# Spec Delta

## Purpose

Defines how users create, import, store and select the shared secret keys that protect each chat, without ever exposing keys in plaintext storage or through the chat platform.

## ADDED Requirements

### Requirement: Create or import a chat key
The system SHALL let the user generate a random key or derive one from a passphrase, and SHALL show the key's short fingerprint.

#### Scenario: Generate random key
- **WHEN** the user chooses to generate a key
- **THEN** a new random 256-bit key is created with a fingerprint shown

#### Scenario: Derive from passphrase
- **WHEN** the user enters a passphrase and a salt shared out of band
- **THEN** the same passphrase and salt always produce the same key and fingerprint

### Requirement: Keys encrypted at rest
The system SHALL store keys only in encrypted form protected by a user-chosen unlock passphrase, never as plaintext on disk.

#### Scenario: Locked storage
- **WHEN** the extension is started and not yet unlocked
- **THEN** no key is usable and stored data contains no plaintext key bytes

#### Scenario: Wrong unlock passphrase
- **WHEN** the user enters an incorrect unlock passphrase
- **THEN** unlock fails and keys stay unavailable

### Requirement: Chat-to-key mapping
The system SHALL associate each chat with a key and SHALL select the key for an incoming message using the message's key ID.

#### Scenario: Matching key found
- **WHEN** an incoming message's key ID matches a stored key
- **THEN** that key is used for decryption

#### Scenario: No matching key
- **WHEN** no stored key matches the message's key ID
- **THEN** the message is reported as undecryptable with an "unknown key" reason

### Requirement: Out-of-band export only
The system SHALL NOT transmit keys through the chat platform and SHALL warn the user that keys must be shared out of band.

#### Scenario: Export key
- **WHEN** the user exports a key for sharing
- **THEN** it is displayed or copied locally with a warning not to send it via the chat
