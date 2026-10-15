use serde::Serialize;

/// Stable error codes sent to the UI. Each decryption failure has its own code so the
/// user is told the actual reason (see the `message-workbench` spec).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ErrorCode {
    NotOurFormat,
    UnknownVersion,
    UnknownKey,
    Tampered,
    Locked,
    WrongPassphrase,
    /// Too many failed unlock attempts; `wait_secs` says how long to wait.
    Throttled,
    InvalidInput,
    /// Encryption was requested without choosing a key.
    NoKey,
    NoSuchKey,
    KeyCollision,
    VaultExists,
    NoVault,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait_secs: Option<u64>,
}

impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        Self {
            code,
            wait_secs: None,
        }
    }

    pub fn throttled(wait_secs: u64) -> Self {
        Self {
            code: ErrorCode::Throttled,
            wait_secs: Some(wait_secs),
        }
    }
}

impl From<ErrorCode> for AppError {
    fn from(code: ErrorCode) -> Self {
        Self::new(code)
    }
}

impl core::fmt::Display for AppError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:?}", self.code)
    }
}

impl std::error::Error for AppError {}
