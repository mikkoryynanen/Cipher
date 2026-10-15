# Spec Delta

## Purpose

Makes the everyday encrypt, decrypt and reply loop fast: both directions live on one page, with the fewest steps and keystrokes between typing or receiving a message and having the result in the right place, without weakening any of the app's secrecy guarantees.

## ADDED Requirements

### Requirement: Single Messages page
The app SHALL present encrypting and decrypting together on one Messages page, sharing one key selector, so that a conversation does not require switching views.

#### Scenario: Both on one page
- **WHEN** the user opens the Messages page
- **THEN** the message-to-encrypt field, the encrypted-input field and the key selector are all available without switching tabs

#### Scenario: Shared key
- **WHEN** the user selects a key on the Messages page
- **THEN** that key is used for encrypting, and is shown as the key in use for replies

### Requirement: Key preselection
The Messages page SHALL preselect a key when one can be chosen unambiguously: the only stored key, otherwise the key last used successfully in this session.

#### Scenario: Single key
- **WHEN** exactly one key is stored and the Messages page is shown
- **THEN** that key is selected

#### Scenario: Last used key
- **WHEN** several keys are stored and the user previously encrypted or decrypted with one of them
- **THEN** that key is selected, including after the vault was locked and unlocked

#### Scenario: Last used key deleted
- **WHEN** the remembered key no longer exists
- **THEN** no key is preselected and the user must choose one

### Requirement: Automatic copy setting
The Settings page SHALL provide a switch "Copy encrypted message automatically", on by default and persisted. When on, a newly generated encrypted message SHALL be placed on the clipboard immediately, subject to the existing clipboard clearing rules.

#### Scenario: Setting on
- **WHEN** the setting is on and the user encrypts text (button or Ctrl/Cmd+Enter)
- **THEN** the encrypted message is shown and is already on the clipboard, and the copy notice or clearing countdown is shown

#### Scenario: Setting off
- **WHEN** the setting is off and the user encrypts text
- **THEN** the encrypted message is shown but the clipboard is not changed until the user chooses Copy

#### Scenario: Persisted
- **WHEN** the user changes the setting and restarts the app
- **THEN** the setting keeps its value

#### Scenario: Existing settings file
- **WHEN** the app starts with saved clipboard settings that predate this setting
- **THEN** the saved settings are kept and the new setting takes its default

#### Scenario: Missing key or text
- **WHEN** no key is selected or the text is empty
- **THEN** nothing is encrypted or copied and the reason is shown next to the relevant field

### Requirement: Clearing a draft
The Messages page SHALL offer a way to clear the message and the encrypted result in one action.

#### Scenario: Clear
- **WHEN** the user chooses "Clear"
- **THEN** the message field and the result are emptied

### Requirement: Decrypt from the clipboard
The Messages page SHALL support Ctrl/Cmd+Enter to decrypt the current encrypted input, and SHALL read the clipboard only when the user explicitly chooses "Paste & decrypt".

#### Scenario: Keyboard decrypt
- **WHEN** the user presses Ctrl/Cmd+Enter in the encrypted-input field
- **THEN** the input is decrypted as if the Decrypt button was chosen

#### Scenario: No implicit clipboard reads
- **WHEN** the Messages page is shown or focused
- **THEN** the clipboard is not read

### Requirement: Reply with the same key
For each successfully decrypted message the Messages page SHALL offer a "Reply" action that selects the key used for decryption and focuses the empty message field, without leaving the page.

#### Scenario: Reply
- **WHEN** the user chooses "Reply" on a decrypted message
- **THEN** the key that decrypted the message is selected and the message field is empty and focused

### Requirement: No new plaintext persistence
Convenience features SHALL NOT persist message text, decrypted text or drafts, and SHALL keep only non-secret preferences such as the last used key identifier and the automatic-copy setting.

#### Scenario: Lock clears work in progress
- **WHEN** the vault locks
- **THEN** message fields, results and decrypted text are emptied, and only the last used key identifier and settings survive
