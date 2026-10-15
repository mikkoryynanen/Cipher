# Spec Delta

## Purpose

Helps a user who has not read any documentation to get from first launch to a working encrypted conversation, and keeps the app's state, errors and navigation understandable afterwards.

## ADDED Requirements

### Requirement: First-run guidance
When no keys are stored, the Messages page SHALL explain in plain language that a shared key is needed and offer a direct action to add one.

#### Scenario: No keys yet
- **WHEN** the vault holds no keys and the user opens Messages
- **THEN** a short explanation and an "Add a key" action are shown, and the action opens the Keys view with the add-key form ready

#### Scenario: Keys exist
- **WHEN** at least one key is stored
- **THEN** the guidance is not shown

### Requirement: Next steps after adding a key
After a key is added, the app SHALL tell the user what to do next, including that the contact must receive the same key out of band.

#### Scenario: Key generated
- **WHEN** a new random key was generated
- **THEN** the confirmation offers to export it for sharing and repeats that it must not be sent through the messenger

#### Scenario: Passphrase key with new salt
- **WHEN** a passphrase key was created with a newly generated salt
- **THEN** the salt is shown with a copy action and a reminder that the contact needs both salt and passphrase

### Requirement: Consistent status feedback
The app SHALL show the outcome of every user action (success or failure) in a visible location near the action, and SHALL NOT rely on text that can be scrolled out of view.

#### Scenario: Result visible
- **WHEN** an action completes or fails
- **THEN** its outcome is visible without scrolling in the default window size

### Requirement: Keyboard navigation
All views SHALL be operable by keyboard. The tab list SHALL support arrow-key navigation and Ctrl/Cmd+1..3 SHALL switch views.

#### Scenario: Arrow keys
- **WHEN** a tab has focus and the user presses the left or right arrow
- **THEN** focus and selection move to the neighbouring tab

#### Scenario: Shortcut
- **WHEN** the user presses Ctrl/Cmd+2 while unlocked
- **THEN** the second view (Keys) is shown

### Requirement: Lock reason
The unlock screen SHALL tell the user why the app is locked when it was not a first start.

#### Scenario: Inactivity lock
- **WHEN** the vault locks because of inactivity
- **THEN** the unlock screen states that the app locked after a period of inactivity and that unsent text was cleared

#### Scenario: Manual lock
- **WHEN** the user chooses Lock
- **THEN** the unlock screen is shown without a warning message

### Requirement: Clear naming and readable layout
Views SHALL be named for what the user does, the primary action in each view SHALL be visually distinct from secondary actions, and the window SHALL have a minimum size at which no content is clipped.

#### Scenario: Settings naming
- **WHEN** the tab list is shown
- **THEN** it contains Messages, Keys and Settings
