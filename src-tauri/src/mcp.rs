//! Thin Tauri wrapper over the Node MCP probe entry (`dist-cli/cli/mcp/probe.js`).
//! Secrets are resolved inside the Node entry (keychain) — none cross this boundary.

use std::io::Write;
use std::process::{Command, Stdio};

/// Probe an MCP server by delegating to the Node client entry
/// (dist-cli/cli/mcp/probe.js, built from src/cli/mcp/probe.ts).
/// The connection JSON goes in on stdin; the McpProbe JSON comes back on stdout.
#[tauri::command]
pub fn mcp_probe(connection_json: String) -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let script = cwd.join("dist-cli/cli/mcp/probe.js");
    let mut child = Command::new("node")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn node: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(connection_json.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("probe failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
