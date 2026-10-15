# Spec Delta

## Purpose

Defines encrypted messages as plain text without a visible marker, so they are less conspicuous in a messenger and robust against apps that mangle emoji.

## ADDED Requirements

### Requirement: No marker prefix on new messages
The system SHALL produce encrypted messages as a single token of URL-safe base64 text (alphabet `A-Z a-z 0-9 - _`, no padding) with no prefix and no other fixed visible marker.

#### Scenario: Encrypt
- **WHEN** the user encrypts text
- **THEN** the result contains no `🔒` character and consists only of URL-safe base64 characters

#### Scenario: Version still protected
- **WHEN** a message is produced
- **THEN** its format version is carried inside the authenticated header, so changing it makes decryption fail

### Requirement: Finding messages in pasted text
The system SHALL locate encrypted messages in pasted text by trying each whitespace-separated token, accepting only tokens that parse as a valid message and are long enough to hold a header, nonce and tag. Other tokens SHALL be ignored.

#### Scenario: Surrounding text
- **WHEN** the pasted text has words or whitespace around a single message
- **THEN** the message is found and decrypted

#### Scenario: Several messages
- **WHEN** the pasted text contains several messages separated by whitespace
- **THEN** each is decrypted and shown separately, in the order pasted

#### Scenario: Old prefix not supported
- **WHEN** the pasted text contains a message with the former `🔒1.` prefix
- **THEN** it is not recognised as a message

#### Scenario: Ordinary text
- **WHEN** the pasted text contains no valid message, for example a normal sentence
- **THEN** the user is told that it is not a CipherChat message, and nothing is decrypted

#### Scenario: Altered message
- **WHEN** a token has a valid structure but was changed after encryption
- **THEN** it is reported as altered or damaged, not as "not a CipherChat message"

### Requirement: Unknown versions are reported
The system SHALL report a message whose authenticated header names a newer format version as using a newer format.

#### Scenario: Newer version
- **WHEN** a valid-looking message has a version other than the supported one
- **THEN** the user is told to update CipherChat to read it
