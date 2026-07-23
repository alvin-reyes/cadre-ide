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

/// The PLAN gate approval (§6.1/§6.3). Written *only* by the engine at human
/// approval, into `.cadre/approvals/plan.json` (outside every agent worktree, so
/// agents cannot forge it). Freezes the human-confirmed **verification command(s)**
/// so the QA gate re-reads them from disk — an agent can never set or alter what
/// it will be judged against.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PlanApproval {
    pub approved: bool,
    /// verification steps to run at the QA gate (project command + pack checks)
    pub verification: Vec<String>,
}

/// Legal next statuses per §5 (mirrors `src/lib/engine/transitions.ts`). Enforced
/// by the sole writer (`set_status`) so illegal edges — e.g. Draft → Done — are
/// impossible, not merely discouraged.
fn legal_next(from: Status) -> &'static [Status] {
    use Status::*;
    match from {
        Draft => &[Approved, Blocked],
        Approved => &[InProgress, Blocked],
        InProgress => &[InReview, Failed, Blocked],
        InReview => &[Done, Failed, Blocked],
        Failed => &[InProgress, Blocked],
        Blocked => &[Approved, InProgress],
        Done => &[Approved, Blocked], // re-open (scope change); Blocked if it can't merge back
    }
}

pub fn can_transition(from: Status, to: Status) -> bool {
    // A same-status write is an idempotent no-op (e.g. resuming an already
    // InProgress story re-dispatches it), never an illegal jump.
    from == to || legal_next(from).contains(&to)
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

    /// Write a story's authoritative `Status`, enforcing legal transitions (§5).
    /// The first write for a story (no current status) is always allowed; after
    /// that, only legal edges are accepted.
    pub fn set_status(&self, epic: u32, story: u32, status: Status) -> Result<(), String> {
        if let Some(current) = self.get_status(epic, story)? {
            if !can_transition(current.status, status) {
                return Err(format!(
                    "illegal status transition: {:?} -> {:?}",
                    current.status, status
                ));
            }
        }
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

    fn plan_path(&self) -> PathBuf {
        self.root.join(".cadre").join("approvals").join("plan.json")
    }

    /// Approve the PLAN gate, freezing the human-confirmed verification steps.
    pub fn approve_plan(&self, verification: Vec<String>) -> Result<(), String> {
        let approval = PlanApproval {
            approved: true,
            verification,
        };
        let json = serde_json::to_string_pretty(&approval).map_err(|e| e.to_string())?;
        self.atomic_write(&self.plan_path(), &json)
    }

    /// Read the PLAN approval, or `None` if the plan hasn't been approved yet.
    pub fn get_plan_approval(&self) -> Result<Option<PlanApproval>, String> {
        match fs::read_to_string(self.plan_path()) {
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

/// Managed engine state: one `CadreState` per open project root, so multiple
/// projects are live at once. Empty until the first project is opened.
pub struct CadreEngine {
    states: Mutex<HashMap<PathBuf, CadreState>>,
}

impl CadreEngine {
    pub fn new() -> Self {
        Self { states: Mutex::new(HashMap::new()) }
    }
}

// --- Tauri commands ---

#[tauri::command]
pub fn open_project(engine: tauri::State<'_, CadreEngine>, root: String) -> Result<(), String> {
    let key = PathBuf::from(&root);
    engine.states.lock().unwrap().insert(key, CadreState::new(root));
    Ok(())
}

#[tauri::command]
pub fn story_set_status(
    engine: tauri::State<'_, CadreEngine>,
    root: String,
    epic: u32,
    story: u32,
    status: Status,
) -> Result<(), String> {
    let guard = engine.states.lock().unwrap();
    let state = guard.get(&PathBuf::from(&root)).ok_or("project not open")?;
    state.set_status(epic, story, status)
}

#[tauri::command]
pub fn story_get_status(
    engine: tauri::State<'_, CadreEngine>,
    root: String,
    epic: u32,
    story: u32,
) -> Result<Option<StoryState>, String> {
    let guard = engine.states.lock().unwrap();
    let state = guard.get(&PathBuf::from(&root)).ok_or("project not open")?;
    state.get_status(epic, story)
}

/// Write-origin suppression bridge (§5): true if `content` at `path` matches
/// what the engine last wrote there. The reconciler consults this to drop the
/// watcher event caused by cadre's own write, so the watcher only surfaces
/// genuine *external* changes. Returns false if no project is open.
#[tauri::command]
pub fn is_own_write(
    engine: tauri::State<'_, CadreEngine>,
    root: String,
    path: String,
    content: String,
) -> Result<bool, String> {
    let guard = engine.states.lock().unwrap();
    let state = guard.get(&PathBuf::from(&root)).ok_or("project not open")?;
    Ok(state.is_own_write(std::path::Path::new(&path), &content))
}

#[tauri::command]
pub fn approve_plan(
    engine: tauri::State<'_, CadreEngine>,
    root: String,
    verification: Vec<String>,
) -> Result<(), String> {
    let guard = engine.states.lock().unwrap();
    let state = guard.get(&PathBuf::from(&root)).ok_or("project not open")?;
    state.approve_plan(verification)
}

#[tauri::command]
pub fn get_plan_approval(
    engine: tauri::State<'_, CadreEngine>,
    root: String,
) -> Result<Option<PlanApproval>, String> {
    let guard = engine.states.lock().unwrap();
    let state = guard.get(&PathBuf::from(&root)).ok_or("project not open")?;
    state.get_plan_approval()
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
    fn status_advances_through_legal_edges_latest_wins() {
        let root = tmp_root("overwrite");
        let s = CadreState::new(&root);
        s.set_status(1, 1, Status::InProgress).unwrap();
        s.set_status(1, 1, Status::InReview).unwrap();
        s.set_status(1, 1, Status::Done).unwrap();
        assert_eq!(s.get_status(1, 1).unwrap().unwrap().status, Status::Done);
    }

    #[test]
    fn set_status_rejects_an_illegal_transition() {
        let root = tmp_root("illegal");
        let s = CadreState::new(&root);
        s.set_status(1, 1, Status::InProgress).unwrap();
        // InProgress -> Done must go through InReview
        let err = s.set_status(1, 1, Status::Done).unwrap_err();
        assert!(err.contains("illegal status transition"));
        // and the stored status is unchanged
        assert_eq!(s.get_status(1, 1).unwrap().unwrap().status, Status::InProgress);
    }

    #[test]
    fn can_transition_matches_the_state_machine() {
        assert!(can_transition(Status::Draft, Status::Approved));
        assert!(!can_transition(Status::Draft, Status::Done));
        assert!(can_transition(Status::InReview, Status::Done));
        assert!(can_transition(Status::Done, Status::Approved)); // re-open
        assert!(!can_transition(Status::Done, Status::InProgress));
    }

    #[test]
    fn plan_approval_freezes_the_verification_command() {
        let root = tmp_root("plan");
        let s = CadreState::new(&root);
        assert_eq!(s.get_plan_approval().unwrap(), None); // not approved yet
        s.approve_plan(vec!["pnpm test".into(), "slither .".into()])
            .unwrap();
        let approval = s.get_plan_approval().unwrap().unwrap();
        assert!(approval.approved);
        assert_eq!(approval.verification, vec!["pnpm test", "slither ."]);
    }

    #[test]
    fn plan_approval_lives_outside_worktrees() {
        // approvals path is under .cadre/approvals, not in any story worktree,
        // so an agent (running in .cadre/worktrees/...) has no write path to it.
        let s = CadreState::new("/proj");
        assert_eq!(s.plan_path(), PathBuf::from("/proj/.cadre/approvals/plan.json"));
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
