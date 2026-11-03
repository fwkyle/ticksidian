pub mod db_commands;
pub mod error;
pub mod file_commands;
pub(crate) mod fs_executor;
pub mod inbox_organizer;
pub mod note_move;
pub mod secrets_config;
pub mod secrets_viewer;
pub mod secure_storage;
pub mod types;
pub mod vault_commands;
pub mod vault_guard;

// ---------------------------------------------------------------------------
// 공개 re-export — lib.rs 의 `commands::<name>` 경로가 그대로 작동하도록
// ---------------------------------------------------------------------------

pub use db_commands::{
    delete_sync_meta, get_sync_meta, get_vault_binding, list_sync_meta_by_state,
    list_vault_bindings, upsert_sync_meta, upsert_vault_binding,
};

pub use file_commands::{
    check_file_exists, create_directory, create_markdown_file_if_absent, delete_file,
    get_file_stat, list_directory, list_directory_entries, read_markdown_file, read_text_file,
    write_markdown_file, write_text_file,
};

pub use vault_commands::{list_vault_notes, register_vault_path, select_vault_folder};

pub use error::{CommandError, CommandResult};
