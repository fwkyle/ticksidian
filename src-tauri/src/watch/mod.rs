//! 볼트 파일 시스템 push watcher (TICK-P1-006).
//!
//! 프론트의 폴링 watcher는 변경이 없어도 매 tick 디렉터리를 stat한다. 이 모듈은 OS
//! 파일 감시(notify: macOS FSEvents / Linux inotify / Windows ReadDirectoryChangesW)로
//! 실제 변경이 있을 때만 `vault-fs-changed` 이벤트를 프론트로 emit한다. 목표는
//! "외부 변경 즉시 반영 + idle 시 폴링 비용 제거"다.
//!
//! 안전: 프론트 폴링은 fallback으로 그대로 둔다. notify가 이벤트를 놓치거나(일부
//! 네트워크 FS 등) 이 watcher가 못 떠도 폴링이 변경을 잡으므로 무회귀다. 그래서 여기서
//! 발생하는 에러(감시 시작 실패, emit 실패)는 치명적으로 다루지 않는다.

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter, State};

use crate::commands::error::{CommandError, CommandResult};
use crate::commands::vault_guard::ensure_path_in_registered_vault;
use crate::RegisteredVaults;

/// notify가 저장 1회에 여러 이벤트를 쏘므로 모으는 디바운스 창.
const WATCH_DEBOUNCE_MS: u64 = 300;

/// 프론트로 emit하는 이벤트 이름. `useVaultWatcher`가 listen한다.
pub const VAULT_FS_CHANGED_EVENT: &str = "vault-fs-changed";

/// 현재 활성 watcher. 볼트 전환 시 이전 것을 drop(=watch 중지)하고 새로 만든다.
/// Default는 None(감시 안 함).
#[derive(Default)]
pub struct VaultWatchState(pub Mutex<Option<Debouncer<RecommendedWatcher>>>);

/// 변경 경로가 노트 목록에 영향을 주는지 판정(순수 — 단위 테스트 대상).
///
/// - dot으로 시작하는 경로 컴포넌트(`.trash`, `.ticksidian-sync`, `.git`, 그리고
///   원자적 쓰기 임시파일 `.{name}.ticksidian-tmp-*`)가 하나라도 있으면 무시한다.
///   앱 자체 메타/휴지통/임시 쓰기로 인한 불필요한 refresh를 막는다.
/// - `.md` 파일이거나 확장자 없는 경로(폴더 생성/삭제/이름변경 가능성)면 emit 대상.
/// - 그 외 확장자(.json 등)는 노트 목록에 직접 영향 없으므로 무시한다.
pub fn should_emit_for_path(path: &Path) -> bool {
    for comp in path.components() {
        if let Component::Normal(os) = comp {
            if os.to_str().map(|s| s.starts_with('.')).unwrap_or(false) {
                return false;
            }
        }
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some("md") => true,
        None => true,
        Some(_) => false,
    }
}

fn any_relevant(paths: &[PathBuf]) -> bool {
    paths.iter().any(|p| should_emit_for_path(p))
}

/// 볼트 루트를 재귀 감시 시작. 이전 watcher가 있으면 교체(중지)한다.
/// 등록된 vault 경계 안의 경로만 허용한다(프론트가 register 후 호출).
#[tauri::command]
pub fn start_vault_watch(
    app: AppHandle,
    state: State<'_, VaultWatchState>,
    vaults: State<'_, RegisteredVaults>,
    path: String,
) -> CommandResult<()> {
    let canonical = ensure_path_in_registered_vault(&vaults, Path::new(&path))?;

    let app_handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(WATCH_DEBOUNCE_MS),
        move |res: DebounceEventResult| {
            // notify-debouncer-mini는 이 콜백을 watch 루프 스레드 위에서 직접 호출하고
            // catch_unwind로 감싸지 않는다. 콜백이 패닉하면 그 스레드가 죽어 push가 조용히
            // 멎는다(폴링 fallback이 정확성은 커버하지만). 현재 본문엔 실질 패닉 표면이 없지만,
            // 배경 스레드라 관측이 어려우므로 방어적으로 패닉을 가둬 스레드를 살린다.
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // 에러는 무시(폴링 fallback). 정상 이벤트만 필터해 emit.
                let Ok(events) = res else {
                    return;
                };
                let paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
                if any_relevant(&paths) {
                    // emit 실패(웹뷰 미준비 등)도 무시 — 폴링이 안전망.
                    let _ = app_handle.emit(VAULT_FS_CHANGED_EVENT, ());
                }
            }));
            if outcome.is_err() {
                eprintln!("[vault-watch] event handler panicked; watch thread preserved");
            }
        },
    )
    .map_err(|e| CommandError::Watch(e.to_string()))?;

    debouncer
        .watcher()
        .watch(&canonical, RecursiveMode::Recursive)
        .map_err(|e| CommandError::Watch(e.to_string()))?;

    let mut guard = state
        .0
        .lock()
        .map_err(|_| CommandError::Watch("watch state lock poisoned".to_owned()))?;
    // 이전 Some(_)은 여기서 교체되며 drop → 이전 watch가 중지된다.
    *guard = Some(debouncer);
    Ok(())
}

/// 감시 중지(볼트 닫기/전환 정리). 활성 watcher를 drop한다.
#[tauri::command]
pub fn stop_vault_watch(state: State<'_, VaultWatchState>) -> CommandResult<()> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| CommandError::Watch("watch state lock poisoned".to_owned()))?;
    *guard = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_emit_for_path;
    use std::path::Path;

    #[test]
    fn emits_for_md_file() {
        assert!(should_emit_for_path(Path::new("/vault/notes/Foo.md")));
    }

    #[test]
    fn emits_for_nested_md_file() {
        assert!(should_emit_for_path(Path::new("/vault/notes/sub/Bar.md")));
    }

    #[test]
    fn emits_for_directory_without_extension() {
        assert!(should_emit_for_path(Path::new("/vault/notes/NewFolder")));
    }

    #[test]
    fn ignores_trash_component() {
        assert!(!should_emit_for_path(Path::new(
            "/vault/.trash/ticksidian/Foo.md"
        )));
    }

    #[test]
    fn ignores_sync_component() {
        assert!(!should_emit_for_path(Path::new(
            "/vault/.ticksidian-sync/abc.json"
        )));
    }

    #[test]
    fn ignores_atomic_write_tmp_file() {
        // 원자적 쓰기 임시파일은 '.'로 시작 → 무시(저장 중 noise 방지).
        assert!(!should_emit_for_path(Path::new(
            "/vault/notes/.Foo.md.ticksidian-tmp-1234"
        )));
    }

    #[test]
    fn ignores_dotfile() {
        assert!(!should_emit_for_path(Path::new("/vault/notes/.DS_Store")));
    }

    #[test]
    fn ignores_non_md_extension() {
        assert!(!should_emit_for_path(Path::new("/vault/notes/data.json")));
    }
}
