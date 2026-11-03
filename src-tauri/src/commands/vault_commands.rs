use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

use crate::{RegisteredVaults, SecretsViewerState};

use super::error::{CommandError, CommandResult};
use super::secrets_config::{home_dir, home_unavailable, validate_vault_candidate};
use super::vault_guard::{
    ensure_fs_plugin, ensure_path_in_registered_vault, validate_directory_path,
};

/// 한 번에 등록 가능한 vault 개수 상한 (TICK-P0-004).
///
/// 동시 등록 vault 수에 hard limit을 두어 fs_scope에 무제한으로 디렉토리가
/// 누적되는 것을 막는다. 실제 사용 시나리오에서 8개를 동시에 쓰는 경우는
/// 거의 없고, 후속 "최근 vault" UI가 들어오면 이 한도 안에서 회전한다.
pub const MAX_REGISTERED_VAULTS: usize = 8;

/// 신규 vault 등록 결정 결과 (pure helper용).
#[derive(Debug, PartialEq, Eq)]
pub enum VaultRegistryDecision {
    /// 이미 등록된 경로. 추가 동작 없음.
    AlreadyRegistered,
    /// 새 경로이고 상한 안. push 가능.
    Insert,
    /// 새 경로지만 상한 도달. 거부.
    AtCapacity,
}

/// 등록 결정만 담당하는 pure helper. lock/AppHandle 없이 단위 테스트한다.
pub fn decide_vault_registration(
    existing: &[PathBuf],
    candidate: &Path,
    max: usize,
) -> VaultRegistryDecision {
    if existing.iter().any(|p| p.as_path() == candidate) {
        VaultRegistryDecision::AlreadyRegistered
    } else if existing.len() >= max {
        VaultRegistryDecision::AtCapacity
    } else {
        VaultRegistryDecision::Insert
    }
}

// ---------------------------------------------------------------------------
// Vault 선택 / 등록 명령어
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn select_vault_folder(app: AppHandle) -> CommandResult<Option<String>> {
    let selected = app
        .dialog()
        .file()
        .set_title("볼트 폴더 선택")
        .blocking_pick_folder();

    selected.map(file_path_to_string).transpose()
}

#[tauri::command]
pub fn register_vault_path(
    app: AppHandle,
    vaults: State<'_, RegisteredVaults>,
    secrets: State<'_, SecretsViewerState>,
    vault_path: String,
) -> CommandResult<()> {
    ensure_fs_plugin(&app)?;
    let vault_dir = validate_directory_path(&vault_path)?;
    // 루트·홈·앱 설정 폴더·비밀 폴더와 겹치는 폴더는 볼트로 등록하지 않는다(설계 런타임-볼트-전환-정책.md §9).
    // 비밀 폴더가 미설정·무시 상태이면(effective_base 오류) 그 검사만 건너뛴다.
    let secrets_base = secrets.effective_base(&[]).ok();
    // 홈을 확인할 수 없으면 보호 영역을 만들 수 없으므로 거부한다(fail-closed).
    let home = home_dir().ok_or_else(home_unavailable)?;
    let vault_dir = validate_vault_candidate(&vault_dir, &home, secrets_base.as_deref())?;

    // 레지스트리에 등록 (중복 제거 + 상한 검사, TICK-P0-004).
    {
        let mut registered = vaults
            .0
            .lock()
            .map_err(|_| CommandError::InvalidPath("vault registry lock poisoned".to_owned()))?;

        match decide_vault_registration(&registered, &vault_dir, MAX_REGISTERED_VAULTS) {
            VaultRegistryDecision::AlreadyRegistered => {
                // 이미 같은 경로가 등록됨. 멱등 처리하고 fs_scope만 갱신한다.
            }
            VaultRegistryDecision::Insert => {
                registered.push(vault_dir.clone());
            }
            VaultRegistryDecision::AtCapacity => {
                return Err(CommandError::VaultRegistryFull {
                    limit: MAX_REGISTERED_VAULTS,
                });
            }
        }
    }

    // 기존 fs_scope 이중 방어도 그대로 유지.
    app.fs_scope()
        .allow_directory(&vault_dir, true)
        .map_err(|error| CommandError::FsScopeRegistration {
            path: vault_dir.to_string_lossy().into_owned(),
            message: error.to_string(),
        })?;

    Ok(())
}

#[tauri::command]
pub fn list_vault_notes(
    app: AppHandle,
    vaults: State<'_, RegisteredVaults>,
    vault_path: String,
) -> CommandResult<Vec<String>> {
    ensure_fs_plugin(&app)?;
    let vault_dir = validate_directory_path(&vault_path)?;
    let vault_dir = ensure_path_in_registered_vault(&vaults, &vault_dir)?;
    let mut notes = Vec::new();

    collect_markdown_files(&vault_dir, &mut notes)?;
    notes.sort();

    Ok(notes)
}

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

fn file_path_to_string(file_path: tauri_plugin_dialog::FilePath) -> CommandResult<String> {
    let path = file_path
        .into_path()
        .map_err(|error| CommandError::DialogPathConversion(error.to_string()))?;

    Ok(path.to_string_lossy().into_owned())
}

pub(crate) fn collect_markdown_files(
    dir: &Path,
    notes: &mut Vec<String>,
) -> Result<(), std::io::Error> {
    let mut entries = fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let path = entry.path();
        let file_type = entry.file_type()?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }

        if file_type.is_dir() {
            collect_markdown_files(&path, notes)?;
            continue;
        }

        let is_markdown = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("md"))
            .unwrap_or(false);

        if is_markdown {
            notes.push(path.to_string_lossy().into_owned());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    /// 빈 레지스트리에 후보를 넣을 때 Insert로 결정된다.
    #[test]
    fn decide_inserts_into_empty_registry() {
        let existing: Vec<PathBuf> = Vec::new();
        let candidate = p("/tmp/vault-a");
        assert_eq!(
            decide_vault_registration(&existing, &candidate, MAX_REGISTERED_VAULTS),
            VaultRegistryDecision::Insert
        );
    }

    /// 동일 경로가 이미 있으면 AlreadyRegistered로 멱등 처리한다.
    #[test]
    fn decide_recognises_duplicate() {
        let existing = vec![p("/tmp/vault-a"), p("/tmp/vault-b")];
        let candidate = p("/tmp/vault-a");
        assert_eq!(
            decide_vault_registration(&existing, &candidate, MAX_REGISTERED_VAULTS),
            VaultRegistryDecision::AlreadyRegistered
        );
    }

    /// 상한 도달 + 신규 후보 → AtCapacity 거부.
    /// 후보가 9번째일 때만 막혀야 하므로 8개를 미리 채운다.
    #[test]
    fn decide_rejects_when_at_capacity_with_new_candidate() {
        let existing: Vec<PathBuf> = (0..MAX_REGISTERED_VAULTS)
            .map(|i| p(&format!("/tmp/vault-{i}")))
            .collect();
        assert_eq!(existing.len(), MAX_REGISTERED_VAULTS);
        let candidate = p("/tmp/vault-new");
        assert_eq!(
            decide_vault_registration(&existing, &candidate, MAX_REGISTERED_VAULTS),
            VaultRegistryDecision::AtCapacity
        );
    }

    /// 상한 도달 + 중복 후보는 멱등(이미 있으니까). 9번째여도 Already.
    #[test]
    fn decide_allows_duplicate_even_at_capacity() {
        let existing: Vec<PathBuf> = (0..MAX_REGISTERED_VAULTS)
            .map(|i| p(&format!("/tmp/vault-{i}")))
            .collect();
        let duplicate = p("/tmp/vault-3");
        assert_eq!(
            decide_vault_registration(&existing, &duplicate, MAX_REGISTERED_VAULTS),
            VaultRegistryDecision::AlreadyRegistered
        );
    }

    /// 상한 직전(7개) + 신규 후보 → 8번째로 들어간다. 경계 정확성 확인.
    #[test]
    fn decide_inserts_when_one_below_capacity() {
        let existing: Vec<PathBuf> = (0..MAX_REGISTERED_VAULTS - 1)
            .map(|i| p(&format!("/tmp/vault-{i}")))
            .collect();
        assert_eq!(existing.len(), MAX_REGISTERED_VAULTS - 1);
        let candidate = p("/tmp/vault-fresh");
        assert_eq!(
            decide_vault_registration(&existing, &candidate, MAX_REGISTERED_VAULTS),
            VaultRegistryDecision::Insert
        );
    }
}
