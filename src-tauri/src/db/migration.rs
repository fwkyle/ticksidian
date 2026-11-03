use rusqlite::Connection;

use crate::db::repository::DbResult;
use crate::db::schema::{INITIAL_SCHEMA_SQL, M3_VAULT_BINDING_SQL, V3_ALTER_VAULT_BINDING_SQL};

pub const CURRENT_USER_VERSION: i32 = 3;

pub fn run_migrations(conn: &mut Connection) -> DbResult<()> {
    let user_version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if user_version < 1 {
        let transaction = conn.transaction()?;
        transaction.execute_batch(INITIAL_SCHEMA_SQL)?;
        transaction.pragma_update(None, "user_version", 1)?;
        transaction.commit()?;
    }

    if user_version < 2 {
        let transaction = conn.transaction()?;
        // M3_VAULT_BINDING_SQL은 이미 todos_migration_done 컬럼을 포함하므로,
        // user_version < 2 경로(신규 DB 또는 v1→v2 업그레이드)에서 생성된 테이블은
        // todos_migration_done 컬럼을 이미 가진다. v3 step에서 ALTER를 건너뛴다.
        transaction.execute_batch(M3_VAULT_BINDING_SQL)?;
        transaction.pragma_update(None, "user_version", 2)?;
        transaction.commit()?;
    }

    if user_version < 3 {
        // user_version 2에서 온 경우: vault_binding이 이미 존재하지만 todos_migration_done이 없다.
        // user_version < 2 경로를 이미 거쳐 온 경우: 컬럼이 이미 있으므로 PRAGMA table_info로 확인 후 스킵.
        let has_column = column_exists(conn, "vault_binding", "todos_migration_done")?;
        if !has_column {
            let transaction = conn.transaction()?;
            transaction.execute_batch(V3_ALTER_VAULT_BINDING_SQL)?;
            transaction.pragma_update(None, "user_version", 3)?;
            transaction.commit()?;
        } else {
            // 컬럼은 있지만 user_version이 아직 2인 경우(신규 DB가 v2 CREATE→v3 step 도달)
            // user_version만 3으로 올린다.
            conn.pragma_update(None, "user_version", 3)?;
        }
    }

    Ok(())
}

/// PRAGMA table_info로 특정 테이블에 컬럼이 존재하는지 확인한다.
fn column_exists(conn: &Connection, table: &str, column: &str) -> DbResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .any(|r| r.map(|name| name == column).unwrap_or(false));
    Ok(exists)
}
