use argon2::{Algorithm, Argon2, Params, Version};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use zeroize::ZeroizeOnDrop;

use crate::Error;

pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;
pub const KEY_ID_LEN: usize = 4;

// Fixed Argon2id parameters. Changing these changes every passphrase-derived
// key, so they are covered by a test vector.
const ARGON_M_KIB: u32 = 19 * 1024;
const ARGON_T: u32 = 2;
const ARGON_P: u32 = 1;

const KEY_ID_CONTEXT: &[u8] = b"cipherchat/key-id/v1";

/// A 256-bit symmetric chat key. Bytes are wiped from memory on drop.
#[derive(ZeroizeOnDrop)]
pub struct ChatKey {
    bytes: [u8; KEY_LEN],
}

impl ChatKey {
    /// Generate a fresh random key.
    pub fn generate() -> Self {
        let mut bytes = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut bytes);
        Self { bytes }
    }

    /// Wrap existing raw key bytes.
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self { bytes }
    }

    /// Derive a key from a passphrase and a salt shared out of band (Argon2id).
    pub fn from_passphrase(passphrase: &str, salt: &[u8; SALT_LEN]) -> Result<Self, Error> {
        let params = Params::new(ARGON_M_KIB, ARGON_T, ARGON_P, Some(KEY_LEN))
            .map_err(|_| Error::KeyDerivation)?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut bytes = [0u8; KEY_LEN];
        argon
            .hash_password_into(passphrase.as_bytes(), salt, &mut bytes)
            .map_err(|_| Error::KeyDerivation)?;
        Ok(Self { bytes })
    }

    /// Generate a random salt for passphrase-derived keys.
    pub fn random_salt() -> [u8; SALT_LEN] {
        let mut salt = [0u8; SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        salt
    }

    /// Raw key bytes (for encrypted-at-rest storage and export).
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.bytes
    }

    /// 4-byte key ID: domain-separated hash prefix, reveals nothing useful about the key.
    pub fn key_id(&self) -> [u8; KEY_ID_LEN] {
        let mut h = Sha256::new();
        h.update(KEY_ID_CONTEXT);
        h.update(self.bytes);
        let digest = h.finalize();
        let mut id = [0u8; KEY_ID_LEN];
        id.copy_from_slice(&digest[..KEY_ID_LEN]);
        id
    }

    /// Short human-comparable fingerprint, e.g. `a1b2-c3d4`.
    pub fn fingerprint(&self) -> String {
        fingerprint_of(&self.key_id())
    }
}

/// Format a key ID as a fingerprint string.
pub fn fingerprint_of(id: &[u8; KEY_ID_LEN]) -> String {
    format!("{:02x}{:02x}-{:02x}{:02x}", id[0], id[1], id[2], id[3])
}

#[cfg(test)]
mod tests {
    use super::*;

    const SALT: [u8; SALT_LEN] = [7u8; SALT_LEN];

    #[test]
    fn passphrase_is_deterministic() {
        let a = ChatKey::from_passphrase("correct horse", &SALT).unwrap();
        let b = ChatKey::from_passphrase("correct horse", &SALT).unwrap();
        assert_eq!(a.as_bytes(), b.as_bytes());
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn passphrase_vector() {
        // Pins the Argon2id parameters: if this fails, derived keys changed.
        let k = ChatKey::from_passphrase("correct horse", &SALT).unwrap();
        assert_eq!(k.fingerprint(), "9449-1831");
    }

    #[test]
    fn different_salt_diverges() {
        let a = ChatKey::from_passphrase("correct horse", &SALT).unwrap();
        let b = ChatKey::from_passphrase("correct horse", &[8u8; SALT_LEN]).unwrap();
        assert_ne!(a.as_bytes(), b.as_bytes());
        assert_ne!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn different_passphrase_diverges() {
        let a = ChatKey::from_passphrase("one", &SALT).unwrap();
        let b = ChatKey::from_passphrase("two", &SALT).unwrap();
        assert_ne!(a.as_bytes(), b.as_bytes());
    }

    #[test]
    fn fingerprint_is_stable() {
        let k = ChatKey::from_bytes([1u8; KEY_LEN]);
        assert_eq!(k.fingerprint(), k.fingerprint());
        assert_eq!(k.fingerprint().len(), 9);
        assert_eq!(fingerprint_of(&k.key_id()), k.fingerprint());
    }

    #[test]
    fn generated_keys_differ() {
        assert_ne!(ChatKey::generate().as_bytes(), ChatKey::generate().as_bytes());
    }
}
