//! Key management (`desktop-key-management` spec): create, derive, import, export, label
//! and delete keys in the vault. Raw key bytes leave this module only through `export`.

use cipherchat_core::{ChatKey, KEY_LEN, SALT_LEN};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, ErrorCode};
use crate::hex;
use crate::vault::{KeyEntry, Vault, MIN_PASSPHRASE_CHARS};

pub const EXPORT_PREFIX: &str = "ck1-";
pub const MAX_LABEL_CHARS: usize = 64;

/// What the UI may know about a key: never the key itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    /// Key ID as 8 hex chars.
    pub id: String,
    pub label: String,
    pub fingerprint: String,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum KeySource {
    Generate,
    /// Derive from a shared passphrase and a 16-byte salt (hex). A salt is generated if absent.
    Passphrase {
        passphrase: Zeroizing<String>,
        salt_hex: Option<String>,
    },
    /// A `ck1-<64 hex>` string produced by `export`.
    Import {
        exported: Zeroizing<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddOutcome {
    pub key: KeyInfo,
    /// Salt used for a passphrase-derived key, to share together with the passphrase.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salt_hex: Option<String>,
    /// The identical key was already stored; nothing was changed.
    pub already_exists: bool,
    /// The passphrase is short enough to be guessed offline from captured messages.
    pub weak_passphrase: bool,
}

fn info(e: &KeyEntry) -> Result<KeyInfo, AppError> {
    let bytes = e.key_bytes().ok_or(ErrorCode::Internal)?;
    let arr: [u8; KEY_LEN] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| ErrorCode::Internal)?;
    Ok(KeyInfo {
        id: e.id.clone(),
        label: e.label.clone(),
        fingerprint: ChatKey::from_bytes(arr).fingerprint(),
    })
}

fn clean_label(label: &str) -> Result<String, AppError> {
    let label = label.trim();
    if label.chars().count() > MAX_LABEL_CHARS || label.chars().any(char::is_control) {
        return Err(ErrorCode::InvalidInput.into());
    }
    Ok(label.to_string())
}

pub fn list(vault: &Vault) -> Result<Vec<KeyInfo>, AppError> {
    vault.read(|keys| keys.iter().map(info).collect())
}

pub fn add(vault: &Vault, label: &str, source: KeySource) -> Result<AddOutcome, AppError> {
    let label = clean_label(label)?;
    // Fail fast when locked, before spending time on key derivation.
    vault.read(|_| Ok(()))?;

    let mut salt_hex = None;
    let mut weak_passphrase = false;
    let key: ChatKey = match source {
        KeySource::Generate => ChatKey::generate(),
        KeySource::Passphrase {
            passphrase,
            salt_hex: given,
        } => {
            if passphrase.is_empty() {
                return Err(ErrorCode::InvalidInput.into());
            }
            weak_passphrase = passphrase.chars().count() < MIN_PASSPHRASE_CHARS;
            let salt: [u8; SALT_LEN] =
                match given.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    Some(s) => hex::decode(s)
                        .and_then(|b| b.try_into().ok())
                        .ok_or(ErrorCode::InvalidInput)?,
                    None => ChatKey::random_salt(),
                };
            salt_hex = Some(hex::encode(&salt));
            ChatKey::from_passphrase(&passphrase, &salt).map_err(|_| ErrorCode::Internal)?
        }
        KeySource::Import { exported } => {
            let hex_part = exported
                .trim()
                .strip_prefix(EXPORT_PREFIX)
                .ok_or(ErrorCode::InvalidInput)?;
            let bytes = Zeroizing::new(hex::decode(hex_part).ok_or(ErrorCode::InvalidInput)?);
            let arr: [u8; KEY_LEN] = bytes
                .as_slice()
                .try_into()
                .map_err(|_| ErrorCode::InvalidInput)?;
            ChatKey::from_bytes(arr)
        }
    };

    let entry = KeyEntry {
        id: hex::encode(&key.key_id()),
        label: if label.is_empty() {
            key.fingerprint()
        } else {
            label
        },
        key_hex: Zeroizing::new(hex::encode(key.as_bytes())),
    };
    let (key_info, already_exists) = vault.mutate(|keys| {
        let inserted = insert(keys, entry)?;
        let stored = keys
            .iter()
            .find(|k| k.id == inserted.id)
            .ok_or(ErrorCode::Internal)?;
        Ok((info(stored)?, inserted.already_exists))
    })?;
    Ok(AddOutcome {
        key: key_info,
        salt_hex,
        already_exists,
        weak_passphrase,
    })
}

struct Inserted {
    id: String,
    already_exists: bool,
}

/// Add `entry` unless the same key is stored. A *different* key with the same 4-byte ID
/// is refused: the ID is how incoming messages pick a key, so two keys cannot share one.
fn insert(keys: &mut Vec<KeyEntry>, entry: KeyEntry) -> Result<Inserted, AppError> {
    if let Some(existing) = keys.iter().find(|k| k.id == entry.id) {
        // Compare the stored key with the new one without short-circuiting on content.
        return if *existing.key_hex == *entry.key_hex {
            Ok(Inserted {
                id: entry.id,
                already_exists: true,
            })
        } else {
            Err(ErrorCode::KeyCollision.into())
        };
    }
    let id = entry.id.clone();
    keys.push(entry);
    Ok(Inserted {
        id,
        already_exists: false,
    })
}

pub fn rename(vault: &Vault, id: &str, label: &str) -> Result<KeyInfo, AppError> {
    let label = clean_label(label)?;
    vault.mutate(|keys| {
        let k = keys
            .iter_mut()
            .find(|k| k.id == id)
            .ok_or(ErrorCode::NoSuchKey)?;
        let fingerprint = info(k)?.fingerprint;
        k.label = if label.is_empty() { fingerprint } else { label };
        info(k)
    })
}

pub fn delete(vault: &Vault, id: &str) -> Result<(), AppError> {
    vault.mutate(|keys| {
        let before = keys.len();
        keys.retain(|k| k.id != id);
        if keys.len() == before {
            return Err(ErrorCode::NoSuchKey.into());
        }
        Ok(())
    })
}

/// The only place a raw key leaves the backend, as a `ck1-` string.
pub fn export(vault: &Vault, id: &str) -> Result<Zeroizing<String>, AppError> {
    vault.read(|keys| {
        let k = keys
            .iter()
            .find(|k| k.id == id)
            .ok_or(ErrorCode::NoSuchKey)?;
        Ok(Zeroizing::new(format!("{EXPORT_PREFIX}{}", *k.key_hex)))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::tests::{entry, rig, Rig, PASS};

    fn unlocked() -> Rig {
        let r = rig();
        r.vault.create(PASS).unwrap();
        r
    }

    fn passphrase(p: &str, salt: Option<&str>) -> KeySource {
        KeySource::Passphrase {
            passphrase: Zeroizing::new(p.to_string()),
            salt_hex: salt.map(String::from),
        }
    }

    fn import(s: &str) -> KeySource {
        KeySource::Import {
            exported: Zeroizing::new(s.to_string()),
        }
    }

    const SALT: &str = "000102030405060708090a0b0c0d0e0f";

    #[test]
    fn generate_adds_a_key_with_fingerprint_label_by_default() {
        let r = unlocked();
        let out = add(&r.vault, "", KeySource::Generate).unwrap();
        assert!(!out.already_exists);
        assert_eq!(out.key.label, out.key.fingerprint);
        assert_eq!(out.key.fingerprint.len(), 9);
        assert_eq!(out.key.id.len(), 8);
        assert_eq!(list(&r.vault).unwrap(), [out.key]);
    }

    #[test]
    fn two_generated_keys_differ() {
        let r = unlocked();
        let a = add(&r.vault, "a", KeySource::Generate).unwrap().key;
        let b = add(&r.vault, "b", KeySource::Generate).unwrap().key;
        assert_ne!(a.id, b.id);
        assert_eq!(list(&r.vault).unwrap().len(), 2);
    }

    #[test]
    fn same_passphrase_and_salt_give_the_same_fingerprint() {
        let a = unlocked();
        let b = unlocked();
        let ka = add(
            &a.vault,
            "x",
            passphrase("shared secret phrase", Some(SALT)),
        )
        .unwrap();
        let kb = add(
            &b.vault,
            "y",
            passphrase("shared secret phrase", Some(SALT)),
        )
        .unwrap();
        assert_eq!(ka.key.fingerprint, kb.key.fingerprint);
        assert_eq!(ka.key.id, kb.key.id);
        assert_eq!(ka.salt_hex.as_deref(), Some(SALT));
        let other_salt = add(
            &a.vault,
            "z",
            passphrase("shared secret phrase", Some("ff".repeat(16).as_str())),
        )
        .unwrap();
        assert_ne!(other_salt.key.fingerprint, ka.key.fingerprint);
    }

    #[test]
    fn missing_salt_is_generated_and_reported() {
        let r = unlocked();
        let out = add(&r.vault, "p", passphrase("a long enough phrase", None)).unwrap();
        let salt = out.salt_hex.unwrap();
        assert_eq!(salt.len(), 32);
        // Re-deriving elsewhere with that salt reproduces the key.
        let other = unlocked();
        let again = add(
            &other.vault,
            "p",
            passphrase("a long enough phrase", Some(&salt)),
        )
        .unwrap();
        assert_eq!(again.key.fingerprint, out.key.fingerprint);
    }

    #[test]
    fn bad_salts_and_empty_passphrase_are_rejected() {
        let r = unlocked();
        for salt in ["zz", "0011", &"00".repeat(17), "+1".repeat(8).as_str()] {
            assert_eq!(
                add(
                    &r.vault,
                    "p",
                    passphrase("a long enough phrase", Some(salt))
                )
                .unwrap_err()
                .code,
                ErrorCode::InvalidInput,
                "salt {salt}"
            );
        }
        assert_eq!(
            add(&r.vault, "p", passphrase("", None)).unwrap_err().code,
            ErrorCode::InvalidInput
        );
        assert!(list(&r.vault).unwrap().is_empty());
    }

    #[test]
    fn short_passphrase_is_flagged_not_blocked() {
        let r = unlocked();
        assert!(
            add(&r.vault, "s", passphrase("short", None))
                .unwrap()
                .weak_passphrase
        );
        assert!(
            !add(&r.vault, "l", passphrase("twelve chars", None))
                .unwrap()
                .weak_passphrase
        );
    }

    #[test]
    fn export_import_round_trip_keeps_fingerprint_and_decrypts() {
        let a = unlocked();
        let b = unlocked();
        let k = add(&a.vault, "shared", KeySource::Generate).unwrap().key;
        let exported = export(&a.vault, &k.id).unwrap();
        assert!(exported.starts_with("ck1-"));
        assert_eq!(exported.len(), 4 + 64);
        let imported = add(&b.vault, "from a", import(&format!("  {}\n", *exported))).unwrap();
        assert_eq!(imported.key.fingerprint, k.fingerprint);
        assert_eq!(imported.key.id, k.id);

        // The same message decrypts with the key stored in either vault.
        let bytes_a = a.vault.read(|ks| Ok(ks[0].key_bytes().unwrap())).unwrap();
        let bytes_b = b.vault.read(|ks| Ok(ks[0].key_bytes().unwrap())).unwrap();
        let wire = cipherchat_core::encrypt(
            &ChatKey::from_bytes(bytes_a.as_slice().try_into().unwrap()),
            "hi",
        )
        .unwrap();
        let key_b = ChatKey::from_bytes(bytes_b.as_slice().try_into().unwrap());
        assert_eq!(cipherchat_core::decrypt(&key_b, &wire).unwrap(), "hi");
    }

    #[test]
    fn malformed_imports_store_nothing() {
        let r = unlocked();
        let good = format!("ck1-{}", "ab".repeat(32));
        let cases = [
            "".to_string(),
            "ck1-".to_string(),
            "ck2-".to_string() + &"ab".repeat(32),
            "ab".repeat(32),
            good.replace("ab", "zz"),
            format!("ck1-{}", "ab".repeat(31)),
            format!("ck1-{}", "ab".repeat(33)),
            format!("ck1-{}a", "ab".repeat(32)),
            format!("ck1-+1{}", "ab".repeat(31)),
        ];
        for c in &cases {
            assert_eq!(
                add(&r.vault, "", import(c)).unwrap_err().code,
                ErrorCode::InvalidInput,
                "{c}"
            );
        }
        assert!(list(&r.vault).unwrap().is_empty());
        add(&r.vault, "", import(&good)).unwrap();
    }

    #[test]
    fn adding_the_same_key_twice_keeps_the_existing_entry() {
        let r = unlocked();
        let first = add(&r.vault, "original", KeySource::Generate).unwrap().key;
        let exported = export(&r.vault, &first.id).unwrap();
        let again = add(&r.vault, "renamed attempt", import(&exported)).unwrap();
        assert!(again.already_exists);
        assert_eq!(again.key.label, "original");
        assert_eq!(list(&r.vault).unwrap().len(), 1);
    }

    #[test]
    fn different_key_with_the_same_id_is_rejected_without_replacing() {
        // Two real keys sharing a 4-byte ID cannot be found cheaply, so build the entries.
        let mut keys = vec![entry(1)];
        let mut clash = entry(2);
        clash.id = keys[0].id.clone();
        assert_eq!(
            insert(&mut keys, clash).err().unwrap().code,
            ErrorCode::KeyCollision
        );
        assert_eq!(keys.len(), 1);
        assert_eq!(*keys[0].key_hex, hex::encode(&[1u8; 32]));

        let same = entry(1);
        assert!(insert(&mut keys, same).unwrap().already_exists);
        assert_eq!(keys.len(), 1);
        assert!(insert(&mut keys, entry(3)).is_ok());
        assert_eq!(keys.len(), 2);
    }

    #[test]
    fn labels_are_trimmed_validated_and_renamable() {
        let r = unlocked();
        let k = add(&r.vault, "  Alice  ", KeySource::Generate).unwrap().key;
        assert_eq!(k.label, "Alice");
        assert_eq!(
            add(&r.vault, &"x".repeat(65), KeySource::Generate)
                .unwrap_err()
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            add(&r.vault, "bad\nlabel", KeySource::Generate)
                .unwrap_err()
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(rename(&r.vault, &k.id, "Bob").unwrap().label, "Bob");
        assert_eq!(rename(&r.vault, &k.id, "").unwrap().label, k.fingerprint);
        assert_eq!(
            rename(&r.vault, "deadbeef", "x").unwrap_err().code,
            ErrorCode::NoSuchKey
        );
    }

    #[test]
    fn delete_removes_the_key_for_good() {
        let r = unlocked();
        let k = add(&r.vault, "gone", KeySource::Generate).unwrap().key;
        delete(&r.vault, &k.id).unwrap();
        assert!(list(&r.vault).unwrap().is_empty());
        assert_eq!(
            export(&r.vault, &k.id).unwrap_err().code,
            ErrorCode::NoSuchKey
        );
        assert_eq!(
            delete(&r.vault, &k.id).unwrap_err().code,
            ErrorCode::NoSuchKey
        );
        // Still gone after a lock/unlock cycle.
        r.vault.lock();
        r.vault.unlock(PASS).unwrap();
        assert!(list(&r.vault).unwrap().is_empty());
    }

    #[test]
    fn everything_is_refused_while_locked() {
        let r = unlocked();
        let k = add(&r.vault, "k", KeySource::Generate).unwrap().key;
        r.vault.lock();
        assert_eq!(list(&r.vault).unwrap_err().code, ErrorCode::Locked);
        assert_eq!(
            add(&r.vault, "", KeySource::Generate).unwrap_err().code,
            ErrorCode::Locked
        );
        assert_eq!(export(&r.vault, &k.id).unwrap_err().code, ErrorCode::Locked);
        assert_eq!(delete(&r.vault, &k.id).unwrap_err().code, ErrorCode::Locked);
        assert_eq!(
            rename(&r.vault, &k.id, "x").unwrap_err().code,
            ErrorCode::Locked
        );
        // Locked passphrase derivation fails fast, without needing the slow KDF.
        assert_eq!(
            add(&r.vault, "", passphrase("a long enough phrase", None))
                .unwrap_err()
                .code,
            ErrorCode::Locked
        );
    }

    #[test]
    fn responses_to_the_ui_never_contain_key_bytes() {
        let r = unlocked();
        let g = add(&r.vault, "g", KeySource::Generate).unwrap();
        let p = add(
            &r.vault,
            "p",
            passphrase("a long enough phrase", Some(SALT)),
        )
        .unwrap();
        let src = hex::encode(&[9u8; 32]);
        let i = add(&r.vault, "i", import(&format!("ck1-{src}"))).unwrap();
        let again = add(&r.vault, "i", import(&format!("ck1-{src}"))).unwrap();
        let rn = rename(&r.vault, &g.key.id, "renamed").unwrap();

        let mut shown = vec![
            serde_json::to_string(&list(&r.vault).unwrap()).unwrap(),
            serde_json::to_string(&rn).unwrap(),
        ];
        for o in [&g, &p, &i, &again] {
            shown.push(serde_json::to_string(o).unwrap());
        }
        let secrets: Vec<String> = r
            .vault
            .read(|ks| Ok(ks.iter().map(|k| (*k.key_hex).clone()).collect()))
            .unwrap();
        assert_eq!(secrets.len(), 3);
        for json in &shown {
            assert!(!json.to_lowercase().contains("keyhex"), "{json}");
            for s in &secrets {
                assert!(!json.contains(s.as_str()), "key bytes leaked in {json}");
            }
        }
        // Only an explicit export reveals the key.
        assert!(export(&r.vault, &i.key.id).unwrap().contains(&src));
    }

    #[test]
    fn key_source_json_shape() {
        let g: KeySource = serde_json::from_str(r#"{"kind":"generate"}"#).unwrap();
        assert!(matches!(g, KeySource::Generate));
        let p: KeySource =
            serde_json::from_str(r#"{"kind":"passphrase","passphrase":"x","saltHex":"00"}"#)
                .unwrap();
        assert!(matches!(
            p,
            KeySource::Passphrase {
                salt_hex: Some(_),
                ..
            }
        ));
        let i: KeySource =
            serde_json::from_str(r#"{"kind":"import","exported":"ck1-00"}"#).unwrap();
        assert!(matches!(i, KeySource::Import { .. }));
        assert!(serde_json::from_str::<KeySource>(r#"{"kind":"other"}"#).is_err());
    }
}
