# Proposal

## Why

The desktop app (`desktop-app-out-of-band`) works, but using it for real conversations is clumsy. The out-of-band flow already costs copy-paste, so every extra click or detour is paid on every message. Reading the current UI (`desktop/src/ui/`) shows these concrete friction points:

- **Encrypting takes too many steps.** The user must pick a key from a dropdown every time (even with one key, the selection resets to "Select a key…" after each lock), click Encrypt, then click a separate Copy button. There is no keyboard shortcut, and the plaintext stays in the box afterwards.
- **Encrypt and Decrypt are on separate tabs.** A conversation is a back-and-forth, so the user keeps switching tabs and re-selecting the key. Replying means going to the other tab by hand.
- **Every message starts with `🔒1.`.** It is noise in the messenger and looks odd to recipients, and the emoji can be mangled by some apps.
- **First run is unguided.** After creating a vault the user lands on an Encrypt tab that says "No keys yet – add one in Keys". Nothing explains what a key is, that the contact needs the same one, or what to do after generating it (export and share out of band).
- **Navigation and feedback are weak.** The tab "Clipboard" is really settings. Tabs have no keyboard navigation. Success and errors appear as small text below the fold. An inactivity lock drops the user on the unlock screen with no explanation, and any draft is silently gone.
- **Keys screen is heavy.** Adding a key shows a long form where the salt (needed by the contact) is displayed but cannot be copied, and destructive actions sit next to harmless ones.

## What Changes

- **One Messages page** holds both Encrypt and Decrypt, sharing a single key selector, so the user never changes tabs during a conversation. Tabs become Messages, Keys, Settings.
- Encrypt side: preselect the last-used key (or the only key), support Ctrl/Cmd+Enter, and offer a "Clear" action for the draft.
- New setting **"Copy encrypted message automatically"** (default on): when enabled, the encrypted text is placed on the clipboard immediately after it is generated. When off, the user copies it with the Copy button. This extends the persisted clipboard settings.
- Decrypt side: paste from the clipboard with one action, support Ctrl/Cmd+Enter, and a "Reply" action that selects the decrypting key and focuses the message field on the same page.
- **BREAKING (format):** drop the `🔒1.` prefix. A message is just the base64url text. The version stays inside the authenticated header, so nothing is lost. The app is unreleased, so there is no legacy format to keep: the old prefix is removed outright.
- First-run and empty states: a short guided "get started" on the first empty Encrypt/Decrypt view, with a direct button to add a key. After adding a key, show next steps (share it out of band, copy salt/exported key).
- Navigation: rename "Clipboard" to "Settings", keyboard shortcuts for switching tabs, arrow-key navigation within the tab list, and a visible status area for success and errors.
- Lock behaviour: the unlock screen says why the app locked (manual, inactivity). The inactivity timeout stays backend-enforced.
- Keys panel: copy buttons for the salt, compact add-key form, destructive actions visually separated and confirmed as today.
- Visual polish: clearer hierarchy, larger primary actions, consistent spacing, and a sensible minimum window size.

Out of scope: new cryptographic features (the cipher, key derivation and header contents are unchanged), new backend commands that expose key material, persisting message plaintext or drafts across locks, OS-level global hotkeys, tray icon, and mobile.

## Capabilities

### New Capabilities
- `workbench-quick-flow`: A single Messages page for encrypt, decrypt and reply with key preselection, an automatic-copy setting and keyboard shortcuts.
- `compact-message-format`: Encrypted messages without the `🔒1.` marker, and finding messages in pasted text.
- `desktop-guidance`: First-run guidance, empty states, post-action next steps, consistent status feedback, keyboard navigation and lock-reason messaging.

### Modified Capabilities

None. `openspec/specs/` is empty because `desktop-app-out-of-band` and `build-cipherchat-mvp` are not yet archived. These specs layer on `message-workbench`, `desktop-key-management`, `desktop-vault` and `clipboard-hygiene` from `desktop-app-out-of-band` and must be archived after it.

## Impact

- **Code:** `desktop/src/ui/*.ts` (Encrypt and Decrypt merged into a Messages panel), `desktop/src-tauri/src/clipboard.rs`, `desktop/src/style.css`, `desktop/index.html`, `desktop/src-tauri/tauri.conf.json` (minimum window size) and the UI tests in `desktop/tests/`.
- **Core:** `core/src/wire.rs` changes the output format and the parser (see `design.md`), with tests. The `core/README.md` format description is updated. The browser extension also uses the format; it is being replaced by the desktop app and is not updated.
- **Backend:** `ClipboardSettings` gains an `autoCopyCiphertext` field (backward compatible with saved settings). The last-used key id and lock reason are kept in UI memory for the app session. No new key-exposing commands, and `capabilities/default.json` gains no permissions.
- **Security:** plaintext and drafts remain in memory only and are wiped on lock. The clipboard is read only on an explicit user action. Clipboard clearing rules are unchanged and apply to automatic copies.
- **Unchanged:** the cipher, key derivation and stored vaults. No released version exists, so no compatibility with the old `🔒1.` form is kept.
