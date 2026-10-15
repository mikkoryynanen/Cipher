# Design

## Context

The repo is a Cargo workspace (`core`, `wasm`) plus a TypeScript MV3 extension. `core` is pure Rust with no I/O and already provides everything the desktop app needs for crypto (`ChatKey`, `encrypt`, `decrypt`, `key_id_of`, Argon2id, `🔒1.` format). The vault, service and popup logic currently live in TypeScript (`extension/src/background/`, `extension/src/popup/`) and call `core` through WASM. See proposal.md for motivation. The behavior contract is in the four specs of this change.

Toolchain observed: Rust 1.99 and Node 24 are installed; the Tauri CLI is not.

## Goals / Non-Goals

**Goals:**
- Run all crypto, vault and clipboard logic in Rust, in one process, with the UI as a thin client that never sees keys except on explicit export.
- Reuse `core` unchanged for the wire format so existing `🔒1.` messages stay compatible.
- A small, auditable privilege surface: no network, no filesystem or shell access from the UI, no access to other apps.

**Non-Goals:**
- Mobile builds, auto-update, telemetry, cloud backup or sync of keys.
- Protection against a compromised host OS (keyloggers, memory scraping, screen capture).
- Porting the extension's per-chat state or WhatsApp-specific code.

## Decisions

1. **Tauri 2 as the desktop shell (assumption, see Open Questions).** The backend is Rust, so `core` links directly and the vault becomes Rust code. The UI is a system webview, which gives a small installer and a capability-based permission model. Alternatives: *Electron* — bundles Chromium and Node, a much larger surface, and needs a second language for crypto or a native addon; *native toolkit (egui/iced)* — smallest surface and no webview, but slower to build and style, and a reasonable fallback if webview risk proves unacceptable.
2. **New workspace member `desktop/` containing `src-tauri` (Rust backend) and a plain TypeScript + Vite frontend.** No UI framework: the interface is a few forms. `wasm/` and `extension/` are deleted after parity, and the workspace `members` list is updated. Alternative: keep `wasm/` for reuse by a future web client — rejected, since nothing needs it and it is unused code in a crypto path.
3. **Backend owns all secrets; the UI talks to it over a typed command set.** Commands: `status`, `create_vault`, `unlock`, `lock`, `list_keys`, `add_key`, `delete_key`, `export_key`, `encrypt`, `decrypt`, `copy_to_clipboard`. Command results contain text, IDs, labels and fingerprints; raw keys cross the boundary only in `export_key`. Alternative: expose a generic crypto API to the UI — rejected, because it would let any script in the webview request key bytes.
4. **Vault file format.** One file in the OS app-data directory holding `{ version, kdf params, salt, blob }`. The blob is the JSON key list sealed with `core::encrypt` under a key derived from the unlock passphrase. The KDF parameters are stored in the file, so they can be raised later without breaking old vaults. The vault uses stronger Argon2id parameters than chat keys (initial target 64 MiB, t=3, p=1) via a new `ChatKey::from_passphrase_with_params` in `core`; the existing chat-key parameters and test vector stay as they are. Alternative: reuse the fixed chat-key parameters — rejected because the vault is the main offline-attack target (audit finding on weak passphrases).
5. **Serialized, atomic writes.** All vault mutations go through one async mutex and a read-modify-write on the in-memory vault. Persistence writes a temp file in the same directory, fsyncs, then renames over the vault file. This removes the extension's lost-update race and covers interrupted writes. The vault file is created with owner-only permissions where the OS supports them.
6. **Throttling state is persisted.** Failure count and the next-allowed time are stored in a small file next to the vault, so restarting does not reset the wait. The wait is 5 s doubling to a 15 min cap, starting after 3 failures. Limitation: someone who copies the vault file and attacks it with their own tool is not throttled. Only the Argon2id cost and the passphrase protect against that, which is why the passphrase minimum is 12 characters and is enforced in the backend.
7. **Memory handling.** Keys are held in `ChatKey` (zeroized on drop), and the passphrase buffer is zeroized after derivation. The unlocked vault lives only in the backend process. On lock or inactivity timeout, the in-memory key list, and the content of the UI's text fields are cleared (the backend emits a `locked` event that the UI must handle). Strings that reach the webview, such as decrypted plaintext, cannot be zeroized, which is accepted.
8. **Clipboard in the backend.** (Reading is limited to the user's paste action and to checking the app's own pending entry; the check hashes what it read and drops it. A platform change counter would avoid the read, but it is not available on every OS.) `copy_to_clipboard(kind, text)` writes through a Rust clipboard crate and records a hash of what it wrote. A timer later compares the current clipboard to that hash and clears it only on a match. The clear also runs on lock and on exit. Alternative: the webview's `navigator.clipboard` — rejected, because the UI could not do conditional clearing reliably and would hold the data longer.
9. **Locked-down webview.** CSP `default-src 'self'`; no remote content, no network commands, no shell, filesystem or opener plugins exposed to the UI; only the commands in decision 3 are allowed by the Tauri capability file. Production builds disable devtools. A test checks that the capability file lists exactly these commands.
10. **Reusing logic from the extension.** Port, don't re-derive: key add/dedup/collision logic from `service.ts`, hex and `ck1-` export format from `shared/`, and the error code set from `shared/messages.ts` (without the chat-specific codes). The port adds the key ID collision check that the extension lacked.
11. **Parsing pasted text.** The decrypt command scans pasted text for `🔒1.` tokens (prefix followed by base64url characters) and decrypts each. It does not depend on any messenger's formatting. Large pastes are capped (e.g. 1 MiB) to avoid freezing the UI.
12. **Testing.** `cargo test` for `core` (existing plus new KDF-params tests), unit tests for the vault (create, unlock, wrong passphrase, throttling with a fake clock, concurrent adds, interrupted write via a failing writer, tamper detection), command-level tests with Tauri's mock runtime, and clipboard tests with a fake clipboard. UI is checked with a few Vitest tests and a manual smoke test on each OS.

## Risks / Trade-offs

- [Copy-paste friction makes users give up or paste plaintext into the messenger by mistake] → Make the encrypt result and its copy button prominent, show a clear "copied ciphertext" confirmation, and support a one-click paste-and-decrypt. Accept that some friction is the price of the trust boundary.
- [Clipboard is readable by other apps and clipboard managers] → Timed and conditional clearing, but a clipboard history tool may still keep entries. Document this and recommend disabling clipboard history for sensitive use.
- [System webview vulnerabilities] → Tight CSP and capabilities, no remote content, keep Tauri up to date. Native toolkit remains the fallback.
- [Offline attack on a stolen vault] → Higher Argon2id parameters, 12-character minimum, parameters stored in the file so they can be raised.
- [Platform differences in clipboard, file permissions and app-data paths] → Test on macOS first, then Windows and Linux; keep platform code behind small functions.
- [Breaking change for extension users] → Vaults are not migrated. Users re-import keys through `ck1-` strings, and `core` keeps the wire format, so old messages remain readable. Migration steps are below.
- [Unsigned binaries trigger OS warnings and weaken trust] → Out of scope for this change. Signing and notarization are tracked as an open question.

## Migration Plan

1. Land `core` additions (vault KDF parameters) first. They do not affect the existing wire format or chat-key test vector.
2. Add `desktop/` and bring it to feature parity with the specs while the extension still builds.
3. Remove `extension/` and `wasm/` and update the workspace in a separate commit once the desktop app works end to end, so the removal can be reverted independently.
4. Ordering with `build-cipherchat-mvp`: that change is 18 of 20 tasks complete and its specs are not yet in `openspec/specs/`. Finish or close it and archive it first, so its `message-encryption` capability becomes a main spec. Its extension-specific capabilities should be marked superseded when archiving. Do the removal in step 3 afterwards.
5. Rollback: before step 3, delete `desktop/`. After step 3, revert the removal commit.

## Open Questions

- Which shell should we use if the Tauri assumption is rejected (Electron or a native toolkit)? This would change decisions 1 and 2, so confirm it before implementation starts.
- Which platforms are required for the first release, and should binaries be signed and notarized as part of this change? Assumed: macOS first, then Windows and Linux; signing is out of scope.
- Default inactivity lock timeout (10 minutes is assumed in the vault spec) and default clipboard timeout (30 seconds): confirm with real use.
