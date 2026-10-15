# Spec Delta

## Purpose

Defines how the desktop app protects stored keys with a user passphrase: encryption at rest, backend-enforced passphrase strength, throttled unlock attempts, session locking and safe concurrent writes.

## ADDED Requirements

### Requirement: Keys encrypted at rest
The system SHALL store keys only in an authenticated, encrypted vault protected by a key derived from the user's unlock passphrase, and SHALL NOT write key bytes, passphrases or message plaintext to disk in any other form.

#### Scenario: Vault file contents
- **WHEN** a vault containing keys exists on disk
- **THEN** the file contains no plaintext key bytes and any modification of it is detected at unlock

#### Scenario: Locked app
- **WHEN** the app starts and the vault has not been unlocked
- **THEN** no key is usable for encryption, decryption, listing or export

### Requirement: Backend-enforced passphrase minimum
The system SHALL reject a new unlock passphrase shorter than 12 characters when creating or changing the vault, regardless of which UI or caller submits it.

#### Scenario: Short passphrase at creation
- **WHEN** a caller creates a vault with a passphrase of fewer than 12 characters
- **THEN** creation fails with an invalid-input error and no vault is written

#### Scenario: Short passphrase submitted bypassing the UI
- **WHEN** the backend receives a creation request with a short passphrase directly
- **THEN** it is rejected the same way

### Requirement: Throttled unlock attempts
The system SHALL slow down repeated failed unlock attempts and SHALL keep that slowdown across app restarts.

#### Scenario: Repeated failures
- **WHEN** three consecutive unlock attempts fail
- **THEN** further attempts are refused until a wait period has elapsed, the period doubles with each further failure, starting at 5 seconds and capped at 15 minutes, and the remaining wait is reported to the user

#### Scenario: Restart does not reset throttling
- **WHEN** the app is closed and reopened during a wait period
- **THEN** the wait period still applies

#### Scenario: Successful unlock
- **WHEN** the correct passphrase is entered outside a wait period
- **THEN** the vault unlocks and the failure count resets

### Requirement: Session locking
The system SHALL let the user lock the vault at any time and SHALL lock it automatically after an inactivity timeout, discarding unlocked key material from memory.

#### Scenario: Manual lock
- **WHEN** the user locks the vault
- **THEN** all key operations fail with a locked error until the next unlock

#### Scenario: Inactivity timeout
- **WHEN** the app has had no user activity for the configured timeout (default 10 minutes)
- **THEN** the vault locks automatically

### Requirement: Safe concurrent writes
The system SHALL apply vault modifications one at a time and SHALL NOT lose a key or corrupt the vault when several modifications are requested concurrently or interrupted.

#### Scenario: Concurrent additions
- **WHEN** two keys are added at the same time
- **THEN** both keys are present after both operations complete

#### Scenario: Interrupted write
- **WHEN** the app is terminated while the vault is being saved
- **THEN** the next start finds either the previous or the new complete vault, never a partial one
