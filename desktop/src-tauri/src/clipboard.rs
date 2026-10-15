//! Clipboard hygiene (`clipboard-hygiene` spec). The backend puts exported keys and
//! decrypted text on the system clipboard and clears them after a timeout, but only if
//! the clipboard still holds what the app put there.
//!
//! Reading the clipboard is limited to two cases: the user asks to paste, and checking
//! an entry *this module* placed, to avoid wiping something the user copied later. In
//! the second case the content is hashed in memory and dropped; it is never stored,
//! logged or returned.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::clock::Clock;
use crate::error::{AppError, ErrorCode};
use crate::storage::Storage;

const SETTINGS_FILE: &str = "clipboard-settings.json";
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;
pub const MIN_TIMEOUT_SECS: u64 = 5;
pub const MAX_TIMEOUT_SECS: u64 = 600;

/// The system clipboard. Real implementation: [`SystemClipboard`].
pub trait Clipboard: Send + Sync {
    fn write(&self, text: &str) -> Result<(), AppError>;
    /// Current text content, `None` if the clipboard is empty or not text.
    fn read(&self) -> Result<Option<Zeroizing<String>>, AppError>;
    fn clear(&self) -> Result<(), AppError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CopyKind {
    /// An exported `ck1-` key. Always cleared.
    Key,
    /// Decrypted message text.
    Plaintext,
    /// An encrypted message, meant to be pasted into a messenger.
    Ciphertext,
}

/// User-changeable settings. There is deliberately no switch for exported keys, and
/// unknown fields are rejected, so a request cannot try to add one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardSettings {
    pub timeout_secs: u64,
    pub clear_plaintext: bool,
    pub clear_ciphertext: bool,
    /// Copy a newly encrypted message to the clipboard straight away. Absent in files
    /// saved before this setting existed, which then get the default.
    #[serde(default = "default_auto_copy")]
    pub auto_copy_ciphertext: bool,
}

fn default_auto_copy() -> bool {
    true
}

impl Default for ClipboardSettings {
    fn default() -> Self {
        Self {
            timeout_secs: DEFAULT_TIMEOUT_SECS,
            clear_plaintext: true,
            clear_ciphertext: false,
            auto_copy_ciphertext: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOutcome {
    /// Seconds until the clipboard is cleared, if it will be.
    pub clears_in_secs: Option<u64>,
}

struct Pending {
    hash: [u8; 32],
    deadline: u64,
}

fn digest(text: &str) -> [u8; 32] {
    Sha256::digest(text.as_bytes()).into()
}

pub struct ClipboardGuard {
    clipboard: Box<dyn Clipboard>,
    clock: Arc<dyn Clock>,
    storage: Box<dyn Storage>,
    settings: Mutex<ClipboardSettings>,
    pending: Mutex<Option<Pending>>,
}

impl ClipboardGuard {
    pub fn new(
        clipboard: Box<dyn Clipboard>,
        clock: Arc<dyn Clock>,
        storage: Box<dyn Storage>,
    ) -> Self {
        let settings = storage
            .read(SETTINGS_FILE)
            .ok()
            .flatten()
            .and_then(|b| serde_json::from_slice::<ClipboardSettings>(&b).ok())
            .filter(valid)
            .unwrap_or_default();
        Self {
            clipboard,
            clock,
            storage,
            settings: Mutex::new(settings),
            pending: Mutex::new(None),
        }
    }

    pub fn settings(&self) -> ClipboardSettings {
        *self.settings.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn set_settings(&self, new: ClipboardSettings) -> Result<ClipboardSettings, AppError> {
        if !valid(&new) {
            return Err(ErrorCode::InvalidInput.into());
        }
        let bytes = serde_json::to_vec(&new).map_err(|_| ErrorCode::Internal)?;
        self.storage
            .write_atomic(SETTINGS_FILE, &bytes)
            .map_err(|_| ErrorCode::Internal)?;
        *self.settings.lock().unwrap_or_else(|p| p.into_inner()) = new;
        Ok(new)
    }

    /// Copy `text` and schedule clearing according to `kind` and the settings.
    pub fn copy(&self, kind: CopyKind, text: &str) -> Result<CopyOutcome, AppError> {
        let s = self.settings();
        let clears = match kind {
            CopyKind::Key => true,
            CopyKind::Plaintext => s.clear_plaintext,
            CopyKind::Ciphertext => s.clear_ciphertext,
        };
        self.clipboard.write(text)?;
        let mut pending = self.pending.lock().unwrap_or_else(|p| p.into_inner());
        *pending = clears.then(|| Pending {
            hash: digest(text),
            deadline: self.clock.now_secs() + s.timeout_secs,
        });
        Ok(CopyOutcome {
            clears_in_secs: clears.then_some(s.timeout_secs),
        })
    }

    /// Clear the clipboard if the timeout has passed. Called regularly; does nothing,
    /// and does not touch the clipboard, when nothing is pending.
    pub fn tick(&self) {
        let due = {
            let pending = self.pending.lock().unwrap_or_else(|p| p.into_inner());
            pending
                .as_ref()
                .is_some_and(|p| self.clock.now_secs() >= p.deadline)
        };
        if due {
            self.clear_pending();
        }
    }

    /// Clear now (lock, exit), but only if the clipboard still holds our entry.
    pub fn clear_pending(&self) {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take();
        let Some(p) = pending else { return };
        // Read only to compare with the hash of what we wrote; the text is dropped
        // (and wiped) right here.
        let unchanged = match self.clipboard.read() {
            Ok(Some(current)) => digest(&current) == p.hash,
            Ok(None) => false,
            // Cannot tell: clearing is the safer failure for a key or plaintext.
            Err(_) => true,
        };
        if unchanged {
            let _ = self.clipboard.clear();
        }
    }

    /// Whether an app-placed entry is waiting to be cleared.
    pub fn has_pending(&self) -> bool {
        self.pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .is_some()
    }

    /// Clipboard text for the user's explicit paste action.
    pub fn paste(&self) -> Result<Option<Zeroizing<String>>, AppError> {
        self.clipboard.read()
    }
}

fn valid(s: &ClipboardSettings) -> bool {
    (MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&s.timeout_secs)
}

/// The operating system clipboard, via `arboard`. One long-lived handle, because on
/// Linux the clipboard contents vanish when the owning handle is dropped.
pub struct SystemClipboard {
    inner: Mutex<Option<arboard::Clipboard>>,
}

impl SystemClipboard {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    fn with<T>(
        &self,
        f: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>,
    ) -> Result<T, AppError> {
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if g.is_none() {
            *g = Some(arboard::Clipboard::new().map_err(|_| ErrorCode::Internal)?);
        }
        f(g.as_mut().expect("just set")).map_err(|_| ErrorCode::Internal.into())
    }
}

impl Default for SystemClipboard {
    fn default() -> Self {
        Self::new()
    }
}

impl Clipboard for SystemClipboard {
    fn write(&self, text: &str) -> Result<(), AppError> {
        self.with(|c| c.set_text(text.to_owned()))
    }

    fn read(&self) -> Result<Option<Zeroizing<String>>, AppError> {
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if g.is_none() {
            *g = Some(arboard::Clipboard::new().map_err(|_| ErrorCode::Internal)?);
        }
        match g.as_mut().expect("just set").get_text() {
            Ok(t) => Ok(Some(Zeroizing::new(t))),
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(_) => Err(ErrorCode::Internal.into()),
        }
    }

    fn clear(&self) -> Result<(), AppError> {
        self.with(|c| c.clear())
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    /// Test clipboard that counts reads and can simulate another app copying.
    #[derive(Default, Clone)]
    pub struct FakeClipboard {
        pub content: Arc<Mutex<Option<String>>>,
        pub reads: Arc<AtomicUsize>,
        pub fail_reads: Arc<AtomicBool>,
    }

    impl FakeClipboard {
        pub fn get(&self) -> Option<String> {
            self.content.lock().unwrap().clone()
        }
        /// Another application (or the user) copies something.
        pub fn external_copy(&self, text: &str) {
            *self.content.lock().unwrap() = Some(text.to_string());
        }
        pub fn read_count(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }
    }

    impl Clipboard for FakeClipboard {
        fn write(&self, text: &str) -> Result<(), AppError> {
            *self.content.lock().unwrap() = Some(text.to_string());
            Ok(())
        }
        fn read(&self) -> Result<Option<Zeroizing<String>>, AppError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.fail_reads.load(Ordering::SeqCst) {
                return Err(ErrorCode::Internal.into());
            }
            Ok(self.get().map(Zeroizing::new))
        }
        fn clear(&self) -> Result<(), AppError> {
            *self.content.lock().unwrap() = None;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeClipboard;
    use super::*;
    use crate::clock::fake::FakeClock;
    use crate::storage::mem::MemStorage;

    struct Rig {
        guard: ClipboardGuard,
        cb: FakeClipboard,
        clock: Arc<FakeClock>,
        store: MemStorage,
    }

    fn rig() -> Rig {
        rig_with(MemStorage::default(), Arc::new(FakeClock::new(1_000)))
    }

    fn rig_with(store: MemStorage, clock: Arc<FakeClock>) -> Rig {
        let cb = FakeClipboard::default();
        let guard =
            ClipboardGuard::new(Box::new(cb.clone()), clock.clone(), Box::new(store.clone()));
        Rig {
            guard,
            cb,
            clock,
            store,
        }
    }

    #[test]
    fn exported_key_is_cleared_after_30_seconds() {
        let r = rig();
        let out = r.guard.copy(CopyKind::Key, "ck1-abc").unwrap();
        assert_eq!(out.clears_in_secs, Some(30));
        assert_eq!(r.cb.get().as_deref(), Some("ck1-abc"));
        r.clock.advance(29);
        r.guard.tick();
        assert_eq!(
            r.cb.get().as_deref(),
            Some("ck1-abc"),
            "still there before the timeout"
        );
        r.clock.advance(1);
        r.guard.tick();
        assert_eq!(r.cb.get(), None);
        assert!(!r.guard.has_pending());
    }

    #[test]
    fn decrypted_plaintext_is_cleared_after_30_seconds() {
        let r = rig();
        assert_eq!(
            r.guard
                .copy(CopyKind::Plaintext, "secret")
                .unwrap()
                .clears_in_secs,
            Some(30)
        );
        r.clock.advance(30);
        r.guard.tick();
        assert_eq!(r.cb.get(), None);
    }

    #[test]
    fn ciphertext_is_not_cleared_by_default() {
        let r = rig();
        let out = r.guard.copy(CopyKind::Ciphertext, "abc").unwrap();
        assert_eq!(out.clears_in_secs, None);
        assert!(!r.guard.has_pending());
        r.clock.advance(10_000);
        r.guard.tick();
        assert_eq!(r.cb.get().as_deref(), Some("abc"));
        assert_eq!(
            r.cb.read_count(),
            0,
            "nothing pending, so the clipboard is never read"
        );
    }

    #[test]
    fn ciphertext_clearing_can_be_enabled() {
        let r = rig();
        r.guard
            .set_settings(ClipboardSettings {
                clear_ciphertext: true,
                ..ClipboardSettings::default()
            })
            .unwrap();
        assert_eq!(
            r.guard
                .copy(CopyKind::Ciphertext, "abc")
                .unwrap()
                .clears_in_secs,
            Some(30)
        );
        r.clock.advance(30);
        r.guard.tick();
        assert_eq!(r.cb.get(), None);
    }

    #[test]
    fn something_copied_later_is_left_alone() {
        let r = rig();
        r.guard.copy(CopyKind::Key, "ck1-abc").unwrap();
        r.cb.external_copy("my shopping list");
        r.clock.advance(30);
        r.guard.tick();
        assert_eq!(r.cb.get().as_deref(), Some("my shopping list"));
        assert!(!r.guard.has_pending(), "the entry is resolved either way");
    }

    #[test]
    fn user_emptied_clipboard_is_left_alone() {
        let r = rig();
        r.guard.copy(CopyKind::Key, "ck1-abc").unwrap();
        *r.cb.content.lock().unwrap() = None;
        r.clock.advance(30);
        r.guard.tick();
        assert_eq!(r.cb.get(), None);
    }

    #[test]
    fn a_newer_copy_replaces_the_pending_one() {
        let r = rig();
        r.guard.copy(CopyKind::Key, "ck1-first").unwrap();
        r.clock.advance(20);
        r.guard.copy(CopyKind::Plaintext, "second").unwrap();
        r.clock.advance(15); // first deadline passed, second not yet
        r.guard.tick();
        assert_eq!(r.cb.get().as_deref(), Some("second"));
        r.clock.advance(15);
        r.guard.tick();
        assert_eq!(r.cb.get(), None);
    }

    #[test]
    fn copying_ciphertext_after_a_key_cancels_the_pending_clear() {
        // The clipboard now holds ciphertext, which must not be wiped by the key's timer.
        let r = rig();
        r.guard.copy(CopyKind::Key, "ck1-abc").unwrap();
        r.guard.copy(CopyKind::Ciphertext, "abc").unwrap();
        r.clock.advance(60);
        r.guard.tick();
        assert_eq!(r.cb.get().as_deref(), Some("abc"));
    }

    #[test]
    fn lock_or_exit_clears_immediately_when_unchanged() {
        let r = rig();
        r.guard.copy(CopyKind::Key, "ck1-abc").unwrap();
        r.guard.clear_pending();
        assert_eq!(r.cb.get(), None);
        assert!(!r.guard.has_pending());
    }

    #[test]
    fn lock_or_exit_keeps_a_changed_clipboard() {
        let r = rig();
        r.guard.copy(CopyKind::Plaintext, "secret").unwrap();
        r.cb.external_copy("other");
        r.guard.clear_pending();
        assert_eq!(r.cb.get().as_deref(), Some("other"));
    }

    #[test]
    fn lock_with_nothing_pending_does_nothing() {
        let r = rig();
        r.cb.external_copy("untouched");
        r.guard.clear_pending();
        assert_eq!(r.cb.get().as_deref(), Some("untouched"));
        assert_eq!(r.cb.read_count(), 0);
    }

    #[test]
    fn unreadable_clipboard_is_cleared_rather_than_left_with_a_key() {
        let r = rig();
        r.guard.copy(CopyKind::Key, "ck1-abc").unwrap();
        r.cb.fail_reads
            .store(true, std::sync::atomic::Ordering::SeqCst);
        r.guard.clear_pending();
        assert_eq!(r.cb.get(), None);
    }

    // ---- settings ----

    #[test]
    fn timeout_is_configurable_and_applies_to_later_copies() {
        let r = rig();
        let s = ClipboardSettings {
            timeout_secs: 10,
            ..ClipboardSettings::default()
        };
        r.guard.set_settings(s).unwrap();
        assert_eq!(
            r.guard
                .copy(CopyKind::Key, "ck1-abc")
                .unwrap()
                .clears_in_secs,
            Some(10)
        );
        r.clock.advance(10);
        r.guard.tick();
        assert_eq!(r.cb.get(), None);
    }

    #[test]
    fn plaintext_clearing_can_be_turned_off() {
        let r = rig();
        r.guard
            .set_settings(ClipboardSettings {
                clear_plaintext: false,
                ..ClipboardSettings::default()
            })
            .unwrap();
        assert_eq!(
            r.guard
                .copy(CopyKind::Plaintext, "secret")
                .unwrap()
                .clears_in_secs,
            None
        );
        // ...but exported keys are still cleared.
        assert_eq!(
            r.guard
                .copy(CopyKind::Key, "ck1-abc")
                .unwrap()
                .clears_in_secs,
            Some(30)
        );
    }

    #[test]
    fn clearing_for_keys_cannot_be_disabled() {
        let r = rig();
        // A timeout of 0 (or anything outside the range) would amount to "never/instant".
        for t in [0, 1, MIN_TIMEOUT_SECS - 1, MAX_TIMEOUT_SECS + 1, u64::MAX] {
            let s = ClipboardSettings {
                timeout_secs: t,
                ..ClipboardSettings::default()
            };
            assert_eq!(
                r.guard.set_settings(s).unwrap_err().code,
                ErrorCode::InvalidInput,
                "{t}"
            );
        }
        assert_eq!(r.guard.settings(), ClipboardSettings::default());
        // There is no field for it: a request that tries to add one does not parse.
        for json in [
            r#"{"timeoutSecs":30,"clearPlaintext":true,"clearCiphertext":false,"clearKeys":false}"#,
            r#"{"timeoutSecs":30,"clearPlaintext":true,"clearCiphertext":false,"clearKey":false}"#,
        ] {
            assert!(
                serde_json::from_str::<ClipboardSettings>(json).is_err(),
                "{json}"
            );
        }
        assert!(serde_json::from_str::<ClipboardSettings>(
            r#"{"timeoutSecs":30,"clearPlaintext":true,"clearCiphertext":false}"#
        )
        .is_ok());
    }

    #[test]
    fn settings_persist_and_bad_files_fall_back_to_defaults() {
        let r = rig();
        let s = ClipboardSettings {
            timeout_secs: 90,
            clear_plaintext: false,
            clear_ciphertext: true,
            auto_copy_ciphertext: false,
        };
        r.guard.set_settings(s).unwrap();
        let again = rig_with(r.store.clone(), r.clock.clone());
        assert_eq!(again.guard.settings(), s);

        for bad in [
            &b"{nope"[..],
            br#"{"timeoutSecs":0,"clearPlaintext":true,"clearCiphertext":false}"#,
        ] {
            let store = MemStorage::default();
            store
                .files
                .lock()
                .unwrap()
                .insert(SETTINGS_FILE.into(), bad.to_vec());
            assert_eq!(
                rig_with(store, r.clock.clone()).guard.settings(),
                ClipboardSettings::default()
            );
        }
    }

    #[test]
    fn auto_copy_defaults_on_and_old_settings_files_keep_their_values() {
        assert!(ClipboardSettings::default().auto_copy_ciphertext);
        let r = rig();
        let store = MemStorage::default();
        store.files.lock().unwrap().insert(
            SETTINGS_FILE.into(),
            br#"{"timeoutSecs":90,"clearPlaintext":false,"clearCiphertext":true}"#.to_vec(),
        );
        assert_eq!(
            rig_with(store, r.clock.clone()).guard.settings(),
            ClipboardSettings {
                timeout_secs: 90,
                clear_plaintext: false,
                clear_ciphertext: true,
                auto_copy_ciphertext: true,
            }
        );
    }

    #[test]
    fn failed_settings_save_changes_nothing() {
        let r = rig();
        r.store
            .fail_writes
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let s = ClipboardSettings {
            timeout_secs: 90,
            ..ClipboardSettings::default()
        };
        assert_eq!(
            r.guard.set_settings(s).unwrap_err().code,
            ErrorCode::Internal
        );
        assert_eq!(r.guard.settings(), ClipboardSettings::default());
    }

    // ---- the clipboard-read rule (message-workbench: no reading on its own) ----

    #[test]
    fn clipboard_is_read_only_to_check_our_own_pending_entry() {
        let r = rig();
        // No activity: ticking never reads.
        for _ in 0..5 {
            r.clock.advance(100);
            r.guard.tick();
        }
        assert_eq!(r.cb.read_count(), 0);
        // Copying writes; it does not read.
        r.guard.copy(CopyKind::Key, "ck1-abc").unwrap();
        assert_eq!(r.cb.read_count(), 0);
        // Before the deadline, ticks do not read either.
        r.clock.advance(10);
        r.guard.tick();
        assert_eq!(r.cb.read_count(), 0);
        // At the deadline: exactly one read, to compare with our hash.
        r.clock.advance(20);
        r.guard.tick();
        assert_eq!(r.cb.read_count(), 1);
        // Resolved: no further reads, whatever the user copies next.
        r.cb.external_copy("private");
        r.clock.advance(1_000);
        r.guard.tick();
        r.guard.clear_pending();
        assert_eq!(r.cb.read_count(), 1);
        assert_eq!(r.cb.get().as_deref(), Some("private"));
    }

    #[test]
    fn explicit_paste_is_the_only_other_read() {
        let r = rig();
        r.cb.external_copy("pasted");
        assert_eq!(
            r.guard.paste().unwrap().as_deref().map(String::as_str),
            Some("pasted")
        );
        assert_eq!(r.cb.read_count(), 1);
    }

    #[test]
    fn only_this_module_touches_the_system_clipboard() {
        let src = format!("{}/src", env!("CARGO_MANIFEST_DIR"));
        for entry in std::fs::read_dir(src).unwrap() {
            let path = entry.unwrap().path();
            if path.file_name().unwrap() == "clipboard.rs" {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            let production = text.split("#[cfg(test)]").next().unwrap();
            assert!(
                !production.contains("arboard"),
                "{} uses arboard directly",
                path.display()
            );
        }
        let cargo =
            std::fs::read_to_string(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR"))).unwrap();
        assert!(
            !cargo.contains("clipboard-manager"),
            "webview-reachable clipboard plugin"
        );
    }
}
