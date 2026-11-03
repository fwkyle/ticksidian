use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::State;

use crate::db;

use super::error::{CommandError, CommandResult};
use crate::db::{VaultBinding, VaultSyncState};

// ---------------------------------------------------------------------------
// DB Mutex 잠금 헬퍼
// ---------------------------------------------------------------------------

fn lock_db<'a>(
    state: &'a State<'a, Mutex<Connection>>,
) -> CommandResult<MutexGuard<'a, Connection>> {
    state
        .lock()
        .map_err(|_| CommandError::DatabaseStatePoisoned)
}

// ---------------------------------------------------------------------------
// Sync 메타 명령어 (DB 전용 — 파일 IO 없음, vault 검증 불필요)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_sync_meta(
    note_id: String,
    db_state: State<'_, Mutex<Connection>>,
) -> CommandResult<Option<VaultSyncState>> {
    let conn = lock_db(&db_state)?;
    Ok(db::get_sync_state(&conn, &note_id)?)
}

#[tauri::command]
pub fn upsert_sync_meta(
    state: VaultSyncState,
    db_state: State<'_, Mutex<Connection>>,
) -> CommandResult<()> {
    let conn = lock_db(&db_state)?;
    db::upsert_sync_state(&conn, &state)?;
    Ok(())
}

#[tauri::command]
pub fn delete_sync_meta(
    note_id: String,
    db_state: State<'_, Mutex<Connection>>,
) -> CommandResult<()> {
    let conn = lock_db(&db_state)?;
    db::delete_sync_state(&conn, &note_id)?;
    Ok(())
}

#[tauri::command]
pub fn list_sync_meta_by_state(
    state: String,
    db_state: State<'_, Mutex<Connection>>,
) -> CommandResult<Vec<VaultSyncState>> {
    let conn = lock_db(&db_state)?;
    Ok(db::find_by_state(&conn, &state)?)
}

#[tauri::command]
pub fn get_vault_binding(
    local_vault_id: String,
    db_state: State<'_, Mutex<Connection>>,
) -> CommandResult<Option<VaultBinding>> {
    let conn = lock_db(&db_state)?;
    Ok(db::get_vault_binding(&conn, &local_vault_id)?)
}

#[tauri::command]
pub fn upsert_vault_binding(
    binding: VaultBinding,
    db_state: State<'_, Mutex<Connection>>,
) -> CommandResult<()> {
    let conn = lock_db(&db_state)?;
    db::upsert_vault_binding(&conn, &binding)?;
    Ok(())
}

#[tauri::command]
pub fn list_vault_bindings(
    db_state: State<'_, Mutex<Connection>>,
) -> CommandResult<Vec<VaultBinding>> {
    let conn = lock_db(&db_state)?;
    Ok(db::list_vault_bindings(&conn)?)
}
