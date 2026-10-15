# Tasks

## 1. Core: vault key derivation

- [x] 1.1 Add `ChatKey::from_passphrase_with_params` (memory, iterations, parallelism) to `core/src/key.rs` and verify new tests pass: deterministic output, different params diverge, invalid params return `KeyDerivation`
- [x] 1.2 Confirm the existing chat-key test vector (`passphrase_vector`) and wire-format vectors are unchanged by running `cargo test -p core`
- [x] 1.3 Document the new function and the stronger vault parameters in `core/README.md`, and verify `cargo doc -p core` builds without warnings

## 2. Desktop app scaffold

- [x] 2.1 Create `desktop/` (Tauri 2 backend in `src-tauri`, plain TypeScript + Vite frontend), add it to the workspace `members`, and verify `cargo build -p desktop` and the frontend build succeed
- [x] 2.2 Configure the Tauri capability file and CSP per design decision 9 (only the listed commands, no network, shell, filesystem or opener access) and verify a test fails if an extra command or permission is added
- [x] 2.3 Disable devtools in release builds and verify a release build launches to an empty locked screen on macOS

## 3. Vault (`desktop-vault`)

- [x] 3.1 Implement the vault file format with stored KDF parameters, create, unlock and tamper detection, and verify unit tests: round trip, wrong passphrase, modified blob rejected, no plaintext key bytes in the file
- [x] 3.2 Enforce the 12-character passphrase minimum in the backend create path and verify a test that bypasses the UI and is rejected
- [x] 3.3 Implement persisted unlock throttling (3 failures, then 5 s doubling to 15 min) with an injectable clock, and verify tests for the wait schedule, reset on success and survival across a simulated restart
- [x] 3.4 Implement the single-writer mutex and atomic save (temp file, fsync, rename, owner-only permissions) and verify tests: concurrent additions keep both keys, an injected write failure leaves the previous vault intact
- [x] 3.5 Implement manual lock and inactivity auto-lock (default 10 minutes) that drop key material and emit a `locked` event, and verify tests with a fake clock for both paths

## 4. Key management (`desktop-key-management`)

- [x] 4.1 Port key generation, passphrase derivation (with generated salt) and the `ck1-` export/import format from the extension code, and verify tests: generate, same passphrase and salt give the same fingerprint, export/import round trip, malformed imports rejected
- [x] 4.2 Implement duplicate and key ID collision handling, labels (default to fingerprint) and deletion, and verify tests for same key twice, a forced ID collision rejected without replacing the stored key, and delete removing decryptability
- [x] 4.3 Ensure `list_keys` returns only IDs, labels and fingerprints, and verify a test that serialized responses contain no key bytes outside `export_key`

## 5. Message workbench (`message-workbench`)

- [x] 5.1 Implement the `encrypt` command with explicit key selection and input checks (no key, empty text, locked), and verify command tests including that the output decrypts with the same key
- [x] 5.2 Implement the `decrypt` command: find `🔒1.` tokens in pasted text, match keys by ID, handle surrounding text, multiple messages and the paste size cap, and verify tests for each scenario in the spec
- [x] 5.3 Map every failure to a distinct reason (not ours, unknown key, tampered, unknown version, locked) and verify a test per reason
- [x] 5.4 Confirm nothing is logged or written to disk for message content and verify with a test that scans the app-data directory and captured log output after encrypt and decrypt calls
- [x] 5.5 Confirm the app makes no network connections and reads the clipboard only on user action, by checking the capability file and the code path and adding a test for the clipboard-read rule

## 6. Clipboard hygiene (`clipboard-hygiene`)

- [x] 6.1 Implement `copy_to_clipboard` in the backend with a fake-clipboard abstraction, recording a hash of what was written, and verify tests for the 30 s clear of exported keys and decrypted plaintext using a fake clock
- [x] 6.2 Implement conditional clearing (leave the clipboard alone if it changed) and clear on lock and exit, and verify tests for each case
- [x] 6.3 Implement the settings: configurable timeout, optional clearing of ciphertext, and no way to disable clearing for exported keys, and verify tests that the backend rejects a disable request for keys

## 7. User interface

- [x] 7.1 Build the unlock and create-vault screens, including wait-time display from throttling and the passphrase length message, and verify with Vitest and a manual run that a short passphrase and a wait period are reported correctly
- [x] 7.2 Build the key list, add (generate, passphrase, import), export with out-of-band warning and delete-with-confirmation screens, and verify manually that each spec scenario is reachable
- [x] 7.3 Build the encrypt and decrypt panels with copy buttons, a countdown for clipboard clearing and one-click paste-and-decrypt, and verify manually with a real messenger by sending and reading a message
- [x] 7.4 Handle the `locked` event by clearing every text field, and verify with a UI test that fields are empty after lock and after the inactivity timeout

## 8. Documentation and removal of the extension

- [x] 8.1 Write `desktop/README.md` covering build, the threat model (what is and is not protected, including clipboard history and a compromised OS) and how to share keys out of band, and verify the documented build commands run as written
- [ ] 8.2 Verify end to end on macOS: create a vault, share a key between two vaults, exchange messages through a real messenger, and check the audit findings #1–#5 no longer apply
- [ ] 8.3 After parity is confirmed, delete `extension/` and `wasm/`, update the workspace `members`, update the top-level docs, and verify `cargo test --workspace` and `cargo build` pass without them
- [ ] 8.4 Smoke test on Windows and Linux (build, unlock, encrypt, decrypt, clipboard clearing) and record any platform differences in `desktop/README.md`

## Workflow follow-up

- Finish or close `build-cipherchat-mvp` and archive it before this change, so `message-encryption` becomes a main spec; mark its extension capabilities as superseded.
- Archive this change after review.
