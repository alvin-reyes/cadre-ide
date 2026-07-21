use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

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
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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
}
