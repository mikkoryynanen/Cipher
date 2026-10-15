#![doc = include_str!("../README.md")]
//! CipherChat core: authenticated text encryption with a versioned wire format.
//!
//! See `core/README.md` for the wire format description.

mod key;
mod wire;

pub use key::{fingerprint_of, ChatKey, KEY_ID_LEN, KEY_LEN, SALT_LEN};
pub use wire::{decrypt, encrypt, find_messages, key_id_of};

/// Errors from encryption, decryption and key derivation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Input is not a CipherChat message (bad base64 or too short).
    NotOurFormat,
    /// Well-formed message with an unsupported version.
    UnknownVersion,
    /// The message was encrypted with a different key.
    WrongKey,
    /// Key matches but authentication failed: the message was modified.
    Tampered,
    /// Encryption failed unexpectedly.
    EncryptFailed,
    /// Passphrase key derivation failed.
    KeyDerivation,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Error::NotOurFormat => "not a CipherChat message",
            Error::UnknownVersion => "unknown message version",
            Error::WrongKey => "message was encrypted with a different key",
            Error::Tampered => "message was tampered with",
            Error::EncryptFailed => "encryption failed",
            Error::KeyDerivation => "key derivation failed",
        })
    }
}

impl std::error::Error for Error {}
