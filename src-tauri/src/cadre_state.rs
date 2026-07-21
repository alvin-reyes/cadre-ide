use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// A story's lifecycle status. This is the authoritative state machine (§5).
/// Only the engine writes it — never an agent — which is what makes it
/// un-forgeable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Status {
    Draft,
    Approved,
    InProgress,
    InReview,
    Done,
    Failed,
    Blocked,
}

/// The persisted, authoritative state of a single story. Lives at
/// `.cadre/state/{epic}.{story}.json` (committed to the repo, §3.8) so the board
/// reconstructs on reload.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StoryState {
    pub epic: u32,
    pub story: u32,
    pub status: Status,
}

/// The engine-owned state store: the **sole writer** of everything under
/// `.cadre/state`, `.cadre/approvals`, and `.cadre/decisions`. Agents run in
/// worktrees with no write path here (§5/§6.3).
///
/// It also records the hash of each file it writes so the filesystem
/// watcher/reconciler can ignore cadre's own writes — "write-origin
/// suppression" (§5), which stops the engine's writes from echoing back as
/// spurious state transitions.
pub struct CadreState {
    root: PathBuf,
    own_writes: Mutex<HashMap<PathBuf, u64>>,
}

fn hash_str(s: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

impl CadreState {
    /// `root` is the project root; engine files live under `{root}/.cadre/`.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            own_writes: Mutex::new(HashMap::new()),
        }
    }

    /// `{root}/.cadre/state/{epic}.{story}.json`
    pub fn status_path(&self, epic: u32, story: u32) -> PathBuf {
        self.root
            .join(".cadre")
            .join("state")
            .join(format!("{}.{}.json", epic, story))
    }

    /// Write `content` to `path` atomically (temp file + rename) so a reader
    /// never observes a torn file, and record the write's origin.
    pub fn atomic_write(&self, path: &Path, content: &str) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
        }
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {}", tmp.display(), e))?;
        fs::rename(&tmp, path).map_err(|e| format!("rename to {}: {}", path.display(), e))?;
        self.own_writes
            .lock()
            .unwrap()
            .insert(path.to_path_buf(), hash_str(content));
        Ok(())
    }

    /// Write a story's authoritative `Status`.
    pub fn set_status(&self, epic: u32, story: u32, status: Status) -> Result<(), String> {
        let state = StoryState { epic, story, status };
        let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
        self.atomic_write(&self.status_path(epic, story), &json)
    }

    /// Read a story's status, or `None` if it has no state file yet.
    pub fn get_status(&self, epic: u32, story: u32) -> Result<Option<StoryState>, String> {
        let path = self.status_path(epic, story);
        match fs::read_to_string(&path) {
            Ok(s) => serde_json::from_str(&s).map(Some).map_err(|e| e.to_string()),
            Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// True if `content` at `path` matches what the engine last wrote there.
    /// The reconciler uses this to suppress the watcher event caused by cadre's
    /// own write, so it doesn't re-process it as an external change.
    pub fn is_own_write(&self, path: &Path, content: &str) -> bool {
        self.own_writes.lock().unwrap().get(path).copied() == Some(hash_str(content))
    }
}

/// Managed engine state: holds the `CadreState` for the currently-open project.
/// `None` until a project is opened.
pub struct CadreEngine {
    state: Mutex<Option<CadreState>>,
}

impl CadreEngine {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(None),
        }
    }
}

// --- Tauri commands ---

#[tauri::command]
pub fn open_project(engine: tauri::State<'_, CadreEngine>, root: String) -> Result<(), String> {
    *engine.state.lock().unwrap() = Some(CadreState::new(root));
    Ok(())
}

#[tauri::command]
pub fn story_set_status(
    engine: tauri::State<'_, CadreEngine>,
    epic: u32,
    story: u32,
    status: Status,
) -> Result<(), String> {
    let guard = engine.state.lock().unwrap();
    let state = guard.as_ref().ok_or("no project open")?;
    state.set_status(epic, story, status)
}

#[tauri::command]
pub fn story_get_status(
    engine: tauri::State<'_, CadreEngine>,
    epic: u32,
    story: u32,
) -> Result<Option<StoryState>, String> {
    let guard = engine.state.lock().unwrap();
    let state = guard.as_ref().ok_or("no project open")?;
    state.get_status(epic, story)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("cadre-test-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn status_path_layout() {
        let s = CadreState::new("/proj");
        assert_eq!(
            s.status_path(1, 2),
            PathBuf::from("/proj/.cadre/state/1.2.json")
        );
    }

    #[test]
    fn atomic_write_creates_content_and_no_temp() {
        let root = tmp_root("atomic");
        let s = CadreState::new(&root);
        let path = root.join(".cadre/state/1.1.json");
        s.atomic_write(&path, "hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
        // no leftover temp file
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(".tmp");
        assert!(!PathBuf::from(tmp).exists());
    }

    #[test]
    fn set_and_get_status_roundtrip() {
        let root = tmp_root("roundtrip");
        let s = CadreState::new(&root);
        s.set_status(2, 3, Status::InReview).unwrap();
        let got = s.get_status(2, 3).unwrap().unwrap();
        assert_eq!(
            got,
            StoryState {
                epic: 2,
                story: 3,
                status: Status::InReview
            }
        );
    }

    #[test]
    fn get_status_missing_returns_none() {
        let root = tmp_root("missing");
        let s = CadreState::new(&root);
        assert_eq!(s.get_status(9, 9).unwrap(), None);
    }

    #[test]
    fn status_overwrite_is_atomic_and_latest_wins() {
        let root = tmp_root("overwrite");
        let s = CadreState::new(&root);
        s.set_status(1, 1, Status::InProgress).unwrap();
        s.set_status(1, 1, Status::Done).unwrap();
        assert_eq!(s.get_status(1, 1).unwrap().unwrap().status, Status::Done);
    }

    #[test]
    fn is_own_write_true_for_engine_write() {
        let root = tmp_root("own");
        let s = CadreState::new(&root);
        let path = root.join(".cadre/state/1.1.json");
        s.atomic_write(&path, "engine-content").unwrap();
        assert!(s.is_own_write(&path, "engine-content"));
    }

    #[test]
    fn is_own_write_false_for_foreign_content() {
        let root = tmp_root("foreign");
        let s = CadreState::new(&root);
        let path = root.join(".cadre/state/1.1.json");
        s.atomic_write(&path, "engine-content").unwrap();
        // an external editor changed the file → not our write
        assert!(!s.is_own_write(&path, "someone-else-changed-it"));
        // and an untouched, unknown path is likewise not ours
        assert!(!s.is_own_write(Path::new("/unknown"), "engine-content"));
    }
}
