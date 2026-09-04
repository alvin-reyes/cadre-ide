#[allow(dead_code)] // wired to Tauri commands with the reconciler (Plan 3)
mod cadre_state;
mod mcp;
mod pty;
mod secrets;
mod verify;
mod watcher;

use base64::{engine::general_purpose::STANDARD, Engine};

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    extension: Option<String>,
    is_hidden: bool,
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let resolved = if path.starts_with("~/") {
        let home = get_home_dir();
        path.replacen("~", &home, 1)
    } else if path == "~" {
        get_home_dir()
    } else {
        path.clone()
    };

    let skip_names: std::collections::HashSet<&str> = [
        "node_modules", ".git", "target", "dist", ".DS_Store",
        "__pycache__", ".next", ".cache",
    ].iter().copied().collect();

    let entries = std::fs::read_dir(&resolved)
        .map_err(|e| format!("Failed to read directory {}: {}", resolved, e))?;

    let mut files: Vec<FileEntry> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if skip_names.contains(name.as_str()) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // skip unreadable entries
        };
        let entry_path = entry.path();
        let extension = entry_path.extension().map(|e| e.to_string_lossy().to_string());
        let is_hidden = name.starts_with('.');
        files.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            extension,
            is_hidden,
        });
    }

    // Sort: directories first, then alphabetical (case-insensitive)
    files.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(files)
}

#[tauri::command]
fn check_command_exists(command: String) -> Result<String, String> {
    // Get home directory — try multiple methods for Finder-launched apps
    let home = get_home_dir();

    let search_dirs = [
        format!("{}/.local/bin", home),
        format!("{}/.cargo/bin", home),
        format!("{}/bin", home),
        format!("{}/.nvm/versions/node/*/bin", home),
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
    ];

    // Check each directory directly for the binary
    for dir in &search_dirs {
        if dir.contains('*') {
            if let Ok(entries) = glob::glob(&format!("{}/{}", dir, command)) {
                for entry in entries.flatten() {
                    if entry.exists() {
                        return Ok(entry.to_string_lossy().to_string());
                    }
                }
            }
        } else {
            let path = format!("{}/{}", dir, command);
            if std::path::Path::new(&path).exists() {
                return Ok(path);
            }
        }
    }

    // Fallback: use zsh login shell (macOS default) to resolve PATH
    for shell in &["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let shell_check = std::process::Command::new(shell)
            .args(["-lc", &format!("which {}", command)])
            .env("HOME", &home)
            .output();
        if let Ok(output) = shell_check {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(path);
                }
            }
        }
    }

    Err(format!("{} not found in {} or PATH", command, home))
}

fn get_home_dir() -> String {
    // 1. Try HOME env var
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() && std::path::Path::new(&home).exists() {
            return home;
        }
    }
    // 2. Try NSHomeDirectory via swift (macOS specific, works even from Finder)
    if let Ok(output) = std::process::Command::new("/usr/bin/swift")
        .args(["-e", "import Foundation; print(NSHomeDirectory())"])
        .output()
    {
        if output.status.success() {
            let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !home.is_empty() && std::path::Path::new(&home).exists() {
                return home;
            }
        }
    }
    // 3. Try dscl
    if let Ok(output) = std::process::Command::new("/usr/bin/dscl")
        .args([".", "-read", &format!("/Users/{}", whoami()), "NFSHomeDirectory"])
        .output()
    {
        if output.status.success() {
            let out = String::from_utf8_lossy(&output.stdout);
            if let Some(path) = out.split_whitespace().last() {
                if std::path::Path::new(path).exists() {
                    return path.to_string();
                }
            }
        }
    }
    // 4. Try echo ~
    if let Ok(output) = std::process::Command::new("/bin/sh")
        .args(["-c", "echo ~"])
        .output()
    {
        if output.status.success() {
            let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !home.is_empty() && home != "~" && std::path::Path::new(&home).exists() {
                return home;
            }
        }
    }
    "/Users/unknown".to_string()
}

fn whoami() -> String {
    std::process::Command::new("/usr/bin/whoami")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Advisory, non-blocking check: does the `claude` CLI appear to have a stored login?
/// Checks known credential file locations on disk only — never spawns a process,
/// never touches the network, never hangs.
/// Returns Ok(true) if a plausible non-empty credential file is found, Ok(false) otherwise.
/// All IO errors are swallowed and treated as "not found" so the app is never blocked.
#[tauri::command]
fn claude_auth_status() -> Result<bool, String> {
    let home = get_home_dir();

    // Candidate paths where the Claude CLI may store credentials
    let candidates = [
        // claude CLI credentials file (primary location used by recent claude-code)
        format!("{}/.claude/.credentials.json", home),
        // legacy / alternate: single-file config at ~/.claude.json
        format!("{}/.claude.json", home),
        // XDG-style config fallback
        format!("{}/.config/claude/credentials.json", home),
    ];

    for path in &candidates {
        let p = std::path::Path::new(path);
        if p.exists() {
            // Treat as "logged in" only if the file is non-empty (> a few bytes)
            match std::fs::metadata(p) {
                Ok(meta) if meta.len() > 4 => return Ok(true),
                _ => {}
            }
        }
    }

    Ok(false)
}

#[tauri::command]
fn check_claude_plugin(plugin_name: String) -> Result<bool, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = format!("{}/.claude/plugins/installed_plugins.json", home);
    let content = std::fs::read_to_string(&path)
        .map_err(|_| "No installed plugins file".to_string())?;
    Ok(content.contains(&plugin_name))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let expanded = if path.starts_with('~') {
        let home = get_home_dir();
        path.replacen("~", &home, 1)
    } else {
        path.clone()
    };
    // Ensure parent dir exists
    if let Some(parent) = std::path::Path::new(&expanded).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }
    std::fs::write(&expanded, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

#[tauri::command]
fn create_directory(path: String) -> Result<String, String> {
    let expanded = if path.starts_with('~') {
        let home = get_home_dir();
        path.replacen("~", &home, 1)
    } else {
        path.clone()
    };
    std::fs::create_dir_all(&expanded).map_err(|e| format!("Failed to create dir: {}", e))?;
    Ok(expanded)
}

#[tauri::command]
fn save_temp_image(base64_data: String, extension: String) -> Result<String, String> {
    use std::io::Write;

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = format!("{}/.cadre/images", home);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("paste-{}.{}", timestamp, extension);
    let path = format!("{}/{}", dir, filename);

    let bytes = base64_decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    let mut file = std::fs::File::create(&path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(path)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD
        .decode(cleaned)
        .map_err(|e| format!("Invalid base64: {}", e))
}

/// Cap on files the document viewer will load. base64 inflates by ~4/3 and the
/// whole string crosses the IPC boundary at once, so an unbounded read stalls
/// the webview with no feedback. A refusal the user can read beats a hang.
pub const MAX_VIEWER_BYTES: u64 = 64 * 1024 * 1024;

pub fn check_viewer_size(len: u64) -> Result<(), String> {
    if len > MAX_VIEWER_BYTES {
        return Err(format!(
            "File is too large to preview: {:.1} MB (limit {} MB)",
            len as f64 / 1_048_576.0,
            MAX_VIEWER_BYTES / 1_048_576
        ));
    }
    Ok(())
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let resolved = if path.starts_with("~/") {
        let home = get_home_dir();
        path.replacen("~", &home, 1)
    } else {
        path.clone()
    };
    // Check the size BEFORE reading, so an oversized file is never loaded at all.
    let meta = std::fs::metadata(&resolved)
        .map_err(|e| format!("Failed to stat {}: {}", resolved, e))?;
    check_viewer_size(meta.len())?;
    let bytes = std::fs::read(&resolved).map_err(|e| format!("Failed to read {}: {}", resolved, e))?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let resolved = if path.starts_with("~/") {
        let home = get_home_dir();
        path.replacen("~", &home, 1)
    } else {
        path.clone()
    };
    std::fs::read_to_string(&resolved).map_err(|e| format!("Failed to read {}: {}", resolved, e))
}

#[tauri::command]
fn list_md_files(dir: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    fn walk(dir: &std::path::Path, files: &mut Vec<String>, depth: u32) {
        if depth > 5 { return; }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
                    continue;
                }
                if path.is_dir() {
                    walk(&path, files, depth + 1);
                } else if name.ends_with(".md") {
                    files.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    walk(std::path::Path::new(&dir), &mut files, 0);
    files.sort();
    Ok(files)
}

// ---- Project-wide search & replace (VS Code-style "search all in folder") ----
// Literal matching only (no regex dep). Case-insensitivity is ASCII-fold on bytes,
// which preserves byte length and is UTF-8 safe (multibyte chars only match exactly).

#[derive(serde::Serialize)]
struct SearchMatch {
    line: u32,    // 1-based line number
    col: u32,     // 1-based column of the first match on the line
    count: u32,   // matches on this line
    preview: String,
}

#[derive(serde::Serialize)]
struct FileMatches {
    path: String,
    matches: Vec<SearchMatch>,
}

#[derive(serde::Serialize)]
struct ReplaceSummary {
    files_changed: u32,
    replacements: u32,
}

const SEARCH_SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", ".next", ".cache",
    "__pycache__", ".venv", "venv", "build", ".idea",
];
const SEARCH_MAX_DEPTH: u32 = 12;
const SEARCH_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // skip files > 2MB
const SEARCH_MAX_FILE_HITS: usize = 5000; // cap files returned

fn find_byte_indices(hay: &[u8], needle: &[u8], case_sensitive: bool) -> Vec<usize> {
    let mut idxs = Vec::new();
    if needle.is_empty() || needle.len() > hay.len() {
        return idxs;
    }
    let mut i = 0;
    while i + needle.len() <= hay.len() {
        let window = &hay[i..i + needle.len()];
        let hit = if case_sensitive {
            window == needle
        } else {
            window.iter().zip(needle).all(|(a, b)| a.eq_ignore_ascii_case(b))
        };
        if hit {
            idxs.push(i);
            i += needle.len();
        } else {
            i += 1;
        }
    }
    idxs
}

fn collect_search_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>, depth: u32) {
    if depth > SEARCH_MAX_DEPTH || out.len() >= SEARCH_MAX_FILE_HITS {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            if SEARCH_SKIP_DIRS.contains(&name.as_str()) || name == ".DS_Store" {
                continue;
            }
            collect_search_files(&path, out, depth + 1);
        } else if meta.len() <= SEARCH_MAX_FILE_BYTES && name != ".DS_Store" {
            out.push(path);
        }
    }
}

#[tauri::command]
fn search_in_files(
    root: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<FileMatches>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_search_files(std::path::Path::new(&root), &mut files, 0);

    let needle = query.as_bytes();
    let mut results: Vec<FileMatches> = Vec::new();
    for path in files {
        // read_to_string fails on non-UTF8 (binary) files → skipped, which is what we want.
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if find_byte_indices(content.as_bytes(), needle, case_sensitive).is_empty() {
            continue; // fast whole-file reject before per-line work
        }
        let mut matches = Vec::new();
        for (lineno, line) in content.lines().enumerate() {
            let idxs = find_byte_indices(line.as_bytes(), needle, case_sensitive);
            if idxs.is_empty() {
                continue;
            }
            let col = line[..idxs[0]].chars().count() as u32 + 1;
            let preview: String = if line.len() > 400 {
                line.chars().take(400).collect()
            } else {
                line.to_string()
            };
            matches.push(SearchMatch {
                line: lineno as u32 + 1,
                col,
                count: idxs.len() as u32,
                preview,
            });
        }
        if !matches.is_empty() {
            results.push(FileMatches {
                path: path.to_string_lossy().to_string(),
                matches,
            });
        }
    }
    results.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(results)
}

#[tauri::command]
fn replace_in_files(
    root: String,
    query: String,
    replacement: String,
    case_sensitive: bool,
) -> Result<ReplaceSummary, String> {
    if query.is_empty() {
        return Err("Search query is empty".into());
    }
    let mut files = Vec::new();
    collect_search_files(std::path::Path::new(&root), &mut files, 0);

    let needle = query.as_bytes();
    let mut files_changed = 0u32;
    let mut replacements = 0u32;
    for path in files {
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let idxs = find_byte_indices(content.as_bytes(), needle, case_sensitive);
        if idxs.is_empty() {
            continue;
        }
        // Rebuild the file, splicing replacement at each match boundary. Cuts land on
        // valid UTF-8 boundaries (match edges in valid content), so the result is valid.
        let hay = content.as_bytes();
        let mut out: Vec<u8> = Vec::with_capacity(content.len());
        let mut last = 0usize;
        for &i in &idxs {
            out.extend_from_slice(&hay[last..i]);
            out.extend_from_slice(replacement.as_bytes());
            last = i + needle.len();
        }
        out.extend_from_slice(&hay[last..]);
        let new_content = String::from_utf8_lossy(&out).into_owned();
        std::fs::write(&path, new_content)
            .map_err(|e| format!("Failed to write {}: {}", path.to_string_lossy(), e))?;
        files_changed += 1;
        replacements += idxs.len() as u32;
    }
    Ok(ReplaceSummary {
        files_changed,
        replacements,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::new())
        .manage(watcher::WatcherManager::new())
        .manage(cadre_state::CadreEngine::new())
        .invoke_handler(tauri::generate_handler![
            cadre_state::open_project,
            cadre_state::story_set_status,
            cadre_state::story_get_status,
            cadre_state::is_own_write,
            cadre_state::approve_plan,
            cadre_state::get_plan_approval,
            mcp::mcp_probe,
            pty::create_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::reattach_pty,
            pty::kill_pty,
            pty::get_pty_cwd,
            verify::run_verification,
            verify::run_git,
            verify::run_gh,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_has,
            secrets::secret_delete,
            watcher::watch_directory,
            watcher::unwatch_directory,
            check_command_exists,
            check_claude_plugin,
            claude_auth_status,
            create_directory,
            write_text_file,
            save_temp_image,
            read_file,
            read_file_base64,
            list_md_files,
            list_directory,
            search_in_files,
            replace_in_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod viewer_size_tests {
    use super::check_viewer_size;
    use super::MAX_VIEWER_BYTES;

    #[test]
    fn accepts_a_file_under_the_cap() {
        assert!(check_viewer_size(1024).is_ok());
        assert!(check_viewer_size(MAX_VIEWER_BYTES).is_ok());
    }

    #[test]
    fn rejects_a_file_over_the_cap() {
        let err = check_viewer_size(MAX_VIEWER_BYTES + 1).unwrap_err();
        // The message must name both numbers so the user knows how far over it is.
        assert!(err.contains("64"), "expected the cap in the message, got: {err}");
        assert!(err.to_lowercase().contains("too large"), "got: {err}");
    }
}
