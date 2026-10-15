# CipherChat — Encryption Layer for WhatsApp

A layer that encrypts message text before it reaches WhatsApp and decrypts it after it renders. WhatsApp only ever carries opaque text, so anyone without the key sees a jumbled mess.

## Constraints

- WhatsApp has no plugin API, and modded clients get accounts banned. The layer must sit **around** the official client, never inside it.
- Text only in v1.

## Open decisions

| Decision | Default until decided |
|---|---|
| First platform: WhatsApp Web or Android | WhatsApp Web (browser extension) |
| Group chats in v1 | 1:1 chats only |

---

## 1. Integration points

| Option | Encrypt | Decrypt | Effort | Notes |
|---|---|---|---|---|
| WhatsApp Web/Desktop browser extension | Hook the compose box and swap the text on send | Content script finds marked messages in the DOM and replaces them inline | Low | Best UX; breaks when Meta changes the DOM |
| Android keyboard plus accessibility overlay | Custom IME encrypts on send | Accessibility service reads the screen and overlays plaintext | Medium | Seamless; the permission is very powerful and needs care |
| iOS keyboard extension | Keyboard encrypts | Copy, then a share or app extension decrypts | Medium | iOS keyboards can't read the chat, so receiving is clunky |
| Standalone clipboard app | Paste in, copy out | Same | Trivial | Testing aid only |

**Order:** browser extension (MVP), then Android, then maybe iOS.

## 2. Architecture (Rust)

Rust compiles to WASM for the extension and to Android/iOS libraries through uniffi. The RustCrypto crates are pure Rust, so there's no C library to cross-compile.

```
cipherchat/                  (cargo workspace)
├── core/        # pure crypto + wire format, no I/O, no platform deps
├── wasm/        # wasm-bindgen wrapper → browser extension
├── mobile/      # uniffi wrapper → Kotlin (Android), Swift (iOS later)
└── extension/   # TS content script for WhatsApp Web, calls wasm/
```

### Crates

| Need | Crate |
|---|---|
| AEAD | `chacha20poly1305` (`XChaCha20Poly1305`) |
| Passphrase → key | `argon2` (Argon2id) |
| Key exchange (v2) | `x25519-dalek` |
| Encoding | `base64` (URL-safe, no padding) |
| Wiping secrets from memory | `zeroize` |
| Randomness | `rand_core` with `OsRng`, plus `getrandom` with the `js` feature on the WASM target (required to build) |
| Bindings | `wasm-bindgen`, `uniffi` |

## 3. Cryptography

- **Cipher:** XChaCha20-Poly1305 AEAD. A random 24-byte nonce per message means no nonce-counter state, and tampering is detected automatically.
- **Keys, v1:** one shared secret per chat. If it starts as a passphrase, stretch it with Argon2id and a random 16-byte salt.
- **Keys, v2:** an X25519 key pair per user, with per-contact keys derived via key exchange. Contacts verify each other with a QR scan or a safety number.
- **Later, optional:** Double Ratchet for forward secrecy.
- **Rule:** no custom crypto primitives. Only audited crates.

## 4. Wire format

What appears in the chat:

```
🔒1.<base64url(payload)>
```

Payload bytes:

```
version(1) ‖ key_id(4) ‖ nonce(24) ‖ ciphertext+tag(n+16)
```

- `version ‖ key_id` is passed as AEAD associated data, so a header can't be moved onto another message without decryption failing.
- The prefix lets clients spot encrypted messages cheaply. The version byte allows the format to change later.
- Optional: pad plaintext to size buckets to reduce length leakage.
- Optional, cosmetic only: map bytes to an emoji or word alphabet instead of base64.

## 5. Core API

```rust
pub struct ChatKey { /* 32 bytes, ZeroizeOnDrop */ }

impl ChatKey {
    pub fn from_passphrase(pass: &str, salt: &[u8; 16]) -> Result<Self, Error>;
    pub fn generate() -> Self;
    pub fn fingerprint(&self) -> [u8; 4];   // key ID for the header
}

pub fn encrypt(key: &ChatKey, plaintext: &str) -> String;           // "🔒1.<b64>"
pub fn decrypt(key: &ChatKey, wire: &str) -> Result<String, Error>;
pub fn is_encrypted(text: &str) -> bool;                             // cheap prefix check for DOM scanning
pub fn key_id_of(wire: &str) -> Option<[u8; 4]>;                     // pick the right key before decrypting

pub enum Error {
    NotOurFormat,
    UnknownVersion,
    WrongKey,
    Tampered,
}
```

The distinct error variants let the UI show a useful message, such as "can't decrypt: unknown key", instead of gibberish.

## 6. Key management

- **Storage:** macOS Keychain or Android Keystore. Never plaintext files.
- **Sharing:** out-of-band only, such as a QR code in person. Never send a key through WhatsApp.
- **Lookup:** map chat to key ID to key. The `key_id` in each message selects the right key.
- **Groups (if in scope):** one shared group key, rotated whenever a member is removed.

## 7. Threat model

**Protects against:**
- Group members or anyone else without the key
- Chat backups, including cloud backups
- People glancing at the screen or notifications
- A second layer on top of WhatsApp's own end-to-end encryption

**Does not protect against:**
- Metadata: who talks to whom, when, and roughly how much
- A compromised device
- Recipients screenshotting
- The extension or accessibility service itself, which sees plaintext and must be audited carefully

## 8. Out of scope for v1

Media, voice notes, reactions, and message editing. Quoted replies will quote the ciphertext, which is acceptable.

---

## Milestones

### M1 — `core` crate
- [ ] Workspace scaffold
- [ ] `ChatKey`: generate, from passphrase, fingerprint, zeroize on drop
- [ ] `encrypt` / `decrypt` / `is_encrypted` / `key_id_of`
- [ ] Tests: round-trip, tampered ciphertext, tampered header, wrong key, unknown version, malformed input
- [ ] Fixed test vectors so the format can't drift by accident

### M2 — WASM and a bare extension
- [ ] `wasm` crate with wasm-bindgen exports
- [ ] Extension popup with "encrypt this / decrypt this" boxes
- [ ] Key entry and storage in extension storage, encrypted at rest
- [ ] End-to-end check: encrypt in the popup, paste into WhatsApp, decrypt on another machine

### M3 — WhatsApp Web DOM integration
- [ ] MutationObserver that finds `🔒1.` messages and decrypts them inline
- [ ] Intercept send to encrypt the compose box contents
- [ ] Per-chat on/off toggle and lock indicator
- [ ] Keep all WhatsApp-specific selectors in one file

### M4 — Android
- [ ] `mobile` crate with uniffi bindings to Kotlin
- [ ] Keyboard (IME) that encrypts on send
- [ ] Decrypt path: start with a share target, then an accessibility overlay
- [ ] Keys in Android Keystore

### M5 — v2 keys
- [ ] X25519 identity keys and per-contact key derivation
- [ ] QR key exchange and safety-number verification
- [ ] Group keys with rotation (if groups are in scope)
