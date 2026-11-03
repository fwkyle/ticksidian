use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_fs::FsExt;

use crate::RegisteredVaults;

use super::error::{CommandError, CommandResult};

// ---------------------------------------------------------------------------
// Vault 경계 검증 헬퍼
// ---------------------------------------------------------------------------

/// `path`가 등록된 vault 중 하나의 하위 경로인지 검증하고,
/// canonicalize된 `PathBuf`를 반환한다.
///
/// - vault가 하나도 등록되지 않은 경우 즉시 거부한다.
/// - 존재하는 경로는 `fs::canonicalize`로 심볼릭 링크를 해소한다.
/// - 존재하지 않는 경로(새 파일 쓰기 대상 등)는 가장 가까운 ancestor를
///   canonicalize한 뒤 나머지 세그먼트를 join하여 논리적 절대경로를 구성한다.
///   ancestor를 전혀 찾지 못하면 거부한다.
pub(crate) fn ensure_path_in_registered_vault(
    vaults: &State<'_, RegisteredVaults>,
    path: &Path,
) -> CommandResult<PathBuf> {
    let registered = vaults
        .0
        .lock()
        .map_err(|_| CommandError::InvalidPath("vault registry lock poisoned".to_owned()))?;
    ensure_path_in_vaults_inner(&registered, path)
}

/// `ensure_path_in_registered_vault`의 순수 로직.
/// Tauri State에 의존하지 않으므로 단위 테스트에서 직접 호출할 수 있다.
///
/// # 가드 순서
/// 1. 절대경로 여부 확인
/// 2. `..` / `.` component 거부 (prefix 비교 우회 방지)
/// 3. 등록된 vault 비어 있으면 즉시 거부
/// 4. canonicalize (존재하지 않는 경로는 ancestor 기준)
/// 5. 등록된 vault prefix 포함 여부 확인
pub(crate) fn ensure_path_in_vaults_inner(
    registered: &[PathBuf],
    path: &Path,
) -> CommandResult<PathBuf> {
    let protected = crate::commands::secrets_config::app_config_dir()
        .ok_or_else(crate::commands::secrets_config::home_unavailable)?;
    ensure_path_in_vaults_protecting(registered, path, &protected)
}

/// 앱 설정 폴더(`protected`) 아래는 볼트로 등록돼 있어도 일반 파일 명령이 읽거나 쓰지 못한다.
/// 비밀 폴더 설정 파일을 웹뷰가 일반 파일 쓰기로 바꾸는 경로를 닫는다.
pub(crate) fn ensure_path_in_vaults_protecting(
    registered: &[PathBuf],
    path: &Path,
    protected: &Path,
) -> CommandResult<PathBuf> {
    if !path.is_absolute() {
        return Err(CommandError::InvalidPath(format!(
            "expected an absolute path, got '{}'",
            path.display()
        )));
    }

    // `..` 또는 `.` component가 포함된 경로는 Path::starts_with의 리터럴 비교를 우회해
    // vault 경계 밖에 실제 파일을 쓸 수 있으므로 즉시 거부한다.
    for comp in path.components() {
        match comp {
            Component::ParentDir | Component::CurDir => {
                return Err(CommandError::VaultBoundaryViolation {
                    path: path.display().to_string(),
                });
            }
            _ => {}
        }
    }

    if registered.is_empty() {
        return Err(CommandError::VaultBoundaryViolation {
            path: path.to_string_lossy().into_owned(),
        });
    }

    // 경로가 실제로 존재하면 바로 canonicalize.
    // 존재하지 않으면 ancestor를 따라 올라가며 존재하는 최초 조상을 canonicalize한 뒤
    // 그 아래에 나머지 세그먼트를 join하여 논리적 절대경로를 구성한다.
    let canonical = if path.exists() {
        fs::canonicalize(path)?
    } else {
        // ancestors()는 path 자신부터 루트까지 순서대로 반환한다.
        // path 자신은 존재하지 않으므로 skip(1)부터 확인.
        let existing_ancestor = path
            .ancestors()
            .skip(1)
            .find(|a| a.exists())
            .ok_or_else(|| CommandError::VaultBoundaryViolation {
                path: path.to_string_lossy().into_owned(),
            })?;

        let canon_ancestor = fs::canonicalize(existing_ancestor)?;

        // existing_ancestor 이후의 나머지 세그먼트를 원본 path에서 추출한다.
        let relative_suffix = path.strip_prefix(existing_ancestor).map_err(|_| {
            CommandError::InvalidPath(format!(
                "failed to compute relative suffix for '{}'",
                path.display()
            ))
        })?;

        canon_ancestor.join(relative_suffix)
    };

    // 등록된 vault 중 하나의 prefix를 가지는지 확인.
    let is_inside = registered.iter().any(|vault| canonical.starts_with(vault));

    if !is_inside {
        return Err(CommandError::VaultBoundaryViolation {
            path: canonical.to_string_lossy().into_owned(),
        });
    }

    let protected_canon = fs::canonicalize(protected).unwrap_or_else(|_| protected.to_path_buf());
    if canonical.starts_with(&protected_canon) || canonical.starts_with(protected) {
        return Err(CommandError::VaultBoundaryViolation {
            path: canonical.to_string_lossy().into_owned(),
        });
    }

    Ok(canonical)
}

pub(crate) fn find_registered_vault_root(
    vaults: &State<'_, RegisteredVaults>,
    canonical_path: &Path,
) -> CommandResult<PathBuf> {
    let registered = vaults
        .0
        .lock()
        .map_err(|_| CommandError::InvalidPath("vault registry lock poisoned".to_owned()))?;

    find_vault_root_inner(&registered, canonical_path)
}

/// `find_registered_vault_root`의 순수 로직 (단위 테스트용).
///
/// 등록된 vault 중 `canonical_path`의 prefix가 되는 것들 중 **가장 긴** 경로를 반환한다.
/// 중첩 vault가 있을 때 더 구체적인(안쪽) vault를 선택하기 위해 component 수 기준으로 max를 쓴다.
pub(crate) fn find_vault_root_inner(
    registered: &[PathBuf],
    canonical_path: &Path,
) -> CommandResult<PathBuf> {
    registered
        .iter()
        .filter(|vault| canonical_path.starts_with(vault))
        .max_by_key(|vault| vault.components().count())
        .cloned()
        .ok_or_else(|| CommandError::VaultBoundaryViolation {
            path: canonical_path.to_string_lossy().into_owned(),
        })
}

pub(crate) fn build_trash_path(vault_root: &Path, source_path: &Path) -> CommandResult<PathBuf> {
    let relative_path =
        source_path
            .strip_prefix(vault_root)
            .map_err(|_| CommandError::VaultBoundaryViolation {
                path: source_path.to_string_lossy().into_owned(),
            })?;

    let candidate = vault_root
        .join(".trash")
        .join("ticksidian")
        .join(relative_path);

    Ok(next_available_path(candidate))
}

/// 원본을 `.trash/ticksidian/` 아래로 옮긴다. 목적지도 원본과 같은 경계(등록 볼트 안 + 앱 설정 폴더 거부)를
/// 통과해야 하며, 부모 폴더를 만들기 전과 만든 뒤 두 번 검사한다. `.trash`·`.trash/ticksidian`이
/// 볼트 밖을 가리키는 링크이면 canonicalize 결과가 밖이라 거부되고 원본은 그대로 남는다.
pub(crate) fn move_into_trash(
    registered: &[PathBuf],
    vault_root: &Path,
    source: &Path,
) -> CommandResult<()> {
    let protected = crate::commands::secrets_config::app_config_dir()
        .ok_or_else(crate::commands::secrets_config::home_unavailable)?;
    move_into_trash_protecting(registered, vault_root, source, &protected)
}

pub(crate) fn move_into_trash_protecting(
    registered: &[PathBuf],
    vault_root: &Path,
    source: &Path,
    protected: &Path,
) -> CommandResult<()> {
    let trash_path = build_trash_path(vault_root, source)?;
    ensure_path_in_vaults_protecting(registered, &trash_path, protected)?;
    if let Some(parent) = trash_path.parent() {
        fs::create_dir_all(parent)?;
    }
    // 만든 뒤 실제 해석 경로를 다시 확인한다(생성 중 바뀐 링크 포함).
    let checked = ensure_path_in_vaults_protecting(registered, &trash_path, protected)?;
    fs::rename(source, checked)?;
    Ok(())
}

pub(crate) fn next_available_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = path.extension().and_then(|value| value.to_str());

    let mut counter = 2;
    loop {
        let file_name = match extension {
            Some(ext) => format!("{stem}__{counter}.{ext}"),
            None => format!("{stem}__{counter}"),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

pub(crate) fn validate_markdown_path(raw_path: &str) -> CommandResult<PathBuf> {
    let path = PathBuf::from(raw_path);

    if !path.is_absolute() {
        return Err(CommandError::InvalidPath(format!(
            "expected an absolute markdown path, got '{raw_path}'"
        )));
    }

    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md"))
        != Some(true)
    {
        return Err(CommandError::InvalidPath(format!(
            "expected a .md file path, got '{raw_path}'"
        )));
    }

    Ok(path)
}

pub(crate) fn validate_directory_path(raw_path: &str) -> CommandResult<PathBuf> {
    let path = PathBuf::from(raw_path);

    if !path.is_absolute() {
        return Err(CommandError::InvalidPath(format!(
            "expected an absolute directory path, got '{raw_path}'"
        )));
    }

    let canonical = fs::canonicalize(&path)?;

    if !canonical.is_dir() {
        return Err(CommandError::InvalidPath(format!(
            "expected a directory path, got '{raw_path}'"
        )));
    }

    Ok(canonical)
}

pub(crate) fn ensure_fs_plugin(app: &AppHandle) -> CommandResult<()> {
    if app.try_fs_scope().is_none() {
        return Err(CommandError::FsScopeUnavailable);
    }

    Ok(())
}

pub(crate) fn validate_absolute_path(raw_path: &str) -> CommandResult<PathBuf> {
    let path = PathBuf::from(raw_path);

    if !path.is_absolute() {
        return Err(CommandError::InvalidPath(format!(
            "expected an absolute path, got '{raw_path}'"
        )));
    }

    Ok(path)
}

// ---------------------------------------------------------------------------
// 단위 테스트
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// 테스트 산출물 루트.
    ///
    /// kyle 안전 규칙(`kyle-destructive-ops-safety.md`)상 임시 파일/디렉터리도
    /// 즉시 삭제하지 않는다. repo의 `.codex-artifacts/`는 gitignore되어 있어
    /// 산출물을 그대로 남겨도 커밋되지 않는다. 테스트는 만든 산출물을
    /// 정리하지 않으며, 매 호출마다 unique suffix를 붙여 충돌을 피한다.
    fn qa_root() -> PathBuf {
        let manifest = env!("CARGO_MANIFEST_DIR"); // .../ticksidian/src-tauri
        let mut base = PathBuf::from(manifest);
        base.pop(); // .../ticksidian
        base.push(".codex-artifacts");
        base.push("qa-2026-04-28");
        base.push("rust-unit-vaults");
        fs::create_dir_all(&base).expect("create qa root");
        fs::canonicalize(base).expect("canon qa root")
    }

    /// 호출마다 유일한 이름 suffix를 만든다(pid + nanos + 호출 순서).
    /// 같은 process 안 병렬 테스트도 SEQ 카운터로 분리된다.
    fn unique_suffix(label: &str) -> String {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("{label}-{pid}-{nanos}-{seq}")
    }

    /// 테스트 1건당 격리된 unique vault 디렉터리를 만든다.
    /// cleanup하지 않으며, 다른 테스트와 디렉터리 이름이 겹치지 않는다.
    fn make_unit_vault(label: &str) -> PathBuf {
        let mut base = qa_root();
        base.push(unique_suffix(label));
        fs::create_dir_all(&base).expect("create unit vault");
        fs::canonicalize(base).expect("canon unit vault")
    }

    #[test]
    fn boundary_rejects_path_with_parent_dir_component() {
        let vault = make_unit_vault("a1");
        let registered = vec![vault.clone()];

        // /<vault>/notes/../../escape.md 같은 형태는 component 검사에서 즉시 거부되어야 한다.
        let mut probe = vault.clone();
        probe.push("notes");
        probe.push("..");
        probe.push("..");
        probe.push("escape.md");

        let result = ensure_path_in_vaults_inner(&registered, &probe);
        assert!(
            matches!(result, Err(CommandError::VaultBoundaryViolation { .. })),
            "expected VaultBoundaryViolation for path with `..`, got {result:?}"
        );
    }

    #[test]
    fn validate_absolute_path_rejects_dot_relative_string() {
        // `./notes/foo.md` 같은 상대 경로는 absolute 검증 단계에서 즉시 거부된다.
        // 이는 frontend가 invoke로 보낸 raw 문자열을 가장 먼저 막는 1차 방어선이다.
        let result = validate_absolute_path("./notes/foo.md");
        assert!(
            matches!(result, Err(CommandError::InvalidPath(_))),
            "expected InvalidPath for `./...` relative path, got {result:?}"
        );
        let result_md = validate_markdown_path("./notes/foo.md");
        assert!(
            matches!(result_md, Err(CommandError::InvalidPath(_))),
            "expected InvalidPath for markdown `./...` relative path, got {result_md:?}"
        );
    }

    #[test]
    fn boundary_rejects_path_outside_registered_vault() {
        let vault = make_unit_vault("a3-vault");
        let registered = vec![vault.clone()];

        // 외부 후보는 vault의 sibling 위치에 있는 *존재하지 않는* unique 파일 경로다.
        // 실제 파일을 만들지 않으므로 cleanup이 필요 없다. ancestor(qa_root)는 존재하므로
        // ensure_path_in_vaults_inner의 ancestor canonicalize 분기가 정상적으로 진입한다.
        let outside_path = qa_root().join(format!("{}.md", unique_suffix("outside-a3")));
        assert!(
            !outside_path.exists(),
            "precondition: outside path must not exist"
        );

        let result = ensure_path_in_vaults_inner(&registered, &outside_path);
        assert!(
            matches!(result, Err(CommandError::VaultBoundaryViolation { .. })),
            "expected VaultBoundaryViolation for outside path, got {result:?}"
        );
    }

    #[test]
    fn boundary_rejects_when_no_vault_registered() {
        let registered: Vec<PathBuf> = Vec::new();
        // 실제로 존재하지 않아도 되는 합성 절대경로. registered가 비어 있으면
        // ensure_path_in_vaults_inner는 canonicalize 전에 즉시 거부한다.
        let probe = PathBuf::from("/qa-synthetic/anywhere/foo.md");

        let result = ensure_path_in_vaults_inner(&registered, &probe);
        assert!(
            matches!(result, Err(CommandError::VaultBoundaryViolation { .. })),
            "empty registry must reject all paths, got {result:?}"
        );
    }

    #[test]
    fn boundary_accepts_existing_path_inside_vault() {
        let vault = make_unit_vault("a4");
        let registered = vec![vault.clone()];

        let mut inside = vault.clone();
        inside.push("notes");
        fs::create_dir_all(&inside).expect("mkdir notes");
        inside.push("foo.md");
        fs::write(&inside, b"hello").expect("write foo");

        let result = ensure_path_in_vaults_inner(&registered, &inside);
        assert!(result.is_ok(), "expected accepted, got {result:?}");
    }

    #[test]
    fn boundary_accepts_new_file_inside_vault_via_existing_ancestor() {
        let vault = make_unit_vault("a5");
        let registered = vec![vault.clone()];

        let mut notes_dir = vault.clone();
        notes_dir.push("notes");
        fs::create_dir_all(&notes_dir).expect("mkdir notes");

        // 아직 존재하지 않는 새 파일 경로 — ancestor(notes/)는 존재.
        // unique 이름을 써서 같은 vault 위치에 다른 회차의 잔여 파일과 충돌하지 않게 한다.
        let mut new_file = notes_dir.clone();
        new_file.push(format!("{}.md", unique_suffix("brand-new")));
        assert!(
            !new_file.exists(),
            "precondition: new file should not exist"
        );

        let result = ensure_path_in_vaults_inner(&registered, &new_file);
        assert!(
            result.is_ok(),
            "expected accepted for new file inside vault, got {result:?}"
        );
    }

    #[test]
    fn next_available_path_appends_counter_on_conflict() {
        // 매 호출마다 새 vault dir이라 dir 안은 항상 비어 있는 상태로 시작한다.
        // 따라서 occupied(note.md)를 직접 만들고 next_available_path가 __2 → __3
        // 순으로 deterministic하게 늘어나는지 확인할 수 있다.
        let dir = make_unit_vault("trash-counter");
        let mut occupied = dir.clone();
        occupied.push("note.md");
        fs::write(&occupied, b"first").expect("write occupied");

        let candidate = next_available_path(occupied.clone());
        let stem_with_counter = candidate.file_name().and_then(|n| n.to_str()).unwrap_or("");
        assert_eq!(
            stem_with_counter, "note__2.md",
            "first conflict should be note__2.md, got {stem_with_counter}"
        );

        // 두 번째 conflict — note__2.md도 만들고 다시 시도
        fs::write(&candidate, b"second").expect("write second");
        let candidate3 = next_available_path(occupied.clone());
        let stem3 = candidate3
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        assert_eq!(
            stem3, "note__3.md",
            "second conflict should be note__3.md, got {stem3}"
        );
    }

    #[test]
    fn build_trash_path_places_file_under_trash_ticksidian() {
        let vault = make_unit_vault("trash-build");
        let mut src = vault.clone();
        src.push("notes");
        src.push("a");
        src.push("b");
        fs::create_dir_all(&src).expect("mkdir src");
        src.push("foo.md");
        fs::write(&src, b"content").expect("write src");

        let trash = build_trash_path(&vault, &src).expect("build trash");
        let rel = trash
            .strip_prefix(&vault)
            .expect("trash inside vault")
            .to_string_lossy()
            .into_owned();
        assert!(
            rel.starts_with(".trash/ticksidian/notes/a/b/"),
            "trash path must live under .trash/ticksidian/, got {rel}"
        );
        assert!(
            rel.ends_with("foo.md"),
            "trash path must keep file name, got {rel}"
        );
    }

    #[test]
    fn find_vault_root_inner_picks_longest_match() {
        // find_vault_root_inner는 PathBuf 비교만 하므로 IO가 없다.
        // 실제로 존재하지 않아도 되는 합성 절대경로를 쓴다.
        let outer = PathBuf::from("/qa-synthetic/vault-outer");
        let inner = PathBuf::from("/qa-synthetic/vault-outer/inner-vault");
        let registered = vec![outer.clone(), inner.clone()];

        let probe = PathBuf::from("/qa-synthetic/vault-outer/inner-vault/notes/foo.md");
        let root = find_vault_root_inner(&registered, &probe).expect("must match");
        assert_eq!(root, inner, "should pick the longer/inner vault root");
    }

    #[test]
    fn validate_markdown_path_rejects_non_md_extension() {
        let result = validate_markdown_path("/qa-synthetic/foo.txt");
        assert!(
            matches!(result, Err(CommandError::InvalidPath(_))),
            "non-md extension must be rejected"
        );
    }

    #[test]
    fn validate_markdown_path_rejects_relative_path() {
        let result = validate_markdown_path("notes/foo.md");
        assert!(
            matches!(result, Err(CommandError::InvalidPath(_))),
            "relative path must be rejected"
        );
    }

    #[test]
    fn validate_absolute_path_rejects_relative() {
        let result = validate_absolute_path("notes/foo.md");
        assert!(matches!(result, Err(CommandError::InvalidPath(_))));
    }

    #[test]
    fn app_config_dir_is_rejected_even_inside_a_registered_vault() {
        let home_vault = make_unit_vault("cfg-home");
        let config_dir = home_vault.join(".ticksidian-desktop");
        fs::create_dir_all(&config_dir).unwrap();
        let registered = vec![home_vault.clone()];
        let config_file = config_dir.join("secrets-config.json");
        // 보호 폴더 아래는 거부(없는 파일 쓰기 대상 포함), 같은 볼트의 다른 경로는 허용.
        assert!(ensure_path_in_vaults_protecting(&registered, &config_file, &config_dir).is_err());
        assert!(ensure_path_in_vaults_protecting(&registered, &config_dir, &config_dir).is_err());
        assert!(ensure_path_in_vaults_protecting(
            &registered,
            &home_vault.join("n.md"),
            &config_dir
        )
        .is_ok());
    }

    /// 휴지통 이동 시험용: 볼트 안 파일 하나와 보호할 앱 설정 폴더(볼트 안, 비어 있음)를 만든다.
    fn trash_fixture(label: &str) -> (PathBuf, PathBuf, PathBuf) {
        let vault = make_unit_vault(label);
        let protected = vault.join("home").join(".ticksidian-desktop");
        fs::create_dir_all(&protected).unwrap();
        let source = vault.join("note.md");
        fs::write(&source, "n").unwrap();
        (vault, protected, source)
    }

    #[test]
    fn trash_move_keeps_normal_behavior() {
        let (vault, protected, source) = trash_fixture("trash-ok");
        let registered = vec![vault.clone()];
        move_into_trash_protecting(&registered, &vault, &source, &protected).unwrap();
        assert!(!source.exists());
        assert!(vault.join(".trash/ticksidian/note.md").is_file());
    }

    #[test]
    fn trash_rejects_trash_link_pointing_outside_vault() {
        let (vault, protected, source) = trash_fixture("trash-out");
        let outside = make_unit_vault("trash-out-target");
        std::os::unix::fs::symlink(&outside, vault.join(".trash")).unwrap();
        let registered = vec![vault.clone()];
        let result = move_into_trash_protecting(&registered, &vault, &source, &protected);
        assert!(result.is_err());
        assert!(source.is_file(), "원본은 그대로");
        assert!(
            !outside.join("ticksidian").exists(),
            "볼트 밖에 폴더를 만들지 않음"
        );
    }

    #[test]
    fn trash_rejects_links_into_app_config_dir() {
        // .trash 링크, .trash/ticksidian 링크 모두 앱 설정 폴더로 향하면 거부(설정 파일이 아직 없는 첫 사용 상태).
        for (label, link_inner) in [("trash-cfg-a", false), ("trash-cfg-b", true)] {
            let (vault, protected, source) = trash_fixture(label);
            if link_inner {
                fs::create_dir_all(vault.join(".trash")).unwrap();
                std::os::unix::fs::symlink(&protected, vault.join(".trash/ticksidian")).unwrap();
            } else {
                std::os::unix::fs::symlink(&protected, vault.join(".trash")).unwrap();
            }
            let registered = vec![vault.clone()];
            let result = move_into_trash_protecting(&registered, &vault, &source, &protected);
            assert!(result.is_err(), "{label}");
            assert!(source.is_file(), "{label}: 원본은 그대로");
            let created = fs::read_dir(&protected).unwrap().count();
            assert_eq!(created, 0, "{label}: 설정 폴더에 아무것도 만들지 않음");
        }
    }

    #[test]
    fn trash_directory_move_is_guarded_the_same_way() {
        let (vault, protected, _) = trash_fixture("trash-dir");
        let dir = vault.join("folder");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.md"), "a").unwrap();
        let registered = vec![vault.clone()];
        std::os::unix::fs::symlink(&protected, vault.join(".trash")).unwrap();
        assert!(move_into_trash_protecting(&registered, &vault, &dir, &protected).is_err());
        assert!(dir.join("a.md").is_file());
    }

    #[test]
    fn trash_rejects_dangling_trash_link_without_creating_outside() {
        let (vault, protected, source) = trash_fixture("trash-dangling");
        let missing = vault
            .join("home")
            .join("not-yet")
            .join(".ticksidian-desktop");
        std::os::unix::fs::symlink(&missing, vault.join(".trash")).unwrap();
        let registered = vec![vault.clone()];
        let result = move_into_trash_protecting(&registered, &vault, &source, &protected);
        assert!(result.is_err());
        assert!(source.is_file());
        assert!(!missing.exists());
    }
}
