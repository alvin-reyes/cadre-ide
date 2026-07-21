use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
#[cfg(unix)]
use std::os::unix::process::CommandExt;

/// Result of running a story's verification command.
///
/// This is the engine's own, authoritative signal: cadre runs the verification
/// command itself and trusts *this* exit code — never an agent's self-report.
#[derive(Clone, serde::Serialize)]
pub struct VerificationResult {
    /// The process exit code (`None` if the process was terminated by a signal).
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// True if the command exceeded `timeout_secs` and was killed.
    pub timed_out: bool,
}

/// Run `cmd` (a shell command line, e.g. `"pnpm test jwt"`) in `cwd`, capturing
/// stdout/stderr and the real exit code, with a wall-clock `timeout_secs`.
///
/// Pure of Tauri so it is unit-testable in isolation.
pub fn run_command(cwd: &str, cmd: &str, timeout_secs: u64) -> Result<VerificationResult, String> {
    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg(cmd)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Put the child in its own process group so a timeout can kill the WHOLE
    // tree — test runners (jest/vitest/forge) spawn worker subprocesses that
    // otherwise keep the stdout pipe open and hang us for the full runtime.
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn `{}` in {}: {}", cmd, cwd, e))?;

    // Drain the pipes on background threads so a chatty command can't deadlock by
    // filling the pipe buffer while we poll for completion.
    let mut out_pipe = child.stdout.take().ok_or("no stdout pipe")?;
    let mut err_pipe = child.stderr.take().ok_or("no stderr pipe")?;
    let out_handle = thread::spawn(move || {
        let mut s = String::new();
        let _ = out_pipe.read_to_string(&mut s);
        s
    });
    let err_handle = thread::spawn(move || {
        let mut s = String::new();
        let _ = err_pipe.read_to_string(&mut s);
        s
    });

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if Instant::now() >= deadline {
            // Kill the whole process group (child + its subprocesses), not just
            // the shell — otherwise workers hold the pipe and we block until they
            // finish. process_group(0) made the child the group leader (pgid=pid).
            #[cfg(unix)]
            unsafe {
                libc::killpg(child.id() as i32, libc::SIGKILL);
            }
            #[cfg(not(unix))]
            let _ = child.kill();
            let status = child.wait().map_err(|e| e.to_string())?;
            timed_out = true;
            break status;
        }
        thread::sleep(Duration::from_millis(50));
    };

    let stdout = out_handle.join().unwrap_or_default();
    let stderr = err_handle.join().unwrap_or_default();

    Ok(VerificationResult {
        exit_code: status.code(),
        stdout,
        stderr,
        timed_out,
    })
}

/// Tauri command wrapper. The engine calls this at the QA gate with the
/// human-confirmed verification command frozen at PLAN approval.
#[tauri::command]
pub fn run_verification(
    cwd: String,
    cmd: String,
    timeout_secs: u64,
) -> Result<VerificationResult, String> {
    run_command(&cwd, &cmd, timeout_secs)
}

/// Run `git` with `args` in `cwd` (argv form — no shell escaping). Used by the
/// engine for worktree/branch operations (§6.2).
#[tauri::command]
pub fn run_git(cwd: String, args: Vec<String>) -> Result<VerificationResult, String> {
    let out = Command::new("git")
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("git {:?} failed in {}: {}", args, cwd, e))?;
    Ok(VerificationResult {
        exit_code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        timed_out: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_success_exit_code() {
        let r = run_command(".", "exit 0", 5).unwrap();
        assert_eq!(r.exit_code, Some(0));
        assert!(!r.timed_out);
    }

    #[test]
    fn captures_nonzero_exit_code() {
        let r = run_command(".", "exit 3", 5).unwrap();
        assert_eq!(r.exit_code, Some(3));
        assert!(!r.timed_out);
    }

    #[test]
    fn captures_stdout() {
        let r = run_command(".", "echo hello", 5).unwrap();
        assert_eq!(r.stdout.trim(), "hello");
        assert_eq!(r.exit_code, Some(0));
    }

    #[test]
    fn runs_in_given_cwd() {
        let r = run_command("/tmp", "pwd", 5).unwrap();
        assert!(r.stdout.trim().ends_with("tmp"));
    }

    #[test]
    fn times_out_a_long_command() {
        let r = run_command(".", "sleep 5", 1).unwrap();
        assert!(r.timed_out);
        assert_ne!(r.exit_code, Some(0));
    }

    #[cfg(unix)]
    #[test]
    fn timeout_kills_subprocesses_not_just_the_shell() {
        // A pipeline whose downstream process holds the stdout pipe open. Without
        // process-group kill, killing only `sh` leaves the pipeline alive and we
        // block for the full 10s despite the 1s timeout.
        let start = std::time::Instant::now();
        let r = run_command(".", "sleep 10 | cat", 1).unwrap();
        let elapsed = start.elapsed();
        assert!(r.timed_out);
        assert!(
            elapsed < std::time::Duration::from_secs(4),
            "timeout did not bound wall-clock: took {:?}",
            elapsed
        );
    }
}
