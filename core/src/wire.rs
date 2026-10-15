use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use rand_core::{OsRng, RngCore};

use crate::{ChatKey, Error, KEY_ID_LEN};

/// Marker that starts every encrypted message (format version 1).
pub const PREFIX: &str = "🔒1.";

const VERSION: u8 = 1;
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
const HEADER_LEN: usize = 1 + KEY_ID_LEN;
const MIN_LEN: usize = HEADER_LEN + NONCE_LEN + TAG_LEN;

/// Encrypt `plaintext` into a `🔒1.<base64url>` string.
pub fn encrypt(key: &ChatKey, plaintext: &str) -> Result<String, Error> {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    encrypt_with_nonce(key, plaintext, &nonce)
}

pub(crate) fn encrypt_with_nonce(
    key: &ChatKey,
    plaintext: &str,
    nonce: &[u8; NONCE_LEN],
) -> Result<String, Error> {
    let mut header = [0u8; HEADER_LEN];
    header[0] = VERSION;
    header[1..].copy_from_slice(&key.key_id());

    let cipher = XChaCha20Poly1305::new(Key::from_slice(key.as_bytes()));
    let ct = cipher
        .encrypt(
            XNonce::from_slice(nonce),
            Payload { msg: plaintext.as_bytes(), aad: &header },
        )
        .map_err(|_| Error::EncryptFailed)?;

    let mut out = Vec::with_capacity(HEADER_LEN + NONCE_LEN + ct.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ct);
    Ok(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(out)))
}

/// Cheap prefix check for encrypted text.
pub fn is_encrypted(text: &str) -> bool {
    text.starts_with(PREFIX)
}

fn parse(text: &str) -> Result<Vec<u8>, Error> {
    let body = text.trim().strip_prefix(PREFIX).ok_or(Error::NotOurFormat)?;
    let bytes = URL_SAFE_NO_PAD.decode(body).map_err(|_| Error::NotOurFormat)?;
    if bytes.len() < MIN_LEN {
        return Err(Error::NotOurFormat);
    }
    Ok(bytes)
}

/// Read the 4-byte key ID from a message without decrypting it.
pub fn key_id_of(text: &str) -> Result<[u8; KEY_ID_LEN], Error> {
    let bytes = parse(text)?;
    // The key-id layout is version-specific, so only version 1 can be read.
    if bytes[0] != VERSION {
        return Err(Error::UnknownVersion);
    }
    let mut id = [0u8; KEY_ID_LEN];
    id.copy_from_slice(&bytes[1..HEADER_LEN]);
    Ok(id)
}

/// Decrypt a `🔒1.` message with `key`.
pub fn decrypt(key: &ChatKey, text: &str) -> Result<String, Error> {
    let bytes = parse(text)?;
    if bytes[0] != VERSION {
        return Err(Error::UnknownVersion);
    }
    if bytes[1..HEADER_LEN] != key.key_id() {
        return Err(Error::WrongKey);
    }
    let (header, rest) = bytes.split_at(HEADER_LEN);
    let (nonce, ct) = rest.split_at(NONCE_LEN);

    let cipher = XChaCha20Poly1305::new(Key::from_slice(key.as_bytes()));
    let pt = cipher
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad: header })
        .map_err(|_| Error::Tampered)?;
    String::from_utf8(pt).map_err(|_| Error::Tampered)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> ChatKey {
        ChatKey::from_bytes([42u8; 32])
    }

    fn payload(msg: &str) -> Vec<u8> {
        URL_SAFE_NO_PAD.decode(encrypt(&key(), msg).unwrap().strip_prefix(PREFIX).unwrap()).unwrap()
    }

    fn wrap(bytes: &[u8]) -> String {
        format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes))
    }

    #[test]
    fn round_trip() {
        for msg in ["hello", "", "héllo 🔒🎉 wörld", "line one\nline two\n\nline four"] {
            let enc = encrypt(&key(), msg).unwrap();
            assert!(enc.starts_with(PREFIX));
            assert_eq!(decrypt(&key(), &enc).unwrap(), msg);
        }
    }

    #[test]
    fn fresh_randomness() {
        assert_ne!(encrypt(&key(), "same").unwrap(), encrypt(&key(), "same").unwrap());
    }

    #[test]
    fn detection() {
        assert!(is_encrypted(&encrypt(&key(), "x").unwrap()));
        assert!(!is_encrypted("hello"));
        assert!(!is_encrypted("🔒 hello"));
    }

    #[test]
    fn key_id_without_key() {
        let enc = encrypt(&key(), "x").unwrap();
        assert_eq!(key_id_of(&enc).unwrap(), key().key_id());
    }

    #[test]
    fn tampered_ciphertext() {
        let good = payload("secret");
        for i in HEADER_LEN..good.len() {
            let mut bad = good.clone();
            bad[i] ^= 1;
            assert_eq!(decrypt(&key(), &wrap(&bad)), Err(Error::Tampered), "byte {i}");
        }
    }

    #[test]
    fn tampered_header() {
        let mut bad = payload("secret");
        bad[1] ^= 1; // key id
        assert_eq!(decrypt(&key(), &wrap(&bad)), Err(Error::WrongKey));
        let mut bad = payload("secret");
        bad[0] = 2; // version
        assert_eq!(decrypt(&key(), &wrap(&bad)), Err(Error::UnknownVersion));
        assert_eq!(key_id_of(&wrap(&bad)), Err(Error::UnknownVersion));
    }

    #[test]
    fn header_is_bound_as_aad() {
        // A well-formed header (right version and key id) but ciphertext sealed
        // without the header as AAD must fail authentication.
        let k = key();
        let nonce = [9u8; NONCE_LEN];
        let cipher = XChaCha20Poly1305::new(Key::from_slice(k.as_bytes()));
        let ct = cipher.encrypt(XNonce::from_slice(&nonce), b"secret".as_ref()).unwrap();
        let mut bytes = vec![VERSION];
        bytes.extend_from_slice(&k.key_id());
        bytes.extend_from_slice(&nonce);
        bytes.extend_from_slice(&ct);
        assert_eq!(decrypt(&k, &wrap(&bytes)), Err(Error::Tampered));
    }

    #[test]
    fn wrong_key() {
        let enc = encrypt(&key(), "secret").unwrap();
        let other = ChatKey::from_bytes([43u8; 32]);
        assert_eq!(decrypt(&other, &enc), Err(Error::WrongKey));
    }

    #[test]
    fn malformed_input() {
        assert_eq!(decrypt(&key(), "hello"), Err(Error::NotOurFormat));
        assert_eq!(decrypt(&key(), "🔒2.AAAA"), Err(Error::NotOurFormat));
        assert_eq!(decrypt(&key(), "🔒1.!!!not base64!!!"), Err(Error::NotOurFormat));
        assert_eq!(decrypt(&key(), "🔒1.AAAA"), Err(Error::NotOurFormat));
        assert_eq!(decrypt(&key(), ""), Err(Error::NotOurFormat));
        assert_eq!(key_id_of("hello"), Err(Error::NotOurFormat));
    }

    // Fixed vector: key = [0x11; 32], nonce = [0x22; 24], plaintext below.
    // If this fails the wire format changed.
    const VECTOR_PLAINTEXT: &str = "hello CipherChat 🔒";
    const VECTOR_WIRE: &str = "🔒1.ATp3iqIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiLrAotgM5mn_ZUlcbn-EcCWEmdcQIevSiMFasrDKDlI1-1jzN69";

    #[test]
    fn fixed_vector_encrypts_to_recorded_wire() {
        let k = ChatKey::from_bytes([0x11; 32]);
        let wire = encrypt_with_nonce(&k, VECTOR_PLAINTEXT, &[0x22; NONCE_LEN]).unwrap();
        assert_eq!(wire, VECTOR_WIRE);
    }

    #[test]
    fn fixed_vector_decrypts() {
        let k = ChatKey::from_bytes([0x11; 32]);
        assert_eq!(decrypt(&k, VECTOR_WIRE).unwrap(), VECTOR_PLAINTEXT);
    }
}
