# cipherchat core

Pure-Rust, I/O-free text encryption for CipherChat. Used by the desktop app
(and, until it is removed, the WASM wrapper for the browser extension).

## API

| Item | Purpose |
|------|---------|
| `ChatKey::generate()` | Random 256-bit key |
| `ChatKey::from_passphrase(pass, &salt)` | Argon2id-derived key (same passphrase + salt → same key) |
| `ChatKey::from_passphrase_with_params(pass, &salt, m_kib, t, p)` | Same, with explicit Argon2id parameters (used for the vault key) |
| `ChatKey::random_salt()` | 16-byte salt to share out of band with the passphrase |
| `ChatKey::key_id()` / `fingerprint()` | 4-byte key ID / `abcd-ef01` display form |
| `encrypt(&key, text)` | Plaintext → `🔒1.<base64url>` |
| `decrypt(&key, text)` | Wire string → plaintext, or an `Error` |
| `is_encrypted(text)` | Cheap prefix check |
| `key_id_of(text)` | Read key ID without decrypting |

Errors: `NotOurFormat`, `UnknownVersion`, `WrongKey`, `Tampered` (plus
`EncryptFailed`, `KeyDerivation`).

## Wire format

```text
🔒1. base64url_nopad( version(1) ‖ key_id(4) ‖ nonce(24) ‖ ciphertext ‖ tag(16) )
```

- Cipher: XChaCha20-Poly1305, random 24-byte nonce.
- AAD: `version ‖ key_id` (altering either fails authentication).
- `key_id`: first 4 bytes of `SHA-256("cipherchat/key-id/v1" ‖ key)`.
- Passphrase keys: Argon2id, m = 19 MiB, t = 2, p = 1, 16-byte salt, 32-byte output.
  These parameters are fixed because the same passphrase and salt must give the same
  key on every device.
- Vault keys (desktop app): derived with `from_passphrase_with_params`. The app uses a
  stronger setting (initially m = 64 MiB, t = 3, p = 1) and stores the parameters inside
  the vault file, so they can be raised later without breaking existing vaults.

Decryption order: prefix/base64/length (`NotOurFormat`) → version
(`UnknownVersion`) → key ID (`WrongKey`) → AEAD (`Tampered`).

The wire format is pinned by fixed vectors in `src/wire.rs` and `src/key.rs`.

## Example

```rust
use cipherchat_core::{decrypt, encrypt, is_encrypted, ChatKey};

let key = ChatKey::generate();
let wire = encrypt(&key, "hello 🔒").unwrap();
assert!(is_encrypted(&wire));
assert_eq!(decrypt(&key, &wire).unwrap(), "hello 🔒");
```
