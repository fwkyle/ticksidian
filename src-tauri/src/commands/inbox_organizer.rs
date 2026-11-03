//! 기본함 원문 읽기와 확인된 원본의 덮어쓰기 없는 이동. 일반 노트 쓰기와 별도 경계.
use super::vault_guard::ensure_path_in_vaults_inner;
use crate::RegisteredVaults;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::State;

use super::fs_executor::{file_executor, FsAccess};

pub const MAX_NOTE_BYTES: u64 = 32 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxSnapshot {
    pub content: String,
    pub version: String,
}

pub fn checked_root(registered: &[PathBuf], raw: &str) -> Result<PathBuf, String> {
    let root =
        ensure_path_in_vaults_inner(registered, Path::new(raw)).map_err(|e| e.to_string())?;
    if !registered.contains(&root) {
        return Err("선택한 볼트가 등록되어 있지 않습니다.".into());
    }
    Ok(root)
}

pub(super) fn checked_relative(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || relative.contains('\\')
        || relative
            .split('/')
            .any(|s| s.is_empty() || s.starts_with('.') || s.contains('\0'))
    {
        return Err("허용되지 않는 파일 또는 폴더 경로입니다.".into());
    }
    let mut path = root.to_path_buf();
    for segment in relative.split('/') {
        path.push(segment);
        if fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("바로가기(심볼릭 링크)는 AI 정리에서 제외합니다.".into());
        }
    }
    ensure_path_in_vaults_inner(&[root.to_path_buf()], &path).map_err(|e| e.to_string())
}

pub fn checked_folder(root: &Path, folder: &str) -> Result<PathBuf, String> {
    let top = folder.split('/').next().unwrap_or("").to_lowercase();
    if ["inbox", "archive", "attachments"].contains(&top.as_str()) {
        return Err("기본함·보관·첨부 폴더는 추천 대상이 아닙니다.".into());
    }
    let path = checked_relative(root, folder)?;
    if !path.is_dir() {
        return Err("이동할 폴더가 없어졌습니다. 목록을 새로 확인하세요.".into());
    }
    Ok(path)
}

fn checked_source(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let parts: Vec<_> = relative.split('/').collect();
    let lower = relative.to_lowercase();
    if parts.len() != 2
        || parts[0] != "inbox"
        || !lower.ends_with(".md")
        || lower.ends_with(".excalidraw.md")
    {
        return Err("기본함 바로 아래의 Markdown 노트만 정리할 수 있습니다.".into());
    }
    let path = checked_relative(root, relative)?;
    if !path.is_file() {
        return Err("원본 노트가 없습니다. 목록을 새로 확인하세요.".into());
    }
    Ok(path)
}

pub fn read_snapshot(root: &Path, relative: &str) -> Result<InboxSnapshot, String> {
    let path = checked_source(root, relative)?;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    if before.len() > MAX_NOTE_BYTES {
        return Err("큰 노트는 직접 정리해 주세요 (최대 32KiB).".into());
    }
    let mut bytes = Vec::new();
    (&file)
        .take(MAX_NOTE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    let modified = after.modified().map_err(|e| e.to_string())?;
    if before.modified().map_err(|e| e.to_string())? != modified
        || before.len() != after.len()
        || bytes.len() as u64 > MAX_NOTE_BYTES
    {
        return Err("읽는 동안 노트가 바뀌었습니다. 다시 읽어 주세요.".into());
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let content = String::from_utf8(bytes).map_err(|_| "UTF-8 Markdown만 정리할 수 있습니다.")?;
    if content.contains("excalidraw-plugin:") {
        return Err("플러그인 그림 노트는 정리에서 제외합니다.".into());
    }
    let nanos = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(InboxSnapshot {
        content,
        version: format!("{hash}:{nanos}"),
    })
}

pub fn verify_snapshot(
    root: &Path,
    relative: &str,
    expected: &str,
) -> Result<InboxSnapshot, String> {
    let snapshot = read_snapshot(root, relative)?;
    if snapshot.version != expected {
        return Err("추천 이후 원본이 바뀌었습니다. 다시 읽고 추천받아 주세요.".into());
    }
    Ok(snapshot)
}

// macOS SDK sys/stdio.h: RENAME_EXCL=0x4. 목적지가 생겨도 절대 덮어쓰지 않는다.
#[cfg(target_os = "macos")]
pub(super) fn rename_exclusive(source: &Path, destination: &Path) -> Result<(), String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    extern "C" {
        fn renamex_np(
            from: *const std::os::raw::c_char,
            to: *const std::os::raw::c_char,
            flags: u32,
        ) -> i32;
    }
    let src = CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let dst = CString::new(destination.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    // SAFETY: NUL-terminated buffers live for the entire call; SDK declaration matches.
    if unsafe { renamex_np(src.as_ptr(), dst.as_ptr(), 0x4) } != 0 {
        return Err(format!(
            "이동하지 못했습니다. 원본은 삭제하지 않았습니다: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn rename_exclusive(_source: &Path, _destination: &Path) -> Result<(), String> {
    Err("이 OS의 안전한 원본 이동은 아직 지원하지 않습니다.".into())
}

pub fn move_original(
    root: &Path,
    relative: &str,
    folder: &str,
    expected: &str,
) -> Result<(), String> {
    let source = checked_source(root, relative)?;
    let target =
        checked_folder(root, folder)?.join(source.file_name().ok_or("파일 이름이 없습니다.")?);
    // 존재 검사에서 모든 오류를 '없음'으로 바꾸지 않는다. 최종 경합은 RENAME_EXCL이 막는다.
    match fs::symlink_metadata(&target) {
        Ok(_) => return Err("같은 이름의 파일이 있습니다. 덮어쓰지 않았습니다.".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    verify_snapshot(root, relative, expected)?;
    rename_exclusive(&source, &target)
}

pub fn registered_root(vaults: &State<'_, RegisteredVaults>, raw: &str) -> Result<PathBuf, String> {
    let registered = vaults
        .0
        .lock()
        .map_err(|_| "볼트 목록을 읽지 못했습니다.")?;
    checked_root(&registered, raw)
}

#[tauri::command]
pub fn read_inbox_organizer_note(
    vault_path: String,
    source_path: String,
    vaults: State<'_, RegisteredVaults>,
) -> Result<InboxSnapshot, String> {
    read_snapshot(&registered_root(&vaults, &vault_path)?, &source_path)
}

/// 기본함 이동도 일반 쓰기·이동과 같은 Mutate 잠금 안에서 버전 확인→rename을 한다
/// (DEF-CONC-005 마무리). 잠금 밖이면 닫힌 노트 메타 쓰기와 겹쳐 옛 경로가 되살아난다.
pub(crate) async fn execute_move_original(
    root: PathBuf,
    source_path: String,
    folder: String,
    expected_version: String,
) -> Result<(), String> {
    file_executor()
        .run(FsAccess::Mutate, move || {
            Ok(move_original(
                &root,
                &source_path,
                &folder,
                &expected_version,
            ))
        })
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn move_inbox_organizer_note(
    vault_path: String,
    source_path: String,
    folder: String,
    expected_version: String,
    vaults: State<'_, RegisteredVaults>,
) -> Result<(), String> {
    let root = registered_root(&vaults, &vault_path)?;
    execute_move_original(root, source_path, folder, expected_version).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn vault() -> PathBuf {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.codex-artifacts/inbox-organizer")
            .join(format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        fs::create_dir_all(path.join("inbox")).unwrap();
        fs::create_dir_all(path.join("개발/앱")).unwrap();
        fs::write(
            path.join("inbox/원본.md"),
            b"---\r\nid: unchanged\r\n---\r\n# Original\r\n",
        )
        .unwrap();
        fs::canonicalize(path).unwrap() // 증거 보존, 삭제하지 않는다.
    }
    #[test]
    fn inbox_move_rejects_changed_content_and_preserves_both_paths() {
        let v = vault();
        let snap = read_snapshot(&v, "inbox/원본.md").unwrap();
        fs::write(v.join("inbox/원본.md"), "외부 수정").unwrap();
        assert!(move_original(&v, "inbox/원본.md", "개발/앱", &snap.version).is_err());
        assert_eq!(
            fs::read_to_string(v.join("inbox/원본.md")).unwrap(),
            "외부 수정"
        );
        assert!(!v.join("개발/앱/원본.md").exists());
    }
    #[test]
    fn inbox_move_rejects_collision_without_overwriting() {
        let v = vault();
        let snap = read_snapshot(&v, "inbox/원본.md").unwrap();
        fs::write(v.join("개발/앱/원본.md"), "대상 원본").unwrap();
        assert!(move_original(&v, "inbox/원본.md", "개발/앱", &snap.version).is_err());
        assert_eq!(
            read_snapshot(&v, "inbox/원본.md").unwrap().content,
            snap.content
        );
        assert_eq!(
            fs::read_to_string(v.join("개발/앱/원본.md")).unwrap(),
            "대상 원본"
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn inbox_os_rename_rejects_destination_created_after_precheck() {
        let v = vault();
        let source = v.join("inbox/원본.md");
        let destination = v.join("개발/앱/원본.md");
        assert!(!destination.exists());
        fs::write(&destination, "경합으로 먼저 생긴 파일").unwrap();
        assert!(rename_exclusive(&source, &destination).is_err());
        assert!(source.exists());
        assert_eq!(
            fs::read_to_string(destination).unwrap(),
            "경합으로 먼저 생긴 파일"
        );
    }

    /// DEF-CONC-005 마무리(검수 DFUA-R001): 쓰기가 Mutate를 쥔 동안 기본함 이동은 끝나지 않고,
    /// 쓰기 뒤에는 버전(해시+mtime) 확인이 이동을 거부해 옛 경로가 되살아나지 않는다.
    #[test]
    fn inbox_move_is_serialized_with_writes_by_mutate_lock() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let v = vault();
            let snap = read_snapshot(&v, "inbox/원본.md").unwrap();
            let source = v.join("inbox/원본.md");
            let executor = file_executor();
            let (started_tx, started_rx) = tokio::sync::oneshot::channel::<()>();
            let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
            let writer_path = source.clone();
            let writer = tokio::spawn(async move {
                executor
                    .run(FsAccess::Mutate, move || {
                        started_tx.send(()).unwrap();
                        release_rx
                            .recv_timeout(std::time::Duration::from_secs(2))
                            .unwrap();
                        fs::write(&writer_path, "새 메타 쓰기")?;
                        Ok(())
                    })
                    .await
            });
            started_rx.await.unwrap();
            let mover = tokio::spawn(execute_move_original(
                v.clone(),
                "inbox/원본.md".into(),
                "개발/앱".into(),
                snap.version.clone(),
            ));
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            assert!(
                source.exists() && !v.join("개발/앱/원본.md").exists(),
                "기본함 이동이 쓰기 잠금을 우회해 원본을 옮겼습니다(직렬화 실패)"
            );
            assert!(
                !mover.is_finished(),
                "기본함 이동이 쓰기 완료 전에 끝났습니다"
            );
            release_tx.send(()).unwrap();
            writer.await.unwrap().unwrap();
            assert!(
                mover.await.unwrap().is_err(),
                "쓰기 뒤의 이동이 버전 확인 없이 성공했습니다"
            );
            assert_eq!(fs::read_to_string(&source).unwrap(), "새 메타 쓰기");
            assert!(!v.join("개발/앱/원본.md").exists());
        });
    }

    #[test]
    fn inbox_read_rejects_large_and_plugin_documents() {
        let v = vault();
        fs::write(
            v.join("inbox/큰파일.md"),
            vec![b'x'; MAX_NOTE_BYTES as usize + 1],
        )
        .unwrap();
        assert!(read_snapshot(&v, "inbox/큰파일.md").is_err());
        fs::write(
            v.join("inbox/플러그인.md"),
            "---\nexcalidraw-plugin: parsed\n---",
        )
        .unwrap();
        assert!(read_snapshot(&v, "inbox/플러그인.md").is_err());
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn inbox_move_preserves_exact_bytes_mtime_and_rejects_repeat() {
        let v = vault();
        let snap = read_snapshot(&v, "inbox/원본.md").unwrap();
        let before = fs::metadata(v.join("inbox/원본.md"))
            .unwrap()
            .modified()
            .unwrap();
        move_original(&v, "inbox/원본.md", "개발/앱", &snap.version).unwrap();
        assert!(!v.join("inbox/원본.md").exists());
        assert_eq!(
            fs::read_to_string(v.join("개발/앱/원본.md")).unwrap(),
            snap.content
        );
        assert_eq!(
            fs::metadata(v.join("개발/앱/원본.md"))
                .unwrap()
                .modified()
                .unwrap(),
            before
        );
        assert!(move_original(&v, "inbox/원본.md", "개발/앱", &snap.version).is_err());
    }
    #[test]
    fn inbox_boundaries_reject_non_inbox_drawings_and_missing_folders() {
        let v = vault();
        for path in [
            "../escape.md",
            "inbox/../원본.md",
            "inbox/a.excalidraw",
            "inbox/a.excalidraw.md",
            "개발/원본.md",
        ] {
            assert!(read_snapshot(&v, path).is_err());
        }
        for folder in [
            "inbox",
            "archive",
            "attachments",
            "../escape",
            "/tmp",
            ".secret",
            "없는폴더",
        ] {
            assert!(checked_folder(&v, folder).is_err());
        }
        assert!(checked_root(&[], v.to_str().unwrap()).is_err());
        assert!(checked_root(&[v.clone()], v.join("inbox").to_str().unwrap()).is_err());
    }
    #[test]
    #[cfg(unix)]
    fn inbox_rejects_symlink_destination_and_source() {
        let v = vault();
        std::os::unix::fs::symlink(v.join("개발"), v.join("alias")).unwrap();
        assert!(checked_folder(&v, "alias/앱").is_err());
        std::os::unix::fs::symlink(v.join("inbox/원본.md"), v.join("inbox/link.md")).unwrap();
        assert!(read_snapshot(&v, "inbox/link.md").is_err());
    }
    #[test]
    fn inbox_rejects_same_bytes_with_changed_mtime() {
        let v = vault();
        let snap = read_snapshot(&v, "inbox/원본.md").unwrap();
        let file = fs::File::options()
            .write(true)
            .open(v.join("inbox/원본.md"))
            .unwrap();
        file.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(100))
            .unwrap();
        assert!(verify_snapshot(&v, "inbox/원본.md", &snap.version).is_err());
    }
}
