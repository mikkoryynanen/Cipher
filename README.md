# CipherChat

Encrypt your messages before they reach a messenger, and decrypt them after they arrive.

CipherChat is a small desktop app that works **next to** your messenger, never inside it. You write a message in CipherChat, copy the encrypted text, and paste it into any chat app. The messenger only ever carries random-looking text. Your contact pastes it into their CipherChat to read it.

```text
You type:    meet at 8?
Chat shows:  ATp3iqQ0v1k9mXn2L0b8Zr5c...
They read:   meet at 8?
```

## Features

- **Works with any messenger.** It only uses copy and paste, so no plugins, no modded clients and no risk to your account.
- **Strong, standard cryptography.** XChaCha20-Poly1305 for encryption and Argon2id for passphrases, from audited Rust crates. No custom primitives.
- **No network access.** The app never connects to anything, keeps no message history, and never logs message content.
- **Tamper detection.** A changed message is rejected, never shown.
- **Encrypted key vault.** Keys live on your computer, protected by a passphrase. The vault locks after 10 minutes of inactivity.
- **Fast everyday flow.** Encrypt, paste & decrypt and reply all happen on one page, with keyboard shortcuts.
- **Clipboard hygiene.** Copied text is cleared from the clipboard after 30 seconds.

## Quick start

1. **Create a vault.** Choose a passphrase of at least 12 characters. If you forget it, your keys cannot be recovered.
2. **Get a shared key.** Open **Keys** and either generate a random key, or derive one from a shared passphrase and salt. Give the same key to your contact **outside the chat**: in person, by phone, or through a password manager.
3. **Write.** On **Messages**, pick the key, type your text and press **Encrypt** (`Ctrl/Cmd+Enter`). The result is copied for you. Paste it into the messenger.
4. **Read.** Copy a received message and press **Paste & decrypt**. The app picks the right key automatically. Press **Reply** to answer with the same key.

Shortcuts: `Ctrl/Cmd+1`, `2`, `3` switch between Messages, Keys and Settings.

## Installation

Prebuilt installers for macOS, Windows and Linux are produced by the [Build workflow](.github/workflows/build.yml) and attached to each run as artifacts.

> **Note:** release builds are not yet signed or notarized, and Windows and Linux are not yet verified. Your operating system may show a warning when you open the app.

### Build from source

You need [Rust](https://rustup.rs) and [Node.js](https://nodejs.org) 22 or newer.

```sh
cd desktop
npm install
npm run tauri -- build --debug --no-bundle   # debug build
../target/debug/desktop                      # start it
```

For a release installer, run `npx tauri build` instead. Linux also needs the WebKitGTK packages listed in the [workflow](.github/workflows/build.yml).

### Run the tests

```sh
cargo test -p core              # crypto and wire format
cargo test -p desktop            # backend
cd desktop && npm test           # UI
```

## Security

### What is protected

- The messenger, its servers, chat backups and notification previews see only encrypted text.
- The messenger's own code never sees your plaintext or keys.
- Altered messages fail authentication and are not shown.
- Guessing the unlock passphrase is slowed down by Argon2id and growing delays after failures.

### What is not protected

- **A compromised computer.** Malware, keyloggers or someone at your unlocked session can read everything.
- **The clipboard.** Clipboard-history tools may keep copies. Turn them off for sensitive use.
- **A stolen vault file.** It can be attacked offline, so use a long passphrase.
- **Metadata.** The messenger still sees who you talk to, when, and roughly how long messages are.
- **Sender identity and forward secrecy.** Anyone holding the key can write messages that look like they came from any other key holder, and if a key leaks, every message made with it can be read.

See [desktop/README.md](desktop/README.md) for the full threat model and where data is stored.

## How it works

```text
base64url( version ‖ key_id ‖ nonce ‖ ciphertext ‖ tag )
```

Messages are plain base64url text with no visible prefix. The version and key ID are authenticated, and a fresh random nonce is used for every message. Full details are in [core/README.md](core/README.md).

## Project layout

| Path | Purpose |
|------|---------|
| [`core/`](core) | Pure Rust crypto and wire format, with no I/O |
| [`desktop/`](desktop) | Tauri desktop app (TypeScript UI, Rust backend) |
| [`openspec/`](openspec) | Specifications and change history |
| [`plan.md`](plan.md) | Original design and roadmap |


## License

[MIT](LICENSE)
