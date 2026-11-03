use std::path::{Path, PathBuf};

pub fn sanitize_filename(name: &str) -> String {
    let replaced: String = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            control if control.is_control() => '-',
            value => value,
        })
        .collect();

    replaced
        .trim_matches(|character: char| character.is_whitespace() || character == '.')
        .to_string()
}

pub fn map_note_to_filepath(
    vault_root: impl AsRef<Path>,
    note_id: &str,
    title: &str,
    folder: Option<&str>,
) -> String {
    let mut path = PathBuf::from(vault_root.as_ref());

    if let Some(folder_path) = folder {
        for segment in folder_path.split(['/', '\\']) {
            let sanitized_segment = sanitize_filename(segment);
            if !sanitized_segment.is_empty() {
                path.push(sanitized_segment);
            }
        }
    }

    let sanitized_title = sanitize_filename(title);
    let file_stem = if sanitized_title.is_empty() {
        format!("untitled-{}", note_id_suffix(note_id))
    } else {
        sanitized_title
    };

    let primary_candidate = path.join(format!("{file_stem}.md"));
    let resolved = if primary_candidate.exists() {
        path.join(format!("{} ({}).md", file_stem, note_id_suffix(note_id)))
    } else {
        primary_candidate
    };

    resolved.to_string_lossy().into_owned()
}

fn note_id_suffix(note_id: &str) -> String {
    let compact: String = note_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect();

    if compact.is_empty() {
        sanitize_filename(note_id)
    } else {
        compact
    }
}
