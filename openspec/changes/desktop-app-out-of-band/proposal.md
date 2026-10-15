# Proposal

## Why

The security audit of the browser extension found problems that come from running inside WhatsApp Web, so patching them one by one won't remove them:

- WhatsApp's own JavaScript can read the plaintext, both what the user types and what is decrypted into the page.
- Send interception can fail open when WhatsApp's DOM selectors break, which sends plaintext without warning.
- Chats are identified by the displayed title, so two contacts with the same name share settings.
- Content scripts can call every privileged service-worker action, including raw key export.

An out-of-band flow removes this class of risk: the user encrypts and decrypts in a separate desktop app and only ciphertext ever goes into the messenger. The cost is extra copy-paste, which we accept in exchange for a much smaller trust boundary.

## What Changes

- **BREAKING**: Replace the WhatsApp Web browser extension (`extension/`, `wasm/`) with a standalone desktop application. The extension's content scripts, DOM selectors, per-chat toggle and send interception are removed, not ported.
- New desktop app that reuses the existing Rust `core` crate (XChaCha20-Poly1305, Argon2id, `🔒1.` wire format) directly, with no WASM layer.
  - The user types plaintext, gets a `🔒1.…` message and copies it into any messenger.
  - For incoming messages, the user pastes the ciphertext and reads the plaintext inside the app.
- The app works with any messenger, not just WhatsApp. It has no WhatsApp-specific code, permissions or network access.
- Key and vault handling is hardened in the new backend:
  - encrypted vault unlocked by a passphrase, with the minimum length enforced in the backend, not only the UI;
  - unlock attempt throttling;
  - serialized vault writes, so concurrent operations cannot lose keys;
  - explicit key selection per operation. No chat-title identity and no per-chat settings.
- Clipboard hygiene: copied ciphertext and exported keys are cleared from the clipboard after a timeout, but only if the clipboard still holds what the app put there.
- Keys never cross into the UI layer unnecessarily: the UI asks the backend to encrypt or decrypt and receives text, and raw keys are exposed only through an explicit export action.

Out of scope: mobile apps, auto-detecting or injecting into messenger windows, global hotkeys that read other apps' content, X25519 identity keys, group keys, media, and a threat model that includes a compromised host OS.

## Capabilities

### New Capabilities
- `desktop-vault`: Passphrase-protected encrypted key vault with backend-enforced passphrase minimum, unlock throttling, session lock and serialized writes.
- `desktop-key-management`: Creating (random or passphrase-derived), importing, exporting, listing and deleting keys in the desktop app, with fingerprints and out-of-band warnings.
- `message-workbench`: The paste-in/copy-out encrypt and decrypt workflow, including explicit key selection, distinct failure reasons and no persistence of message plaintext.
- `clipboard-hygiene`: Time-limited clipboard exposure of ciphertext and exported keys, with conditional clearing.

### Modified Capabilities

None. `openspec/specs/` is empty because `build-cipherchat-mvp` has not been archived. That change's `message-encryption` capability (the wire format) is unchanged and still applies. Its `chat-key-management`, `extension-popup` and `whatsapp-web-integration` capabilities are superseded by this change. See `design.md` for how to sequence archiving.

## Impact

- **Removed:** `extension/` and `wasm/`, once the desktop app reaches parity. The Cargo workspace members change accordingly.
- **New code:** a desktop app crate and frontend, with the Rust `core` crate reused as-is.
- **New dependencies:** a desktop shell (assumed to be Tauri 2, see `design.md`), a clipboard plugin and a small UI framework or plain TypeScript.
- **Unchanged:** `core/` and the `🔒1.` wire format. Existing messages stay decryptable. Vaults created by the extension are not migrated automatically. Users re-import keys via the `ck1-` export format.
- **Security:** the app has no network permissions and no access to other applications' content. The trust boundary shrinks to the app and the host OS.
