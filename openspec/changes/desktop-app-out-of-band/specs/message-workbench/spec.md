# Spec Delta

## Purpose

Defines the copy-in/copy-out workflow: the user encrypts text in the app and pastes the ciphertext into any messenger, and pastes received ciphertext into the app to read it. The app never reads from or writes into other applications.

## ADDED Requirements

### Requirement: Encrypt text for sharing
The system SHALL encrypt user-entered text with an explicitly selected key and present the resulting `🔒1.` message ready to copy.

#### Scenario: Encrypt
- **WHEN** the user enters text, selects a key and chooses encrypt
- **THEN** a `🔒1.` message is shown that only holders of that key can decrypt

#### Scenario: No key selected
- **WHEN** the user chooses encrypt without a selected key
- **THEN** nothing is encrypted and the user is asked to select a key

#### Scenario: Empty input
- **WHEN** the input text is empty
- **THEN** encryption is not performed

### Requirement: Decrypt pasted messages
The system SHALL decrypt a pasted `🔒1.` message by finding the stored key whose ID matches the message, and SHALL show the plaintext only inside the app.

#### Scenario: Decrypt with matching key
- **WHEN** the user pastes a valid message and a matching key is stored
- **THEN** the plaintext is shown together with the label of the key that was used

#### Scenario: Surrounding text
- **WHEN** the pasted content has leading or trailing whitespace or text around a single `🔒1.` message
- **THEN** the message is still found and decrypted

#### Scenario: Multiple messages pasted
- **WHEN** the pasted content contains several `🔒1.` messages
- **THEN** each is decrypted and shown separately, in the order pasted

### Requirement: Distinct failure reasons
The system SHALL report why a message could not be decrypted, using distinct reasons for each cause.

#### Scenario: Not a CipherChat message
- **WHEN** pasted text contains no `🔒1.` message
- **THEN** the user is told it is not a CipherChat message

#### Scenario: Unknown key
- **WHEN** no stored key matches the message's key ID
- **THEN** the user is told they do not have the key for this message

#### Scenario: Tampered or corrupted
- **WHEN** the key matches but authentication fails
- **THEN** the user is told the message was altered or damaged and no plaintext is shown

#### Scenario: Unknown version
- **WHEN** the message uses an unsupported format version
- **THEN** the user is told to update the app

#### Scenario: Vault locked
- **WHEN** the vault is locked
- **THEN** encryption and decryption are unavailable and the user is prompted to unlock

### Requirement: No plaintext persistence
The system SHALL NOT save message plaintext or ciphertext history to disk or logs, and SHALL clear input and output fields when the vault locks.

#### Scenario: Lock clears content
- **WHEN** the vault locks
- **THEN** all entered plaintext, decrypted plaintext and ciphertext shown in the app are cleared

#### Scenario: Restart
- **WHEN** the app is restarted
- **THEN** no earlier messages are shown or recoverable from app storage

### Requirement: No messenger integration or network access
The system SHALL NOT read other applications' windows, SHALL NOT inject text into other applications, SHALL NOT make network connections, and SHALL read the clipboard only when the user pastes or when checking an entry the app itself placed there.

#### Scenario: Paste is user-initiated
- **WHEN** the user has not pasted or triggered a paste action and the app has not placed anything on the clipboard
- **THEN** the app does not read the clipboard

#### Scenario: Checking its own clipboard entry
- **WHEN** the app has placed an exported key or decrypted text on the clipboard and its clearing time arrives or the vault locks
- **THEN** the app reads the clipboard once, only to compare it with what it placed, discards what it read, and does not read the clipboard again until it places another entry

#### Scenario: Offline operation
- **WHEN** the device has no network access
- **THEN** every feature works unchanged
