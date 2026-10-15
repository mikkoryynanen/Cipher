# Proposal

## Why

WhatsApp chats, backups and notifications are readable by anyone who gets access to the account, device or a cloud backup. CipherChat adds a second, user-controlled encryption layer that sits *around* the official client (never inside it, so accounts are not at risk), so WhatsApp only carries opaque text. `plan.md` defines the full roadmap; this change builds the MVP (milestones M1–M3).

## What Changes

- New Cargo workspace with a pure-Rust `core` crate: XChaCha20-Poly1305 encryption, Argon2id passphrase-derived keys, versioned wire format `🔒1.<base64url>` with authenticated header, fixed test vectors.
- New `wasm` crate exposing the core API to JavaScript via wasm-bindgen.
- New browser extension (TypeScript, Manifest V3) for WhatsApp Web with:
  - a popup for manual encrypt/decrypt and key entry,
  - encrypted-at-rest key storage in extension storage,
  - a content script that decrypts `🔒1.` messages inline and encrypts compose-box text on send,
  - a per-chat on/off toggle and lock indicator.
- All WhatsApp DOM selectors isolated in one file.
- Defaults from `plan.md` apply: WhatsApp Web first, 1:1 chats only, text only.

Out of scope for this change: Android/iOS (`mobile` crate, M4), X25519 identity keys, QR exchange, group keys (M5), media, voice notes, reactions, edits.

## Capabilities

### New Capabilities
- `message-encryption`: Encrypting/decrypting text to and from the `🔒1.` wire format, including detection, key-id lookup and distinct error outcomes.
- `chat-key-management`: Creating, importing (passphrase) and storing per-chat keys encrypted at rest, and mapping chats and key IDs to keys.
- `extension-popup`: Manual encrypt/decrypt tool and key entry UI in the extension popup.
- `whatsapp-web-integration`: Inline decryption of received messages and encryption of outgoing messages in WhatsApp Web, with per-chat toggle and lock indicator.

### Modified Capabilities

None (no existing specs).

## Impact

- New code: `core/`, `wasm/`, `extension/` in the repo root plus a workspace `Cargo.toml`.
- New dependencies: RustCrypto crates (`chacha20poly1305`, `argon2`, `base64`, `zeroize`, `rand_core`, `getrandom` with `js`), `wasm-bindgen`; TypeScript and a bundler for the extension.
- Tooling: `wasm-pack` is not currently installed and must be added; the `wasm32-unknown-unknown` target is required.
- Security: the extension sees plaintext and must request minimal permissions (WhatsApp Web origin + storage only).
