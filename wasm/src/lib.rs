//! Thin wasm-bindgen wrapper over `core`. No crypto logic lives here.
//!
//! Keys cross the boundary as 32-byte `Uint8Array`s. Failures throw an `Error`
//! whose `message` is a stable code: `NotOurFormat`, `UnknownVersion`,
//! `WrongKey`, `Tampered`, `EncryptFailed`, `KeyDerivation` or `InvalidKey`.

use cipherchat_core::{self as core_api, ChatKey, Error, KEY_ID_LEN, KEY_LEN, SALT_LEN};
use wasm_bindgen::prelude::*;

fn code(e: Error) -> &'static str {
    match e {
        Error::NotOurFormat => "NotOurFormat",
        Error::UnknownVersion => "UnknownVersion",
        Error::WrongKey => "WrongKey",
        Error::Tampered => "Tampered",
        Error::EncryptFailed => "EncryptFailed",
        Error::KeyDerivation => "KeyDerivation",
    }
}

fn js_err(e: Error) -> JsError {
    JsError::new(code(e))
}

fn key_from(bytes: &[u8]) -> Result<ChatKey, JsError> {
    let arr: [u8; KEY_LEN] = bytes.try_into().map_err(|_| JsError::new("InvalidKey"))?;
    Ok(ChatKey::from_bytes(arr))
}

/// Generate a random 32-byte key.
#[wasm_bindgen(js_name = generateKey)]
pub fn generate_key() -> Vec<u8> {
    ChatKey::generate().as_bytes().to_vec()
}

/// Generate a random 16-byte salt for passphrase-derived keys.
#[wasm_bindgen(js_name = randomSalt)]
pub fn random_salt() -> Vec<u8> {
    ChatKey::random_salt().to_vec()
}

/// Derive a 32-byte key from a passphrase and a 16-byte salt (Argon2id).
#[wasm_bindgen(js_name = deriveKey)]
pub fn derive_key(passphrase: &str, salt: &[u8]) -> Result<Vec<u8>, JsError> {
    let salt: [u8; SALT_LEN] = salt.try_into().map_err(|_| JsError::new("KeyDerivation"))?;
    let key = ChatKey::from_passphrase(passphrase, &salt).map_err(js_err)?;
    Ok(key.as_bytes().to_vec())
}

/// 4-byte key ID of a key.
#[wasm_bindgen(js_name = keyId)]
pub fn key_id(key: &[u8]) -> Result<Vec<u8>, JsError> {
    Ok(key_from(key)?.key_id().to_vec())
}

/// Short fingerprint (`abcd-ef01`) of a key.
#[wasm_bindgen]
pub fn fingerprint(key: &[u8]) -> Result<String, JsError> {
    Ok(key_from(key)?.fingerprint())
}

/// Encrypt text into a `🔒1.` message.
#[wasm_bindgen]
pub fn encrypt(key: &[u8], plaintext: &str) -> Result<String, JsError> {
    core_api::encrypt(&key_from(key)?, plaintext).map_err(js_err)
}

/// Decrypt a `🔒1.` message.
#[wasm_bindgen]
pub fn decrypt(key: &[u8], text: &str) -> Result<String, JsError> {
    core_api::decrypt(&key_from(key)?, text).map_err(js_err)
}

/// Cheap prefix check for encrypted text.
#[wasm_bindgen(js_name = isEncrypted)]
pub fn is_encrypted(text: &str) -> bool {
    core_api::is_encrypted(text)
}

/// Read the 4-byte key ID from a message without decrypting.
#[wasm_bindgen(js_name = keyIdOf)]
pub fn key_id_of(text: &str) -> Result<Vec<u8>, JsError> {
    let id: [u8; KEY_ID_LEN] = core_api::key_id_of(text).map_err(js_err)?;
    Ok(id.to_vec())
}

/// Format a 4-byte key ID as a fingerprint string.
#[wasm_bindgen(js_name = fingerprintOfId)]
pub fn fingerprint_of_id(id: &[u8]) -> Result<String, JsError> {
    let id: [u8; KEY_ID_LEN] = id.try_into().map_err(|_| JsError::new("InvalidKey"))?;
    Ok(core_api::fingerprint_of(&id))
}
