# Tasks

## 1. Workspace and tooling

- [x] 1.1 Create root `Cargo.toml` workspace with `core` and `wasm` members and a `.gitignore`; verify `cargo check` succeeds
- [x] 1.2 Install `wasm32-unknown-unknown` target and `wasm-pack`; verify `wasm-pack --version` and `rustup target list --installed` show them

## 2. Core crate (M1)

- [x] 2.1 Implement `ChatKey` (generate, from_passphrase with Argon2id, fingerprint, ZeroizeOnDrop); verify unit tests for determinism, fingerprint stability and different-salt divergence pass
- [x] 2.2 Implement wire format with `encrypt`, `decrypt`, `is_encrypted`, `key_id_of` and the `Error` enum; verify round-trip (incl. emoji/multiline) tests pass
- [x] 2.3 Add negative tests for tampered ciphertext, tampered header, wrong key, unknown version and malformed input; verify each maps to the specified error
- [x] 2.4 Commit fixed test vectors (key, nonce-injected encrypt helper under test cfg, wire string) and verify `cargo test -p core` passes and fails if the format is altered
- [x] 2.5 Write `core/README.md` documenting the API and wire format; verify the example compiles as a doctest

## 3. WASM crate (M2)

- [x] 3.1 Implement wasm-bindgen exports for key generation, passphrase derivation, encrypt, decrypt, is_encrypted, key_id_of with `getrandom` `js` feature; verify `wasm-pack build --target web` succeeds
- [x] 3.2 Add wasm tests (node or headless) covering round-trip and error codes surfaced to JS; verify `wasm-pack test --node` passes

## 4. Extension foundation and storage (M2)

- [x] 4.1 Scaffold `extension/` (TypeScript, bundler, MV3 manifest limited to `web.whatsapp.com` and storage, service worker, popup, content script); verify the build output loads unpacked in Chrome without errors
- [x] 4.2 Load WASM in the service worker with a typed message API for popup and content script; verify a Vitest/message test round-trips encrypt/decrypt
- [x] 4.3 Implement encrypted-at-rest key store (unlock passphrase, session-scoped unlocked state, add/list/delete, chat-to-key mapping, key-id lookup); verify tests show no plaintext key bytes in stored data and wrong passphrase fails

## 5. Popup UI (M2)

- [x] 5.1 Build unlock and key-management views (generate, passphrase import with salt, list by fingerprint, delete, export with out-of-band warning); verify manually and with component tests
- [x] 5.2 Build encrypt and decrypt boxes with copy buttons and descriptive error messages; verify manually that each error type shows its message
- [ ] 5.3 Manual end-to-end check: encrypt in the popup, paste into WhatsApp Web, decrypt on a second machine/profile; record result in `extension/README.md` along with load-unpacked instructions

## 6. WhatsApp Web integration (M3)

- [x] 6.1 Create `extension/src/whatsapp/selectors.ts` as the only file with WhatsApp selectors, plus saved DOM fixtures; verify a test fails if selectors are used elsewhere (lint rule or grep check)
- [x] 6.2 Implement MutationObserver decryption of `🔒1.` messages, with reprocessing guard and "unknown key"/error placeholders; verify fixture tests for existing, new and undecryptable messages
- [x] 6.3 Implement capture-phase send interception that encrypts the compose box and blocks (fail closed) when locked, keyless or on error; verify tests that plaintext is never sent in those cases
- [x] 6.4 Implement per-chat toggle (default off, persisted), lock indicator, and group-chat disabling; verify fixture/unit tests and manual check
- [ ] 6.5 Manual end-to-end on live WhatsApp Web between two accounts: send encrypted, receive decrypted, check the chat on the phone shows only ciphertext; document in `extension/README.md`

## Workflow follow-up

- Archive the change after review; M4 (Android) and M5 (v2 keys) will be separate changes.
