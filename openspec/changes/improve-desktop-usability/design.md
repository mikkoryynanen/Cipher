# Design

## Context

The UI is plain TypeScript (`desktop/src/ui/`), one factory per panel returning `{ el, refresh }`, assembled by `App.showMain()`. `App.teardown()` wipes every field and rebuilds all panels on each unlock, so panels hold no state across a lock. The backend already emits a `locked` event for both manual and inactivity locks, and persists `ClipboardSettings` (with `deny_unknown_fields`) as JSON. See `proposal.md` for the friction points.

The wire format in `core/src/wire.rs` is `🔒1.` + base64url(header ‖ nonce ‖ ciphertext), where header is `version(1 byte) ‖ key id(4 bytes)` and is authenticated as AEAD associated data. The prefix therefore has two jobs: the `🔒` is a **marker**, so a decryptor can find messages inside pasted text and say "not a CipherChat message" for anything else; the `1.` is a **version label**. The version label is redundant, because the version byte already sits in the authenticated header and is what `decrypt` checks. The marker is the only thing that is lost when the prefix goes.

## Goals / Non-Goals

**Goals:**
- Encrypt, decrypt and reply on one page, with an automatic-copy setting.
- Fewer steps and keystrokes; a new user can reach a working conversation without help.
- Messages without the visible prefix.
- No change to what is stored or exposed: secrets and message text stay in memory and are wiped on lock.

**Non-Goals:**
- A UI framework migration. Plain TypeScript and the `h()` helper stay.
- Changing the cipher, key derivation or header contents.
- Updating the browser extension to the new format.
- Compatibility with the old `🔒1.` form. The app is unreleased, so no messages in that form need to stay readable.
- Remembering anything except the one new setting across app restarts.

## Decisions

1. **One `messagesPanel` replaces `encryptPanel` and `decryptPanel`.** Layout: key selector on top, an "Encrypt" section (message field, Encrypt, Clear, result with Copy), and a "Decrypt" section (input, Decrypt, Paste & decrypt, results with Copy and Reply). On wide windows the sections sit side by side, otherwise stacked. Alternative: keep two tabs with a shared key in `Session`. Rejected: it does not remove the switching the user asked to remove.
2. **Cross-panel state lives in `App`.** `App` owns a small `Session` object (`lastKeyId`, `lockReason`) passed through `Ctx`. It outlives `teardown()` so it survives a lock, and dies with the process. Alternative: persist it. Rejected: needs new storage for a non-critical preference and leaks which keys are used.
3. **Auto-copy is a persisted backend setting, enforced in the UI flow.** Add `auto_copy_ciphertext: bool` to `ClipboardSettings` with `#[serde(default = "true")]`, so a saved settings file without the field still parses (otherwise `deny_unknown_fields` plus a missing field would reject the file and silently reset the user's other settings). After `api.encrypt`, the Messages panel calls `api.copy("ciphertext", …)` when the setting is on, so timeout and conditional-clear rules in clipboard-hygiene apply unchanged. The setting is read when the panel refreshes. Alternative: copy inside the `encrypt` command. Rejected: it changes a command's contract and would copy for any caller. Default is on, since ciphertext is not secret and the goal is fewer steps; users who dislike it can switch it off.
4. **Drop the `🔒1.` prefix, keep the version in the header.** `encrypt` emits `base64url(header ‖ nonce ‖ ct)` only, and `parse` decodes it directly. The `PREFIX` constant, `is_encrypted` prefix check and all prefix handling are deleted rather than kept for compatibility. The authenticated AAD is unchanged.
5. **Finding messages without a marker: token scan.** Pasted text is split on whitespace. A token qualifies if it is valid base64url, decodes to at least `MIN_LEN` bytes (header+nonce+tag = 45 bytes, so ≥ 60 characters) and its version byte is known or at least plausible. Qualifying tokens are decrypted; others are skipped. If none qualify the result is `NotOurFormat`. A long base64-looking token that is not ours (for example a hash or URL fragment) reaches AEAD verification and is reported as unknown key or tampered; this is acceptable, since the key id check runs first and gives `UnknownKey`. Alternatives: a short ASCII marker like `ck:`, which keeps detection precise but is the visible noise the user wants gone; or no scanning, which makes surrounding text and multi-message paste fail. Rejected both.
6. **Reply stays on the page.** The decrypt result's Reply button sets the shared selector to the key id and focuses the message field. No navigation, so no `ctx.go` is needed for it.
7. **Lock reason is inferred in the UI.** `App` sets `manualLock = true` before calling `api.lock()`. A `locked` event with no manual flag is treated as inactivity and shows the notice.
8. **Clipboard is read only via the existing `paste_and_decrypt` command**, triggered by an explicit click.
9. **Keyboard handling is one `keydown` listener on the app root**: Ctrl/Cmd+1..3 switches tabs, Ctrl/Cmd+Enter submits in the message or input fields. Arrow-key tab navigation follows the WAI-ARIA tabs pattern (roving `tabindex`).
10. **Status feedback uses one `role="status"` line per section placed directly under its primary action**, replacing the scattered `.msg`/`.hint` paragraphs.
11. **Visual changes are CSS-only plus markup tweaks**: a primary/secondary button hierarchy, a danger zone in the Keys panel, and a minimum window size in `tauri.conf.json`.

12. **Debug builds relax the vault passphrase minimum.** `Vault::new` uses a minimum of 1 character under `debug_assertions` and 12 otherwise; the backend reports the minimum in `status` so the UI shows the right rule. Release behaviour is unchanged. Tests that build vaults with `with_options` keep the 12-character rule.

## Risks / Trade-offs

- [No visible marker makes a message look like random text, and a recipient who has not installed the app cannot tell it is encrypted] → Accepted by the requester. Detection in the app is by structure, not by marker.
- [Token scan may try to decrypt unrelated long tokens] → Cheap structural filter first, key id lookup before any AEAD work, and distinct error results. No false plaintext is possible because AEAD verification must succeed.
- [Messengers may wrap or split a long token] → Tokens are ASCII without spaces, which line wrapping in messengers does not break; a token split by a line break is reported as not our format, and the README says to copy the message as one piece.
- [A debug binary shipped by mistake would accept weak passphrases] → Builds meant for distribution must be release builds; the README says so.
- [Auto-copy on by default overwrites whatever the user had copied] → Only happens on an explicit Encrypt. The setting can be switched off and the notice states that the clipboard was set.
- [Inactivity lock still discards drafts] → Kept deliberately; the lock notice says text was cleared.
- [Preselecting a key could encrypt for the wrong contact] → The selected key's label and fingerprint stay visible by the message field, and Encrypt never runs without a selected key.
- [`core/` wire tests and desktop tests assert the old prefix] → Update them in the same task groups that change the behaviour.
- [Depends on `desktop-app-out-of-band`, which is not yet archived] → Implement on top of the current code; archive that change first.
