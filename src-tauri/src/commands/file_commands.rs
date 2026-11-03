use std::fs;
use std::io;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use tauri::{AppHandle, Manager};

use crate::RegisteredVaults;

use super::error::{CommandError, CommandResult};
use super::fs_executor::{file_executor, FsAccess};
use super::types::{DirectoryEntry, FileStat};
use super::vault_guard::{
    ensure_fs_plugin, ensure_path_in_registered_vault, find_registered_vault_root, move_into_trash,
    validate_absolute_path, validate_markdown_path,
};

/// 바이너리 파일(이미지 등) 읽기 상한. 20MiB.
/// 로드맵 §4 위험(blob 메모리) 관리용 상한으로, 초과하면 읽지 않고 명시적으로 거부한다.
pub(crate) const MAX_BINARY_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// 크기 상한 판정(순수). 단위 테스트로 경계를 잠근다.
pub(crate) fn ensure_binary_within_limit(len: u64) -> Result<(), CommandError> {
    if len > MAX_BINARY_FILE_BYTES {
        return Err(CommandError::FileTooLarge {
            size: len,
            limit: MAX_BINARY_FILE_BYTES,
        });
    }
    Ok(())
}

/// 원자적 파일 쓰기.
///
/// 노트 본문을 `fs::write`로 원본에 직접 덮어쓰면, 저장 도중 앱 크래시·전원 차단·
/// 디스크 가득참이 발생할 때 원본이 잘린 채 남아 사용자 원고가 손상될 수 있다.
/// 그래서 같은 디렉터리의 임시 파일에 먼저 기록한 뒤 `fs::rename`으로 교체한다.
/// rename은 같은 파일시스템에서 원자적이라, 중단되면 원본은 그대로 보존된다.
///
/// 임시 이름은 호출마다 다르며 create_new로 잔여 파일도 덮어쓰지 않는다.
/// command 쓰기 순서는 공통 FS 실행기가 보호한다. debounce만으로는 직렬화되지 않는다.
///
/// 주의: Unix(macOS 포함)에서 rename은 기존 대상을 원자적으로 대체한다. Windows
/// 지원을 켤 때는 대상 존재 시 동작이 다르므로 별도 처리가 필요하다.
///
/// 반환값은 "내가 쓴 내용의 mtime"(epoch ms)이다. 게시 전 임시 파일 핸들에서 읽으므로
/// 게시 뒤 같은 경로에 생기는 외부 쓰기의 mtime이 섞일 수 없다(DEF-CONC-002).
/// rename은 inode를 옮길 뿐이라 게시된 파일의 mtime도 이 값과 같다.
fn write_file_atomic(path: &Path, content: impl AsRef<[u8]>) -> io::Result<u64> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "path has no parent directory")
    })?;
    fs::create_dir_all(parent)?;

    path.file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let tmp_path = parent.join(format!(
        ".ticksidian-tmp-write-{}-{}",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)?;
    let written = file.write_all(content.as_ref());
    let mtime = written.and_then(|()| {
        file.metadata()?
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .map_err(|error| io::Error::other(format!("invalid file mtime: {error}")))
    });
    drop(file);
    let result = mtime.and_then(|mtime| fs::rename(&tmp_path, path).map(|()| mtime));
    if result.is_err() {
        // 이 호출이 만든 미게시 임시 이름만 해제한다. 기존 잔여물은 건드리지 않는다.
        let _ = fs::remove_file(&tmp_path);
    }
    result
}

/// FS 대기줄/경로 검증이 끝난 뒤 실제 쓰기 직전에 관측 mtime을 재확인한다.
/// 다른 프로세스와 원자적 CAS는 아니다. 확인 이후 외부 쓰기의 짧은 틈은 남는다.
fn write_file_atomic_checked(
    path: &Path,
    content: &[u8],
    expected_mtime: Option<u64>,
) -> CommandResult<u64> {
    if let Some(expected) = expected_mtime {
        let conflict = || CommandError::FileModifiedExternally {
            path: path.to_string_lossy().into_owned(),
        };
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(conflict()),
            Err(error) => return Err(error.into()),
        };
        let observed = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map_err(|error| io::Error::other(format!("invalid file mtime: {error}")))?
            .as_millis() as u64;
        if observed != expected {
            return Err(conflict());
        }
    }
    Ok(write_file_atomic(path, content)?)
}

/// 완성된 임시 파일을 빈 이름에만 원자적으로 게시한다.
/// hard_link는 기존 파일/링크/디렉터리를 교체하지 않는다. 미지원 FS는 오류로 중단한다.
fn create_file_atomic(path: &Path, content: &[u8]) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("path has no parent"))?;
    fs::create_dir_all(parent)?;
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let temp = parent.join(format!(
        ".ticksidian-tmp-create-{}-{}",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    // create_new가 실패하면 과거 임시 파일도 건드리지 않는다.
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let result = (|| {
        file.write_all(content)?;
        file.sync_all()?;
        match fs::hard_link(&temp, path) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
            Err(error) => Err(error),
        }
    })();
    drop(file);
    // 이 호출이 만든 미게시 임시 이름만 해제한다. 대상 파일/QA 증거는 삭제하지 않는다.
    let _ = fs::remove_file(&temp);
    result
}

// ---------------------------------------------------------------------------
// Markdown 파일 명령어
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn read_markdown_file(app: AppHandle, path: String) -> CommandResult<String> {
    file_executor()
        .run(FsAccess::Read, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let path = validate_markdown_path(&path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;
            Ok(fs::read_to_string(path)?)
        })
        .await
}

#[tauri::command]
pub async fn write_markdown_file(
    app: AppHandle,
    path: String,
    content: String,
) -> CommandResult<()> {
    file_executor()
        .run(FsAccess::Mutate, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let path = validate_markdown_path(&path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;

            write_file_atomic(&path, &content)?;
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn create_markdown_file_if_absent(
    app: AppHandle,
    path: String,
    content: String,
) -> CommandResult<bool> {
    file_executor()
        .run(FsAccess::Mutate, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let path = validate_markdown_path(&path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;
            Ok(create_file_atomic(&path, content.as_bytes())?)
        })
        .await
}

// ---------------------------------------------------------------------------
// 범용 파일 읽기/쓰기 명령어
// ---------------------------------------------------------------------------

/// 볼트 안 바이너리 파일(이미지 등) 읽기 — 2026-08-19 이미지 임베드 보기(TICK-IMG-001).
///
/// IPC 형식: `tauri::ipc::Response`(InvokeResponseBody::Raw)로 webview에 원시 바이트를
/// 전달한다. `Vec<u8>`을 그대로 반환하면 JSON 배열 직렬화(20MB → 수십 MB 문자열)가
/// 되므로 raw 경로를 쓴다. 설계: docs/waterfall/03-상세설계/이미지-임베드-보기.md §1-3.
#[tauri::command]
pub async fn read_binary_file(app: AppHandle, path: String) -> CommandResult<tauri::ipc::Response> {
    file_executor()
        .run(FsAccess::Read, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let path = validate_absolute_path(&path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;

            if !path.exists() {
                return Err(CommandError::InvalidPath(format!(
                    "file does not exist: '{}'",
                    path.display()
                )));
            }
            if !path.is_file() {
                return Err(CommandError::InvalidPath(format!(
                    "path is not a file: '{}'",
                    path.display()
                )));
            }

            let metadata = fs::metadata(&path)?;
            ensure_binary_within_limit(metadata.len())?;

            let bytes = fs::read(&path)?;
            Ok(tauri::ipc::Response::new(bytes))
        })
        .await
}

/// x-ticksidian-path 헤더 디코딩(순수).
///
/// HTTP 헤더 값은 ASCII 밖 문자를 실을 수 없다 — 실측(2026-08-20 검수): JS `Headers`는
/// 한글에서 ByteString 예외를 던지고, Rust `HeaderValue::to_str()`도 non-ASCII에서
/// 실패한다. 그래서 JS wrapper가 `encodeURIComponent`로 보내고 여기서 percent-decode
/// 한다. 인코딩 안 된 ASCII 경로는 그대로 통과한다(% 없음 → 무변환).
pub(crate) fn decode_header_path(raw: &str) -> Result<String, CommandError> {
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .map_err(|_| CommandError::InvalidPath(format!("invalid encoded path header: '{raw}'")))
}

/// 볼트 안 바이너리 파일(이미지 등) 원자적 쓰기 — 2026-08-19 이미지 넣기(TICK-IMG-002).
///
/// IPC 형식(설계 이미지-임베드-보기.md 1-3): JS가 invoke(cmd, Uint8Array, headers)로
/// raw body를 보내면 tauri::ipc::Request로 받는다. 경로는 raw body에 실을 수 없어
/// 커스텀 헤더 x-ticksidian-path로 전달한다(encodeURIComponent — 한글 경로 대응,
/// 2026-08-20 검수 수정).
#[tauri::command]
pub async fn write_binary_file(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> CommandResult<()> {
    ensure_fs_plugin(&app)?;
    let raw_path = request
        .headers()
        .get("x-ticksidian-path")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| CommandError::InvalidPath("missing x-ticksidian-path header".to_owned()))?;
    let decoded_path = decode_header_path(raw_path)?;

    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err(CommandError::InvalidPath(
                "write_binary_file expects a raw bytes body".to_owned(),
            ));
        }
    };
    ensure_binary_within_limit(bytes.len() as u64)?;
    let bytes = bytes.to_vec();
    file_executor()
        .run(FsAccess::Mutate, move || {
            let vaults = app.state::<RegisteredVaults>();
            let path = validate_absolute_path(&decoded_path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;
            write_file_atomic(&path, bytes)?;
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn read_text_file(app: AppHandle, path: String) -> CommandResult<String> {
    file_executor()
        .run(FsAccess::Read, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let path = validate_absolute_path(&path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;
            Ok(fs::read_to_string(path)?)
        })
        .await
}

#[tauri::command]
pub async fn write_text_file(
    app: AppHandle,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> CommandResult<u64> {
    file_executor()
        .run(FsAccess::Mutate, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let path = validate_absolute_path(&path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;

            write_file_atomic_checked(&path, content.as_bytes(), expected_mtime)
        })
        .await
}

#[tauri::command]
pub async fn list_directory(app: AppHandle, dir_path: String) -> CommandResult<Vec<String>> {
    file_executor()
        .run(FsAccess::Read, move || {
            let vaults = app.state::<RegisteredVaults>();
            use super::vault_guard::validate_directory_path;

            ensure_fs_plugin(&app)?;
            let dir = validate_directory_path(&dir_path)?;
            let dir = ensure_path_in_registered_vault(&vaults, &dir)?;

            let mut entries = Vec::new();
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                entries.push(entry.path().to_string_lossy().into_owned());
            }
            entries.sort();
            Ok(entries)
        })
        .await
}

/// 파일 생성 시각(birthtime)을 epoch ms로. 미지원 파일시스템은 `created()`가 Err → None.
/// `get_file_stat`의 created_at과 같은 단위(as_millis)다.
pub(crate) fn directory_entry_created_at(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

#[tauri::command]
pub async fn list_directory_entries(
    app: AppHandle,
    dir_path: String,
) -> CommandResult<Vec<DirectoryEntry>> {
    file_executor()
        .run(FsAccess::Read, move || {
            let vaults = app.state::<RegisteredVaults>();
            use super::vault_guard::validate_directory_path;

            ensure_fs_plugin(&app)?;
            let dir = validate_directory_path(&dir_path)?;
            let dir = ensure_path_in_registered_vault(&vaults, &dir)?;

            let mut entries = Vec::new();
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let file_type = entry.file_type()?;
                // read_dir 패스에서 metadata()를 한 번 더 호출해 mtime을 얻는다.
                // 디렉터리 항목이나 metadata 조회 실패 시 None으로 남겨 기존 getFileStat fallback을
                // 유지한다. get_file_stat의 modified_at 단위(epoch milliseconds)와 동일.
                // metadata()는 파일 항목에 한 번만 부르고 mtime/birthtime을 같이 읽는다
                // (TICK-UX-006: 생성일 정렬용 created_at — 추가 syscall 0회).
                let file_metadata = if file_type.is_file() {
                    entry.metadata().ok()
                } else {
                    None
                };
                let modified_at = file_metadata
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                let created_at = file_metadata.as_ref().and_then(directory_entry_created_at);
                entries.push(DirectoryEntry {
                    path: entry.path().to_string_lossy().into_owned(),
                    name: entry.file_name().to_string_lossy().into_owned(),
                    is_dir: file_type.is_dir(),
                    is_file: file_type.is_file(),
                    modified_at,
                    created_at,
                });
            }

            entries.sort_by(|a, b| a.path.cmp(&b.path));
            Ok(entries)
        })
        .await
}

// ---------------------------------------------------------------------------
// 파일 삭제 명령어 (staging 이동 — 실제 삭제 아님)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn delete_file(app: AppHandle, path: String) -> CommandResult<()> {
    file_executor()
        .run(FsAccess::Mutate, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let path = validate_absolute_path(&path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;

            if !path.exists() {
                return Err(CommandError::InvalidPath(format!(
                    "file does not exist: '{}'",
                    path.display()
                )));
            }

            if !path.is_file() {
                return Err(CommandError::InvalidPath(format!(
                    "path is not a file: '{}'",
                    path.display()
                )));
            }

            let vault_root = find_registered_vault_root(&vaults, &path)?;
            move_into_trash(&vaults.snapshot()?, &vault_root, &path)
        })
        .await
}

/// 폴더 이름 변경 (2026-08-19 폴더 컨텍스트 메뉴).
/// source/target 모두 vault_guard를 통과하고, 대상이 이미 있으면 거부한다.
#[tauri::command]
pub async fn rename_directory(app: AppHandle, path: String, new_name: String) -> CommandResult<()> {
    file_executor()
        .run(FsAccess::Mutate, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let trimmed_name = new_name.trim();
            if trimmed_name.is_empty()
                || trimmed_name == "."
                || trimmed_name == ".."
                || trimmed_name.contains('/')
                || trimmed_name.contains('\\')
                || trimmed_name.contains('\0')
            {
                return Err(CommandError::InvalidPath(format!(
                    "invalid directory name: '{new_name}'"
                )));
            }

            let source = validate_absolute_path(&path)?;
            let source = ensure_path_in_registered_vault(&vaults, &source)?;
            if !source.is_dir() {
                return Err(CommandError::InvalidPath(format!(
                    "path is not a directory: '{}'",
                    source.display()
                )));
            }
            let vault_root = find_registered_vault_root(&vaults, &source)?;
            if source == vault_root {
                return Err(CommandError::InvalidPath(
                    "vault root directory cannot be renamed".to_owned(),
                ));
            }

            let parent = source.parent().ok_or_else(|| {
                CommandError::InvalidPath(format!(
                    "directory has no parent: '{}'",
                    source.display()
                ))
            })?;
            let target = parent.join(trimmed_name);
            let target = ensure_path_in_registered_vault(&vaults, &target)?;
            if target.exists() {
                return Err(CommandError::InvalidPath(format!(
                    "destination directory already exists: '{}'",
                    target.display()
                )));
            }

            fs::rename(source, target)?;
            Ok(())
        })
        .await
}

/// 폴더 삭제 대신 .trash/ticksidian/ 아래로 이동한다.
#[tauri::command]
pub async fn trash_directory(app: AppHandle, path: String) -> CommandResult<()> {
    file_executor()
        .run(FsAccess::Mutate, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let source = validate_absolute_path(&path)?;
            let source = ensure_path_in_registered_vault(&vaults, &source)?;
            if !source.is_dir() {
                return Err(CommandError::InvalidPath(format!(
                    "path is not a directory: '{}'",
                    source.display()
                )));
            }

            let vault_root = find_registered_vault_root(&vaults, &source)?;
            if source == vault_root {
                return Err(CommandError::InvalidPath(
                    "vault root directory cannot be trashed".to_owned(),
                ));
            }
            if source.starts_with(vault_root.join(".trash")) {
                return Err(CommandError::InvalidPath(format!(
                    "directory is already inside trash: '{}'",
                    source.display()
                )));
            }

            move_into_trash(&vaults.snapshot()?, &vault_root, &source)
        })
        .await
}

// ---------------------------------------------------------------------------
// 파일 메타데이터 조회 명령어
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_file_stat(app: AppHandle, path: String) -> CommandResult<FileStat> {
    file_executor()
        .run(FsAccess::Read, move || {
            let vaults = app.state::<RegisteredVaults>();
            ensure_fs_plugin(&app)?;
            let path = validate_absolute_path(&path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;

            if !path.exists() {
                return Err(CommandError::InvalidPath(format!(
                    "file does not exist: '{}'",
                    path.display()
                )));
            }

            let metadata = fs::metadata(&path)?;

            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);

            let created_at = metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);

            Ok(FileStat {
                path: path.to_string_lossy().into_owned(),
                size: metadata.len(),
                modified_at,
                created_at,
            })
        })
        .await
}

// ---------------------------------------------------------------------------
// 마이그레이션용 명령어 (보류/후속 제거 대상)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_file_exists(app: AppHandle, file_path: String) -> CommandResult<bool> {
    file_executor()
        .run(FsAccess::Read, move || {
            let vaults = app.state::<RegisteredVaults>();
            // guard 순서: fs plugin → vault 경계 → IO
            ensure_fs_plugin(&app)?;
            let path = validate_absolute_path(&file_path)?;
            // vault 경계 검증: 등록된 vault 밖 경로는 존재 확인도 허용하지 않는다.
            let path = ensure_path_in_registered_vault(&vaults, &path)?;
            Ok(path.exists() && path.is_file())
        })
        .await
}

#[tauri::command]
pub async fn create_directory(
    app: AppHandle,
    dir_path: String,
    recursive: bool,
) -> CommandResult<()> {
    file_executor()
        .run(FsAccess::Mutate, move || {
            let vaults = app.state::<RegisteredVaults>();
            // guard 순서: fs plugin → vault 경계 → IO
            ensure_fs_plugin(&app)?;
            let path = validate_absolute_path(&dir_path)?;
            let path = ensure_path_in_registered_vault(&vaults, &path)?;

            if recursive {
                fs::create_dir_all(&path)?;
            } else {
                fs::create_dir(&path)?;
            }

            Ok(())
        })
        .await
}

#[cfg(test)]
#[path = "file_commands_perf_tests.rs"]
mod perf_tests;

#[cfg(test)]
mod tests {
    use super::create_file_atomic;
    use super::{
        decode_header_path, ensure_binary_within_limit, write_file_atomic, MAX_BINARY_FILE_BYTES,
    };
    use std::{io, time::UNIX_EPOCH};

    fn preserved_create_test_dir(label: &str) -> std::path::PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(".codex-artifacts")
            .join(format!("create-{label}-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn exclusive_create_preserves_existing_and_complete_new_file() {
        let root = preserved_create_test_dir("existing");
        let path = root.join("note.md");
        assert!(create_file_atomic(&path, b"original").unwrap());
        assert!(!create_file_atomic(&path, b"replacement").unwrap());
        assert_eq!(fs::read(path).unwrap(), b"original");
        let directory = root.join("directory.md");
        fs::create_dir(&directory).unwrap();
        assert!(!create_file_atomic(&directory, b"replacement").unwrap());
        assert!(directory.is_dir());
    }

    #[test]
    fn exclusive_create_concurrent_writers_have_one_winner() {
        let root = preserved_create_test_dir("concurrent");
        let path = root.join("note.md");
        let gate = std::sync::Arc::new(std::sync::Barrier::new(8));
        let threads: Vec<_> = (0..8)
            .map(|index| {
                let target = path.clone();
                let gate = gate.clone();
                std::thread::spawn(move || {
                    let content = format!("writer-{index}").repeat(4096);
                    gate.wait();
                    (
                        create_file_atomic(&target, content.as_bytes()).unwrap(),
                        content,
                    )
                })
            })
            .collect();
        let winners: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(|(created, _)| *created)
            .collect();
        assert_eq!(winners.len(), 1);
        assert_eq!(fs::read_to_string(path).unwrap(), winners[0].1);
    }

    #[cfg(unix)]
    #[test]
    fn exclusive_create_preserves_unreadable_and_dangling_link() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = preserved_create_test_dir("unreadable");
        let path = root.join("unreadable.md");
        fs::write(&path, b"original").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        let result = create_file_atomic(&path, b"replacement");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!result.unwrap());
        assert_eq!(fs::read(path).unwrap(), b"original");
        let missing = root.join("missing.md");
        let link = root.join("link.md");
        symlink(&missing, &link).unwrap();
        assert!(!create_file_atomic(&link, b"replacement").unwrap());
        assert_eq!(fs::read_link(link).unwrap(), missing);
        assert!(!missing.exists());
    }

    #[cfg(unix)]
    #[test]
    fn exclusive_create_permission_failure_does_not_create_target() {
        use std::os::unix::fs::PermissionsExt;
        let root = preserved_create_test_dir("permission");
        let path = root.join("blocked.md");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o500)).unwrap();
        let result = create_file_atomic(&path, b"must not appear");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
        assert!(!path.exists());
    }

    #[test]
    fn header_path_decodes_encoded_korean_path() {
        // encodeURIComponent("/vault/attachments/회의록/회의록 1.png") 결과.
        let encoded = "%2Fvault%2Fattachments%2F%ED%9A%8C%EC%9D%98%EB%A1%9D%2F%ED%9A%8C%EC%9D%98%EB%A1%9D%201.png";
        let decoded = decode_header_path(encoded).expect("must decode");
        assert_eq!(decoded, "/vault/attachments/회의록/회의록 1.png");
    }

    #[test]
    fn header_path_passes_plain_ascii_unchanged() {
        let decoded = decode_header_path("/vault/a.png").expect("must pass");
        assert_eq!(decoded, "/vault/a.png");
    }

    #[test]
    fn header_path_rejects_invalid_utf8_sequence() {
        assert!(decode_header_path("%FF%FE").is_err());
    }
    use std::fs;
    use std::path::PathBuf;

    /// 테스트 전용 격리 디렉터리. 같은 이름 충돌을 피하려고 pid + 라벨로 고정한다.
    fn temp_subdir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ticksidian-atomic-write-test-{}-{}",
            std::process::id(),
            label
        ));
        // 이전 실행 잔여물이 있으면 비우고 새로 만든다 (테스트 자기 소유 sandbox).
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn leftover_tmp_count(dir: &PathBuf) -> usize {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".ticksidian-tmp-"))
            .count()
    }

    #[test]
    fn atomic_write_creates_file_with_content() {
        let dir = temp_subdir("create");
        let target = dir.join("note.md");

        write_file_atomic(&target, "hello world").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "hello world");
        assert_eq!(leftover_tmp_count(&dir), 0, "임시 파일이 남으면 안 된다");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_overwrites_existing_content() {
        let dir = temp_subdir("overwrite");
        let target = dir.join("note.md");

        write_file_atomic(&target, "first").unwrap();
        write_file_atomic(&target, "second").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
        assert_eq!(leftover_tmp_count(&dir), 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_creates_missing_parent() {
        let dir = temp_subdir("missing-parent");
        let target = dir.join("nested").join("deep").join("note.md");

        write_file_atomic(&target, "content").unwrap();

        assert!(target.exists());
        assert_eq!(fs::read_to_string(&target).unwrap(), "content");

        let _ = fs::remove_dir_all(&dir);
    }

    /// `list_directory_entries`의 mtime 수집 로직 단위 검증.
    ///
    /// command 자체는 AppHandle/State 의존이 있어 unit 테스트 불가지만,
    /// 실제 파일을 만든 뒤 `entry.metadata().modified()` 경로가 Some을 반환하고
    /// 합리적인 epoch ms 값(2020년 이후)인지를 검증한다.
    /// command 루프와 동일한 코드 경로다.
    #[test]
    fn directory_entry_modified_at_is_some_and_reasonable() {
        let dir = temp_subdir("dir-entry-mtime");
        let file = dir.join("note.md");
        fs::write(&file, "content").unwrap();

        // command 루프와 동일한 코드 경로: read_dir → entry.metadata() → modified()
        let modified_at: Option<u64> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.file_name().to_string_lossy().ends_with(".md"))
            .and_then(|e| {
                let ft = e.file_type().ok()?;
                if !ft.is_file() {
                    return None;
                }
                e.metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
            });

        // 2020-01-01 epoch ms = 1_577_836_800_000
        let epoch_2020_ms: u64 = 1_577_836_800_000;
        assert!(
            modified_at.is_some(),
            "파일 항목의 modified_at은 Some이어야 한다"
        );
        assert!(
            modified_at.unwrap() > epoch_2020_ms,
            "mtime이 2020년 이후여야 한다: {:?}",
            modified_at
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// `list_directory_entries`의 created_at(birthtime) 수집 경로 검증(TICK-UX-006, 2026-08-23).
    /// mtime 테스트와 같은 방식으로 command 루프와 동일한 코드 경로를 탄다.
    /// birthtime은 macOS/Windows에서 제공되고 일부 Linux 파일시스템은 Err를 준다 →
    /// None이 허용 값이다. 제공되는 플랫폼에서는 Some + 2020년 이후여야 한다.
    #[test]
    fn directory_entry_created_at_follows_metadata_created() {
        let dir = temp_subdir("dir-entry-birthtime");
        let file = dir.join("note.md");
        fs::write(&file, "content").unwrap();

        let created_at: Option<u64> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.file_name().to_string_lossy().ends_with(".md"))
            .and_then(|e| {
                let ft = e.file_type().ok()?;
                if !ft.is_file() {
                    return None;
                }
                super::directory_entry_created_at(&e.metadata().ok()?)
            });

        let epoch_2020_ms: u64 = 1_577_836_800_000;
        if cfg!(any(target_os = "macos", target_os = "windows")) {
            assert!(
                created_at.is_some(),
                "macOS/Windows에서는 created_at이 Some이어야 한다"
            );
            assert!(
                created_at.unwrap() > epoch_2020_ms,
                "birthtime이 2020년 이후여야 한다: {:?}",
                created_at
            );
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn directory_entry_modified_at_is_none_for_dir() {
        let parent = temp_subdir("dir-entry-mtime-dir");
        let child_dir = parent.join("subdir");
        fs::create_dir_all(&child_dir).unwrap();

        // 디렉터리 항목은 modified_at = None (command 루프와 동일)
        let modified_at: Option<u64> = fs::read_dir(&parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.file_name().to_string_lossy() == "subdir")
            .and_then(|e| {
                let ft = e.file_type().ok()?;
                if ft.is_file() {
                    return None;
                }
                // 디렉터리는 None
                None
            });

        assert!(
            modified_at.is_none(),
            "디렉터리 항목의 modified_at은 None이어야 한다"
        );

        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn atomic_write_failure_cleans_up_tmp() {
        // 대상 경로 위치에 같은 이름의 디렉터리를 두면 파일→디렉터리 rename이 실패한다.
        // 이때 rename 실패 cleanup 경로(tmp 제거 + Err 전파)가 도는지 회귀 보호한다.
        let dir = temp_subdir("rename-fail");
        let target = dir.join("note.md");
        fs::create_dir_all(&target).unwrap();

        let result = write_file_atomic(&target, "content");

        assert!(result.is_err(), "디렉터리 위로 rename은 실패해야 한다");
        assert_eq!(
            leftover_tmp_count(&dir),
            0,
            "rename 실패 후에도 tmp 파일이 남으면 안 된다"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn binary_limit_accepts_exact_boundary() {
        assert!(ensure_binary_within_limit(MAX_BINARY_FILE_BYTES).is_ok());
    }

    #[test]
    fn binary_limit_rejects_one_byte_over() {
        let result = ensure_binary_within_limit(MAX_BINARY_FILE_BYTES + 1);
        assert!(
            matches!(
                result,
                Err(super::super::error::CommandError::FileTooLarge { size, limit })
                    if size == MAX_BINARY_FILE_BYTES + 1 && limit == MAX_BINARY_FILE_BYTES
            ),
            "1 byte over the limit must be FileTooLarge, got {result:?}"
        );
    }

    #[test]
    fn binary_limit_rejects_zero_is_ok() {
        assert!(ensure_binary_within_limit(0).is_ok());
    }
}
