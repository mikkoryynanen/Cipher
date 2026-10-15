# Spec Delta

## Purpose

Limits how long sensitive data stays in the system clipboard after the app copies it, without destroying anything the user copied afterwards.

## ADDED Requirements

### Requirement: Timed clipboard clearing
The system SHALL clear the clipboard after a timeout when the app has placed an exported key or decrypted plaintext on it, and SHALL tell the user when it will happen.

#### Scenario: Exported key cleared
- **WHEN** the user copies an exported key
- **THEN** the clipboard is cleared after 30 seconds and a countdown or notice is shown

#### Scenario: Decrypted plaintext cleared
- **WHEN** the user copies decrypted plaintext
- **THEN** the clipboard is cleared after 30 seconds

#### Scenario: Ciphertext copy
- **WHEN** the user copies an encrypted `🔒1.` message
- **THEN** the clipboard is not cleared automatically, because ciphertext is meant to be pasted into a messenger, but the user can enable clearing in settings

### Requirement: Conditional clearing
The system SHALL clear the clipboard only if it still holds the content the app placed there.

#### Scenario: User copied something else
- **WHEN** the timeout elapses and the clipboard now holds different content
- **THEN** the clipboard is left untouched

### Requirement: Clear on lock and exit
The system SHALL clear a pending app-placed clipboard entry immediately when the vault locks or the app exits.

#### Scenario: Lock before timeout
- **WHEN** the vault locks while a cleared-later entry is still on the clipboard
- **THEN** the entry is cleared at once if it is still unchanged

### Requirement: Configurable timeout
The system SHALL let the user change the clipboard clearing timeout or turn it off for decrypted plaintext, but SHALL NOT allow turning it off for exported keys.

#### Scenario: Change timeout
- **WHEN** the user sets a different timeout in settings
- **THEN** later copies use the new timeout

#### Scenario: Exported keys always cleared
- **WHEN** the user tries to disable clearing for exported keys
- **THEN** the setting is not available
