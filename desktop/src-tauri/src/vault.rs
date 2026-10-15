//! The encrypted key vault (`desktop-vault` spec).
//!
//! Keys are stored in one file: `{ version, kdf, saltHex, blob }`, where `blob` is the
//! JSON key list sealed with `core::encrypt` under a key derived from the unlock
//! passphrase (Argon2id, parameters stored in the file). All state changes go through
//! one mutex and are saved atomically.

use std::sync::{Arc, Mutex};

use cipherchat_core::{self as core_api, ChatKey, Error as CoreError};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::clock::Clock;
use crate::error::{AppError, ErrorCode};
use crate::hex;
use crate::storage::Storage;

pub const MIN_PASSPHRASE_CHARS: usize = 12;
pub const DEFAULT_AUTO_LOCK_SECS: u64 = 10 * 60;

const VAULT_FILE: &str = "vault.json";
const THROTTLE_FILE: &str = "throttle.json";

/// Failures allowed before waiting starts, and the first and longest wait (seconds).
const FREE_FAILURES: u32 = 3;
const FIRST_WAIT_SECS: u64 = 5;
const MAX_WAIT_SECS: u64 = 15 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

/// Vault key derivation: stronger than the fixed chat-key parameters (design decision 4).
pub const DEFAULT_KDF: KdfParams = KdfParams {
    m_kib: 64 * 1024,
    t: 3,
    p: 1,
};

/// Bounds for parameters read from a vault file, so a crafted file cannot make the app
/// allocate gigabytes.
fn kdf_in_bounds(k: &KdfParams) -> bool {
    (8..=1024 * 1024).contains(&k.m_kib) && (1..=100).contains(&k.t) && (1..=16).contains(&k.p)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultFile {
    version: u32,
    kdf: KdfParams,
    salt_hex: String,
    blob: String,
}

/// One stored key. `key_hex` is wiped from memory when dropped.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyEntry {
    /// Key ID as 8 hex chars.
    pub id: String,
    pub label: String,
    pub key_hex: Zeroizing<String>,
}

impl KeyEntry {
    pub fn key_bytes(&self) -> Option<Zeroizing<Vec<u8>>> {
        hex::decode(&self.key_hex).map(Zeroizing::new)
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Throttle {
    failures: u32,
    next_allowed: u64,
}

/// Seconds to wait after the given number of consecutive failures.
pub fn wait_after(failures: u32) -> u64 {
    if failures < FREE_FAILURES {
        return 0;
    }
    let doublings = (failures - FREE_FAILURES).min(20);
    (FIRST_WAIT_SECS << doublings).min(MAX_WAIT_SECS)
}

struct Unlocked {
    key: ChatKey,
    keys: Vec<KeyEntry>,
    last_activity: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub unlocked: bool,
    pub has_vault: bool,
}

pub struct Vault {
    storage: Box<dyn Storage>,
    clock: Arc<dyn Clock>,
    kdf: KdfParams,
    auto_lock_secs: u64,
    /// Serializes create/unlock so throttling cannot be raced by parallel attempts.
    gate: Mutex<()>,
    /// Guards the unlocked state; held across every modification and its save.
    inner: Mutex<Option<Unlocked>>,
}

fn internal<E>(_: E) -> AppError {
    AppError::new(ErrorCode::Internal)
}

impl Vault {
    pub fn new(storage: Box<dyn Storage>, clock: Arc<dyn Clock>) -> Self {
        Self::with_options(storage, clock, DEFAULT_KDF, DEFAULT_AUTO_LOCK_SECS)
    }

    pub fn with_options(
        storage: Box<dyn Storage>,
        clock: Arc<dyn Clock>,
        kdf: KdfParams,
        auto_lock_secs: u64,
    ) -> Self {
        Self {
            storage,
            clock,
            kdf,
            auto_lock_secs,
            gate: Mutex::new(()),
            inner: Mutex::new(None),
        }
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, Option<Unlocked>> {
        // A panic while holding the lock must not leave the vault unusable or open.
        self.inner.lock().unwrap_or_else(|poisoned| {
            let mut g = poisoned.into_inner();
            *g = None;
            g
        })
    }

    fn read_file(&self) -> Result<Option<VaultFile>, AppError> {
        match self.storage.read(VAULT_FILE).map_err(internal)? {
            None => Ok(None),
            Some(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(internal),
        }
    }

    pub fn status(&self) -> Result<VaultStatus, AppError> {
        let mut g = self.lock_inner();
        self.expire(&mut g);
        Ok(VaultStatus {
            unlocked: g.is_some(),
            has_vault: self.read_file()?.is_some(),
        })
    }

    /// Create the vault on first use and leave it unlocked.
    pub fn create(&self, passphrase: &str) -> Result<(), AppError> {
        let _gate = self.gate.lock().unwrap_or_else(|p| p.into_inner());
        if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
            return Err(ErrorCode::InvalidInput.into());
        }
        if self.read_file()?.is_some() {
            return Err(ErrorCode::VaultExists.into());
        }
        let salt = ChatKey::random_salt();
        let key = derive(passphrase, &salt, &self.kdf)?;
        let file = VaultFile {
            version: 1,
            kdf: self.kdf,
            salt_hex: hex::encode(&salt),
            blob: String::new(),
        };
        let keys: Vec<KeyEntry> = Vec::new();
        self.save(&file, &key, &keys)?;
        *self.lock_inner() = Some(Unlocked {
            key,
            keys,
            last_activity: self.clock.now_secs(),
        });
        Ok(())
    }

    pub fn unlock(&self, passphrase: &str) -> Result<(), AppError> {
        let _gate = self.gate.lock().unwrap_or_else(|p| p.into_inner());
        let file = self.read_file()?.ok_or(ErrorCode::NoVault)?;
        let now = self.clock.now_secs();

        let throttle = self.read_throttle()?;
        if throttle.next_allowed > now {
            // Clamp so a clock moved backwards cannot lock the user out for longer than the cap.
            return Err(AppError::throttled(
                (throttle.next_allowed - now).min(MAX_WAIT_SECS),
            ));
        }

        if !kdf_in_bounds(&file.kdf) {
            return Err(ErrorCode::Internal.into());
        }
        let salt = hex::decode(&file.salt_hex)
            .and_then(|b| <[u8; 16]>::try_from(b).ok())
            .ok_or(ErrorCode::Internal)?;
        let key = derive(passphrase, &salt, &file.kdf)?;

        let keys = match open_blob(&key, &file.blob) {
            Ok(keys) => keys,
            Err(e) if e.code == ErrorCode::WrongPassphrase => {
                let failures = throttle.failures.saturating_add(1);
                self.write_throttle(&Throttle {
                    failures,
                    next_allowed: now + wait_after(failures),
                })?;
                return Err(e);
            }
            // Right passphrase but the file was altered or corrupted: not a guess.
            Err(e) => return Err(e),
        };
        self.write_throttle(&Throttle::default())?;
        *self.lock_inner() = Some(Unlocked {
            key,
            keys,
            last_activity: now,
        });
        Ok(())
    }

    /// Drop the key material. Returns true if the vault was unlocked.
    pub fn lock(&self) -> bool {
        self.lock_inner().take().is_some()
    }

    /// Lock if the inactivity timeout has passed. Returns true if it locked just now.
    pub fn check_inactivity(&self) -> bool {
        let mut g = self.lock_inner();
        self.expire(&mut g)
    }

    fn expire(&self, g: &mut Option<Unlocked>) -> bool {
        let idle = match g.as_ref() {
            Some(u) => self.clock.now_secs().saturating_sub(u.last_activity) >= self.auto_lock_secs,
            None => false,
        };
        if idle {
            *g = None;
        }
        idle
    }

    /// Run `f` over the stored keys. Counts as user activity.
    pub fn read<T>(
        &self,
        f: impl FnOnce(&[KeyEntry]) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut g = self.lock_inner();
        self.expire(&mut g);
        let u = g.as_mut().ok_or(ErrorCode::Locked)?;
        u.last_activity = self.clock.now_secs();
        f(&u.keys)
    }

    /// Apply `f` to a copy of the key list and save it. The in-memory list changes only
    /// if the save succeeds, so a failed write leaves memory and disk consistent.
    pub fn mutate<T>(
        &self,
        f: impl FnOnce(&mut Vec<KeyEntry>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut g = self.lock_inner();
        self.expire(&mut g);
        let u = g.as_mut().ok_or(ErrorCode::Locked)?;
        u.last_activity = self.clock.now_secs();
        let mut next = u.keys.clone();
        let out = f(&mut next)?;
        let file = self.read_file()?.ok_or(ErrorCode::NoVault)?;
        self.save(&file, &u.key, &next)?;
        u.keys = next;
        Ok(out)
    }

    fn save(&self, file: &VaultFile, key: &ChatKey, keys: &[KeyEntry]) -> Result<(), AppError> {
        let mut json = serde_json::to_vec(keys).map_err(internal)?;
        let text = String::from_utf8(std::mem::take(&mut json)).map_err(internal)?;
        let text = Zeroizing::new(text);
        let blob = core_api::encrypt(key, &text).map_err(internal)?;
        let out = VaultFile {
            version: file.version,
            kdf: file.kdf,
            salt_hex: file.salt_hex.clone(),
            blob,
        };
        let bytes = serde_json::to_vec(&out).map_err(internal)?;
        self.storage
            .write_atomic(VAULT_FILE, &bytes)
            .map_err(internal)
    }

    fn read_throttle(&self) -> Result<Throttle, AppError> {
        match self.storage.read(THROTTLE_FILE).map_err(internal)? {
            None => Ok(Throttle::default()),
            // A damaged throttle file must not become a way around throttling or a lockout.
            Some(b) => Ok(serde_json::from_slice(&b).unwrap_or_default()),
        }
    }

    fn write_throttle(&self, t: &Throttle) -> Result<(), AppError> {
        let bytes = serde_json::to_vec(t).map_err(internal)?;
        self.storage
            .write_atomic(THROTTLE_FILE, &bytes)
            .map_err(internal)
    }
}

fn derive(passphrase: &str, salt: &[u8; 16], kdf: &KdfParams) -> Result<ChatKey, AppError> {
    ChatKey::from_passphrase_with_params(passphrase, salt, kdf.m_kib, kdf.t, kdf.p)
        .map_err(internal)
}

fn open_blob(key: &ChatKey, blob: &str) -> Result<Vec<KeyEntry>, AppError> {
    match core_api::decrypt(key, blob) {
        Ok(mut json) => {
            let parsed = serde_json::from_str::<Vec<KeyEntry>>(&json).map_err(internal);
            json.zeroize();
            parsed
        }
        Err(CoreError::WrongKey) => Err(ErrorCode::WrongPassphrase.into()),
        Err(CoreError::Tampered) => Err(ErrorCode::Tampered.into()),
        Err(_) => Err(ErrorCode::Internal.into()),
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::clock::fake::FakeClock;
    use crate::storage::mem::MemStorage;
    use std::sync::atomic::Ordering;

    pub const DEFAULT_AUTO_LOCK_SECS_FOR_TESTS: u64 = super::DEFAULT_AUTO_LOCK_SECS;
    pub const PASS: &str = "correct horse battery";
    /// Cheap parameters so tests run fast; production uses `DEFAULT_KDF`.
    pub const FAST: KdfParams = KdfParams {
        m_kib: 8,
        t: 1,
        p: 1,
    };

    pub struct Rig {
        pub vault: Arc<Vault>,
        pub store: MemStorage,
        pub clock: Arc<FakeClock>,
    }

    pub fn rig() -> Rig {
        rig_with(MemStorage::default(), Arc::new(FakeClock::new(1_000_000)))
    }

    pub fn rig_with(store: MemStorage, clock: Arc<FakeClock>) -> Rig {
        let vault = Arc::new(Vault::with_options(
            Box::new(store.clone()),
            clock.clone(),
            FAST,
            DEFAULT_AUTO_LOCK_SECS,
        ));
        Rig {
            vault,
            store,
            clock,
        }
    }

    pub fn entry(n: u8) -> KeyEntry {
        let key = ChatKey::from_bytes([n; 32]);
        KeyEntry {
            id: hex::encode(&key.key_id()),
            label: format!("key{n}"),
            key_hex: Zeroizing::new(hex::encode(key.as_bytes())),
        }
    }

    fn add(v: &Vault, n: u8) -> Result<(), AppError> {
        v.mutate(|keys| {
            keys.push(entry(n));
            Ok(())
        })
    }

    fn count(v: &Vault) -> usize {
        v.read(|k| Ok(k.len())).unwrap()
    }

    #[test]
    fn create_unlock_round_trip() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        add(&r.vault, 1).unwrap();
        assert!(r.vault.lock());
        assert_eq!(r.vault.read(|_| Ok(())), Err(ErrorCode::Locked.into()));
        r.vault.unlock(PASS).unwrap();
        assert_eq!(count(&r.vault), 1);
    }

    #[test]
    fn status_reports_vault_and_lock_state() {
        let r = rig();
        assert_eq!(
            r.vault.status().unwrap(),
            VaultStatus {
                unlocked: false,
                has_vault: false
            }
        );
        r.vault.create(PASS).unwrap();
        assert_eq!(
            r.vault.status().unwrap(),
            VaultStatus {
                unlocked: true,
                has_vault: true
            }
        );
        r.vault.lock();
        assert_eq!(
            r.vault.status().unwrap(),
            VaultStatus {
                unlocked: false,
                has_vault: true
            }
        );
    }

    #[test]
    fn locked_vault_refuses_everything() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.vault.lock();
        assert_eq!(add(&r.vault, 1), Err(ErrorCode::Locked.into()));
        assert_eq!(r.vault.read(|_| Ok(())), Err(ErrorCode::Locked.into()));
    }

    #[test]
    fn wrong_passphrase_fails_and_stays_locked() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.vault.lock();
        assert_eq!(
            r.vault.unlock("not the passphrase"),
            Err(ErrorCode::WrongPassphrase.into())
        );
        assert!(!r.vault.status().unwrap().unlocked);
    }

    #[test]
    fn vault_file_holds_no_plaintext_key_bytes() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        add(&r.vault, 7).unwrap();
        let file = r
            .store
            .files
            .lock()
            .unwrap()
            .get(VAULT_FILE)
            .unwrap()
            .clone();
        let text = String::from_utf8(file).unwrap();
        let key_hex = hex::encode(&[7u8; 32]);
        assert!(!text.contains(&key_hex), "key hex found in vault file");
        assert!(!text.contains("key7"), "label found in vault file");
        assert!(!text.contains(PASS));
        assert!(
            text.contains("🔒1."),
            "blob should be a sealed CipherChat message"
        );
    }

    #[test]
    fn modified_blob_is_detected_at_unlock() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        add(&r.vault, 1).unwrap();
        r.vault.lock();
        {
            let mut files = r.store.files.lock().unwrap();
            let mut file: VaultFile = serde_json::from_slice(&files[VAULT_FILE]).unwrap();
            // Flip a character in the middle of the sealed payload (past the header).
            let mut chars: Vec<char> = file.blob.chars().collect();
            let i = chars.len() - 5;
            chars[i] = if chars[i] == 'A' { 'B' } else { 'A' };
            file.blob = chars.into_iter().collect();
            files.insert(VAULT_FILE.into(), serde_json::to_vec(&file).unwrap());
        }
        assert_eq!(r.vault.unlock(PASS), Err(ErrorCode::Tampered.into()));
        assert!(!r.vault.status().unwrap().unlocked);
    }

    #[test]
    fn short_passphrase_rejected_and_nothing_written() {
        let r = rig();
        assert_eq!(
            r.vault.create("elevenchars"),
            Err(ErrorCode::InvalidInput.into())
        );
        assert_eq!(r.vault.create(""), Err(ErrorCode::InvalidInput.into()));
        assert!(r.store.files.lock().unwrap().is_empty());
        assert!(!r.vault.status().unwrap().has_vault);
        // Exactly 12 characters is accepted, counted as characters not bytes.
        r.vault.create("twelve chars").unwrap();
    }

    #[test]
    fn passphrase_length_counts_characters() {
        let r = rig();
        // 11 emoji = 11 characters (44 bytes): too short.
        assert_eq!(
            r.vault.create(&"🔑".repeat(11)),
            Err(ErrorCode::InvalidInput.into())
        );
        r.vault.create(&"🔑".repeat(12)).unwrap();
    }

    #[test]
    fn second_create_is_refused() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        assert_eq!(
            r.vault.create("another passphrase"),
            Err(ErrorCode::VaultExists.into())
        );
    }

    #[test]
    fn wait_schedule_doubles_to_the_cap() {
        let waits: Vec<u64> = (0..=12).map(wait_after).collect();
        assert_eq!(waits, [0, 0, 0, 5, 10, 20, 40, 80, 160, 320, 640, 900, 900]);
        assert_eq!(wait_after(u32::MAX), 900);
    }

    fn fail(r: &Rig) -> AppError {
        r.vault.unlock("wrong wrong wrong").unwrap_err()
    }

    #[test]
    fn throttling_after_three_failures() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.vault.lock();
        for _ in 0..3 {
            assert_eq!(fail(&r).code, ErrorCode::WrongPassphrase);
        }
        // Even the correct passphrase is refused during the wait, and the wait is reported.
        assert_eq!(r.vault.unlock(PASS), Err(AppError::throttled(5)));
        r.clock.advance(3);
        assert_eq!(r.vault.unlock(PASS), Err(AppError::throttled(2)));
        r.clock.advance(2);
        // Wait over: a fourth failure doubles the wait to 10 s.
        assert_eq!(fail(&r).code, ErrorCode::WrongPassphrase);
        assert_eq!(r.vault.unlock(PASS), Err(AppError::throttled(10)));
        r.clock.advance(10);
        // Success resets the counter.
        r.vault.unlock(PASS).unwrap();
        r.vault.lock();
        for _ in 0..3 {
            assert_eq!(fail(&r).code, ErrorCode::WrongPassphrase);
        }
        assert_eq!(r.vault.unlock(PASS), Err(AppError::throttled(5)));
    }

    #[test]
    fn wait_is_capped_at_fifteen_minutes() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.vault.lock();
        for _ in 0..30 {
            // Skip any wait so each attempt actually runs and fails.
            r.clock.advance(MAX_WAIT_SECS);
            assert_eq!(fail(&r).code, ErrorCode::WrongPassphrase);
        }
        assert_eq!(r.vault.unlock(PASS), Err(AppError::throttled(900)));
    }

    #[test]
    fn throttling_survives_restart() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.vault.lock();
        for _ in 0..3 {
            fail(&r);
        }
        // "Restart": a brand new Vault over the same storage and clock.
        let restarted = rig_with(r.store.clone(), r.clock.clone());
        assert_eq!(restarted.vault.unlock(PASS), Err(AppError::throttled(5)));
        r.clock.advance(5);
        restarted.vault.unlock(PASS).unwrap();
    }

    #[test]
    fn clock_moved_backwards_cannot_extend_wait_beyond_cap() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.vault.lock();
        for _ in 0..3 {
            fail(&r);
        }
        let clock = Arc::new(FakeClock::new(1)); // far in the past
        let restarted = rig_with(r.store.clone(), clock);
        assert_eq!(
            restarted.vault.unlock(PASS),
            Err(AppError::throttled(MAX_WAIT_SECS))
        );
    }

    #[test]
    fn corrupt_throttle_file_does_not_lock_the_user_out() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.vault.lock();
        r.store
            .files
            .lock()
            .unwrap()
            .insert(THROTTLE_FILE.into(), b"{not json".to_vec());
        r.vault.unlock(PASS).unwrap();
    }

    #[test]
    fn manual_lock_discards_keys() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        add(&r.vault, 1).unwrap();
        assert!(r.vault.lock());
        assert!(!r.vault.lock(), "second lock reports nothing to lock");
        assert_eq!(count_err(&r.vault), ErrorCode::Locked);
    }

    fn count_err(v: &Vault) -> ErrorCode {
        v.read(|k| Ok(k.len())).unwrap_err().code
    }

    #[test]
    fn auto_lock_after_inactivity() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.clock.advance(DEFAULT_AUTO_LOCK_SECS - 1);
        assert!(!r.vault.check_inactivity());
        assert_eq!(count(&r.vault), 0); // activity resets the idle timer
        r.clock.advance(DEFAULT_AUTO_LOCK_SECS - 1);
        assert!(!r.vault.check_inactivity());
        r.clock.advance(1);
        assert!(r.vault.check_inactivity(), "locks at the timeout");
        assert!(!r.vault.check_inactivity(), "reported only once");
        assert_eq!(count_err(&r.vault), ErrorCode::Locked);
    }

    #[test]
    fn operation_after_timeout_is_refused_even_without_the_timer() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.clock.advance(DEFAULT_AUTO_LOCK_SECS);
        assert_eq!(count_err(&r.vault), ErrorCode::Locked);
        assert!(!r.vault.status().unwrap().unlocked);
    }

    #[test]
    fn concurrent_additions_keep_every_key() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        let handles: Vec<_> = (1..=16u8)
            .map(|n| {
                let v = r.vault.clone();
                std::thread::spawn(move || add(&v, n).unwrap())
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(count(&r.vault), 16);
        // And they are all on disk, not just in memory.
        r.vault.lock();
        r.vault.unlock(PASS).unwrap();
        assert_eq!(count(&r.vault), 16);
    }

    #[test]
    fn failed_write_leaves_previous_vault_intact() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        add(&r.vault, 1).unwrap();
        r.store.fail_writes.store(true, Ordering::SeqCst);
        assert_eq!(add(&r.vault, 2), Err(ErrorCode::Internal.into()));
        // Memory was not changed by the failed save...
        assert_eq!(count(&r.vault), 1);
        r.store.fail_writes.store(false, Ordering::SeqCst);
        // ...and the file on disk still holds the previous complete vault.
        r.vault.lock();
        r.vault.unlock(PASS).unwrap();
        assert_eq!(count(&r.vault), 1);
    }

    #[test]
    fn mutation_error_changes_nothing() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        let res: Result<(), AppError> = r.vault.mutate(|keys| {
            keys.push(entry(1));
            Err(ErrorCode::InvalidInput.into())
        });
        assert_eq!(res, Err(ErrorCode::InvalidInput.into()));
        assert_eq!(count(&r.vault), 0);
    }

    #[test]
    fn crafted_kdf_parameters_are_rejected() {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r.vault.lock();
        {
            let mut files = r.store.files.lock().unwrap();
            let mut file: VaultFile = serde_json::from_slice(&files[VAULT_FILE]).unwrap();
            file.kdf.m_kib = u32::MAX;
            files.insert(VAULT_FILE.into(), serde_json::to_vec(&file).unwrap());
        }
        assert_eq!(r.vault.unlock(PASS), Err(ErrorCode::Internal.into()));
    }

    #[test]
    fn unlock_without_a_vault() {
        let r = rig();
        assert_eq!(r.vault.unlock(PASS), Err(ErrorCode::NoVault.into()));
    }

    #[test]
    fn stored_kdf_params_are_used_not_the_current_defaults() {
        // A vault created with older/other parameters still opens after the defaults change.
        let store = MemStorage::default();
        let clock = Arc::new(FakeClock::new(5));
        let old = Vault::with_options(Box::new(store.clone()), clock.clone(), FAST, 600);
        old.create(PASS).unwrap();
        old.lock();
        let newer = Vault::with_options(
            Box::new(store),
            clock,
            KdfParams {
                m_kib: 16,
                t: 2,
                p: 1,
            },
            600,
        );
        newer.unlock(PASS).unwrap();
    }
}
