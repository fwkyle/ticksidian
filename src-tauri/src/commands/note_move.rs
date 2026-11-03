//! 일반 기록의 폴더 이동. 내용 재직렬화/복사/삭제 없이 원본 이름만 이동한다.
use crate::RegisteredVaults;
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::State;

use super::fs_executor::{file_executor, FsAccess};

fn modified_ms(path: &Path) -> Result<u64, String> {
    Ok(fs::metadata(path)
        .map_err(|e| e.to_string())?
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64)
}

fn checked_absolute(root: &Path, raw: &str) -> Result<std::path::PathBuf, String> {
    let prefix = format!("{}/", root.display());
    let relative = raw
        .strip_prefix(&prefix)
        .ok_or("선택한 볼트 밖의 경로입니다.")?;
    super::inbox_organizer::checked_relative(root, relative)
}

/// 이동·이름 변경 대상이 등록 볼트 안의 일반 Markdown 파일인지 확인한다.
fn checked_markdown_source(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let source = checked_absolute(root, raw)?;
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("파일 이름을 확인할 수 없습니다.")?;
    let lower = name.to_lowercase();
    if !source.is_file() || !lower.ends_with(".md") || lower.ends_with(".excalidraw.md") {
        return Err("일반 Markdown 기록만 이 방법으로 이동할 수 있습니다.".into());
    }
    Ok(source)
}

/// 확인이 끝난 원본을 목적지로 덮어쓰기 금지 이동한다.
/// 목적지가 이미 있거나 원본 mtime이 기대와 다르면 원본을 건드리지 않고 거부한다.
fn move_within_vault(source: PathBuf, target: PathBuf, expected: u64) -> Result<(), String> {
    if source == target {
        return Ok(());
    }
    match fs::symlink_metadata(&target) {
        Ok(_) => return Err("같은 이름의 파일이 있습니다. 덮어쓰지 않았습니다.".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    if modified_ms(&source)? != expected {
        return Err("원본이 바뀌었습니다. 다시 확인한 뒤 이동해 주세요.".into());
    }
    super::inbox_organizer::rename_exclusive(&source, &target)
}

fn move_checked(root: &Path, source: &str, folder: &str, expected: u64) -> Result<(), String> {
    let source = checked_markdown_source(root, source)?;
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("파일 이름을 확인할 수 없습니다.")?
        .to_owned();
    let folder = if Path::new(folder) == root && folder == root.to_string_lossy() {
        root.to_path_buf()
    } else {
        checked_absolute(root, folder)?
    };
    if !folder.is_dir() {
        return Err("이동할 폴더가 없습니다.".into());
    }
    move_within_vault(source, folder.join(name), expected)
}

/// 같은 폴더 안 파일명 변경의 새 이름(단일 .md segment)을 검증한다.
fn checked_new_markdown_name(new_name: &str) -> Result<(), String> {
    let lower = new_name.to_lowercase();
    if new_name.is_empty()
        || new_name == "."
        || new_name == ".."
        || new_name.starts_with('.')
        || new_name.contains('/')
        || new_name.contains('\\')
        || new_name.contains('\0')
        || !lower.ends_with(".md")
        || lower.ends_with(".excalidraw.md")
    {
        return Err("허용되지 않는 파일 이름입니다.".into());
    }
    Ok(())
}

/// 같은 폴더 안 파일명 변경(DEF-CONC-003). 읽기→쓰기→삭제 없이 한 번의 이동으로 끝낸다.
fn rename_checked(root: &Path, source: &str, new_name: &str, expected: u64) -> Result<(), String> {
    let source = checked_markdown_source(root, source)?;
    checked_new_markdown_name(new_name)?;
    let target = source
        .parent()
        .ok_or("파일 위치를 확인할 수 없습니다.")?
        .join(new_name);
    move_within_vault(source, target, expected)
}

pub(crate) async fn execute_move_checked(
    root: PathBuf,
    path: String,
    to_folder: String,
    expected_mtime: u64,
) -> Result<(), String> {
    // 이동도 쓰기와 같은 Mutate 잠금을 지난다(DEF-CONC-005). 확인→rename이
    // write_text_file 같은 변경 명령과 교차하지 않는다.
    file_executor()
        .run(FsAccess::Mutate, move || {
            Ok(move_checked(&root, &path, &to_folder, expected_mtime))
        })
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn move_markdown_file(
    vaults: State<'_, RegisteredVaults>,
    vault_path: String,
    path: String,
    to_folder: String,
    expected_mtime: u64,
) -> Result<(), String> {
    let root = super::inbox_organizer::registered_root(&vaults, &vault_path)?;
    execute_move_checked(root, path, to_folder, expected_mtime).await
}

pub(crate) async fn execute_rename_checked(
    root: PathBuf,
    path: String,
    new_name: String,
    expected_mtime: u64,
) -> Result<(), String> {
    // 이동 명령과 같은 Mutate 잠금 안에서 한 번의 이동으로 끝낸다(DEF-CONC-003).
    file_executor()
        .run(FsAccess::Mutate, move || {
            Ok(rename_checked(&root, &path, &new_name, expected_mtime))
        })
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rename_markdown_file(
    vaults: State<'_, RegisteredVaults>,
    vault_path: String,
    path: String,
    new_name: String,
    expected_mtime: u64,
) -> Result<(), String> {
    let root = super::inbox_organizer::registered_root(&vaults, &vault_path)?;
    execute_rename_checked(root, path, new_name, expected_mtime).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture() -> (PathBuf, PathBuf, PathBuf) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(".codex-artifacts/note-move")
            .join(format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        let folder = root.join("목적지");
        fs::create_dir_all(&folder).unwrap();
        let source = root.join("기록.md");
        fs::write(
            &source,
            "---\ntype: todo\ndone: true\ntags: [중요]\n---\n# 원본\n",
        )
        .unwrap();
        (root, source, folder)
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn record_move_preserves_bytes_mtime_and_same_folder() {
        let (root, source, folder) = fixture();
        let bytes = fs::read(&source).unwrap();
        let mtime = modified_ms(&source).unwrap();
        move_checked(
            &root,
            source.to_str().unwrap(),
            root.to_str().unwrap(),
            mtime,
        )
        .unwrap();
        move_checked(
            &root,
            source.to_str().unwrap(),
            folder.to_str().unwrap(),
            mtime,
        )
        .unwrap();
        let target = folder.join("기록.md");
        assert!(!source.exists());
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert_eq!(modified_ms(&target).unwrap(), mtime);
    }

    #[test]
    fn record_move_rejects_stale_collision_and_unsafe_paths() {
        let (root, source, folder) = fixture();
        let mtime = modified_ms(&source).unwrap();
        let original = fs::read(&source).unwrap();
        assert!(move_checked(
            &root,
            source.to_str().unwrap(),
            folder.to_str().unwrap(),
            mtime + 1
        )
        .is_err());
        fs::write(folder.join("기록.md"), "기존 파일").unwrap();
        assert!(move_checked(
            &root,
            source.to_str().unwrap(),
            folder.to_str().unwrap(),
            mtime
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(folder.join("기록.md")).unwrap(),
            "기존 파일"
        );
        for unsafe_folder in [root.join(".."), root.join("없는폴더")] {
            assert!(move_checked(
                &root,
                source.to_str().unwrap(),
                unsafe_folder.to_str().unwrap(),
                mtime
            )
            .is_err());
        }
        assert!(move_checked(&root, "기록.md", folder.to_str().unwrap(), mtime).is_err());
        assert_eq!(fs::read(&source).unwrap(), original);
    }

    #[test]
    #[cfg(unix)]
    fn record_move_rejects_drawings_and_symlinks() {
        let (root, source, folder) = fixture();
        let mtime = modified_ms(&source).unwrap();
        let link = root.join("링크.md");
        std::os::unix::fs::symlink(&source, &link).unwrap();
        assert!(move_checked(
            &root,
            link.to_str().unwrap(),
            folder.to_str().unwrap(),
            mtime
        )
        .is_err());
        for name in ["그림.excalidraw", "그림.excalidraw.md"] {
            let drawing = root.join(name);
            fs::write(&drawing, "그림 보존").unwrap();
            assert!(move_checked(
                &root,
                drawing.to_str().unwrap(),
                folder.to_str().unwrap(),
                modified_ms(&drawing).unwrap()
            )
            .is_err());
            assert!(drawing.exists());
        }
    }

    /// DEF-CONC-005: 같은 파일에 대한 쓰기(executor Mutate)와 이동이 직렬화된다.
    /// 쓰기가 잠금을 쥔 동안 이동은 완료하지 못하고, 쓰기 완료 뒤에는 mtime 확인이
    /// 이동을 거부한다(원본 경로 부활 없음).
    #[test]
    fn record_move_and_write_are_serialized_by_mutate_lock() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (root, source, folder) = fixture();
            let expected = modified_ms(&source).unwrap();
            let executor = file_executor();
            // 쓰기 작업: Mutate 잠금을 잡은 채 신호까지 대기한 뒤 같은 파일을 고친다.
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
                        fs::write(&writer_path, "외부 쓰기 내용")?;
                        Ok(())
                    })
                    .await
            });
            started_rx.await.unwrap();
            // 쓰기가 잠금을 쥔 동안 이동을 시도한다. 실행기 편입이라면 잠금 뒤에서 기다린다.
            let mover = tokio::spawn(execute_move_checked(
                root.clone(),
                source.to_string_lossy().into_owned(),
                folder.to_string_lossy().into_owned(),
                expected,
            ));
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            assert!(
                source.exists(),
                "이동이 쓰기 잠금을 우회해 원본을 옮겼습니다(직렬화 실패)"
            );
            assert!(
                !mover.is_finished(),
                "이동이 쓰기 완료 전에 끝났습니다(직렬화 실패)"
            );
            // 쓰기를 풀어준다. 이후 이동은 mtime 불일치로 거부돼야 한다.
            release_tx.send(()).unwrap();
            writer.await.unwrap().unwrap();
            let result = mover.await.unwrap();
            assert!(
                result.is_err(),
                "쓰기 뒤의 이동이 mtime 확인 없이 성공했습니다"
            );
            assert_eq!(fs::read_to_string(&source).unwrap(), "외부 쓰기 내용");
            assert!(!folder.join("기록.md").exists());
        });
    }

    /// DEF-CONC-003: 같은 폴더 안 이름 변경은 바이트·mtime을 보존하는 한 번의 이동이다.
    #[test]
    #[cfg(target_os = "macos")]
    fn record_rename_preserves_bytes_and_mtime() {
        let (root, source, _folder) = fixture();
        let bytes = fs::read(&source).unwrap();
        let mtime = modified_ms(&source).unwrap();
        rename_checked(&root, source.to_str().unwrap(), "새 이름.md", mtime).unwrap();
        let target = root.join("새 이름.md");
        assert!(!source.exists());
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert_eq!(modified_ms(&target).unwrap(), mtime);
    }

    /// 목적지가 있으면(확인 시점이든 그 뒤든) 덮지 않고, 원본·목적지 바이트가 그대로다.
    #[test]
    #[cfg(target_os = "macos")]
    fn record_rename_never_overwrites_destination() {
        let (root, source, _folder) = fixture();
        let mtime = modified_ms(&source).unwrap();
        let original = fs::read(&source).unwrap();
        let target = root.join("새 이름.md");
        fs::write(&target, "기존 파일").unwrap();
        assert!(rename_checked(&root, source.to_str().unwrap(), "새 이름.md", mtime).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "기존 파일");
        assert_eq!(fs::read(&source).unwrap(), original);
        // 존재 확인을 지나친 뒤 목적지가 생기는 경합 창은 RENAME_EXCL이 닫는다.
        assert!(super::super::inbox_organizer::rename_exclusive(&source, &target).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "기존 파일");
        assert_eq!(fs::read(&source).unwrap(), original);
    }

    #[test]
    fn record_rename_rejects_stale_unsafe_names_and_drawings() {
        let (root, source, _folder) = fixture();
        let mtime = modified_ms(&source).unwrap();
        let original = fs::read(&source).unwrap();
        let path = source.to_str().unwrap();
        assert!(rename_checked(&root, path, "새 이름.md", mtime + 1).is_err());
        for bad in [
            "",
            ".",
            "..",
            ".숨김.md",
            "a/b.md",
            "a\\b.md",
            "새 이름.txt",
            "그림.excalidraw.md",
        ] {
            assert!(rename_checked(&root, path, bad, mtime).is_err(), "{bad}");
        }
        let drawing = root.join("그림.excalidraw.md");
        fs::write(&drawing, "그림 보존").unwrap();
        assert!(rename_checked(
            &root,
            drawing.to_str().unwrap(),
            "다른.md",
            modified_ms(&drawing).unwrap()
        )
        .is_err());
        assert!(drawing.exists());
        assert_eq!(fs::read(&source).unwrap(), original);
    }
}
