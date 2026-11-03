use std::fmt;
use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::migration::run_migrations;
use crate::db::schema::{current_timestamp_ms, VaultBinding, VaultSyncState};

#[derive(Debug)]
pub enum DbError {
    Sqlite(rusqlite::Error),
    Io(std::io::Error),
    MissingHomeDirectory,
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(error) => write!(f, "sqlite error: {error}"),
            Self::Io(error) => write!(f, "io error: {error}"),
            Self::MissingHomeDirectory => write!(f, "unable to resolve the current home directory"),
        }
    }
}

impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl From<std::io::Error> for DbError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub type DbResult<T> = Result<T, DbError>;

pub fn get_database_path() -> DbResult<PathBuf> {
    let home_dir = dirs::home_dir().ok_or(DbError::MissingHomeDirectory)?;
    Ok(home_dir.join(".ticksidian-desktop").join("sync-meta.db"))
}

pub fn init_db() -> DbResult<Connection> {
    let database_path = get_database_path()?;

    if let Some(parent_dir) = database_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    let mut connection = Connection::open(database_path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    run_migrations(&mut connection)?;

    Ok(connection)
}

pub fn get_sync_state(conn: &Connection, note_id: &str) -> DbResult<Option<VaultSyncState>> {
    let state = conn
        .query_row(
            r#"
            SELECT
                note_id,
                server_revision,
                server_updated_at,
                local_file_path,
                local_file_hash,
                local_file_mtime,
                last_synced_at,
                sync_state,
                conflict_policy,
                conflict_copy_path,
                note_title,
                created_at,
                updated_at
            FROM vault_sync_state
            WHERE note_id = ?1
            "#,
            [note_id],
            map_sync_state_row,
        )
        .optional()?;

    Ok(state)
}

pub fn get_vault_binding(
    conn: &Connection,
    local_vault_id: &str,
) -> DbResult<Option<VaultBinding>> {
    let binding = conn
        .query_row(
            r#"
            SELECT
                local_vault_id,
                local_vault_path,
                sync_mode,
                account_id,
                remote_vault_id,
                auth_state,
                last_sync_cursor,
                last_sync_summary_json,
                todos_migration_done,
                created_at,
                updated_at
            FROM vault_binding
            WHERE local_vault_id = ?1
            "#,
            [local_vault_id],
            map_vault_binding_row,
        )
        .optional()?;

    Ok(binding)
}

pub fn upsert_vault_binding(conn: &Connection, binding: &VaultBinding) -> DbResult<()> {
    let now = current_timestamp_ms();
    let created_at = if binding.created_at > 0 {
        binding.created_at
    } else {
        now
    };
    let updated_at = if binding.updated_at > 0 {
        binding.updated_at
    } else {
        now
    };

    conn.execute(
        r#"
        INSERT INTO vault_binding (
            local_vault_id,
            local_vault_path,
            sync_mode,
            account_id,
            remote_vault_id,
            auth_state,
            last_sync_cursor,
            last_sync_summary_json,
            todos_migration_done,
            created_at,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(local_vault_id) DO UPDATE SET
            local_vault_path = excluded.local_vault_path,
            sync_mode = excluded.sync_mode,
            account_id = excluded.account_id,
            remote_vault_id = excluded.remote_vault_id,
            auth_state = excluded.auth_state,
            last_sync_cursor = excluded.last_sync_cursor,
            last_sync_summary_json = excluded.last_sync_summary_json,
            todos_migration_done = excluded.todos_migration_done,
            updated_at = excluded.updated_at
        "#,
        params![
            &binding.local_vault_id,
            &binding.local_vault_path,
            &binding.sync_mode,
            binding.account_id.as_deref(),
            binding.remote_vault_id.as_deref(),
            &binding.auth_state,
            binding.last_sync_cursor.as_deref(),
            binding.last_sync_summary_json.as_deref(),
            binding.todos_migration_done,
            created_at,
            updated_at,
        ],
    )?;

    Ok(())
}

pub fn list_vault_bindings(conn: &Connection) -> DbResult<Vec<VaultBinding>> {
    let mut statement = conn.prepare(
        r#"
        SELECT
            local_vault_id,
            local_vault_path,
            sync_mode,
            account_id,
            remote_vault_id,
            auth_state,
            last_sync_cursor,
            last_sync_summary_json,
            todos_migration_done,
            created_at,
            updated_at
        FROM vault_binding
        ORDER BY updated_at DESC
        "#,
    )?;

    let bindings = statement
        .query_map([], map_vault_binding_row)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(bindings)
}

pub fn upsert_sync_state(conn: &Connection, state: &VaultSyncState) -> DbResult<()> {
    let now = current_timestamp_ms();
    let created_at = if state.created_at > 0 {
        state.created_at
    } else {
        now
    };
    let updated_at = if state.updated_at > 0 {
        state.updated_at
    } else {
        now
    };

    conn.execute(
        r#"
        INSERT INTO vault_sync_state (
            note_id,
            server_revision,
            server_updated_at,
            local_file_path,
            local_file_hash,
            local_file_mtime,
            last_synced_at,
            sync_state,
            conflict_policy,
            conflict_copy_path,
            note_title,
            created_at,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(note_id) DO UPDATE SET
            server_revision = excluded.server_revision,
            server_updated_at = excluded.server_updated_at,
            local_file_path = excluded.local_file_path,
            local_file_hash = excluded.local_file_hash,
            local_file_mtime = excluded.local_file_mtime,
            last_synced_at = excluded.last_synced_at,
            sync_state = excluded.sync_state,
            conflict_policy = excluded.conflict_policy,
            conflict_copy_path = excluded.conflict_copy_path,
            note_title = excluded.note_title,
            updated_at = excluded.updated_at
        "#,
        params![
            &state.note_id,
            state.server_revision.as_deref(),
            state.server_updated_at,
            &state.local_file_path,
            state.local_file_hash.as_deref(),
            state.local_file_mtime,
            state.last_synced_at,
            &state.sync_state,
            &state.conflict_policy,
            state.conflict_copy_path.as_deref(),
            state.note_title.as_deref(),
            created_at,
            updated_at,
        ],
    )?;

    Ok(())
}

pub fn delete_sync_state(conn: &Connection, note_id: &str) -> DbResult<()> {
    conn.execute("DELETE FROM vault_sync_state WHERE note_id = ?1", [note_id])?;
    Ok(())
}

pub fn find_by_state(conn: &Connection, state: &str) -> DbResult<Vec<VaultSyncState>> {
    let mut statement = conn.prepare(
        r#"
        SELECT
            note_id,
            server_revision,
            server_updated_at,
            local_file_path,
            local_file_hash,
            local_file_mtime,
            last_synced_at,
            sync_state,
            conflict_policy,
            conflict_copy_path,
            note_title,
            created_at,
            updated_at
        FROM vault_sync_state
        WHERE sync_state = ?1
        ORDER BY updated_at DESC
        "#,
    )?;

    let states = statement
        .query_map([state], map_sync_state_row)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(states)
}

pub fn record_audit_log(
    conn: &Connection,
    note_id: &str,
    action: &str,
    detail: Option<&str>,
) -> DbResult<()> {
    conn.execute(
        r#"
        INSERT INTO sync_audit_log (note_id, action, detail, timestamp)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![note_id, action, detail, current_timestamp_ms()],
    )?;

    Ok(())
}

fn map_sync_state_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VaultSyncState> {
    Ok(VaultSyncState {
        note_id: row.get(0)?,
        server_revision: row.get(1)?,
        server_updated_at: row.get(2)?,
        local_file_path: row.get(3)?,
        local_file_hash: row.get(4)?,
        local_file_mtime: row.get(5)?,
        last_synced_at: row.get(6)?,
        sync_state: row.get(7)?,
        conflict_policy: row.get(8)?,
        conflict_copy_path: row.get(9)?,
        note_title: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn map_vault_binding_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VaultBinding> {
    Ok(VaultBinding {
        local_vault_id: row.get(0)?,
        local_vault_path: row.get(1)?,
        sync_mode: row.get(2)?,
        account_id: row.get(3)?,
        remote_vault_id: row.get(4)?,
        auth_state: row.get(5)?,
        last_sync_cursor: row.get(6)?,
        last_sync_summary_json: row.get(7)?,
        todos_migration_done: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory sqlite");
        run_migrations(&mut conn).expect("run migrations");
        conn
    }

    #[test]
    fn vault_binding_roundtrips_local_only_state() {
        let conn = in_memory_db();
        let binding = VaultBinding::local_only("vault-a", "/vaults/a");

        upsert_vault_binding(&conn, &binding).expect("upsert binding");
        let stored = get_vault_binding(&conn, "vault-a")
            .expect("get binding")
            .expect("binding exists");

        assert_eq!(stored.local_vault_id, "vault-a");
        assert_eq!(stored.local_vault_path, "/vaults/a");
        assert_eq!(stored.sync_mode, "local_only");
        assert_eq!(stored.auth_state, "signed_out");
        assert_eq!(stored.account_id, None);
        assert_eq!(stored.remote_vault_id, None);
    }

    #[test]
    fn vault_binding_updates_sync_mode_without_changing_created_at() {
        let conn = in_memory_db();
        let mut binding = VaultBinding::local_only("vault-a", "/vaults/a");
        binding.created_at = 100;
        binding.updated_at = 100;
        upsert_vault_binding(&conn, &binding).expect("insert binding");

        binding.sync_mode = "sync_enabled".to_string();
        binding.auth_state = "signed_in".to_string();
        binding.account_id = Some("account-1".to_string());
        binding.remote_vault_id = Some("remote-1".to_string());
        binding.updated_at = 200;
        upsert_vault_binding(&conn, &binding).expect("update binding");

        let stored = get_vault_binding(&conn, "vault-a")
            .expect("get binding")
            .expect("binding exists");

        assert_eq!(stored.created_at, 100);
        assert_eq!(stored.updated_at, 200);
        assert_eq!(stored.sync_mode, "sync_enabled");
        assert_eq!(stored.auth_state, "signed_in");
        assert_eq!(stored.account_id.as_deref(), Some("account-1"));
        assert_eq!(stored.remote_vault_id.as_deref(), Some("remote-1"));
    }

    // B-2 신규 테스트: todos_migration_done 기본값 / upsert roundtrip / snake_case 직렬화

    #[test]
    fn todos_migration_done_defaults_to_zero() {
        let binding = VaultBinding::local_only("vault-x", "/vaults/x");
        assert_eq!(
            binding.todos_migration_done, 0,
            "local_only() must default todos_migration_done to 0"
        );
    }

    #[test]
    fn todos_migration_done_upsert_roundtrip() {
        let conn = in_memory_db();
        let mut binding = VaultBinding::local_only("vault-m", "/vaults/m");
        upsert_vault_binding(&conn, &binding).expect("insert binding");

        binding.todos_migration_done = 1;
        binding.updated_at += 1;
        upsert_vault_binding(&conn, &binding).expect("update binding");

        let stored = get_vault_binding(&conn, "vault-m")
            .expect("get binding")
            .expect("binding exists");
        assert_eq!(
            stored.todos_migration_done, 1,
            "todos_migration_done=1 must persist after upsert"
        );
    }

    #[test]
    fn todos_migration_done_serializes_snake_case() {
        let binding = VaultBinding::local_only("vault-s", "/vaults/s");
        let v = serde_json::to_value(&binding).expect("serialize");
        assert!(
            v.get("todos_migration_done").is_some(),
            "expected snake_case todos_migration_done in serialized output"
        );
        assert!(
            v.get("todosMigrationDone").is_none(),
            "must not emit camelCase todosMigrationDone as primary key"
        );
        assert_eq!(
            v["todos_migration_done"],
            serde_json::json!(0),
            "default value must be 0"
        );
    }

    #[test]
    fn list_vault_bindings_orders_latest_first() {
        let conn = in_memory_db();
        let mut first = VaultBinding::local_only("vault-a", "/vaults/a");
        first.updated_at = 100;
        let mut second = VaultBinding::local_only("vault-b", "/vaults/b");
        second.updated_at = 200;

        upsert_vault_binding(&conn, &first).expect("insert first");
        upsert_vault_binding(&conn, &second).expect("insert second");

        let bindings = list_vault_bindings(&conn).expect("list bindings");
        let ids = bindings
            .iter()
            .map(|binding| binding.local_vault_id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["vault-b", "vault-a"]);
    }
}
