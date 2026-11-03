// 보안 메모 뷰어 — 사용자가 고른 비밀 폴더 연동 (2026-08-15 [kyle] 요청, 2026-08-20 추가·편집 확장).
//
// 설계: docs/waterfall/03-상세설계/보안-메모-뷰어.md
//
// 계약:
// - 삭제/이름변경/이동 명령은 존재하지 않는다.
// - 추가·편집은 안전 레일과 함께 허용된다(2026-08-20 [kyle] 승인 — 잠긴 계약 3 예외 확장):
//   편집은 '수정' 버튼(진입 시 백업 생성) 경유, 원자적 쓰기, mtime 외부 변경 감지, 600 권한.
// - 사용자가 고른 비밀 폴더(secrets_config) 하위만 접근. 상대경로 문자열 검증 + canonicalize 이중 검증.
// - 노이즈(.DS_Store, .trash-staging/, .backup/)은 목록에서 제외.
// - 내용은 webview로 전달되지만 UI는 기본 가림 렌더다(위험 수용 기록은 설계 문서 §2).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::{RegisteredVaults, SecretsViewerState};

const MAX_FILE_BYTES: u64 = 512 * 1024;
const NOISE_FILE_NAMES: [&str; 1] = [".DS_Store"];
const NOISE_DIR_NAMES: [&str; 2] = [".trash-staging", ".backup"];
/// 편집 백업 폴더(뷰어 목록 제외 대상이자 쓰기 명령의 예약 경로).
const SECRET_BACKUP_DIR: &str = ".backup";
/// 파일당 유지할 편집 백업 개수.
const SECRET_BACKUP_KEEP: usize = 5;
#[cfg(unix)]
const SECRET_FILE_MODE: u32 = 0o600;
#[cfg(unix)]
const SECRET_DIR_MODE: u32 = 0o700;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretFileMeta {
    /// 기본 폴더 기준 상대경로 (예: "aws/ky9376-admin.env")
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

/// 목록/노이즈 필터링 규칙(순수, 단위 테스트 대상).
pub fn should_skip_entry(name: &str, is_dir: bool) -> bool {
    if is_dir {
        return NOISE_DIR_NAMES.contains(&name);
    }
    NOISE_FILE_NAMES.contains(&name)
}

/// 프론트가 보낸 상대경로의 1차 검증(문자열 규칙).
/// 비었거나, 절대경로이거나, `..` 세그먼션이 있으면 거부한다.
pub fn validate_rel_path(rel: &str) -> CommandResult<()> {
    if rel.is_empty() {
        return Err(CommandError::InvalidPath("파일을 선택하세요.".to_string()));
    }
    if rel.starts_with('/') || rel.starts_with('\\') {
        return Err(CommandError::InvalidPath(
            "상대경로만 허용합니다.".to_string(),
        ));
    }
    if rel.contains('\0') {
        return Err(CommandError::InvalidPath("잘못된 경로입니다.".to_string()));
    }
    for segment in rel.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(CommandError::InvalidPath(
                "경로 세그먼트가 올바르지 않습니다.".to_string(),
            ));
        }
        if segment == SECRET_BACKUP_DIR {
            return Err(CommandError::InvalidPath(
                ".backup은 앱이 관리하는 예약 폴더입니다.".to_string(),
            ));
        }
    }
    Ok(())
}

/// 사용자가 고른 비밀 폴더. 매 접근마다 선택과 같은 검증(등록 볼트 충돌 포함)을 다시 거친다.
fn base_dir(state: &SecretsViewerState, vaults: &RegisteredVaults) -> CommandResult<PathBuf> {
    state.effective_base(&vaults.snapshot()?)
}

/// 2차 검증: canonicalize 결과가 기본 폴더 안인지 확인한다(symlink 탈출 차단).
fn resolve_within(base: &Path, rel: &str) -> CommandResult<PathBuf> {
    validate_rel_path(rel)?;
    let base_canon = fs::canonicalize(base).map_err(|e| CommandError::Io(e))?;
    let candidate = fs::canonicalize(base.join(rel))
        .map_err(|_| CommandError::InvalidPath(format!("파일을 찾지 못했습니다: {rel}")))?;
    if !candidate.starts_with(&base_canon) {
        return Err(CommandError::InvalidPath(
            "경로가 비밀 폴더 범위를 벗어납니다.".to_string(),
        ));
    }
    Ok(candidate)
}

fn walk_files(dir: &Path, prefix: &str, out: &mut Vec<SecretFileMeta>) -> CommandResult<()> {
    let entries = fs::read_dir(dir).map_err(CommandError::Io)?;
    for entry in entries {
        let entry = entry.map_err(CommandError::Io)?;
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry.file_type().map_err(CommandError::Io)?;
        let is_dir = file_type.is_dir();
        if should_skip_entry(&name, is_dir) {
            continue;
        }
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if is_dir {
            walk_files(&entry.path(), &rel, out)?;
        } else {
            let meta = entry.metadata().map_err(CommandError::Io)?;
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(SecretFileMeta {
                path: rel,
                size_bytes: meta.len(),
                modified_ms,
            });
        }
    }
    Ok(())
}

/// 비밀 폴더 하위 파일 목록(읽기 전용).
#[tauri::command]
pub async fn list_secret_files(
    state: State<'_, SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> CommandResult<Vec<SecretFileMeta>> {
    let base = base_dir(&state, &vaults)?;
    list_secret_files_in_background(base).await
}

// 대량 파일 조회/정렬로 화면 실행을 막지 않는다. 읽기 조건과 응답은 유지한다.
async fn list_secret_files_in_background(base: PathBuf) -> CommandResult<Vec<SecretFileMeta>> {
    tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        walk_files(&base, "", &mut files)?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(files)
    })
    .await
    .map_err(|error| std::io::Error::other(format!("secret list worker failed: {error}")))?
}

/// 지정한 비밀 파일 내용(읽기 전용, 크기 상한 적용).
#[tauri::command]
pub fn read_secret_file(
    rel_path: String,
    state: State<'_, SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> CommandResult<String> {
    let base = base_dir(&state, &vaults)?;
    let path = resolve_within(&base, &rel_path)?;
    let meta = fs::metadata(&path).map_err(CommandError::Io)?;
    if !meta.is_file() {
        return Err(CommandError::InvalidPath(
            "폴더가 아닌 파일만 읽을 수 있습니다.".to_string(),
        ));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(CommandError::InvalidPath(
            "파일이 너무 큽니다(최대 512KB).".to_string(),
        ));
    }
    fs::read_to_string(&path).map_err(CommandError::Io)
}

// ---------------------------------------------------------------------------
// 추가·편집 (TICK-SEC-002, 2026-08-20 [kyle] 승인 — 잠긴 계약 3 예외 확장)
// ---------------------------------------------------------------------------

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> CommandResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(CommandError::Io)
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> CommandResult<()> {
    Ok(())
}

fn modified_ms_of(meta: &fs::Metadata) -> CommandResult<u64> {
    let duration = meta
        .modified()
        .map_err(CommandError::Io)?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    Ok(duration.as_millis() as u64)
}

/// 같은 폴더 tmp → rename 원자적 쓰기. tmp에 먼저 600을 부여해 rename 후 권한이 유지된다.
fn write_secret_atomic(path: &Path, content: &str) -> CommandResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::InvalidPath("경로가 올바르지 않습니다.".to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| CommandError::InvalidPath("파일명을 확인하세요.".to_string()))?;
    let tmp_path = parent.join(format!(
        ".{}.ticksidian-tmp-{}",
        file_name,
        std::process::id()
    ));
    fs::write(&tmp_path, content).map_err(CommandError::Io)?;
    #[cfg(unix)]
    set_mode(&tmp_path, SECRET_FILE_MODE)?;
    if let Err(err) = fs::rename(&tmp_path, path) {
        // 실패 시 tmp를 남기지 않는다(원본은 tmp 단계라 무사하다).
        let _ = fs::remove_file(&tmp_path);
        return Err(CommandError::Io(err));
    }
    Ok(())
}

/// 없는 상위 폴더를 세그먼트별로 만든다(새 폴더는 700). 결과는 대상 전체 경로.
fn ensure_parent_dirs(base_canon: &Path, rel: &str) -> CommandResult<PathBuf> {
    let segments: Vec<&str> = rel.split('/').collect();
    let mut cursor = base_canon.to_path_buf();
    for segment in &segments[..segments.len() - 1] {
        cursor.push(segment);
        if cursor.is_symlink() {
            return Err(CommandError::InvalidPath(
                "경로가 비밀 폴더 범위를 벗어납니다.".to_string(),
            ));
        }
        if !cursor.is_dir() {
            if cursor.exists() {
                return Err(CommandError::InvalidPath(
                    "폴더를 만들 수 없는 경로입니다.".to_string(),
                ));
            }
            fs::create_dir(&cursor).map_err(CommandError::Io)?;
            #[cfg(unix)]
            set_mode(&cursor, SECRET_DIR_MODE)?;
        }
    }
    Ok(base_canon.join(rel))
}

fn ensure_write_size(content: &str) -> CommandResult<()> {
    let size = content.len() as u64;
    if size > MAX_FILE_BYTES {
        return Err(CommandError::FileTooLarge {
            size,
            limit: MAX_FILE_BYTES,
        });
    }
    Ok(())
}

/// 새 보안 메모 파일 생성(존재하면 거부, 원자적, 600). 순수 경계라 cargo 단위 테스트 대상.
pub fn create_secret_file_impl(
    base: &Path,
    rel: &str,
    content: &str,
) -> CommandResult<SecretFileMeta> {
    validate_rel_path(rel)?;
    ensure_write_size(content)?;
    let base_canon = fs::canonicalize(base).map_err(CommandError::Io)?;
    let target = ensure_parent_dirs(&base_canon, rel)?;
    // 상위 폴더까지 canonicalize 이중 검증(중간 symlink 탈출 차단).
    let parent_canon = fs::canonicalize(
        target
            .parent()
            .ok_or_else(|| CommandError::InvalidPath("경로가 올바르지 않습니다.".to_string()))?,
    )
    .map_err(CommandError::Io)?;
    if !parent_canon.starts_with(&base_canon) {
        return Err(CommandError::InvalidPath(
            "경로가 비밀 폴더 범위를 벗어납니다.".to_string(),
        ));
    }
    let file_name = rel.rsplit('/').next().unwrap_or_default();
    let target = parent_canon.join(file_name);
    // symlink 포함 존재 검사(symlink_metadata는 링크 자체를 본다).
    if fs::symlink_metadata(&target).is_ok() {
        return Err(CommandError::InvalidPath(format!(
            "이미 존재하는 파일입니다: {rel}"
        )));
    }
    write_secret_atomic(&target, content)?;
    let meta = fs::metadata(&target).map_err(CommandError::Io)?;
    Ok(SecretFileMeta {
        path: rel.to_string(),
        size_bytes: meta.len(),
        modified_ms: modified_ms_of(&meta)?,
    })
}

/// 고정 폭 타임스탬프({초 10자리}.{나노초 9자리}) — 이름 정렬이 시간 정렬과 같다.
fn backup_timestamp() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:010}.{:09}", duration.as_secs(), duration.subsec_nanos())
}

/// 백업 파일명에 쓰는 원본 식별자 — 폴더 경로까지 포함해 rel 전체를 인코딩한다.
/// 파일명(basename)만 쓰면 다른 폴더의 같은 이름 파일(oci/main.env vs gcp/main.env)이
/// 백업 풀 하나를 공유해 "파일당 5개" 약속이 깨진다(2026-08-20 검수 발견,
/// [kyle] 파일당 5개 조건 승인에 맞춰 수정).
fn backup_stem(rel: &str) -> String {
    rel.replace('/', "__")
}

/// `{stem}.` 뒤가 정확히 백업 타임스탬프({초 10자리}.{나노초 9자리})인지 판정.
/// 이름이 서로 접두 관계인 파일(a.env vs a.env.local)의 백업이 섞이지 않게 한다.
fn is_backup_of(name: &str, stem: &str) -> bool {
    let Some(suffix) = name
        .strip_prefix(stem)
        .and_then(|rest| rest.strip_prefix('.'))
    else {
        return false;
    };
    let bytes = suffix.as_bytes();
    bytes.len() == 20
        && bytes[10] == b'.'
        && bytes[..10].iter().all(u8::is_ascii_digit)
        && bytes[11..].iter().all(u8::is_ascii_digit)
}

/// 파일당 최근 SECRET_BACKUP_KEEP개만 남긴다. 초과분은 파일 단위로 하나씩 제거하고
/// 회전 실패는 편집을 막지 않는다(best-effort — 설계 §8, [kyle] 2026-08-20 "파일당 5개" 승인).
fn rotate_backups(backup_dir: &Path, stem: &str) {
    let Ok(entries) = fs::read_dir(backup_dir) else {
        return;
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| is_backup_of(n, stem))
        .collect();
    if names.len() <= SECRET_BACKUP_KEEP {
        return;
    }
    names.sort_unstable();
    let excess = &names[..names.len() - SECRET_BACKUP_KEEP];
    for name in excess {
        let _ = fs::remove_file(backup_dir.join(name));
    }
}

/// mtime 편집 토큰 — 나노초 정확도({초 10자리}.{나노초 9자리}).
/// ms로 자르면 같은 밀리초 안의 외부 변경을 못 잡는다(실측). u64 나노초는 JS 숫자
/// 안전 한계(2^53)를 넘으므로 문자열 토큰으로 주고받는다(프론트는 불투명하게 전달).
fn mtime_token(meta: &fs::Metadata) -> CommandResult<String> {
    let duration = meta
        .modified()
        .map_err(CommandError::Io)?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    Ok(format!(
        "{:010}.{:09}",
        duration.as_secs(),
        duration.subsec_nanos()
    ))
}

/// 편집 진입('수정' 버튼 클릭 시점 1회): 원본 백업 + 현재 mtime 토큰 반환.
pub fn begin_secret_edit_impl(base: &Path, rel: &str) -> CommandResult<String> {
    validate_rel_path(rel)?;
    let source = resolve_within(base, rel)?;
    let meta = fs::metadata(&source).map_err(CommandError::Io)?;
    if !meta.is_file() {
        return Err(CommandError::InvalidPath(
            "폴더가 아닌 파일만 편집할 수 있습니다.".to_string(),
        ));
    }
    let backup_dir = base.join(SECRET_BACKUP_DIR);
    if !backup_dir.is_dir() {
        if backup_dir.is_symlink() {
            return Err(CommandError::InvalidPath(
                ".backup 경로를 확인하세요.".to_string(),
            ));
        }
        fs::create_dir(&backup_dir).map_err(CommandError::Io)?;
        #[cfg(unix)]
        set_mode(&backup_dir, SECRET_DIR_MODE)?;
    }
    // 폴더 경로까지 인코딩한 stem — 다른 폴더의 같은 이름 파일과 풀이 섞이지 않는다.
    let stem = backup_stem(rel);
    let backup_path = backup_dir.join(format!("{stem}.{}", backup_timestamp()));
    fs::copy(&source, &backup_path).map_err(CommandError::Io)?;
    #[cfg(unix)]
    set_mode(&backup_path, SECRET_FILE_MODE)?;
    rotate_backups(&backup_dir, &stem);
    mtime_token(&meta)
}

/// 편집 저장: mtime 일치 확인 → 원자적 쓰기(600 유지) → 새 mtime 반환.
pub fn write_secret_file_impl(
    base: &Path,
    rel: &str,
    content: &str,
    expected_mtime: &str,
) -> CommandResult<String> {
    validate_rel_path(rel)?;
    ensure_write_size(content)?;
    let path = resolve_within(base, rel)?;
    let meta = fs::metadata(&path).map_err(CommandError::Io)?;
    if !meta.is_file() {
        return Err(CommandError::InvalidPath(
            "폴더가 아닌 파일만 저장할 수 있습니다.".to_string(),
        ));
    }
    let current = mtime_token(&meta)?;
    if current != expected_mtime {
        return Err(CommandError::SecretModifiedExternally {
            path: rel.to_string(),
        });
    }
    write_secret_atomic(&path, content)?;
    mtime_token(&fs::metadata(&path).map_err(CommandError::Io)?)
}

/// macOS Finder에서 원본 파일 하이라이트(open -R). webview plugin 직접 호출 금지 원칙 유지.
pub fn reveal_secret_in_finder_impl(base: &Path, rel: &str) -> CommandResult<()> {
    let path = resolve_within(base, rel)?;
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(CommandError::Io)?;
        if !status.success() {
            return Err(CommandError::InvalidPath(
                "Finder에서 열지 못했습니다.".to_string(),
            ));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Err(CommandError::InvalidPath(
            "Finder 보기는 macOS에서만 지원합니다.".to_string(),
        ));
    }
    Ok(())
}

/// 새 보안 메모 파일 생성(존재하면 거부, 원자적 쓰기, 생성 직후 600).
#[tauri::command]
pub fn create_secret_file(
    rel_path: String,
    content: String,
    state: State<'_, SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> CommandResult<SecretFileMeta> {
    let base = base_dir(&state, &vaults)?;
    create_secret_file_impl(&base, &rel_path, &content)
}

/// 편집 진입('수정' 버튼 클릭 시점): 원본을 .backup/{파일명}.{타임스탬프}로 백업하고 mtime 반환.
#[tauri::command]
pub fn begin_secret_edit(
    rel_path: String,
    state: State<'_, SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> CommandResult<String> {
    let base = base_dir(&state, &vaults)?;
    begin_secret_edit_impl(&base, &rel_path)
}

/// 편집 저장(mtime 불일치 거부, 원자적 쓰기, 600 유지). 새 mtime을 반환한다.
#[tauri::command]
pub fn write_secret_file(
    rel_path: String,
    content: String,
    expected_mtime: String,
    state: State<'_, SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> CommandResult<String> {
    let base = base_dir(&state, &vaults)?;
    write_secret_file_impl(&base, &rel_path, &content, &expected_mtime)
}

/// macOS Finder에서 원본 파일 하이라이트.
#[tauri::command]
pub fn reveal_secret_in_finder(
    rel_path: String,
    state: State<'_, SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> CommandResult<()> {
    let base = base_dir(&state, &vaults)?;
    reveal_secret_in_finder_impl(&base, &rel_path)
}

// ---------------------------------------------------------------------------
// Gemini API 키 로더 — env 우선, 없으면 비밀 폴더 안 설정된 상대경로에서 읽는다
// (2026-08-15 [kyle] 요청: dev 터미널 source가 없어도 dev/배포 앱 모두 작동하게).
// 키는 Rust 내부에서만 쓰고 webview로 전달하지 않는다(기존 계약 유지).
// ---------------------------------------------------------------------------

/// env 파일 내용에서 키 값 추출(순수 함수). KEY=VALUE / export KEY=VALUE,
/// 값 양쪽 따옴표(짝이 맞을 때)를 지원한다.
pub fn extract_env_value(content: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}=");
    for raw_line in content.lines() {
        let mut line = raw_line.trim();
        if let Some(rest) = line.strip_prefix("export ") {
            line = rest.trim();
        }
        let Some(rest) = line.strip_prefix(&prefix) else {
            continue;
        };
        let mut value = rest.trim();
        if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            value = &value[1..value.len() - 1];
        }
        return Some(value.to_string());
    }
    None
}

/// Gemini API 키 해석: GEMINI_API_KEY env 우선(CI/기존 워크플로 호환),
/// 없으면 비밀 폴더 안 설정된 상대경로(기본 gemini.env)에서 읽는다.
pub fn resolve_gemini_api_key(state: &SecretsViewerState, vaults: &RegisteredVaults) -> String {
    if let Ok(key) = std::env::var("GEMINI_API_KEY") {
        if !key.trim().is_empty() {
            return key;
        }
    }
    let Ok(base) = base_dir(state, vaults) else {
        return String::new();
    };
    let Ok(path) = resolve_within(&base, &state.gemini_key_rel_path()) else {
        return String::new();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return String::new();
    };
    extract_env_value(&content, "GEMINI_API_KEY").unwrap_or_default()
}

// ---------------------------------------------------------------------------
// 단위 테스트
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn skip_noise_entries_only() {
        assert!(should_skip_entry(".DS_Store", false));
        assert!(should_skip_entry(".trash-staging", true));
        assert!(should_skip_entry(".backup", true));
        assert!(!should_skip_entry(".env", false));
        assert!(!should_skip_entry("aws", true));
        assert!(!should_skip_entry("gemini/projects/memory-core.env", false));
    }

    #[test]
    fn extract_env_value_supports_plain_export_and_quotes() {
        let content = "# 주석\nGEMINI_API_KEY=plain-key\nexport OTHER=\"x\"\n";
        assert_eq!(
            extract_env_value(content, "GEMINI_API_KEY"),
            Some("plain-key".to_string())
        );
        assert_eq!(
            extract_env_value("export GEMINI_API_KEY=\"quoted-key\"\n", "GEMINI_API_KEY"),
            Some("quoted-key".to_string())
        );
        assert_eq!(
            extract_env_value("GEMINI_API_KEY='single'\n", "GEMINI_API_KEY"),
            Some("single".to_string())
        );
        assert_eq!(extract_env_value("OTHER=1\n", "GEMINI_API_KEY"), None);
        // 접두만 같은 다른 키(GEMINI_API_KEYS=)는 매칭하지 않는다
        assert_eq!(
            extract_env_value("GEMINI_API_KEYS=nope\n", "GEMINI_API_KEY"),
            None
        );
    }

    #[test]
    fn rel_path_rejects_escape_attempts() {
        assert!(validate_rel_path("").is_err());
        assert!(validate_rel_path("/etc/passwd").is_err());
        assert!(validate_rel_path("..").is_err());
        assert!(validate_rel_path("aws/../../secrets").is_err());
        assert!(validate_rel_path("a//b").is_err());
        assert!(validate_rel_path("a/\0b").is_err());
        assert!(validate_rel_path("aws/ky9376-admin.env").is_ok());
        assert!(validate_rel_path(".env").is_ok());
    }

    /// 임시 홈 아래 비밀 폴더를 만들어 설정된 SecretsViewerState를 주입한다(실제 폴더 미사용).
    /// /tmp QA 산출물은 그대로 둔다(삭제 원칙: 기본은 남긴다).
    fn temp_secret_home(label: &str) -> (PathBuf, SecretsViewerState) {
        let unique = format!(
            "ticksidian-sec-qa-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let home = std::env::temp_dir().join(unique);
        let secrets = home.join("my-secrets");
        fs::create_dir_all(&secrets).expect("temp secrets base");
        let state =
            SecretsViewerState::new(crate::commands::secrets_config::config_path_for_home(&home));
        state
            .set_base_dir(fs::canonicalize(&secrets).expect("canonical secrets base"))
            .expect("persist temp config");
        (home, state)
    }

    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn create_secret_file_writes_600_and_rejects_duplicate() {
        let (_home, state) = temp_secret_home("create");
        let base = state.effective_base(&[]).unwrap();

        let meta = create_secret_file_impl(&base, "oci/new-key.env", "KEY=1\n").unwrap();
        assert_eq!(meta.path, "oci/new-key.env");
        assert_eq!(
            fs::read_to_string(base.join("oci/new-key.env")).unwrap(),
            "KEY=1\n"
        );
        assert_eq!(mode_of(&base.join("oci/new-key.env")), 0o600);
        assert_eq!(mode_of(&base.join("oci")), 0o700);

        let err = create_secret_file_impl(&base, "oci/new-key.env", "KEY=2\n").unwrap_err();
        assert!(err.to_string().contains("이미 존재하는 파일입니다"));
        // 거부 후에도 원본은 불변이다
        assert_eq!(
            fs::read_to_string(base.join("oci/new-key.env")).unwrap(),
            "KEY=1\n"
        );
    }

    #[test]
    fn create_secret_file_rejects_reserved_and_escape_paths() {
        let (_home, state) = temp_secret_home("guard");
        let base = state.effective_base(&[]).unwrap();
        assert!(create_secret_file_impl(&base, ".backup/x.env", "a").is_err());
        assert!(create_secret_file_impl(&base, "../escape.env", "a").is_err());
        assert!(create_secret_file_impl(&base, "/tmp/abs.env", "a").is_err());
        assert!(!base.join("escape.env").exists());
    }

    #[test]
    fn begin_secret_edit_creates_backups_with_rotation() {
        let (_home, state) = temp_secret_home("backup");
        let base = state.effective_base(&[]).unwrap();
        fs::write(base.join("svc.env"), "V=1\n").unwrap();

        let mut expected = "V=1\n".to_string();
        for round in 1..=6 {
            let mtime = begin_secret_edit_impl(&base, "svc.env").unwrap();
            assert!(mtime.contains('.'));

            let backup_dir = base.join(".backup");
            let mut names: Vec<String> = fs::read_dir(&backup_dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| n.starts_with("svc.env."))
                .collect();
            names.sort_unstable();
            let count = names.len();
            assert!(count <= 5, "회전 상한 5 초과: {count}");
            assert_eq!(count, round.min(5));

            // 첫 회차: 백업 내용은 진입 시점 원본 그대로다
            if round == 1 {
                let backup = fs::read_to_string(backup_dir.join(&names[0])).unwrap();
                assert_eq!(backup, expected);
                assert_eq!(mode_of(&backup_dir), 0o700);
                assert_eq!(mode_of(&backup_dir.join(&names[0])), 0o600);
            }

            // 편집 저장 시뮬레이션(원본이 바뀐다)
            expected = format!("V={}\n", round + 1);
            fs::write(base.join("svc.env"), &expected).unwrap();
        }
    }

    #[test]
    fn write_secret_file_checks_mtime_and_keeps_600() {
        let (_home, state) = temp_secret_home("write");
        let base = state.effective_base(&[]).unwrap();
        fs::write(base.join("token.env"), "T=1\n").unwrap();

        let mtime = begin_secret_edit_impl(&base, "token.env").unwrap();
        // 외부 변경: 열려 있는 사이 원본이 바뀐다
        fs::write(base.join("token.env"), "T=external\n").unwrap();
        let err = write_secret_file_impl(&base, "token.env", "T=mine\n", &mtime).unwrap_err();
        assert!(matches!(err, CommandError::SecretModifiedExternally { .. }));
        assert_eq!(
            fs::read_to_string(base.join("token.env")).unwrap(),
            "T=external\n"
        );

        // 외부 변경본 기준으로 다시 시작하면 성공한다
        let mtime2 = begin_secret_edit_impl(&base, "token.env").unwrap();
        let new_mtime = write_secret_file_impl(&base, "token.env", "T=mine\n", &mtime2).unwrap();
        assert_eq!(
            fs::read_to_string(base.join("token.env")).unwrap(),
            "T=mine\n"
        );
        assert_eq!(mode_of(&base.join("token.env")), 0o600);
        assert!(new_mtime >= mtime2);
    }

    #[test]
    fn walk_files_excludes_backup_dir() {
        let (_home, state) = temp_secret_home("walk");
        let base = state.effective_base(&[]).unwrap();
        fs::write(base.join("a.env"), "A=1\n").unwrap();
        fs::create_dir_all(base.join(".backup")).unwrap();
        fs::write(base.join(".backup/a.env.123"), "A=1\n").unwrap();

        let mut files = Vec::new();
        walk_files(&base, "", &mut files).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["a.env"]);
    }

    #[test]
    fn background_listing_preserves_order_metadata_and_errors() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (_home, state) = temp_secret_home("background-list");
            let base = state.effective_base(&[]).unwrap();
            fs::create_dir_all(base.join("nested")).unwrap();
            fs::create_dir_all(base.join(".backup")).unwrap();
            fs::write(base.join("z.env"), "Z=1\n").unwrap();
            fs::write(base.join("nested/a.env"), "A=1\n").unwrap();
            fs::write(base.join(".backup/hidden.env"), "H=1\n").unwrap();
            let files = list_secret_files_in_background(base.clone()).await.unwrap();
            let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
            assert_eq!(paths, vec!["nested/a.env", "z.env"]);
            assert!(files
                .iter()
                .all(|file| file.size_bytes == 4 && file.modified_ms > 0));
            assert!(matches!(
                list_secret_files_in_background(base.join("missing")).await,
                Err(CommandError::Io(_))
            ));
        });
    }

    #[test]
    fn reveal_rejects_missing_file_without_spawning_finder() {
        let (_home, state) = temp_secret_home("reveal");
        let base = state.effective_base(&[]).unwrap();
        assert!(reveal_secret_in_finder_impl(&base, "missing.env").is_err());
    }

    #[test]
    fn backup_pools_are_separate_per_rel_path_not_basename() {
        // 다른 폴더의 같은 이름 파일은 백업 풀을 공유하면 안 된다
        // (2026-08-20 검수 발견 — [kyle] "파일당 5개" 승인 조건).
        let (_home, state) = temp_secret_home("pool");
        let base = state.effective_base(&[]).unwrap();
        create_secret_file_impl(&base, "oci/main.env", "A=1\n").unwrap();
        create_secret_file_impl(&base, "gcp/main.env", "B=1\n").unwrap();

        // oci/main.env를 회전 한계 너머까지 편집 진입시킨다.
        for _ in 0..(SECRET_BACKUP_KEEP + 3) {
            begin_secret_edit_impl(&base, "oci/main.env").unwrap();
        }
        // gcp/main.env는 1회만.
        begin_secret_edit_impl(&base, "gcp/main.env").unwrap();

        let backup_dir = base.join(SECRET_BACKUP_DIR);
        let names: Vec<String> = fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        let oci_count = names
            .iter()
            .filter(|n| is_backup_of(n, "oci__main.env"))
            .count();
        let gcp_count = names
            .iter()
            .filter(|n| is_backup_of(n, "gcp__main.env"))
            .count();
        assert_eq!(oci_count, SECRET_BACKUP_KEEP, "oci 풀은 상한까지만 남는다");
        assert_eq!(gcp_count, 1, "gcp 백업이 oci 회전에 밀려나면 안 된다");
    }

    #[test]
    fn rotation_ignores_prefix_named_siblings() {
        // a.env의 회전이 a.env.local의 백업을 집어삼키면 안 된다(접두 관계 이름).
        let (_home, state) = temp_secret_home("prefix");
        let base = state.effective_base(&[]).unwrap();
        create_secret_file_impl(&base, "a.env", "A=1\n").unwrap();
        create_secret_file_impl(&base, "a.env.local", "B=1\n").unwrap();

        begin_secret_edit_impl(&base, "a.env.local").unwrap();
        for _ in 0..(SECRET_BACKUP_KEEP + 2) {
            begin_secret_edit_impl(&base, "a.env").unwrap();
        }

        let backup_dir = base.join(SECRET_BACKUP_DIR);
        let names: Vec<String> = fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        let local_count = names
            .iter()
            .filter(|n| is_backup_of(n, "a.env.local"))
            .count();
        assert_eq!(local_count, 1, "접두 이름 형제의 백업은 보존돼야 한다");
    }

    #[test]
    fn is_backup_of_requires_exact_timestamp_shape() {
        assert!(is_backup_of("a.env.0000000001.000000002", "a.env"));
        assert!(!is_backup_of("a.env.local.0000000001.000000002", "a.env"));
        assert!(!is_backup_of("a.env.not-a-timestamp", "a.env"));
        assert!(!is_backup_of("a.env.0000000001.00000000", "a.env")); // 나노초 8자리
        assert!(!is_backup_of("b.env.0000000001.000000002", "a.env"));
    }

    #[test]
    fn unconfigured_state_blocks_viewer_and_gemini_file_lookup() {
        let home =
            std::env::temp_dir().join(format!("ticksidian-sec-unset-{}", std::process::id()));
        let state =
            SecretsViewerState::new(crate::commands::secrets_config::config_path_for_home(&home));
        let err = state.effective_base(&[]).unwrap_err();
        assert!(err.to_string().contains("비밀 폴더가 설정되지 않았습니다"));
    }

    #[test]
    fn restart_reads_persisted_folder_and_keeps_gemini_rel_path() {
        let (home, state) = temp_secret_home("persist");
        let base = state.effective_base(&[]).unwrap();
        let cfg_path = crate::commands::secrets_config::config_path_for_home(&home);
        // 사용자가 설정 파일에서 Gemini 키 상대경로를 바꾼 뒤 폴더를 다시 골라도 값이 유지된다.
        let text = fs::read_to_string(&cfg_path)
            .unwrap()
            .replace("\"gemini.env\"", "\"gemini/projects/key.env\"");
        fs::write(&cfg_path, text).unwrap();
        let reloaded = SecretsViewerState::new(cfg_path.clone());
        assert_eq!(reloaded.effective_base(&[]).unwrap(), base);
        assert_eq!(reloaded.gemini_key_rel_path(), "gemini/projects/key.env");
        reloaded.set_base_dir(base).unwrap();
        assert_eq!(reloaded.gemini_key_rel_path(), "gemini/projects/key.env");
    }

    #[test]
    fn gemini_key_env_wins_then_file_fallback() {
        let (_home, state) = temp_secret_home("gemini");
        let base = state.effective_base(&[]).unwrap();
        fs::write(base.join("gemini.env"), "GEMINI_API_KEY=from-file\n").unwrap();
        // env 변경은 프로세스 전역이라 이 시험 하나에서만 순서대로 다룬다.
        std::env::remove_var("GEMINI_API_KEY");
        assert_eq!(
            resolve_gemini_api_key(&state, &RegisteredVaults(std::sync::Mutex::new(Vec::new()))),
            "from-file"
        );
        std::env::set_var("GEMINI_API_KEY", "from-env");
        assert_eq!(
            resolve_gemini_api_key(&state, &RegisteredVaults(std::sync::Mutex::new(Vec::new()))),
            "from-env"
        );
        std::env::remove_var("GEMINI_API_KEY");
    }

    #[test]
    fn symlink_escape_out_of_secrets_folder_is_rejected() {
        let (home, state) = temp_secret_home("symlink");
        let base = state.effective_base(&[]).unwrap();
        let outside = home.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("leak.env"), "L=1\n").unwrap();
        std::os::unix::fs::symlink(&outside, base.join("link")).unwrap();
        assert!(resolve_within(&base, "link/leak.env").is_err());
        assert!(create_secret_file_impl(&base, "link/new.env", "x").is_err());
        assert!(!outside.join("new.env").exists());
    }
}
