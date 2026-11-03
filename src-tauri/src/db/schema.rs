use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub const INITIAL_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS vault_sync_state (
    note_id            TEXT    NOT NULL PRIMARY KEY,
    server_revision    TEXT,
    server_updated_at  INTEGER,
    local_file_path    TEXT    NOT NULL,
    local_file_hash    TEXT,
    local_file_mtime   INTEGER,
    last_synced_at     INTEGER,
    sync_state         TEXT    NOT NULL DEFAULT 'idle'
                               CHECK (sync_state IN ('idle','syncing','synced','local_changed','conflicted','preserved_both','failed')),
    conflict_policy    TEXT    NOT NULL DEFAULT 'keep-both'
                               CHECK (conflict_policy IN ('keep-both','prefer-server','prefer-local')),
    conflict_copy_path TEXT,
    note_title         TEXT,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_state ON vault_sync_state(sync_state);
CREATE INDEX IF NOT EXISTS idx_local_path ON vault_sync_state(local_file_path);

CREATE TABLE IF NOT EXISTS sync_audit_log (
    id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    note_id    TEXT    NOT NULL REFERENCES vault_sync_state(note_id),
    action     TEXT    NOT NULL,
    detail     TEXT,
    timestamp  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_note_id ON sync_audit_log(note_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON sync_audit_log(timestamp);
"#;

pub const M3_VAULT_BINDING_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS vault_binding (
    local_vault_id          TEXT    NOT NULL PRIMARY KEY,
    local_vault_path        TEXT    NOT NULL,
    sync_mode               TEXT    NOT NULL DEFAULT 'local_only'
                                    CHECK (sync_mode IN ('local_only','sync_enabled')),
    account_id              TEXT,
    remote_vault_id         TEXT,
    auth_state              TEXT    NOT NULL DEFAULT 'signed_out'
                                    CHECK (auth_state IN ('signed_out','signed_in','reauth_required')),
    last_sync_cursor        TEXT,
    last_sync_summary_json  TEXT,
    todos_migration_done    INTEGER NOT NULL DEFAULT 0,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_binding_mode ON vault_binding(sync_mode);
CREATE INDEX IF NOT EXISTS idx_vault_binding_path ON vault_binding(local_vault_path);
"#;

/// v2 → v3: 기존 vault_binding 테이블에 todos_migration_done 컬럼 추가.
/// 신규 DB는 M3_VAULT_BINDING_SQL(CREATE TABLE)이 이미 컬럼을 가지므로,
/// ALTER를 실행하기 전 컬럼 존재 여부를 먼저 확인한다.
pub const V3_ALTER_VAULT_BINDING_SQL: &str =
    "ALTER TABLE vault_binding ADD COLUMN todos_migration_done INTEGER NOT NULL DEFAULT 0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultBinding {
    #[serde(alias = "localVaultId")]
    pub local_vault_id: String,
    #[serde(alias = "localVaultPath")]
    pub local_vault_path: String,
    #[serde(alias = "syncMode")]
    pub sync_mode: String,
    #[serde(alias = "accountId")]
    pub account_id: Option<String>,
    #[serde(alias = "remoteVaultId")]
    pub remote_vault_id: Option<String>,
    #[serde(alias = "authState")]
    pub auth_state: String,
    #[serde(alias = "lastSyncCursor")]
    pub last_sync_cursor: Option<String>,
    #[serde(alias = "lastSyncSummaryJson")]
    pub last_sync_summary_json: Option<String>,
    /// todos.json → .md 1회 마이그레이션 완료 여부. 1이면 완료, 0이면 미완료. 기본값 0.
    #[serde(alias = "todosMigrationDone", default)]
    pub todos_migration_done: i64,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
}

impl VaultBinding {
    pub fn local_only(
        local_vault_id: impl Into<String>,
        local_vault_path: impl Into<String>,
    ) -> Self {
        let now = current_timestamp_ms();

        Self {
            local_vault_id: local_vault_id.into(),
            local_vault_path: local_vault_path.into(),
            sync_mode: "local_only".to_string(),
            account_id: None,
            remote_vault_id: None,
            auth_state: "signed_out".to_string(),
            last_sync_cursor: None,
            last_sync_summary_json: None,
            todos_migration_done: 0,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultSyncState {
    #[serde(alias = "noteId")]
    pub note_id: String,
    #[serde(alias = "serverRevision")]
    pub server_revision: Option<String>,
    #[serde(alias = "serverUpdatedAt")]
    pub server_updated_at: Option<i64>,
    #[serde(alias = "localFilePath")]
    pub local_file_path: String,
    #[serde(alias = "localFileHash")]
    pub local_file_hash: Option<String>,
    #[serde(alias = "localFileMtime")]
    pub local_file_mtime: Option<i64>,
    #[serde(alias = "lastSyncedAt")]
    pub last_synced_at: Option<i64>,
    #[serde(alias = "syncState")]
    pub sync_state: String,
    #[serde(alias = "conflictPolicy")]
    pub conflict_policy: String,
    #[serde(alias = "conflictCopyPath")]
    pub conflict_copy_path: Option<String>,
    #[serde(alias = "noteTitle")]
    pub note_title: Option<String>,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    #[serde(alias = "updatedAt")]
    pub updated_at: i64,
}

impl VaultSyncState {
    pub fn new(note_id: impl Into<String>, local_file_path: impl Into<String>) -> Self {
        let now = current_timestamp_ms();

        Self {
            note_id: note_id.into(),
            server_revision: None,
            server_updated_at: None,
            local_file_path: local_file_path.into(),
            local_file_hash: None,
            local_file_mtime: None,
            last_synced_at: None,
            sync_state: "idle".to_string(),
            conflict_policy: "keep-both".to_string(),
            conflict_copy_path: None,
            note_title: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncAuditLog {
    pub id: i64,
    pub note_id: String,
    pub action: String,
    pub detail: Option<String>,
    pub timestamp: i64,
}

pub fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    // VaultSyncState — snake_case 직렬화 출력 보존
    #[test]
    fn vault_sync_state_serializes_snake_case() {
        let s = VaultSyncState::new("note-1", "/abs/path/note-1.md");
        let v = serde_json::to_value(&s).unwrap();
        assert!(v.get("note_id").is_some(), "expected snake_case note_id");
        assert!(
            v.get("local_file_path").is_some(),
            "expected snake_case local_file_path"
        );
        assert!(v.get("server_revision").is_some());
        assert!(v.get("sync_state").is_some());
        assert!(v.get("conflict_policy").is_some());
        assert!(v.get("created_at").is_some());
        assert!(v.get("updated_at").is_some());
        assert!(v.get("noteId").is_none(), "must not emit camelCase noteId");
        assert!(v.get("localFilePath").is_none());
    }

    // VaultBinding — snake_case 직렬화 출력 보존
    #[test]
    fn vault_binding_serializes_snake_case() {
        let b = VaultBinding::local_only("vault-1", "/abs/vault-1");
        let v = serde_json::to_value(&b).unwrap();
        assert!(v.get("local_vault_id").is_some());
        assert!(v.get("local_vault_path").is_some());
        assert!(v.get("sync_mode").is_some());
        assert!(v.get("auth_state").is_some());
        assert!(
            v.get("todos_migration_done").is_some(),
            "expected todos_migration_done field"
        );
        assert_eq!(
            v["todos_migration_done"],
            serde_json::json!(0),
            "default must be 0"
        );
        assert!(v.get("created_at").is_some());
        assert!(v.get("updated_at").is_some());
        assert!(
            v.get("localVaultId").is_none(),
            "must not emit camelCase localVaultId"
        );
        assert!(v.get("syncMode").is_none());
    }

    // VaultSyncState — snake_case 입력 역직렬화
    #[test]
    fn vault_sync_state_deserializes_from_snake_case() {
        let json = serde_json::json!({
            "note_id": "n1",
            "server_revision": null,
            "server_updated_at": null,
            "local_file_path": "/abs/n1.md",
            "local_file_hash": null,
            "local_file_mtime": null,
            "last_synced_at": null,
            "sync_state": "idle",
            "conflict_policy": "keep-both",
            "conflict_copy_path": null,
            "note_title": null,
            "created_at": 1,
            "updated_at": 2,
        });
        let s: VaultSyncState = serde_json::from_value(json).unwrap();
        assert_eq!(s.note_id, "n1");
        assert_eq!(s.local_file_path, "/abs/n1.md");
    }

    // VaultBinding — camelCase 입력도 받아야 한다 (이전 commands/types.rs 동작 유지)
    #[test]
    fn vault_binding_deserializes_from_camel_case_alias() {
        let json = serde_json::json!({
            "localVaultId": "vault-1",
            "localVaultPath": "/abs/v1",
            "syncMode": "local_only",
            "accountId": null,
            "remoteVaultId": null,
            "authState": "signed_out",
            "lastSyncCursor": null,
            "lastSyncSummaryJson": null,
            "createdAt": 1,
            "updatedAt": 2,
        });
        let b: VaultBinding = serde_json::from_value(json).unwrap();
        assert_eq!(b.local_vault_id, "vault-1");
        assert_eq!(b.local_vault_path, "/abs/v1");
        assert_eq!(b.sync_mode, "local_only");
    }
}
