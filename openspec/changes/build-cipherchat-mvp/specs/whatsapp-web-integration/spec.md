# Spec Delta

## Purpose

Makes encryption transparent inside WhatsApp Web by decrypting encrypted messages in place and encrypting outgoing text, without modifying the official client's code.

## ADDED Requirements

### Requirement: Inline decryption
The extension SHALL detect messages beginning with `🔒1.` in the open chat and display their plaintext in place, including messages that load later.

#### Scenario: Existing message
- **WHEN** a chat containing an encrypted message for a known key is opened while unlocked
- **THEN** the message is shown as plaintext with a lock indicator

#### Scenario: New incoming message
- **WHEN** a new encrypted message arrives
- **THEN** it is decrypted and shown without a page reload

#### Scenario: Cannot decrypt
- **WHEN** a message cannot be decrypted
- **THEN** it displays a short reason (e.g. "unknown key") instead of silently showing gibberish

### Requirement: Encrypt on send
When encryption is enabled for the current chat, the extension SHALL replace the compose-box text with its encrypted form before it is sent.

#### Scenario: Send with encryption on
- **WHEN** the user sends a message in a chat with encryption on and storage unlocked
- **THEN** only the `🔒1.` ciphertext is sent to WhatsApp

#### Scenario: Cannot encrypt
- **WHEN** encryption is on but storage is locked or the chat has no key
- **THEN** the send is blocked and the user is told why; plaintext is never sent

### Requirement: Per-chat toggle and indicator
The extension SHALL provide an on/off toggle per chat, defaulting to off, with a visible indicator of the current state.

#### Scenario: Toggle
- **WHEN** the user turns encryption on for a chat
- **THEN** the state persists for that chat and the indicator shows locked

#### Scenario: Group chat
- **WHEN** the open chat is a group
- **THEN** encryption cannot be enabled in v1

### Requirement: Contained selectors and minimal permissions
All WhatsApp-specific DOM selectors SHALL live in one module, and the extension SHALL request only access to WhatsApp Web and extension storage.

#### Scenario: DOM change
- **WHEN** WhatsApp changes its markup
- **THEN** fixing integration requires editing only the selectors module
