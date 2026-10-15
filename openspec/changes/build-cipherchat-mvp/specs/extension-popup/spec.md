# Spec Delta

## Purpose

Provides a standalone UI in the browser extension for manually encrypting and decrypting text and managing keys, independent of any chat page.

## ADDED Requirements

### Requirement: Manual encrypt and decrypt
The popup SHALL provide an input to encrypt text with a selected key and an input to decrypt pasted ciphertext, each with a copyable result.

#### Scenario: Encrypt in popup
- **WHEN** the user enters text and presses encrypt with a key selected
- **THEN** a `🔒1.` string is shown and can be copied

#### Scenario: Decrypt in popup
- **WHEN** the user pastes a valid `🔒1.` string for a known key
- **THEN** the plaintext is shown

#### Scenario: Decrypt failure message
- **WHEN** decryption fails
- **THEN** the popup shows a message naming the cause (not our format, unknown version, unknown key, or tampered)

### Requirement: Key management UI
The popup SHALL allow unlocking storage, adding, listing (by fingerprint and label) and deleting keys.

#### Scenario: Add key
- **WHEN** the user adds a key while unlocked
- **THEN** it appears in the list with its fingerprint

#### Scenario: Locked state
- **WHEN** storage is locked
- **THEN** encrypt/decrypt controls are disabled and an unlock prompt is shown
