use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

pub struct PtyInstance {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    pid: Option<u32>,
}

/// Decide the argv for the PTY child. An explicit `command` runs as the PTY's
/// **direct child** (so process-exit is a clean completion signal — required for
/// `claude -p` fleet agents); otherwise fall back to an interactive login shell.
fn resolve_argv(command: Option<&str>, args: &[String], shell: &str) -> Vec<String> {
    match command {
        Some(cmd) if !cmd.is_empty() => {
            let mut v = vec![cmd.to_string()];
            v.extend(args.iter().cloned());
            v
        }
        _ => vec![shell.to_string(), "-l".to_string()],
    }
}

pub struct PtyManager {
    instances: Arc<Mutex<HashMap<u32, PtyInstance>>>,
    next_id: Arc<Mutex<u32>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum PtyEvent {
    #[serde(rename = "output")]
    Output { data: Vec<u8> },
    #[serde(rename = "exit")]
    Exit { code: Option<i32> },
    #[serde(rename = "error")]
    Error { message: String },
}

#[tauri::command]
pub fn create_pty(
    state: tauri::State<'_, PtyManager>,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    command: Option<String>,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
    on_event: Channel<PtyEvent>,
) -> Result<u32, String> {
    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {}", e))?;

    // Explicit command (e.g. `claude -p ...`) runs as the PTY's direct child;
    // otherwise fall back to the login shell.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let argv = resolve_argv(command.as_deref(), &args.unwrap_or_default(), &shell);
    let mut cmd = CommandBuilder::new(&argv[0]);
    for a in &argv[1..] {
        cmd.arg(a);
    }

    if let Some(dir) = cwd {
        cmd.cwd(dir);
    } else if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }

    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    if let Ok(user) = std::env::var("USER") {
        cmd.env("USER", user);
    }
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    if let Ok(lang) = std::env::var("LANG") {
        cmd.env("LANG", lang);
    }

    // Per-spawn env overrides (ModelRouter: ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN
    // / ANTHROPIC_MODEL, and any other agent-specific vars). Applied last so they win.
    if let Some(extra) = env {
        for (k, v) in extra {
            cmd.env(k, v);
        }
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn failed: {}", e))?;
    let child_pid = child.process_id();
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| format!("take_writer failed: {}", e))?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("clone_reader failed: {}", e))?;

    let id = {
        let mut next = state.next_id.lock().unwrap();
        let id = *next;
        *next += 1;
        id
    };

    {
        let mut instances = state.instances.lock().unwrap();
        instances.insert(
            id,
            PtyInstance {
                writer,
                child,
                master: pair.master,
                pid: child_pid,
            },
        );
    }

    let instances_ref = state.instances.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = on_event.send(PtyEvent::Output {
                        data: buf[..n].to_vec(),
                    });
                }
                Err(e) => {
                    let _ = on_event.send(PtyEvent::Error {
                        message: e.to_string(),
                    });
                    break;
                }
            }
        }
        // EOF on the master means the child closed its fds — reap it to get the
        // real exit code (the clean completion signal §6.1 relies on).
        let code = {
            let mut instances = instances_ref.lock().unwrap();
            match instances.remove(&id) {
                Some(mut inst) => inst.child.wait().ok().map(|s| s.exit_code() as i32),
                None => None,
            }
        };
        let _ = on_event.send(PtyEvent::Exit { code });
    });

    Ok(id)
}

#[tauri::command]
pub fn write_pty(
    state: tauri::State<'_, PtyManager>,
    id: u32,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    if let Some(instance) = instances.get_mut(&id) {
        instance
            .writer
            .write_all(&data)
            .map_err(|e| e.to_string())?;
        instance.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    state: tauri::State<'_, PtyManager>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let instances = state.instances.lock().unwrap();
    if let Some(instance) = instances.get(&id) {
        instance
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reattach_pty(
    state: tauri::State<'_, PtyManager>,
    id: u32,
    on_event: Channel<PtyEvent>,
) -> Result<(), String> {
    let instances = state.instances.lock().unwrap();
    let instance = instances.get(&id).ok_or("PTY not found")?;
    let mut reader = instance
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {}", e))?;
    drop(instances);

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if on_event
                        .send(PtyEvent::Output {
                            data: buf[..n].to_vec(),
                        })
                        .is_err()
                    {
                        break; // channel closed (window closed)
                    }
                }
                Err(_) => break,
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn kill_pty(state: tauri::State<'_, PtyManager>, id: u32) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    instances.remove(&id);
    Ok(())
}

#[tauri::command]
pub fn get_pty_cwd(state: tauri::State<'_, PtyManager>, id: u32) -> Result<String, String> {
    let instances = state.instances.lock().unwrap();
    let instance = instances.get(&id).ok_or("PTY not found")?;
    let pid = instance.pid.ok_or("No PID")?;

    // On macOS, use lsof to get the CWD of the foreground process group
    // First try to find the foreground child process, fall back to shell PID
    let fg_pid = get_foreground_pid(pid).unwrap_or(pid);

    let output = std::process::Command::new("/usr/bin/lsof")
        .args(["-a", "-d", "cwd", "-p", &fg_pid.to_string(), "-Fn"])
        .output()
        .map_err(|e| format!("lsof failed: {}", e))?;

    if !output.status.success() {
        return Err("lsof returned error".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix('n') {
            return Ok(path.to_string());
        }
    }
    Err("CWD not found in lsof output".to_string())
}

/// Get the foreground process of a shell by finding its child processes
fn get_foreground_pid(shell_pid: u32) -> Option<u32> {
    // Use pgrep to find child processes of the shell
    let output = std::process::Command::new("/usr/bin/pgrep")
        .args(["-P", &shell_pid.to_string()])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Get the last child (most recently spawned foreground process)
    stdout
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .last()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_login_shell_when_no_command() {
        assert_eq!(
            resolve_argv(None, &[], "/bin/zsh"),
            vec!["/bin/zsh".to_string(), "-l".to_string()]
        );
    }

    #[test]
    fn empty_command_falls_back_to_shell() {
        assert_eq!(
            resolve_argv(Some(""), &[], "/bin/bash"),
            vec!["/bin/bash".to_string(), "-l".to_string()]
        );
    }

    #[test]
    fn explicit_command_becomes_direct_child() {
        let args = vec!["-p".to_string(), "do the thing".to_string()];
        assert_eq!(
            resolve_argv(Some("claude"), &args, "/bin/zsh"),
            vec![
                "claude".to_string(),
                "-p".to_string(),
                "do the thing".to_string()
            ]
        );
    }

    #[test]
    fn explicit_command_with_no_args() {
        assert_eq!(
            resolve_argv(Some("claude"), &[], "/bin/zsh"),
            vec!["claude".to_string()]
        );
    }

    #[test]
    fn args_require_a_command_and_are_ignored_without_one() {
        // Contract: args apply only to an explicit command; with no command we
        // fall back to the login shell and the args are intentionally unused.
        assert_eq!(
            resolve_argv(None, &["--foo".to_string()], "/bin/zsh"),
            vec!["/bin/zsh".to_string(), "-l".to_string()]
        );
    }
}
