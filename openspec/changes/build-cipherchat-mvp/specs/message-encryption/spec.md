# Spec Delta

## Purpose

Defines how plaintext messages are converted to and from an authenticated, versioned text format that can be carried safely by a chat platform that only transports text.

## ADDED Requirements

### Requirement: Encrypt text to wire format
The system SHALL encrypt a plaintext string with a chat key into a single text string of the form `🔒1.` followed by URL-safe base64 without padding.

#### Scenario: Round trip
- **WHEN** a message is encrypted with a key and then decrypted with the same key
- **THEN** the decrypted text equals the original, including emoji and multi-line text

#### Scenario: Fresh randomness
- **WHEN** the same plaintext is encrypted twice with the same key
- **THEN** the two outputs differ

### Requirement: Authenticated header
The system SHALL bind the version and key ID to the ciphertext so that altering either causes decryption to fail.

#### Scenario: Tampered ciphertext
- **WHEN** any byte of the encoded payload is modified
- **THEN** decryption fails with a `Tampered` error and returns no plaintext

#### Scenario: Tampered header
- **WHEN** the key ID or version bytes are changed while the rest is intact
- **THEN** decryption does not succeed

### Requirement: Distinct decryption errors
The system SHALL report decryption failure as one of `NotOurFormat`, `UnknownVersion`, `WrongKey` or `Tampered`.

#### Scenario: Not our format
- **WHEN** the input does not start with the `🔒1.` marker family or is not valid base64 or is too short
- **THEN** the error is `NotOurFormat`

#### Scenario: Unknown version
- **WHEN** the payload version byte is not supported
- **THEN** the error is `UnknownVersion`

#### Scenario: Wrong key
- **WHEN** the key's ID differs from the key ID in the message
- **THEN** the error is `WrongKey`

### Requirement: Cheap detection and key lookup
The system SHALL provide a prefix-based check for encrypted text and a way to read the key ID from a message without decrypting it.

#### Scenario: Detect encrypted message
- **WHEN** text begins with `🔒1.`
- **THEN** the detection check returns true, and false for ordinary text

#### Scenario: Read key ID
- **WHEN** a well-formed encrypted message is inspected
- **THEN** its 4-byte key ID is returned without needing a key

### Requirement: Stable wire format
The wire format SHALL NOT change unintentionally between releases.

#### Scenario: Fixed test vectors
- **WHEN** the test suite decrypts the committed fixed vectors
- **THEN** each yields its recorded plaintext

### Requirement: Memory hygiene for keys
Key material SHALL be wiped from memory when the key is dropped.

#### Scenario: Key dropped
- **WHEN** a chat key goes out of scope
- **THEN** its 32 key bytes are zeroized
