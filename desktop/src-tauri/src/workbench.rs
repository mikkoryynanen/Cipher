//! The paste-in/copy-out workflow (`message-workbench` spec): encrypt text with a chosen
//! key, and decrypt every `🔒<version>.…` message found in pasted text. Nothing here
//! touches disk, logs or the network.

use cipherchat_core::{self as core_api, ChatKey, Error as CoreError, KEY_LEN};
use serde::Serialize;

use crate::error::{AppError, ErrorCode};
use crate::hex;
use crate::vault::Vault;

/// Upper bound for text handed to either direction, so a huge paste cannot freeze the app.
pub const MAX_INPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DecryptItem {
    Ok {
        text: String,
        key_id: String,
        key_label: String,
    },
    Error {
        error: ErrorCode,
    },
}

fn key_from(bytes: &[u8]) -> Result<ChatKey, AppError> {
    let arr: [u8; KEY_LEN] = bytes.try_into().map_err(|_| ErrorCode::Internal)?;
    Ok(ChatKey::from_bytes(arr))
}

/// Encrypt `text` with the key whose ID is `key_id`.
pub fn encrypt(vault: &Vault, key_id: Option<&str>, text: &str) -> Result<String, AppError> {
    // Locked comes first so a locked app always prompts for the passphrase.
    vault.read(|_| Ok(()))?;
    let key_id = key_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(ErrorCode::NoKey)?;
    if text.trim().is_empty() || text.len() > MAX_INPUT_BYTES {
        return Err(ErrorCode::InvalidInput.into());
    }
    vault.read(|keys| {
        let entry = keys
            .iter()
            .find(|k| k.id == key_id)
            .ok_or(ErrorCode::NoSuchKey)?;
        let key = key_from(&entry.key_bytes().ok_or(ErrorCode::Internal)?)?;
        core_api::encrypt(&key, text).map_err(|_| ErrorCode::Internal.into())
    })
}

/// A message candidate found in pasted text: the whole `🔒<digits>.<base64url>` run.
fn find_messages(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find('🔒') {
        let after = &rest[i + '🔒'.len_utf8()..];
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || after.as_bytes().get(digits) != Some(&b'.') {
            rest = after;
            continue;
        }
        let body = &after[digits + 1..];
        let body_len = body
            .bytes()
            .take_while(|b| b.is_ascii_alphanumeric() || *b == b'-' || *b == b'_')
            .count();
        let end = i + '🔒'.len_utf8() + digits + 1 + body_len;
        out.push(&rest[i..end]);
        rest = &rest[end..];
    }
    out
}

fn decrypt_one(vault: &Vault, message: &str) -> DecryptItem {
    let fail = |error| DecryptItem::Error { error };
    // Only `🔒1.` exists today; any other number is a newer format.
    if !message.starts_with(core_api::PREFIX) {
        return fail(ErrorCode::UnknownVersion);
    }
    let id = match core_api::key_id_of(message) {
        Ok(id) => hex::encode(&id),
        Err(CoreError::UnknownVersion) => return fail(ErrorCode::UnknownVersion),
        Err(_) => return fail(ErrorCode::NotOurFormat),
    };
    let found = vault.read(|keys| {
        Ok(keys
            .iter()
            .find(|k| k.id == id)
            .map(|k| (k.label.clone(), k.key_bytes())))
    });
    let (label, bytes) = match found {
        Ok(Some((label, Some(bytes)))) => (label, bytes),
        Ok(Some((_, None))) => return fail(ErrorCode::Internal),
        Ok(None) => return fail(ErrorCode::UnknownKey),
        Err(e) => return fail(e.code),
    };
    let Ok(key) = key_from(&bytes) else {
        return fail(ErrorCode::Internal);
    };
    match core_api::decrypt(&key, message) {
        Ok(text) => DecryptItem::Ok {
            text,
            key_id: id,
            key_label: label,
        },
        Err(CoreError::Tampered) => fail(ErrorCode::Tampered),
        Err(CoreError::WrongKey) => fail(ErrorCode::UnknownKey),
        Err(CoreError::UnknownVersion) => fail(ErrorCode::UnknownVersion),
        Err(_) => fail(ErrorCode::NotOurFormat),
    }
}

/// Decrypt every message in `pasted`, in order. Errors for the whole call: locked, no
/// message found, or input too large. Per-message problems are reported per item.
pub fn decrypt(vault: &Vault, pasted: &str) -> Result<Vec<DecryptItem>, AppError> {
    vault.read(|_| Ok(()))?;
    if pasted.len() > MAX_INPUT_BYTES {
        return Err(ErrorCode::InvalidInput.into());
    }
    let messages = find_messages(pasted);
    if messages.is_empty() {
        return Err(ErrorCode::NotOurFormat.into());
    }
    Ok(messages
        .into_iter()
        .map(|m| decrypt_one(vault, m))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::{self, KeySource};
    use crate::vault::tests::{rig, Rig, PASS};
    use zeroize::Zeroizing;

    fn with_key(label: &str) -> (Rig, String) {
        let r = rig();
        r.vault.create(PASS).unwrap();
        let id = keys::add(&r.vault, label, KeySource::Generate)
            .unwrap()
            .key
            .id;
        (r, id)
    }

    fn err(r: Result<impl std::fmt::Debug, AppError>) -> ErrorCode {
        r.unwrap_err().code
    }

    fn ok_texts(items: &[DecryptItem]) -> Vec<&str> {
        items
            .iter()
            .map(|i| match i {
                DecryptItem::Ok { text, .. } => text.as_str(),
                other => panic!("expected success, got {other:?}"),
            })
            .collect()
    }

    // ---- encrypt ----

    #[test]
    fn encrypt_output_decrypts_with_the_same_key() {
        let (r, id) = with_key("alice");
        for msg in ["hello", "héllo 🔒🎉", "line one\nline two"] {
            let wire = encrypt(&r.vault, Some(&id), msg).unwrap();
            assert!(wire.starts_with("🔒1."));
            let items = decrypt(&r.vault, &wire).unwrap();
            assert_eq!(
                items,
                [DecryptItem::Ok {
                    text: msg.into(),
                    key_id: id.clone(),
                    key_label: "alice".into()
                }]
            );
        }
    }

    #[test]
    fn encrypt_requires_a_key_and_text() {
        let (r, id) = with_key("k");
        assert_eq!(err(encrypt(&r.vault, None, "hi")), ErrorCode::NoKey);
        assert_eq!(err(encrypt(&r.vault, Some("  "), "hi")), ErrorCode::NoKey);
        assert_eq!(
            err(encrypt(&r.vault, Some("deadbeef"), "hi")),
            ErrorCode::NoSuchKey
        );
        assert_eq!(
            err(encrypt(&r.vault, Some(&id), "")),
            ErrorCode::InvalidInput
        );
        assert_eq!(
            err(encrypt(&r.vault, Some(&id), " \n\t ")),
            ErrorCode::InvalidInput
        );
        assert_eq!(
            err(encrypt(
                &r.vault,
                Some(&id),
                &"x".repeat(MAX_INPUT_BYTES + 1)
            )),
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn locked_vault_blocks_both_directions_before_anything_else() {
        let (r, id) = with_key("k");
        let wire = encrypt(&r.vault, Some(&id), "secret").unwrap();
        r.vault.lock();
        // Locked wins even over an otherwise invalid request.
        assert_eq!(err(encrypt(&r.vault, None, "")), ErrorCode::Locked);
        assert_eq!(err(encrypt(&r.vault, Some(&id), "x")), ErrorCode::Locked);
        assert_eq!(err(decrypt(&r.vault, &wire)), ErrorCode::Locked);
        assert_eq!(err(decrypt(&r.vault, "not a message")), ErrorCode::Locked);
    }

    // ---- decrypt: scanning ----

    #[test]
    fn surrounding_whitespace_and_text_are_ignored() {
        let (r, id) = with_key("k");
        let wire = encrypt(&r.vault, Some(&id), "secret").unwrap();
        for pasted in [
            format!("  {wire}\n"),
            format!("[12:01, 3/4/2026] Bob: {wire}"),
            format!("{wire} (sent)"),
            format!("\u{200e}{wire}\u{200e}"),
        ] {
            assert_eq!(
                ok_texts(&decrypt(&r.vault, &pasted).unwrap()),
                ["secret"],
                "{pasted:?}"
            );
        }
    }

    #[test]
    fn several_messages_are_decrypted_in_order() {
        let (r, id) = with_key("k");
        let a = encrypt(&r.vault, Some(&id), "first").unwrap();
        let b = encrypt(&r.vault, Some(&id), "second").unwrap();
        let c = encrypt(&r.vault, Some(&id), "third").unwrap();
        let items = decrypt(&r.vault, &format!("{a}\nhello there\n{b} {c}")).unwrap();
        assert_eq!(ok_texts(&items), ["first", "second", "third"]);
    }

    #[test]
    fn one_bad_message_does_not_hide_the_good_ones() {
        let (r, id) = with_key("k");
        let good = encrypt(&r.vault, Some(&id), "fine").unwrap();
        let items = decrypt(&r.vault, &format!("{good}\n🔒1.AAAA\n{good}")).unwrap();
        assert_eq!(items.len(), 3);
        assert!(matches!(items[0], DecryptItem::Ok { .. }));
        assert_eq!(
            items[1],
            DecryptItem::Error {
                error: ErrorCode::NotOurFormat
            }
        );
        assert!(matches!(items[2], DecryptItem::Ok { .. }));
    }

    #[test]
    fn find_messages_cases() {
        assert_eq!(
            find_messages("a 🔒1.abc-_9 b 🔒1.def"),
            ["🔒1.abc-_9", "🔒1.def"]
        );
        assert_eq!(find_messages("🔒1.abc🔒1.def"), ["🔒1.abc", "🔒1.def"]);
        assert_eq!(find_messages("🔒 hello 🔒12 🔒x.abc"), Vec::<&str>::new());
        assert_eq!(find_messages("🔒2.abc"), ["🔒2.abc"]);
        assert_eq!(find_messages("🔒1."), ["🔒1."]);
        assert_eq!(find_messages(""), Vec::<&str>::new());
        assert_eq!(find_messages("🔒"), Vec::<&str>::new());
        assert_eq!(find_messages("🔒🔒1.a"), ["🔒1.a"]);
    }

    // ---- decrypt: one test per failure reason ----

    #[test]
    fn reason_not_ours() {
        let (r, _) = with_key("k");
        for pasted in ["hello", "🔒 hello", "", "   "] {
            assert_eq!(
                err(decrypt(&r.vault, pasted)),
                ErrorCode::NotOurFormat,
                "{pasted:?}"
            );
        }
        assert_eq!(
            decrypt(&r.vault, "🔒1.!!!").unwrap(),
            [DecryptItem::Error {
                error: ErrorCode::NotOurFormat
            }]
        );
    }

    #[test]
    fn reason_unknown_key() {
        let (r, id) = with_key("k");
        let wire = encrypt(&r.vault, Some(&id), "secret").unwrap();
        keys::delete(&r.vault, &id).unwrap();
        assert_eq!(
            decrypt(&r.vault, &wire).unwrap(),
            [DecryptItem::Error {
                error: ErrorCode::UnknownKey
            }]
        );
    }

    #[test]
    fn reason_tampered_shows_no_plaintext() {
        let (r, id) = with_key("k");
        let wire = encrypt(&r.vault, Some(&id), "secret").unwrap();
        let mut chars: Vec<char> = wire.chars().collect();
        let last = chars.len() - 3;
        chars[last] = if chars[last] == 'A' { 'B' } else { 'A' };
        let bad: String = chars.into_iter().collect();
        let items = decrypt(&r.vault, &bad).unwrap();
        assert_eq!(
            items,
            [DecryptItem::Error {
                error: ErrorCode::Tampered
            }]
        );
        assert!(!serde_json::to_string(&items).unwrap().contains("secret"));
    }

    #[test]
    fn reason_unknown_version() {
        let (r, id) = with_key("k");
        // A future prefix number...
        assert_eq!(
            decrypt(&r.vault, "🔒2.AAAAAAAAAAAAAAAA").unwrap(),
            [DecryptItem::Error {
                error: ErrorCode::UnknownVersion
            }]
        );
        // ...and a `🔒1.` message whose inner version byte is newer.
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        let wire = encrypt(&r.vault, Some(&id), "x").unwrap();
        let mut bytes = URL_SAFE_NO_PAD
            .decode(wire.strip_prefix("🔒1.").unwrap())
            .unwrap();
        bytes[0] = 2;
        let newer = format!("🔒1.{}", URL_SAFE_NO_PAD.encode(bytes));
        assert_eq!(
            decrypt(&r.vault, &newer).unwrap(),
            [DecryptItem::Error {
                error: ErrorCode::UnknownVersion
            }]
        );
    }

    #[test]
    fn reason_locked_is_reported_for_the_whole_call() {
        let (r, id) = with_key("k");
        let wire = encrypt(&r.vault, Some(&id), "x").unwrap();
        r.vault.lock();
        assert_eq!(err(decrypt(&r.vault, &wire)), ErrorCode::Locked);
    }

    #[test]
    fn oversized_paste_is_refused() {
        let (r, _) = with_key("k");
        assert_eq!(
            err(decrypt(&r.vault, &"a".repeat(MAX_INPUT_BYTES + 1))),
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn decrypts_a_message_from_the_recorded_wire_vector() {
        // Same vector as core/src/wire.rs: key [0x11; 32], so the wire format is unchanged.
        let r = rig();
        r.vault.create(PASS).unwrap();
        let exported = format!("ck1-{}", hex::encode(&[0x11u8; 32]));
        keys::add(
            &r.vault,
            "vector",
            KeySource::Import {
                exported: Zeroizing::new(exported),
            },
        )
        .unwrap();
        let wire = "🔒1.ATp3iqIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiLrAotgM5mn_ZUlcbn-EcCWEmdcQIevSiMFasrDKDlI1-1jzN69";
        assert_eq!(
            ok_texts(&decrypt(&r.vault, wire).unwrap()),
            ["hello CipherChat 🔒"]
        );
    }

    // ---- no persistence / no output of message content ----

    #[test]
    fn nothing_about_messages_reaches_disk() {
        use crate::storage::FsStorage;
        use std::sync::Arc;
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::with_options(
            Box::new(FsStorage::new(dir.path().to_path_buf()).unwrap()),
            Arc::new(crate::clock::SystemClock),
            crate::vault::tests::FAST,
            600,
        );
        vault.create(PASS).unwrap();
        let id = keys::add(&vault, "k", KeySource::Generate).unwrap().key.id;

        let plain = "PLAINTEXT-MARKER-4f1c";
        let wire = encrypt(&vault, Some(&id), plain).unwrap();
        let shown = decrypt(&vault, &wire).unwrap();
        assert_eq!(ok_texts(&shown), [plain]);
        let body = wire.strip_prefix("🔒1.").unwrap().to_string();

        let mut scanned = 0;
        for entry in std::fs::read_dir(dir.path()).unwrap() {
            let bytes = std::fs::read(entry.unwrap().path()).unwrap();
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains(plain), "plaintext written to disk");
            assert!(!text.contains(&body), "ciphertext written to disk");
            scanned += 1;
        }
        assert!(scanned >= 1, "expected the vault file to be scanned");
    }

    #[test]
    fn source_has_no_logging_or_debug_output() {
        // Message content must never reach logs. The app has no logging at all, so any
        // print or logging call appearing in the source needs a deliberate review.
        let src = format!("{}/src", env!("CARGO_MANIFEST_DIR"));
        let banned = [
            "println!",
            "eprintln!",
            "print!(",
            "dbg!(",
            "log::",
            "tracing::",
            "info!(",
            "warn!(",
            "debug!(",
        ];
        for entry in std::fs::read_dir(src).unwrap() {
            let path = entry.unwrap().path();
            let text = std::fs::read_to_string(&path).unwrap();
            // Ignore this file's own list of banned strings and the test modules.
            let production = text.split("#[cfg(test)]").next().unwrap();
            for b in banned {
                assert!(!production.contains(b), "{} contains {b}", path.display());
            }
        }
    }
}
