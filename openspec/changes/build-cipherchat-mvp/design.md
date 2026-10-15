# Design

## Context

Greenfield repo containing only `plan.md`. Rust (`cargo`) and Node are installed; `wasm-pack` is not. WhatsApp has no plugin API and modified clients risk bans, so integration must be an outside layer: a Manifest V3 extension on `web.whatsapp.com`. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- A `core` crate with no I/O and no platform dependencies, reusable later by `mobile` (M4).
- An extension where all crypto runs in WASM built from `core`, and all WhatsApp-specific code is isolated.

**Non-Goals:**
- Mobile, key exchange (X25519), groups, forward secrecy, padding, emoji alphabets.
- Hiding metadata or defending against a compromised device.

## Decisions

1. **Cargo workspace: `core`, `wasm`, `extension/`.** `wasm` is a thin wasm-bindgen wrapper; no crypto logic outside `core`. Alternative: compile `core` directly with wasm-bindgen — rejected to keep `core` binding-agnostic for uniffi later.
2. **XChaCha20-Poly1305 with random 24-byte nonce, AAD = `version ‖ key_id`.** No nonce state to persist; only audited RustCrypto crates. Alternative AES-GCM: 96-bit nonces are risky when random.
3. **Wire format `🔒1.` + base64url(no pad) of `version(1) ‖ key_id(4) ‖ nonce(24) ‖ ct+tag`.** `key_id` is the first 4 bytes of a hash of the key (domain-separated, e.g. BLAKE2/SHA-256 over a context string and the key) so it reveals nothing useful about the key. Error mapping: bad prefix/base64/length → `NotOurFormat`; version ≠ 1 → `UnknownVersion`; key_id mismatch → `WrongKey`; AEAD failure with matching key_id → `Tampered`.
4. **Passphrase keys: Argon2id with a random 16-byte salt.** The salt must be shared with the passphrase out of band (exported as part of the key share string), since the same passphrase+salt must yield the same key. Parameters fixed in `core` and covered by a test vector.
5. **At-rest storage:** keys are stored in `chrome.storage.local` as AEAD blobs under a key derived (Argon2id) from a user unlock passphrase. The unlocked key set lives only in the service worker/session memory (`chrome.storage.session`, not persisted). Alternative: WebCrypto non-extractable keys in IndexedDB — protects less against a user with profile access and is harder to make unlock-gated; revisit later.
6. **Extension layout:** TypeScript + a bundler (Vite or esbuild) producing the popup, a service worker, and a content script. The WASM module is loaded in the service worker and exposed to the popup and content script through message passing, so key material never enters the page's JS context. Content script runs in an isolated world.
7. **Decrypt via MutationObserver on the message list**, replacing text nodes in place and tagging processed nodes to avoid reprocessing. Never write plaintext back into anything WhatsApp reads on send.
8. **Encrypt on send** by intercepting the Enter key and send-button click in the capture phase, replacing the compose text with ciphertext, then letting the send proceed. If anything fails, block the send (fail closed). Selectors live in `extension/src/whatsapp/selectors.ts`.
9. **Testing:** `cargo test` for core (round-trip, tamper, wrong key, unknown version, malformed, fixed vectors); `wasm-pack test`/node for the wrapper; Vitest for extension logic against saved DOM fixtures. End-to-end WhatsApp checks are manual.

## Risks / Trade-offs

- [Meta changes the DOM and breaks integration] → Single selectors file, fixture-based tests, fail closed on send.
- [Plaintext exposed in the page DOM to page scripts] → Accepted per threat model; keep plaintext only in rendered nodes, minimal extension permissions.
- [Fail-open on send leaks plaintext] → Intercept at capture phase; block on any error; test with locked state.
- [Weak passphrases] → Argon2id with strong parameters, recommend generated keys; show warning for short passphrases.
- [`getrandom` fails to build for WASM] → Enable the `js` feature on the wasm32 target.
- [Argon2 slow in WASM] → Run in service worker, show progress; tune parameters.
- [Unlock passphrase adds friction] → Session-scoped unlock; acceptable for MVP.

## Assumptions (from plan.md defaults)

WhatsApp Web first; 1:1 chats only (groups cannot enable encryption); Chrome/Chromium MV3 first, Firefox later.
