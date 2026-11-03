use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use thiserror::Error;

use crate::commands::CommandError;

#[derive(Debug, Error)]
pub enum RagError {
    #[error("RAG DB를 찾지 못했습니다: {0}")]
    MissingDatabase(String),
    #[error("완료되지 않은 RAG DB입니다. 터미널에서 전체 빌드(rag:build)를 실행하세요.")]
    IncompleteIndex,
    #[error("RAG DB 차원({db})과 임베딩 차원({expected})이 다릅니다. 같은 임베딩으로 만든 DB인지 확인하세요.")]
    DimensionMismatch { db: usize, expected: usize },
    #[error("검색어가 비어 있습니다.")]
    EmptyQuery,
    #[error("Gemini API 키가 없습니다. GEMINI_API_KEY 환경변수를 설정하거나, 보안 메모에서 비밀 폴더를 고른 뒤 그 안의 Gemini 키 파일(기본 gemini.env)에 GEMINI_API_KEY를 두세요. 앱은 이 파일을 자동으로 읽습니다.")]
    MissingApiKey,
    #[error("쿼리 임베딩 실패: {0}")]
    Embedding(String),
    #[error("검토 항목 분류 실패: {0}")]
    Classification(String),
    #[error("vault 경계 밖 경로: {0}")]
    Boundary(String),
    #[error("sqlite 오류: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io 오류: {0}")]
    Io(#[from] std::io::Error),
}

impl From<CommandError> for RagError {
    fn from(error: CommandError) -> Self {
        match error {
            CommandError::VaultBoundaryViolation { path } => Self::Boundary(path),
            other => Self::Boundary(other.to_string()),
        }
    }
}

impl RagError {
    fn code(&self) -> &'static str {
        match self {
            Self::MissingDatabase(_) => "ragMissingDatabase",
            Self::IncompleteIndex => "ragIncompleteIndex",
            Self::DimensionMismatch { .. } => "ragDimensionMismatch",
            Self::EmptyQuery => "ragEmptyQuery",
            Self::MissingApiKey => "ragMissingApiKey",
            Self::Embedding(_) => "ragEmbedding",
            Self::Classification(_) => "ragClassification",
            Self::Boundary(_) => "ragBoundary",
            Self::Sqlite(_) => "ragSqlite",
            Self::Io(_) => "ragIo",
        }
    }
}

impl Serialize for RagError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("RagError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
