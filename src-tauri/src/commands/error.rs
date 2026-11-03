use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use thiserror::Error;

use crate::db;

pub type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("database error: {0}")]
    Database(#[from] db::DbError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database state lock poisoned")]
    DatabaseStatePoisoned,
    #[error("filesystem scope plugin is unavailable")]
    FsScopeUnavailable,
    #[error("failed to register vault directory '{path}': {message}")]
    FsScopeRegistration { path: String, message: String },
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("파일이 열려 있는 동안 외부에서 바뀌었습니다: {path}")]
    SecretModifiedExternally { path: String },
    #[error("저장을 기다리는 동안 파일이 외부에서 바뀌었습니다: {path}")]
    FileModifiedExternally { path: String },
    #[error("file is too large: {size} bytes exceeds the {limit} byte limit")]
    FileTooLarge { size: u64, limit: u64 },
    #[error("failed to convert dialog path: {0}")]
    DialogPathConversion(String),
    #[error("path is outside registered vault: {path}")]
    VaultBoundaryViolation { path: String },
    #[error("vault registry is full ({limit} max). detach an existing vault before registering a new one.")]
    VaultRegistryFull { limit: usize },
    #[error("vault watch error: {0}")]
    Watch(String),
}

impl CommandError {
    fn code(&self) -> &'static str {
        match self {
            Self::Database(_) => "database",
            Self::Io(_) => "io",
            Self::DatabaseStatePoisoned => "databaseStatePoisoned",
            Self::FsScopeUnavailable => "fsScopeUnavailable",
            Self::FsScopeRegistration { .. } => "fsScopeRegistration",
            Self::InvalidPath(_) => "invalidPath",
            Self::SecretModifiedExternally { .. } => "secretModifiedExternally",
            Self::FileModifiedExternally { .. } => "fileModifiedExternally",
            Self::FileTooLarge { .. } => "fileTooLarge",
            Self::DialogPathConversion(_) => "dialogPathConversion",
            Self::VaultBoundaryViolation { .. } => "vaultBoundaryViolation",
            Self::VaultRegistryFull { .. } => "vaultRegistryFull",
            Self::Watch(_) => "watch",
        }
    }
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("CommandError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
