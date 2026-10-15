# Tasks

## 1. Message format without the prefix

- [x] 1.1 In `core/src/wire.rs`, emit `base64url(header ‖ nonce ‖ ct)` and remove `PREFIX`, `is_encrypted` and all prefix handling; update every use of the prefix in `core` and `desktop/src-tauri/src` (`workbench.rs`, `keys.rs`, `vault.rs`, `clipboard.rs` and their tests) and in the desktop UI text and tests; verify with core tests: output has no `🔒` and round-trips, a changed version byte fails
- [x] 1.2 Add a token scanner in `core` (split on whitespace, structural filter by decodable length ≥ `MIN_LEN`, no prefix handling) and use it in the desktop `decrypt` and `paste_and_decrypt` paths in place of the prefix search; verify with tests for surrounding text, several messages, ordinary text and a former `🔒1.`-prefixed message (both `NotOurFormat`), altered token (`Tampered`) and newer version (`UnknownVersion`)
- [x] 1.3 Update `core/README.md` and `desktop/README.md` to describe the new format; verify the documented example round-trips in a core doc test or test case

## 2. Auto-copy setting (backend)

- [x] 2.1 Add `auto_copy_ciphertext: bool` (default true, `#[serde(default)]`) to `ClipboardSettings` in `desktop/src-tauri/src/clipboard.rs` and `api.ts`; verify with Rust tests: default value, persistence round trip, an old settings file without the field keeps its other values, unknown fields are still rejected

## 3. Messages page

- [x] 3.1 Add `Session` (last key id, lock reason) to `Ctx` and `App`; verify with a test in `desktop/tests/unlock.test.ts` that `lastKeyId` survives a lock/unlock cycle
- [x] 3.2 Replace `encrypt.ts` and `decrypt.ts` with `messages.ts`/`messagesPanel` containing the shared key selector, encrypt section and decrypt section; verify with the updated `desktop/tests/workbench.test.ts` that encrypting and decrypting both work from the one panel without switching tabs
- [x] 3.3 Key preselection (only key, last used, deleted key fallback), Ctrl/Cmd+Enter in both fields and "Clear"; verify with tests for each case
- [x] 3.4 Auto-copy: after a successful encrypt call `api.copy("ciphertext", …)` when the setting is on and show the countdown; do nothing when off; verify with tests for on, off, and missing key/text
- [x] 3.5 "Reply" on decrypted items selects the key and focuses the empty message field; verify with a test, including that the clipboard is not read on focus

## 4. Navigation, settings and guidance

- [x] 4.1 Tabs become Messages, Keys, Settings; add roving-tabindex arrow navigation and Ctrl/Cmd+1..3; verify with tests
- [x] 4.2 Add the "Copy encrypted message automatically" switch to the Settings panel (renamed from Clipboard), loading and saving it with the other clipboard settings; verify with a settings test that it persists through save and refresh
- [x] 4.3 Show the lock reason (inactivity vs manual) on the unlock screen; verify with tests for both cases
- [x] 4.4 First-run guidance with an "Add a key" action on the Messages page when no keys exist; next steps after adding a key (export prompt, salt with copy button and reminder); verify in `desktop/tests/keys.test.ts`
- [x] 4.5 Replace the scattered `.msg`/`.hint` outcome text with one `role="status"` line under each primary action; verify existing error and countdown tests pass against the new slot

## 5. Layout and polish

- [x] 5.1 Restyle in `desktop/src/style.css`: side-by-side Messages layout on wide windows, primary/secondary button hierarchy, danger zone for destructive key actions, compact add-key form; verify by running the app and checking each page at the default size
- [x] 5.2 Set a minimum window size in `desktop/src-tauri/tauri.conf.json`; verify nothing clips at that size
- [x] 5.3 Document shortcuts, the auto-copy setting and first-run flow in `desktop/README.md`; verify the shortcuts work in the running app
- [x] 5.4 Run `cargo test` for the workspace and `npm test` and `npm run build` in `desktop/`; verify all pass
