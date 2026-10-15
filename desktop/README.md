# CipherChat desktop

A small desktop app for encrypting and decrypting messages by hand. You write a message
here, copy the encrypted text, and paste it into any messenger. When you receive an
encrypted message, you paste it here to read it. The app never touches the messenger,
and it makes no network connections.

The messenger only ever carries a block of random-looking text such as `ATp3iq…` (copy it as one piece, without line breaks). The key stays on your
computer, in a vault protected by a passphrase.

## Using it

1. **Create a vault.** Choose a passphrase of at least 12 characters (debug builds accept any non-empty one). It protects your
   keys on this computer. If you forget it, the keys cannot be recovered.
2. **Get a key.** Everyone in a conversation needs the same key. In **Keys** you can:
   - generate a random key and send it to your contact **out of band** (in person, by
     phone, or through a password manager, never through the chat);
   - or derive one from a shared passphrase plus a salt (also shared out of band).
     Random keys are safer, because a passphrase can be guessed offline from captured
     messages.
3. **Write.** On the **Messages** page pick the key (it is preselected when there is only
   one, or when you used it last), type the message and press **Encrypt** (or Ctrl/Cmd+Enter).
   The encrypted text is copied to the clipboard automatically; paste it into the messenger.
   Turn this off under **Settings** to copy by hand with **Copy encrypted message**.
4. **Read.** Copy the received message in the messenger, then press **Paste & decrypt** (or
   paste into the box and press **Decrypt**, or Ctrl/Cmd+Enter). The app finds the right key
   by the key ID stored in the message. **Reply** selects that key for your answer.

Shortcuts: Ctrl/Cmd+1, 2, 3 switch between Messages, Keys and Settings. The tabs also work
with the arrow keys.

Copied keys and decrypted text are removed from the clipboard after 30 seconds (change
this under **Settings**), but only if the clipboard still contains what the app put
there. The vault locks after 10 minutes without activity, and locking clears every field.

## Build and test

Requires Rust and Node.

```sh
cd desktop
npm install
npm test                          # UI tests
cargo test -p desktop             # backend tests (run from the repository root)
npm run tauri -- build --debug --no-bundle  # debug binary: ../target/debug/desktop
../target/debug/desktop                     # start it
```

`npm run tauri -- build` also builds the frontend, and sets the Tauri feature that embeds
it in the binary. A plain `cargo build` does not embed the frontend. Use `--debug` for
normal development. Release builds (without `--debug`) enforce the 12-character minimum
for the vault passphrase; debug builds only require a non-empty one.

## What is and is not protected

**Protected**

- The messenger, its servers, your chat backups and notification previews see only
  encrypted text.
- The messenger's own code (for example WhatsApp Web's JavaScript) never sees your
  plaintext or your keys, because you never type or read them in the messenger.
- Messages are authenticated: a changed message is rejected, never shown.
- Keys are stored only in the encrypted vault. The app has no network access, no logging
  of message content, and no history. Restarting it shows no earlier messages.
- Guessing the unlock passphrase is slowed down: Argon2id with a strong cost, plus
  waiting periods after repeated failures (5 s doubling to 15 min).

**Not protected**

- **A compromised computer.** Malware, keyloggers, screen capture or someone with your
  unlocked session can read everything. Keep your system updated and lock the app.
- **The clipboard.** Other apps and clipboard-history tools can read what you copy. The
  app clears its own entries, but cannot clear copies a history tool has already kept.
  Turn clipboard history off for sensitive use.
- **A stolen vault file.** Throttling only applies inside the app. Someone with a copy of
  `vault.json` can try passphrases offline, limited only by the Argon2id cost. Use a long
  passphrase.
- **Metadata.** Who you talk to, when, and roughly how long each message is remain visible
  to the messenger.
- **Authenticity between key holders.** Everyone with the key can write messages that look
  like they came from anyone else with the key, and an old message can be pasted into a
  chat again. There is no forward secrecy: if a key leaks, every message that used it can
  be read.
- **Memory.** Keys are wiped from memory when no longer needed, but text shown in the
  window cannot be wiped completely.

## Where data is kept

In the app data folder (`app.cipherchat.desktop`), for example
`~/Library/Application Support/app.cipherchat.desktop` on macOS:

| File | Contents |
|------|----------|
| `vault.json` | Encrypted keys, key-derivation settings and salt |
| `throttle.json` | Failed unlock count and the time of the next allowed attempt |
| `clipboard-settings.json` | Copy and clipboard clearing preferences |

Files are readable only by your user account on macOS and Linux.

## Design notes

- `core/` (Rust) does all cryptography: XChaCha20-Poly1305 and Argon2id. Messages are
  plain base64url text with no prefix. The old `🔒1.` form is no longer recognised.
- `desktop/src-tauri/` is the backend that owns the vault, keys and clipboard. The window
  can only call the commands listed in `src-tauri/commands.txt`, and
  `src-tauri/tests/capabilities.rs` fails if anything else is allowed, if a network
  dependency appears, or if the content security policy is loosened.
- `desktop/src/` is the window, written in plain TypeScript. It never receives key bytes
  except when you press **Export**.

## Status

Not yet verified on Windows and Linux, and release binaries are not signed or notarized, so
your operating system may warn when you open the app.
