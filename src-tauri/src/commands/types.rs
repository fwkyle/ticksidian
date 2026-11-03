use serde::Serialize;

// ---------------------------------------------------------------------------
// DirectoryEntry / FileStat 등 file 명령 응답 DTO.
// VaultBinding / VaultSyncState는 db::schema에서 직접 사용한다.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub is_file: bool,
    /// 파일 수정 시각 (epoch milliseconds). 디렉터리 또는 metadata 조회 실패 시 None.
    /// get_file_stat의 modified_at 단위(as_millis)와 동일하게 맞춘다.
    pub modified_at: Option<u64>,
    /// 파일 생성 시각(birthtime, epoch milliseconds). 디렉터리/조회 실패/미지원 파일시스템이면 None.
    /// 목록 "생성일" 정렬이 frontmatter createdAt 다음 순위로 쓴다(2026-08-23 TICK-UX-006).
    /// 같은 metadata 구조체에서 읽으므로 추가 syscall 없이 채워진다.
    pub created_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileStat {
    pub path: String,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub created_at: Option<u64>,
}
