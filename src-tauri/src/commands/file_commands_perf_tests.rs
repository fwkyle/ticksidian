use super::super::fs_executor::{FsAccess, FsExecutor};
use super::super::vault_guard::{ensure_path_in_vaults_inner, validate_markdown_path};
use super::write_file_atomic;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Barrier};
use std::time::{SystemTime, UNIX_EPOCH};

fn preserved_dir(label: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.codex-artifacts/perf-step3")
        .join(format!(
            "{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    fs::create_dir_all(&root).unwrap();
    fs::canonicalize(root).unwrap()
}

#[test]
fn perf_atomic_concurrent_writes_publish_only_complete_files() {
    let root = preserved_dir("atomic-race");
    let path = root.join("note.md");
    let gate = Arc::new(Barrier::new(8));
    let threads: Vec<_> = (0..8)
        .map(|index| {
            let path = path.clone();
            let gate = gate.clone();
            std::thread::spawn(move || {
                let bytes = vec![b'A' + index; 2 * 1024 * 1024];
                gate.wait();
                write_file_atomic(&path, &bytes)
            })
        })
        .collect();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    let bytes = fs::read(path).unwrap();
    assert!(
        results.iter().all(Result::is_ok),
        "concurrent writes failed: {results:?}"
    );
    assert_eq!(bytes.len(), 2 * 1024 * 1024);
    assert!(
        bytes.iter().all(|byte| *byte == bytes[0]),
        "partial writes mixed together"
    );
    assert_eq!(
        fs::read_dir(root).unwrap().count(),
        1,
        "temporary file collision/leak"
    );
}

#[test]
fn perf_guard_and_real_file_round_trip_run_in_executor() {
    let root = preserved_dir("guard-roundtrip");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let executor = FsExecutor::new();
        let path = root.join("새 폴더/노트.md");
        let target = path.clone();
        let registered = vec![root.clone()];
        executor
            .run(FsAccess::Mutate, move || {
                let target = validate_markdown_path(&target.to_string_lossy())?;
                let target = ensure_path_in_vaults_inner(&registered, &target)?;
                write_file_atomic(&target, "# 한글\n\n완성 본문")?;
                Ok(())
            })
            .await
            .unwrap();
        let registered = vec![root.clone()];
        let content = executor
            .run(FsAccess::Read, move || {
                let target = ensure_path_in_vaults_inner(&registered, &path)?;
                Ok(fs::read_to_string(target)?)
            })
            .await
            .unwrap();
        assert_eq!(content, "# 한글\n\n완성 본문");
        let probes = [
            root.join("../escape.md"),
            PathBuf::from("relative.md"),
            root.join("drawing.excalidraw"),
        ];
        for probe in probes {
            let registered = vec![root.clone()];
            assert!(executor
                .run(FsAccess::Mutate, move || {
                    let probe = validate_markdown_path(&probe.to_string_lossy())?;
                    let probe = ensure_path_in_vaults_inner(&registered, &probe)?;
                    write_file_atomic(&probe, "must not write")?;
                    Ok(())
                })
                .await
                .is_err());
        }
        let missing = root.join("missing.md");
        assert!(executor
            .run(FsAccess::Read, move || Ok(fs::read(missing)?))
            .await
            .is_err());
        let target = root.join("새 폴더/노트.md");
        assert!(executor
            .run(FsAccess::Read, move || {
                ensure_path_in_vaults_inner(&[], &target)?;
                Ok(())
            })
            .await
            .is_err());
    });
}

#[cfg(unix)]
#[test]
fn perf_guard_rejects_symlink_escape_in_executor() {
    let root = preserved_dir("guard-link");
    let outside = preserved_dir("outside-link");
    fs::write(outside.join("outside.md"), "untouched").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let path = root.join("link/outside.md");
            let result = FsExecutor::new()
                .run(FsAccess::Mutate, move || {
                    let path = ensure_path_in_vaults_inner(&[root], &path)?;
                    write_file_atomic(&path, "must not write")?;
                    Ok(())
                })
                .await;
            assert!(result.is_err());
        });
    assert_eq!(
        fs::read_to_string(outside.join("outside.md")).unwrap(),
        "untouched"
    );
}

#[test]
fn perf_atomic_failure_preserves_target_and_cleans_only_own_temp() {
    let root = preserved_dir("rename-failure");
    let target = root.join("directory.md");
    fs::create_dir(&target).unwrap();
    let old_temp = root.join(format!(
        ".directory.md.ticksidian-tmp-{}",
        std::process::id()
    ));
    fs::write(&old_temp, "preserve previous evidence").unwrap();
    assert!(write_file_atomic(&target, "replacement").is_err());
    assert!(target.is_dir());
    assert_eq!(
        fs::read_to_string(old_temp).unwrap(),
        "preserve previous evidence"
    );
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);
}

#[test]
fn perf_executor_same_file_writes_finish_in_request_order() {
    let root = preserved_dir("ordered-writes");
    let target = root.join("note.md");
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let executor = Arc::new(FsExecutor::new());
            let mut tasks = Vec::new();
            for index in 0..12 {
                let executor = executor.clone();
                let target = target.clone();
                tasks.push(tokio::spawn(async move {
                    executor
                        .run(FsAccess::Mutate, move || {
                            let content = format!("writer-{index}\n").repeat(1024);
                            write_file_atomic(&target, content)?;
                            Ok(())
                        })
                        .await
                }));
                tokio::task::yield_now().await;
            }
            for task in tasks {
                task.await.unwrap().unwrap();
            }
        });
    assert_eq!(
        fs::read_to_string(target).unwrap(),
        "writer-11\n".repeat(1024)
    );
    assert_eq!(fs::read_dir(root).unwrap().count(), 1);
}

#[test]
fn perf_real_atomic_temp_name_is_ignored_by_watcher() {
    struct Probe {
        root: PathBuf,
    }
    impl AsRef<[u8]> for Probe {
        fn as_ref(&self) -> &[u8] {
            let names: Vec<_> = fs::read_dir(&self.root)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect();
            assert_eq!(names.len(), 1);
            assert!(names[0]
                .to_string_lossy()
                .starts_with(".ticksidian-tmp-write-"));
            // 실제 임시 basename을 일반 볼트 경로에 붙인다. QA 루트 자체가 숨김
            // 폴더여서 무조건 무시되는 거짓 양성을 피한다.
            let probe = PathBuf::from("/vault/notes").join(&names[0]);
            assert!(!crate::watch::should_emit_for_path(&probe));
            b"complete"
        }
    }
    let root = preserved_dir("watch-temp");
    write_file_atomic(&root.join("note.md"), Probe { root: root.clone() }).unwrap();
    assert!(crate::watch::should_emit_for_path(std::path::Path::new(
        "/vault/notes/note.md"
    )));
    assert_eq!(fs::read_dir(root).unwrap().count(), 1);
}

#[test]
fn perf_queued_write_rechecks_mtime_after_wait_and_preserves_external_content() {
    let root = preserved_dir("queued-external-edit");
    let path = root.join("note.md");
    fs::write(&path, "old").unwrap();
    let old_time = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(old_time))
        .unwrap();
    let expected = fs::metadata(&path)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let executor = Arc::new(FsExecutor::new());
            let (started, ready) = tokio::sync::oneshot::channel();
            let (release, blocked) = std::sync::mpsc::channel();
            let first_executor = executor.clone();
            let blocker = tokio::spawn(async move {
                first_executor
                    .run(FsAccess::Mutate, move || {
                        started.send(()).unwrap();
                        blocked
                            .recv_timeout(std::time::Duration::from_secs(2))
                            .unwrap();
                        Ok(())
                    })
                    .await
            });
            ready.await.unwrap();
            let target = path.clone();
            let queued = tokio::spawn(async move {
                executor
                    .run(FsAccess::Mutate, move || {
                        super::write_file_atomic_checked(&target, b"stale local", Some(expected))
                    })
                    .await
            });
            tokio::task::yield_now().await;
            // 독립 외부 작성자 역할: 실행기 밖에서만 변경한다.
            fs::write(&path, "new external content").unwrap();
            release.send(()).unwrap();
            blocker.await.unwrap().unwrap();
            let result = queued.await.unwrap();
            assert!(
                result.is_err(),
                "a queued stale write overwrote external content"
            );
            let error = serde_json::to_value(result.unwrap_err()).unwrap();
            assert_eq!(error["code"], "fileModifiedExternally");
        });
    assert_eq!(fs::read_to_string(&path).unwrap(), "new external content");
    assert_eq!(fs::read_dir(root).unwrap().count(), 1);
}

#[test]
fn perf_checked_write_accepts_matching_mtime_and_legacy_none() {
    let root = preserved_dir("checked-compatible");
    let path = root.join("note.md");
    super::write_file_atomic_checked(&path, b"created", None).unwrap();
    let expected = fs::metadata(&path)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    super::write_file_atomic_checked(&path, b"updated", Some(expected)).unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"updated");
    assert!(super::write_file_atomic_checked(
        &root.join("missing.md"),
        b"no resurrection",
        Some(expected)
    )
    .is_err());
    assert!(!root.join("missing.md").exists());
    super::write_file_atomic_checked(&path, b"legacy overwrite", None).unwrap();
    assert_eq!(fs::read(path).unwrap(), b"legacy overwrite");
}

/// DEF-CONC-002: 쓰기가 돌려주는 값은 "내가 쓴 내용의 mtime"이다.
/// 게시 직후 외부 쓰기가 있어도 반환값은 외부 mtime이 아니며, 게시된 내 파일과 같다.
#[test]
fn perf_checked_write_returns_own_mtime_not_later_external_mtime() {
    let root = preserved_dir("checked-returns-mtime");
    let path = root.join("note.md");
    let returned = super::write_file_atomic_checked(&path, b"mine", None).unwrap();
    let published = fs::metadata(&path)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    assert_eq!(returned, published);
    // 외부 작성자가 나중에 쓰면 디스크 mtime은 달라질 수 있지만 이미 받은 반환값은 그대로다.
    std::thread::sleep(std::time::Duration::from_millis(30));
    fs::write(&path, "external").unwrap();
    let after_external = fs::metadata(&path)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    assert!(
        after_external > returned,
        "외부 쓰기 mtime이 더 커야 재조회 방식의 결함이 재현된다"
    );
    // 반환값을 기준선으로 쓰면 다음 확인 쓰기는 외부 변경을 덮지 못한다.
    assert!(super::write_file_atomic_checked(&path, b"stale", Some(returned)).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "external");
}
