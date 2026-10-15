# CipherChat browser extension (MVP)

Second encryption layer around WhatsApp Web. All crypto runs in WASM built from
`../core`; WhatsApp only ever carries `🔒1.…` text. Chrome/Chromium, Manifest V3.

## Build and load

```sh
# one-time: rustup target add wasm32-unknown-unknown && cargo install wasm-pack
cd extension
npm install
npm run build:wasm   # ../wasm -> src/wasm-pkg
npm run build        # -> dist/
```

Then open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, and
select `extension/dist`. Permissions requested: `storage` and `https://web.whatsapp.com/*` only.

Tests: `npm test` (Vitest + jsdom; needs `build:wasm` first). Typecheck: `npm run typecheck`.

## Using it

1. Click the toolbar icon and **create your vault** (unlock passphrase). Keys are stored
   encrypted under it; locking or closing the browser makes them unusable again.
2. **Add a key**: generate a random one, derive one from a shared passphrase + salt, or
   import an exported `ck1-…` key. Use **Export** to share a key with your contact,
   **in person or over another secure channel — never through the chat itself**.
3. Popup **Encrypt / Decrypt** boxes work anywhere, with or without WhatsApp.
4. On WhatsApp Web a **🔓 Off / 🔒 On** toggle appears in the compose area, per chat
   (default off). With it on, outgoing text is encrypted before sending and incoming
   `🔒1.` messages are decrypted in place.

## Behaviour to know

- **Fails closed**: if encryption is on and the vault is locked, the key is missing, or
  anything errors, the send is blocked and a notice explains why. Plaintext is not sent.
- **1:1 chats only.** Groups, broadcasts and channels cannot be enabled.
- Chats are identified by the **name in the chat header** (WhatsApp exposes no chat ID in
  the page), so renaming a contact resets its toggle, and two chats with identical names
  would share settings. Groups are detected heuristically (member list in the header, or
  more than two senders on screen).
- Text only. Very long messages that WhatsApp truncates behind "Read more" may not decrypt.
- All WhatsApp selectors live in `src/whatsapp/selectors.ts`; a test enforces this.

## Verification status

Automated (all passing): core unit tests and fixed vectors, WASM tests under Node,
and 46 extension tests (message API, encrypted-at-rest store, popup components,
decryption, fail-closed send, toggle, selector containment). Also checked in headless
Brave: the unpacked extension loads, the service worker starts, the real popup
runs create-vault → add key → encrypt → decrypt (including error messages), and the
content script initialises on `web.whatsapp.com` with no exceptions.

**Not yet verified against real WhatsApp Web.** The DOM fixtures in `tests/fixtures/`
are hand-written approximations of WhatsApp's markup, not captures of a live page, so
the selectors are unproven against the real client. The two manual checks below need a
logged-in WhatsApp Web session and a second account.

### Manual check 5.3 — popup round trip via WhatsApp

- [ ] Encrypt in the popup, paste the `🔒1.…` text into a WhatsApp Web chat and send.
- [ ] On a second machine/profile with the same key imported, decrypt it in the popup.
- Result: _not run yet_

### Manual check 6.5 — live end-to-end between two accounts

- [ ] Turn the toggle on, send a message; receiver (with the key) sees plaintext inline.
- [ ] The chat on the sender's **phone** shows only `🔒1.…` ciphertext.
- [ ] Lock CipherChat, try to send with the toggle on: send is blocked, nothing is sent.
- [ ] Toggle off: messages send as normal text.
- [ ] If any selector fails, fix `src/whatsapp/selectors.ts` only and refresh the fixtures.
- Result: _not run yet_
