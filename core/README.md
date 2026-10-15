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
| `encrypt(&key, text)` | Plaintext → base64url text (no prefix) |
| `decrypt(&key, text)` | Wire string → plaintext, or an `Error` |
| `find_messages(text)` | Messages found in pasted text (whitespace-separated tokens that parse) |
| `key_id_of(text)` | Read key ID without decrypting |

Errors: `NotOurFormat`, `UnknownVersion`, `WrongKey`, `Tampered` (plus
`EncryptFailed`, `KeyDerivation`).

## Wire format

```text
base64url_nopad( version(1) ‖ key_id(4) ‖ nonce(24) ‖ ciphertext ‖ tag(16) )
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

There is no prefix or other visible marker. The version is the first byte of the authenticated
header. `find_messages` locates messages in pasted text by trying each whitespace-separated
token (ignoring surrounding punctuation) and keeping those that decode to at least
version + key id + nonce + tag bytes (45 bytes, 60 characters). The old `🔒1.` form is not
recognised.

Decryption order: base64/length (`NotOurFormat`) → version
(`UnknownVersion`) → key ID (`WrongKey`) → AEAD (`Tampered`).

The wire format is pinned by fixed vectors in `src/wire.rs` and `src/key.rs`.

## Example

```rust
use cipherchat_core::{decrypt, encrypt, find_messages, ChatKey};

let key = ChatKey::generate();
let wire = encrypt(&key, "hello 🔒").unwrap();
assert!(!wire.contains('🔒'));
assert_eq!(find_messages(&format!("here: {wire}")), [wire.as_str()]);
assert_eq!(decrypt(&key, &wire).unwrap(), "hello 🔒");
```
