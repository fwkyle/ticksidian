pub mod migration;
pub mod repository;
pub mod schema;

pub use migration::{run_migrations, CURRENT_USER_VERSION};
pub use repository::{
    delete_sync_state, find_by_state, get_database_path, get_sync_state, get_vault_binding,
    init_db, list_vault_bindings, record_audit_log, upsert_sync_state, upsert_vault_binding,
    DbError, DbResult,
};
pub use schema::{current_timestamp_ms, SyncAuditLog, VaultBinding, VaultSyncState};
