# Spec Delta

## Purpose

Defines how users create, import, label, export and delete the shared keys used in the desktop app. Keys are shared out of band and are selected explicitly per operation, not tied to a chat.

## ADDED Requirements

### Requirement: Create or derive a key
The system SHALL let the user generate a random 256-bit key or derive one from a passphrase and a 16-byte salt, and SHALL show the key's short fingerprint.

#### Scenario: Generate random key
- **WHEN** the user generates a key
- **THEN** a new random key is added to the vault with its fingerprint shown

#### Scenario: Derive from passphrase
- **WHEN** the user enters a passphrase and a salt shared out of band
- **THEN** the same passphrase and salt always produce the same key and fingerprint

#### Scenario: Generated salt
- **WHEN** the user derives a key without supplying a salt
- **THEN** a random salt is generated and shown so it can be shared together with the passphrase

#### Scenario: Weak shared passphrase warning
- **WHEN** the user derives a key from a passphrase shorter than 12 characters
- **THEN** the system warns that short passphrases can be guessed offline from captured messages and recommends a generated key

### Requirement: Import and export
The system SHALL export a key as a `ck1-` text string and SHALL import such a string as a key, rejecting malformed input.

#### Scenario: Round trip
- **WHEN** a key is exported and the string is imported into another vault
- **THEN** the imported key has the same fingerprint and decrypts the same messages

#### Scenario: Malformed import
- **WHEN** the user imports a string with a wrong prefix, non-hex content or the wrong length
- **THEN** import fails with an invalid-input error and nothing is stored

#### Scenario: Export warning
- **WHEN** the user exports a key
- **THEN** the system warns that the key must be shared out of band and never through a chat

### Requirement: Key identity and duplicates
The system SHALL identify keys by their short key ID and SHALL NOT silently replace or discard a different key that has the same ID.

#### Scenario: Same key added twice
- **WHEN** a key identical to a stored key is added again
- **THEN** the existing entry is kept and the user is told it already exists

#### Scenario: Key ID collision
- **WHEN** a different key with the same key ID as a stored key is added
- **THEN** the system rejects it with a clear collision message and keeps the stored key

### Requirement: Labels and deletion
The system SHALL let the user label and delete keys, requiring confirmation for deletion.

#### Scenario: Default label
- **WHEN** a key is added without a label
- **THEN** its fingerprint is used as the label

#### Scenario: Delete key
- **WHEN** the user confirms deleting a key
- **THEN** the key is removed and messages for that key can no longer be decrypted

### Requirement: Keys stay in the backend
The system SHALL expose raw key bytes to the user interface only as the result of an explicit export action.

#### Scenario: Listing keys
- **WHEN** the interface lists keys
- **THEN** it receives only IDs, labels and fingerprints
