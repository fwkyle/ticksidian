pub mod commands;
pub mod db;
pub mod rag;
pub mod sync;
pub mod watch;

use std::path::PathBuf;
use std::sync::Mutex;

/// 런타임에 등록된 vault 절대경로 목록.
/// `register_vault_path` 호출 시 canonicalize된 경로가 누적되고,
/// 모든 file 명령은 대상 경로가 이 목록 중 하나의 하위 경로인지 검증한다.
pub struct RegisteredVaults(pub Mutex<Vec<PathBuf>>);

impl RegisteredVaults {
    /// 등록 볼트 목록 사본(비밀 폴더 충돌 재검사용).
    pub fn snapshot(&self) -> commands::error::CommandResult<Vec<PathBuf>> {
        self.0.lock().map(|guard| guard.clone()).map_err(|_| {
            commands::error::CommandError::InvalidPath("vault registry lock poisoned".to_owned())
        })
    }
}

/// 보안 메모 뷰어·Gemini 키 조회의 비밀 폴더 경계(볼트 밖).
/// 사용자가 고른 폴더를 Rust가 소유하고 웹뷰 밖 설정 파일에 영속한다
/// (2026-11-02 [kyle] 승인 — 개인 폴더 이름 고정을 설정으로 대체. 추가·편집 가능, 삭제·이름변경 없음).
/// 미설정(None)이면 뷰어·파일 키 조회는 비어 있다.
pub struct SecretsViewerState {
    config_path: PathBuf,
    config: Mutex<Option<commands::secrets_config::SecretsConfig>>,
    /// 시작 시 설정을 허용하지 않아 무시한 이유(다시 고르면 지운다).
    rejection: Mutex<Option<String>>,
}

impl SecretsViewerState {
    /// 설정 파일을 읽어 시작한다. 선택과 같은 검증(`validate_candidate`)을 거치며,
    /// 없음·손상·허용되지 않는 값은 미설정이다(허용되지 않은 이유는 `status`로 알린다).
    pub fn new(config_path: PathBuf) -> Self {
        use commands::secrets_config::{home_for_config_path, load_config, ConfigLoad};
        let home = home_for_config_path(&config_path);
        let (config, rejection) = match load_config(&config_path, &home, &[]) {
            ConfigLoad::Accepted(config) => (Some(config), None),
            ConfigLoad::Rejected(reason) => (None, Some(reason)),
            ConfigLoad::Absent => (None, None),
        };
        Self {
            config_path,
            config: Mutex::new(config),
            rejection: Mutex::new(rejection),
        }
    }

    fn current(&self) -> Option<commands::secrets_config::SecretsConfig> {
        self.config.lock().ok().and_then(|guard| guard.clone())
    }

    fn rejection(&self) -> Option<String> {
        self.rejection.lock().ok().and_then(|guard| guard.clone())
    }

    /// 비밀 폴더를 쓰는 모든 경로의 단일 관문: 설정된 폴더를 `validate_candidate`로 매번 다시 검사한다
    /// (등록 볼트와의 충돌, 폴더 사라짐, 심볼릭 링크 바뀜 포함). 통과하면 canonicalize된 경로를 돌려준다.
    pub fn effective_base(&self, vaults: &[PathBuf]) -> commands::error::CommandResult<PathBuf> {
        use commands::error::CommandError;
        let Some(config) = self.current() else {
            let message = match self.rejection() {
                Some(reason) => {
                    format!("설정된 폴더가 허용되지 않아 무시했습니다. 다시 고르세요. ({reason})")
                }
                None => "비밀 폴더가 설정되지 않았습니다. 폴더를 먼저 고르세요.".to_string(),
            };
            return Err(CommandError::InvalidPath(message));
        };
        let home = commands::secrets_config::home_for_config_path(&self.config_path);
        commands::secrets_config::validate_candidate(
            std::path::Path::new(&config.base_dir),
            &home,
            vaults,
        )
        .map_err(|err| {
            CommandError::InvalidPath(format!(
                "설정된 폴더가 허용되지 않아 무시했습니다. 다시 고르세요. ({err})"
            ))
        })
    }

    /// 화면용 상태. 허용되지 않는 설정은 미설정으로 보이고 이유를 함께 돌려준다.
    pub fn status(&self, vaults: &[PathBuf]) -> commands::secrets_config::SecretsFolderStatus {
        use commands::secrets_config::SecretsFolderStatus;
        match self.effective_base(vaults) {
            Ok(base) => SecretsFolderStatus {
                configured: true,
                path: Some(base.to_string_lossy().into_owned()),
                reason: None,
            },
            Err(err) => SecretsFolderStatus {
                configured: false,
                path: None,
                reason: (self.current().is_some() || self.rejection().is_some())
                    .then(|| err.to_string()),
            },
        }
    }

    /// 비밀 폴더 기준 Gemini 키 파일 상대경로.
    pub fn gemini_key_rel_path(&self) -> String {
        self.current()
            .map(|c| c.gemini_key_rel_path)
            .unwrap_or_else(|| commands::secrets_config::DEFAULT_GEMINI_KEY_REL_PATH.to_string())
    }

    /// 검증을 마친(canonicalize된) 폴더를 저장하고 메모리에 반영한다.
    /// 기존 Gemini 키 상대경로 설정은 유지한다.
    pub fn set_base_dir(&self, base_dir: PathBuf) -> commands::error::CommandResult<()> {
        let next = commands::secrets_config::SecretsConfig {
            version: 1,
            base_dir: base_dir.to_string_lossy().into_owned(),
            gemini_key_rel_path: self.gemini_key_rel_path(),
        };
        commands::secrets_config::save_config(&self.config_path, &next)?;
        if let Ok(mut guard) = self.config.lock() {
            *guard = Some(next);
        }
        if let Ok(mut guard) = self.rejection.lock() {
            *guard = None;
        }
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    rag::ensure_sqlite_vec_registered();
    let conn = db::init_db().expect("failed to initialize sync metadata database");
    // 홈을 확인할 수 없으면(DB 초기화가 먼저 실패하므로 사실상 도달하지 않음) 존재할 수 없는 절대 위치를 줘
    // 비밀 폴더는 미설정이 된다. 상대 폴백(".")은 쓰지 않는다. 볼트 등록·일반 파일 명령은 홈이 없으면 거부한다.
    let secrets_home = commands::secrets_config::home_dir()
        .unwrap_or_else(|| PathBuf::from("/nonexistent-ticksidian-home"));
    let secrets_config_path = commands::secrets_config::config_path_for_home(&secrets_home);

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(conn))
        .manage(RegisteredVaults(Mutex::new(Vec::new())))
        .manage(SecretsViewerState::new(secrets_config_path))
        .manage(watch::VaultWatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::file_commands::read_markdown_file,
            commands::file_commands::write_markdown_file,
            commands::file_commands::create_markdown_file_if_absent,
            commands::db_commands::get_sync_meta,
            commands::db_commands::upsert_sync_meta,
            commands::db_commands::delete_sync_meta,
            commands::db_commands::list_sync_meta_by_state,
            commands::db_commands::get_vault_binding,
            commands::db_commands::upsert_vault_binding,
            commands::db_commands::list_vault_bindings,
            commands::vault_commands::select_vault_folder,
            commands::vault_commands::register_vault_path,
            commands::vault_commands::list_vault_notes,
            commands::file_commands::read_text_file,
            commands::file_commands::read_binary_file,
            commands::file_commands::write_binary_file,
            commands::file_commands::write_text_file,
            commands::file_commands::list_directory,
            commands::file_commands::list_directory_entries,
            commands::file_commands::delete_file,
            commands::file_commands::rename_directory,
            commands::file_commands::trash_directory,
            commands::file_commands::get_file_stat,
            commands::file_commands::check_file_exists,
            commands::file_commands::create_directory,
            commands::secure_storage::secure_get_refresh_token,
            commands::secure_storage::secure_set_refresh_token,
            commands::secure_storage::secure_clear_refresh_token,
            commands::secrets_config::get_secrets_folder_status,
            commands::secrets_config::select_secrets_folder,
            commands::secrets_viewer::list_secret_files,
            commands::secrets_viewer::read_secret_file,
            commands::secrets_viewer::create_secret_file,
            commands::secrets_viewer::begin_secret_edit,
            commands::secrets_viewer::write_secret_file,
            commands::secrets_viewer::reveal_secret_in_finder,
            rag::commands::rag_index_status,
            rag::commands::rag_search,
            rag::commands::classify_review_item,
            commands::inbox_organizer::read_inbox_organizer_note,
            commands::inbox_organizer::move_inbox_organizer_note,
            commands::note_move::move_markdown_file,
            commands::note_move::rename_markdown_file,
            rag::inbox_folders::recommend_inbox_folder,
            watch::start_vault_watch,
            watch::stop_vault_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
