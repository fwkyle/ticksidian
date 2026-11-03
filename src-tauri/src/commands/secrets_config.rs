// 비밀 폴더 설정 — 보안 메모 뷰어와 Gemini 키 조회가 쓰는 폴더 경계를 사용자가 고른다
// (2026-11-02 [kyle] 승인, 설계: docs/waterfall/03-상세설계/보안-메모-뷰어.md §12).
//
// 계약:
// - 설정은 Rust가 소유하고 웹뷰 밖(`~/.ticksidian-desktop/secrets-config.json`)에 둔다.
// - 선택 명령은 경로 인자를 받지 않고, 폴더는 Rust가 연 네이티브 선택 창에서만 정해진다.
// - 선택·시작 시 설정 읽기·비밀 폴더를 쓰는 매 접근은 같은 함수 `validate_candidate` 하나로 검사한다
//   (canonicalize·디렉터리 여부·루트, 홈과 그 상위, 등록 볼트와 그 상위, 앱 설정 폴더 겹침).
// - 설정 파일이 없거나 손상됐거나 허용되지 않는 값이면 "미설정"으로 떨어지고 이유를 화면에 알린다
//   (설정 파일은 지우거나 덮지 않는다. 개인 이름 폴백 없음).
// - 설정 파일이 웹뷰의 일반 파일 명령으로 바뀌지 않도록 vault_guard가 앱 설정 폴더 아래 경로를 거부한다.
// - 쓰기는 같은 폴더 tmp → rename 원자적 쓰기, 600 권한.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::error::{CommandError, CommandResult};
use crate::{RegisteredVaults, SecretsViewerState};

const CONFIG_VERSION: u32 = 1;
/// 설정 폴더(sync-meta.db와 같은 공용 폴더라 dev·local·정식 빌드가 한 설정을 공유한다).
pub const CONFIG_DIR_NAME: &str = ".ticksidian-desktop";
pub const CONFIG_FILE_NAME: &str = "secrets-config.json";
/// Gemini 키 파일의 기본 상대경로(비밀 폴더 기준). 다른 배치는 설정 파일의 값으로 바꾼다.
pub const DEFAULT_GEMINI_KEY_REL_PATH: &str = "gemini.env";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretsConfig {
    pub version: u32,
    pub base_dir: String,
    #[serde(default = "default_gemini_rel_path")]
    pub gemini_key_rel_path: String,
}

fn default_gemini_rel_path() -> String {
    DEFAULT_GEMINI_KEY_REL_PATH.to_string()
}

/// 웹뷰에 보여 주는 상태. 경로는 비밀이 아니라 표시용이다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretsFolderStatus {
    pub configured: bool,
    pub path: Option<String>,
    /// 설정이 있는데 허용되지 않아 무시된 이유(없으면 None).
    pub reason: Option<String>,
}

/// 설정 읽기 결과: 쓸 수 있는 설정 또는 무시한 이유.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigLoad {
    /// 설정 파일 없음(처음 사용).
    Absent,
    Accepted(SecretsConfig),
    Rejected(String),
}

pub fn config_path_for_home(home: &Path) -> PathBuf {
    home.join(CONFIG_DIR_NAME).join(CONFIG_FILE_NAME)
}

/// 앱 설정 폴더(`~/.ticksidian-desktop`). 일반 파일 명령이 쓰지 못하게 vault_guard도 이 함수를 쓴다.
pub fn app_config_dir_for_home(home: &Path) -> PathBuf {
    home.join(CONFIG_DIR_NAME)
}

/// 홈을 확인할 수 없으면 None(호출자는 거부한다).
pub fn app_config_dir() -> Option<PathBuf> {
    home_dir().map(|home| app_config_dir_for_home(&home))
}

/// 설정 파일 위치에서 홈 폴더를 되짚는다(`<홈>/.ticksidian-desktop/<파일>`).
pub fn home_for_config_path(config_path: &Path) -> PathBuf {
    config_path
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 설정 읽기. 형식 검사 뒤 폴더는 `validate_candidate`로 선택과 같은 규칙을 적용한다.
/// 시작 시에는 볼트가 아직 등록되지 않았으므로 `vaults`는 비어 있고, 볼트 충돌은 접근 때마다 다시 검사한다.
pub fn load_config(config_path: &Path, home: &Path, vaults: &[PathBuf]) -> ConfigLoad {
    let text = match fs::read_to_string(config_path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return ConfigLoad::Absent,
        Err(_) => return ConfigLoad::Rejected("설정 파일을 읽지 못했습니다.".to_string()),
    };
    let Ok(mut config) = serde_json::from_str::<SecretsConfig>(&text) else {
        return ConfigLoad::Rejected("설정 파일 형식이 올바르지 않습니다.".to_string());
    };
    if config.version != CONFIG_VERSION {
        return ConfigLoad::Rejected("지원하지 않는 설정 버전입니다.".to_string());
    }
    if !Path::new(&config.base_dir).is_absolute() {
        return ConfigLoad::Rejected("설정된 폴더가 절대경로가 아닙니다.".to_string());
    }
    if crate::commands::secrets_viewer::validate_rel_path(&config.gemini_key_rel_path).is_err() {
        return ConfigLoad::Rejected("Gemini 키 상대경로가 올바르지 않습니다.".to_string());
    }
    match validate_candidate(Path::new(&config.base_dir), home, vaults) {
        Ok(canon) => {
            config.base_dir = canon.to_string_lossy().into_owned();
            ConfigLoad::Accepted(config)
        }
        Err(err) => ConfigLoad::Rejected(err.to_string()),
    }
}

/// 설정 원자적 쓰기(같은 폴더 tmp → rename, 600).
pub fn save_config(config_path: &Path, config: &SecretsConfig) -> CommandResult<()> {
    let parent = config_path
        .parent()
        .ok_or_else(|| CommandError::InvalidPath("설정 경로가 올바르지 않습니다.".to_string()))?;
    fs::create_dir_all(parent).map_err(CommandError::Io)?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| CommandError::InvalidPath(format!("설정을 직렬화하지 못했습니다: {e}")))?;
    let tmp = parent.join(format!(
        ".{CONFIG_FILE_NAME}.ticksidian-tmp-{}",
        std::process::id()
    ));
    fs::write(&tmp, json).map_err(CommandError::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)).map_err(CommandError::Io)?;
    }
    if let Err(err) = fs::rename(&tmp, config_path) {
        let _ = fs::remove_file(&tmp);
        return Err(CommandError::Io(err));
    }
    Ok(())
}

/// 후보 폴더 검증. 통과하면 canonicalize된 경로를 돌려준다.
/// 거부: 디렉터리 아님, 루트, 홈 폴더 자체·홈의 상위, 앱 설정 폴더 겹침, 등록 볼트 자체·볼트의 상위·볼트 안쪽.
pub fn validate_candidate(
    candidate: &Path,
    home: &Path,
    vaults: &[PathBuf],
) -> CommandResult<PathBuf> {
    let canon = fs::canonicalize(candidate)
        .map_err(|_| CommandError::InvalidPath("폴더를 찾지 못했습니다.".to_string()))?;
    if !canon.is_dir() {
        return Err(CommandError::InvalidPath(
            "폴더만 고를 수 있습니다.".to_string(),
        ));
    }
    if canon.parent().is_none() {
        return Err(CommandError::InvalidPath(
            "루트 폴더는 비밀 폴더로 쓸 수 없습니다.".to_string(),
        ));
    }
    let too_broad = |protected: &Path| {
        fs::canonicalize(protected)
            .map(|p| p.starts_with(&canon))
            .unwrap_or(false)
    };
    if too_broad(home) {
        return Err(CommandError::InvalidPath(
            "홈 폴더 전체는 비밀 폴더로 쓸 수 없습니다. 비밀 파일만 둔 하위 폴더를 고르세요."
                .to_string(),
        ));
    }
    let config_dir = app_config_dir_for_home(home);
    let config_canon = fs::canonicalize(&config_dir).unwrap_or(config_dir);
    if paths_overlap(&canon, &config_canon) {
        return Err(CommandError::InvalidPath(
            "앱 설정 폴더는 비밀 폴더로 쓸 수 없습니다.".to_string(),
        ));
    }
    // 등록 볼트와의 겹침도 볼트 등록(validate_vault_candidate)과 같은 판정 함수를 쓴다(문구만 방향별로 다르다).
    for vault in vaults {
        let Ok(vault_canon) = fs::canonicalize(vault) else {
            continue;
        };
        if !paths_overlap(&canon, &vault_canon) {
            continue;
        }
        let message = if vault_canon.starts_with(&canon) {
            "노트 볼트를 포함하는 폴더는 비밀 폴더로 쓸 수 없습니다."
        } else {
            "노트 볼트 안쪽 폴더는 비밀 폴더로 쓸 수 없습니다."
        };
        return Err(CommandError::InvalidPath(message.to_string()));
    }
    Ok(canon)
}

/// 두 경로(둘 다 canonicalize된 것)가 같거나 한쪽이 다른 쪽의 상위인지.
/// 볼트 등록과 비밀 폴더 검증이 같은 겹침 판정을 쓴다(문구는 각자).
pub fn paths_overlap(a: &Path, b: &Path) -> bool {
    a.starts_with(b) || b.starts_with(a)
}

/// 볼트 후보 검증(2026-11-03, 설계: 런타임-볼트-전환-정책.md §9). 통과하면 canonicalize된 경로를 돌려준다.
/// 거부: 디렉터리 아님, 루트, 홈 자체·홈의 상위, 앱 설정 폴더와 겹침, 설정된 비밀 폴더와 겹침.
/// `secrets_base`는 쓸 수 있는 비밀 폴더(없으면 None — 그 검사만 건너뛴다).
pub fn validate_vault_candidate(
    candidate: &Path,
    home: &Path,
    secrets_base: Option<&Path>,
) -> CommandResult<PathBuf> {
    let canon = fs::canonicalize(candidate)
        .map_err(|_| CommandError::InvalidPath("폴더를 찾지 못했습니다.".to_string()))?;
    if !canon.is_dir() {
        return Err(CommandError::InvalidPath(
            "폴더만 볼트로 쓸 수 있습니다.".to_string(),
        ));
    }
    if canon.parent().is_none() {
        return Err(CommandError::InvalidPath(
            "루트 폴더는 볼트로 쓸 수 없습니다.".to_string(),
        ));
    }
    let home_canon = fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    if home_canon.starts_with(&canon) {
        return Err(CommandError::InvalidPath(
            "홈 폴더 전체나 그 상위는 볼트로 쓸 수 없습니다. 노트만 둔 하위 폴더를 고르세요."
                .to_string(),
        ));
    }
    let config_dir = app_config_dir_for_home(&home_canon);
    let config_canon = fs::canonicalize(&config_dir).unwrap_or(config_dir);
    if paths_overlap(&canon, &config_canon) {
        return Err(CommandError::InvalidPath(
            "앱 설정 폴더는 볼트로 쓸 수 없습니다.".to_string(),
        ));
    }
    if let Some(base) = secrets_base {
        let base_canon = fs::canonicalize(base).unwrap_or_else(|_| base.to_path_buf());
        if paths_overlap(&canon, &base_canon) {
            return Err(CommandError::InvalidPath(
                "비밀 폴더와 겹치는 폴더는 볼트로 쓸 수 없습니다.".to_string(),
            ));
        }
    }
    Ok(canon)
}

/// 홈 폴더 결정의 순수 부분: 환경변수 HOME이 비어 있지 않은 절대경로이면 그것, 아니면 OS 사용자 정보(`os_home`)가
/// 절대경로일 때 그것. 둘 다 아니면 None — 상대경로("." 포함)나 빈 값을 홈으로 쓰지 않는다
/// (검수 R1: HOME이 없으면 보호 영역이 현재 작업 폴더 기준으로 만들어지던 우회).
pub fn resolve_home(
    env_home: Option<&std::ffi::OsStr>,
    os_home: Option<PathBuf>,
) -> Option<PathBuf> {
    env_home
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| os_home.filter(|path| path.is_absolute()))
}

/// 실제 홈 폴더 공통 경계. 확인할 수 없으면 None이고, 호출자는 거부(fail-closed)한다.
/// DB 위치(`db::repository`)와 같은 `dirs::home_dir()`를 OS 조회로 쓴다.
pub fn home_dir() -> Option<PathBuf> {
    resolve_home(std::env::var_os("HOME").as_deref(), dirs::home_dir())
}

/// 홈을 확인하지 못했을 때 모든 보호 판정을 거부로 돌리는 공통 오류.
pub fn home_unavailable() -> CommandError {
    CommandError::InvalidPath("사용자 홈 폴더를 확인할 수 없어 처리할 수 없습니다.".to_string())
}

/// 현재 비밀 폴더 설정 상태(읽기 전용).
#[tauri::command]
pub fn get_secrets_folder_status(
    state: State<'_, SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> CommandResult<SecretsFolderStatus> {
    Ok(state.status(&vaults.snapshot()?))
}

/// 네이티브 폴더 선택 창을 Rust가 열고 결과를 검증·저장한다. 취소하면 None(상태 불변).
/// 경로 인자가 없다 — 폴더는 이 네이티브 선택 창으로만 정해진다.
#[tauri::command]
pub fn select_secrets_folder(
    app: AppHandle,
    state: State<'_, SecretsViewerState>,
    vaults: State<'_, RegisteredVaults>,
) -> CommandResult<Option<SecretsFolderStatus>> {
    let home = home_dir().ok_or_else(home_unavailable)?;
    let mut dialog = app.dialog().file().set_title("비밀 폴더 선택");
    let suggested = home.join(".secrets");
    dialog = dialog.set_directory(if suggested.is_dir() {
        suggested
    } else {
        home.clone()
    });
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let picked = picked
        .into_path()
        .map_err(|error| CommandError::DialogPathConversion(error.to_string()))?;
    let registered = vaults.snapshot()?;
    let canon = validate_candidate(&picked, &home, &registered)?;
    state.set_base_dir(canon)?;
    Ok(Some(state.status(&registered)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ticksidian-secfg-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn accepted(load: ConfigLoad) -> Option<SecretsConfig> {
        match load {
            ConfigLoad::Accepted(c) => Some(c),
            _ => None,
        }
    }

    #[test]
    fn missing_config_is_unconfigured() {
        let home = temp_dir("missing");
        assert_eq!(
            load_config(&config_path_for_home(&home), &home, &[]),
            ConfigLoad::Absent
        );
    }

    #[test]
    fn save_then_load_round_trip_keeps_600() {
        let home = temp_dir("roundtrip");
        let secrets = fs::canonicalize(&home).unwrap().join("s");
        fs::create_dir_all(&secrets).unwrap();
        let path = config_path_for_home(&home);
        let config = SecretsConfig {
            version: CONFIG_VERSION,
            base_dir: secrets.to_string_lossy().into_owned(),
            gemini_key_rel_path: "gemini/key.env".to_string(),
        };
        save_config(&path, &config).unwrap();
        assert_eq!(accepted(load_config(&path, &home, &[])), Some(config));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    /// 시작 시 설정 읽기가 선택(validate_candidate)과 같은 규칙으로 거부하는지 표로 확인한다.
    #[test]
    fn startup_load_rejects_what_selection_rejects() {
        let home = temp_dir("probe");
        let path = config_path_for_home(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let secrets = home.join("s");
        let file = home.join("f.txt");
        let link_to_root = home.join("link-root");
        fs::create_dir_all(&secrets).unwrap();
        fs::write(&file, "x").unwrap();
        std::os::unix::fs::symlink("/", &link_to_root).unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let write = |base: &str| {
            fs::write(&path, format!(r#"{{"version":1,"baseDir":"{base}"}}"#)).unwrap();
        };
        let rejected = |base: String| {
            write(&base);
            matches!(load_config(&path, &home, &[]), ConfigLoad::Rejected(_))
        };
        assert!(rejected("/".to_string())); // root
        assert!(rejected(s(&home))); // home
        assert!(rejected(s(home.parent().unwrap()))); // home-parent
        assert!(rejected(s(&link_to_root))); // symlink-root
        assert!(rejected(s(&file))); // file
        assert!(rejected("relative/dir".to_string())); // relative
        assert!(rejected(s(&app_config_dir_for_home(&home)))); // 앱 설정 폴더
        assert!(rejected(s(&secrets.join("gone")))); // 사라진 폴더
                                                     // 손상·다른 버전·잘못된 상대경로
        for text in [
            "not json".to_string(),
            "{}".to_string(),
            format!(r#"{{"version":2,"baseDir":"{}"}}"#, s(&secrets)),
            format!(
                r#"{{"version":1,"baseDir":"{}","geminiKeyRelPath":"../x"}}"#,
                s(&secrets)
            ),
        ] {
            fs::write(&path, text).unwrap();
            assert!(matches!(
                load_config(&path, &home, &[]),
                ConfigLoad::Rejected(_)
            ));
        }
        // 대조군: 안전한 폴더만 수용(canonical 경로로), 상대경로 필드가 없으면 기본값.
        write(&s(&secrets));
        let ok = accepted(load_config(&path, &home, &[])).unwrap();
        assert_eq!(ok.base_dir, s(&fs::canonicalize(&secrets).unwrap()));
        assert_eq!(ok.gemini_key_rel_path, DEFAULT_GEMINI_KEY_REL_PATH);
    }

    #[test]
    fn registered_vault_overlap_is_rechecked_on_every_access() {
        let home = temp_dir("vault-overlap");
        let path = config_path_for_home(&home);
        let secrets = home.join("secrets");
        let nested_vault = secrets.join("inner-vault");
        let other_vault = home.join("vault");
        fs::create_dir_all(&nested_vault).unwrap();
        fs::create_dir_all(&other_vault).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            format!(r#"{{"version":1,"baseDir":"{}"}}"#, secrets.display()),
        )
        .unwrap();
        // 시작 시에는 볼트가 아직 없어 수용한다.
        let state = crate::SecretsViewerState::new(path.clone());
        assert!(state.effective_base(&[]).is_ok());
        assert!(state.effective_base(&[other_vault]).is_ok());
        // 볼트가 등록된 뒤 비밀 폴더가 그 볼트를 포함하면 같은 함수가 다시 거부한다.
        assert!(state.effective_base(&[nested_vault.clone()]).is_err());
        let status = state.status(&[nested_vault]);
        assert!(!status.configured && status.path.is_none());
        assert!(status.reason.unwrap().contains("노트 볼트"));
    }

    #[test]
    fn rejected_startup_config_reports_reason_and_keeps_file() {
        let home = temp_dir("reason");
        let path = config_path_for_home(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let text = r#"{"version":1,"baseDir":"/"}"#;
        fs::write(&path, text).unwrap();
        let state = crate::SecretsViewerState::new(path.clone());
        let status = state.status(&[]);
        assert!(!status.configured);
        assert!(status.path.is_none());
        assert!(status
            .reason
            .unwrap()
            .contains("허용되지 않아 무시했습니다"));
        assert_eq!(fs::read_to_string(&path).unwrap(), text); // 파일은 지우거나 덮지 않는다
    }

    #[test]
    fn candidate_rejects_broad_and_missing_paths() {
        let home = temp_dir("candidate");
        let vault = home.join("vault");
        let secrets = home.join("secrets");
        let file = home.join("file.txt");
        fs::create_dir_all(&vault).unwrap();
        fs::create_dir_all(&secrets).unwrap();
        fs::write(&file, "x").unwrap();
        let vaults = vec![vault.clone()];

        assert!(validate_candidate(Path::new("/"), &home, &vaults).is_err());
        assert!(validate_candidate(&home, &home, &vaults).is_err());
        assert!(validate_candidate(home.parent().unwrap(), &home, &vaults).is_err());
        assert!(validate_candidate(&vault, &home, &vaults).is_err());
        assert!(validate_candidate(&home.join("missing"), &home, &vaults).is_err());
        assert!(validate_candidate(&file, &home, &vaults).is_err());
        let ok = validate_candidate(&secrets, &home, &vaults).unwrap();
        assert_eq!(ok, fs::canonicalize(&secrets).unwrap());
    }
    /// 볼트 등록 범위(설계 §9): 거부·허용 표. 홈은 임시 폴더로 만든 가짜 홈이다.
    #[test]
    fn vault_candidate_rejection_table() {
        let home = temp_dir("vault-scope");
        let home_c = fs::canonicalize(&home).unwrap();
        let config_dir = app_config_dir_for_home(&home_c);
        let secrets = home_c.join(".secrets");
        let docs = home_c.join("Documents").join("vault");
        let file = home_c.join("f.txt");
        for dir in [
            &config_dir,
            &secrets,
            &docs,
            &config_dir.join("sub"),
            &secrets.join("sub"),
        ] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(&file, "x").unwrap();
        let link_to_home = home_c.join("Documents").join("link-home");
        let link_to_secrets = home_c.join("Documents").join("link-secrets");
        let link_to_config = home_c.join("Documents").join("link-config");
        let link_to_root = home_c.join("Documents").join("link-root");
        std::os::unix::fs::symlink(&home_c, &link_to_home).unwrap();
        std::os::unix::fs::symlink(&secrets, &link_to_secrets).unwrap();
        std::os::unix::fs::symlink(&config_dir, &link_to_config).unwrap();
        std::os::unix::fs::symlink("/", &link_to_root).unwrap();
        let check = |p: &Path, s: Option<&Path>| validate_vault_candidate(p, &home, s);
        let sec = Some(secrets.as_path());

        // 거부: 루트·홈·홈 상위·앱 설정 폴더(같음/하위)·비밀 폴더(같음/하위)·파일·없는 경로.
        for (label, path) in [
            ("root", Path::new("/").to_path_buf()),
            ("home", home_c.clone()),
            ("home-parent", home_c.parent().unwrap().to_path_buf()),
            ("config", config_dir.clone()),
            ("config-child", config_dir.join("sub")),
            ("secrets", secrets.clone()),
            ("secrets-child", secrets.join("sub")),
            ("file", file.clone()),
            ("missing", docs.join("gone")),
            ("link-home", link_to_home.clone()),
            ("link-secrets", link_to_secrets.clone()),
            ("link-config", link_to_config.clone()),
            ("link-root", link_to_root.clone()),
        ] {
            assert!(check(&path, sec).is_err(), "{label} must be rejected");
        }
        // 비밀 폴더가 볼트 상위여도(=홈 하위 비밀 폴더를 포함하는 폴더) 거부된다.
        let outer = home_c.join("outer");
        let inner_secrets = outer.join("secrets");
        fs::create_dir_all(&inner_secrets).unwrap();
        assert!(check(&outer, Some(inner_secrets.as_path())).is_err());

        // 허용: 홈 하위 일반 폴더, 일반 폴더로 가는 링크, 비밀 폴더 미설정이면 비밀 폴더 검사 생략.
        assert_eq!(check(&docs, sec).unwrap(), docs);
        assert_eq!(check(&docs, None).unwrap(), docs);
        let link_to_docs = home_c.join("Documents").join("link-docs");
        std::os::unix::fs::symlink(&docs, &link_to_docs).unwrap();
        assert_eq!(check(&link_to_docs, sec).unwrap(), docs);
        // 비밀 폴더가 아직 없거나 사라졌으면(미설정 취급) 이름만 같은 일반 폴더 허용 여부를 해치지 않는다.
        assert!(check(&docs, Some(home_c.join("no-such-secrets").as_path())).is_ok());
    }

    /// 앱 설정 폴더가 아직 만들어지지 않았어도 홈 기준으로 겹침을 막는다.
    #[test]
    fn vault_candidate_rejects_missing_config_dir_overlap() {
        let home = temp_dir("vault-noconfig");
        let home_c = fs::canonicalize(&home).unwrap();
        assert!(!app_config_dir_for_home(&home_c).exists());
        assert!(validate_vault_candidate(&home_c, &home, None).is_err());
        let ok = home_c.join("notes");
        fs::create_dir_all(&ok).unwrap();
        assert!(validate_vault_candidate(&ok, &home, None).is_ok());
    }

    /// 비밀 폴더 선택 대칭: 등록 볼트 안쪽 후보 거부, 기존 거부(볼트 자체·상위)는 유지.
    #[test]
    fn secrets_candidate_rejects_inside_registered_vault() {
        let home = temp_dir("secrets-inside");
        let vault = home.join("vault");
        let inside = vault.join("private");
        let sibling = home.join("secrets");
        for dir in [&inside, &sibling] {
            fs::create_dir_all(dir).unwrap();
        }
        let vaults = vec![vault.clone()];
        assert!(validate_candidate(&inside, &home, &vaults).is_err());
        assert!(validate_candidate(&vault, &home, &vaults).is_err());
        assert!(validate_candidate(&home, &home, &vaults).is_err());
        assert!(validate_candidate(&sibling, &home, &vaults).is_ok());
        // 볼트가 없으면 안쪽 검사는 없다.
        assert!(validate_candidate(&inside, &home, &[]).is_ok());
    }

    #[test]
    fn paths_overlap_is_symmetric_prefix() {
        let a = Path::new("/a/b");
        assert!(paths_overlap(a, Path::new("/a/b")));
        assert!(paths_overlap(a, Path::new("/a")));
        assert!(paths_overlap(a, Path::new("/a/b/c")));
        assert!(!paths_overlap(a, Path::new("/a/bc")));
        assert!(!paths_overlap(a, Path::new("/x")));
    }
    /// 검수 R1: HOME이 없거나 비었거나 상대경로여도 상대 기준 홈을 만들지 않는다.
    #[test]
    fn resolve_home_never_returns_relative_or_empty() {
        use std::ffi::OsStr;
        let os = Some(PathBuf::from("/home/os-user"));
        let env = |s: &str| Some(PathBuf::from(s));
        let r = |e: Option<&str>, o: Option<PathBuf>| resolve_home(e.map(OsStr::new), o);
        assert_eq!(r(Some("/home/a"), os.clone()), env("/home/a")); // 정상
        assert_eq!(r(None, os.clone()), os); // 없음 → OS 조회
        assert_eq!(r(Some(""), os.clone()), os); // 빈 값 → OS 조회
        assert_eq!(r(Some("."), os.clone()), os); // 상대경로 → OS 조회
        assert_eq!(r(Some("rel/home"), os.clone()), os);
        assert_eq!(r(None, None), None); // 확인 불가
        assert_eq!(r(Some(""), None), None);
        assert_eq!(r(Some("."), None), None);
        assert_eq!(r(None, env("relative")), None); // OS 값도 상대경로면 버린다
    }

    /// 검수 R1 회귀: 홈이 주입된 절대경로이면 현재 작업 폴더와 무관하게 홈·앱 설정 폴더·비밀 폴더를 거부한다.
    #[test]
    fn vault_candidate_is_independent_of_cwd() {
        let home = temp_dir("vault-cwd");
        let home_c = fs::canonicalize(&home).unwrap();
        let config = app_config_dir_for_home(&home_c);
        let secrets = home_c.join("s");
        let ok = home_c.join("notes");
        for dir in [&config, &secrets, &ok] {
            fs::create_dir_all(dir).unwrap();
        }
        // 현재 작업 폴더는 시험이 바꾸지 않는다(프로세스 전역). 홈 밖(임시 폴더)이 cwd인 것과 같은 조건을 주입 홈으로 확인.
        assert!(validate_vault_candidate(&home_c, &home_c, Some(&secrets)).is_err());
        assert!(validate_vault_candidate(&config, &home_c, Some(&secrets)).is_err());
        assert!(validate_vault_candidate(&secrets, &home_c, Some(&secrets)).is_err());
        assert!(validate_vault_candidate(&ok, &home_c, Some(&secrets)).is_ok());
        // 상대 홈(".")이 주입되는 우회는 resolve_home이 만들지 않는다.
        assert!(resolve_home(Some(std::ffi::OsStr::new(".")), None).is_none());
    }
}
