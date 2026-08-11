import { useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Modal } from "../components/Modal";
import { useConnectionsStore } from "../../stores/connectionsStore";
import type { Preset } from "../../lib/mcp/catalog";
import type { Connection, StdioTransport, HttpTransport, Transport } from "../../lib/mcp/connections";

/**
 * ConnectionModal — configure, test, and save one Connection. Secret values
 * (tokens etc.) live ONLY in local `secrets` state, keyed by `secretField.field`;
 * they are passed to `probe`/`upsert` as the `secrets` map and NEVER written into
 * `connection.transport` (which persists to `.cadre/mcp.json` — a secret there
 * would be a plaintext-on-disk leak). For `custom` presets, command/args/url are
 * genuinely non-secret transport config and are edited directly on the connection.
 */

const inputStyle = {
  width: "100%",
  background: "var(--c-surface-2)",
  border: "1px solid var(--c-border-strong)",
  borderRadius: "var(--c-radius)",
  outline: "none",
  color: "var(--c-text)",
  fontSize: "var(--c-fs-sm)",
  fontFamily: "var(--c-font-mono)",
  padding: "7px 10px",
} as const;

/** Fields that look like a credential (token/secret/key/password) render masked;
 *  everything else (e.g. a team ID or site URL) renders as plain text even though
 *  it still routes through the keychain-backed `secrets` map like any other field. */
function isSecretLike(field: string): boolean {
  return /TOKEN|SECRET|KEY|PASSWORD/i.test(field);
}

export function ConnectionModal({
  root,
  preset,
  connection,
  isNew,
  onClose,
}: {
  root: string;
  preset: Preset;
  connection: Connection;
  isNew: boolean;
  onClose: () => void;
}) {
  const upsert = useConnectionsStore((s) => s.upsert);
  const probe = useConnectionsStore((s) => s.probe);

  const [label, setLabel] = useState(connection.label);
  const [transportKind, setTransportKind] = useState<Transport["kind"]>(connection.transport.kind);
  const [stdioCommand, setStdioCommand] = useState(connection.transport.kind === "stdio" ? connection.transport.command : "");
  const [stdioArgs, setStdioArgs] = useState(connection.transport.kind === "stdio" ? connection.transport.args.join(" ") : "");
  const [httpUrl, setHttpUrl] = useState(connection.transport.kind === "http" ? connection.transport.url : "");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; toolCount: number; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function buildConn(): Connection {
    if (!preset.custom) return connection;
    const transport: StdioTransport | HttpTransport =
      transportKind === "stdio"
        ? { kind: "stdio", command: stdioCommand.trim(), args: stdioArgs.trim() ? stdioArgs.trim().split(/\s+/) : [], env: {} }
        : { kind: "http", url: httpUrl.trim(), headers: {} };
    return { ...connection, label: label.trim() || "Custom", transport };
  }

  // A "custom" connection needs a runnable target before Test/Save mean anything.
  const customIncomplete = preset.custom && (transportKind === "stdio" ? !stdioCommand.trim() : !httpUrl.trim());
  const busy = testing || saving;

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const result = await probe(buildConn(), secrets);
    setTesting(false);
    setTestResult(result);
  }

  async function handleSave() {
    setSaving(true);
    const built = buildConn();
    // A green test is a strong enough signal to flip it on by default; otherwise
    // keep whatever the connection already had (false for a brand-new one).
    const enabled = testResult?.ok ? true : built.enabled;
    await upsert(root, { ...built, enabled }, secrets);
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      label={`${isNew ? "Connect" : "Edit"} ${preset.label}`}
      onClose={onClose}
      width={460}
      title={
        <span style={{ fontSize: "var(--c-fs-lg)", fontWeight: 600 as const, color: "var(--c-text)" }}>
          {isNew ? `Connect ${preset.label}` : `Edit ${connection.label}`}
        </span>
      }
    >
      <div style={{ padding: "var(--c-space-4)", display: "flex", flexDirection: "column", gap: "var(--c-space-3)" }}>
        <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
          {preset.blurb}
          {preset.docsUrl && (
            <>
              {" "}
              <a href={preset.docsUrl} target="_blank" rel="noreferrer" style={{ color: "var(--c-accent)" }}>
                Docs ↗
              </a>
            </>
          )}
        </div>

        {preset.custom && (
          <>
            <Field label="Name">
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My MCP server" style={inputStyle} />
            </Field>

            <div style={{ display: "flex", gap: 6 }}>
              {(["stdio", "http"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setTransportKind(k)}
                  aria-pressed={transportKind === k}
                  style={{
                    fontSize: "var(--c-fs-xs)",
                    fontWeight: 600 as const,
                    padding: "5px 12px",
                    borderRadius: "var(--c-radius-sm)",
                    background: transportKind === k ? "var(--c-accent-subtle)" : "var(--c-surface-2)",
                    color: transportKind === k ? "var(--c-accent)" : "var(--c-text-secondary)",
                    border: "1px solid var(--c-border)",
                    cursor: "pointer",
                  }}
                >
                  {k === "stdio" ? "Stdio (command)" : "HTTP"}
                </button>
              ))}
            </div>

            {transportKind === "stdio" ? (
              <>
                <Field label="Command">
                  <input value={stdioCommand} onChange={(e) => setStdioCommand(e.target.value)} placeholder="npx" style={inputStyle} />
                </Field>
                <Field label="Args" hint="space-separated">
                  <input value={stdioArgs} onChange={(e) => setStdioArgs(e.target.value)} placeholder="-y @scope/mcp-server" style={inputStyle} />
                </Field>
              </>
            ) : (
              <Field label="URL">
                <input value={httpUrl} onChange={(e) => setHttpUrl(e.target.value)} placeholder="https://example.com/mcp" style={inputStyle} />
              </Field>
            )}
          </>
        )}

        {!preset.custom && connection.transport.kind === "stdio" && (
          <div
            style={{
              fontSize: "var(--c-fs-xs)",
              fontFamily: "var(--c-font-mono)",
              color: "var(--c-text-muted)",
              background: "var(--c-code-bg)",
              borderRadius: "var(--c-radius-sm)",
              padding: "6px 9px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {connection.transport.command} {connection.transport.args.join(" ")}
          </div>
        )}

        {preset.secretFields.map((f) => (
          <Field key={f.field} label={f.label} hint={f.required ? undefined : "optional"}>
            <input
              type={isSecretLike(f.field) ? "password" : "text"}
              value={secrets[f.field] ?? ""}
              onChange={(e) => setSecrets((s) => ({ ...s, [f.field]: e.target.value }))}
              placeholder={f.placeholder}
              autoComplete="off"
              spellCheck={false}
              style={inputStyle}
            />
          </Field>
        ))}

        {testResult && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--c-fs-sm)",
              color: testResult.ok ? "var(--c-success)" : "var(--c-danger)",
            }}
          >
            {testResult.ok ? <CheckCircle2 size={14} strokeWidth={2} /> : <XCircle size={14} strokeWidth={2} />}
            {testResult.ok
              ? `Connected · ${testResult.toolCount} tool${testResult.toolCount === 1 ? "" : "s"}`
              : testResult.error || "Connection failed"}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: "var(--c-space-1)" }}>
          <button
            onClick={handleTest}
            disabled={busy || customIncomplete}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "6px 14px",
              borderRadius: "var(--c-radius)",
              background: "transparent",
              color: "var(--c-text-secondary)",
              border: "1px solid var(--c-border-strong)",
              cursor: busy || customIncomplete ? "default" : "pointer",
              opacity: busy || customIncomplete ? 0.6 : 1,
            }}
          >
            {testing && <Loader2 size={13} strokeWidth={2} className="cadre-spin" />}
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            onClick={handleSave}
            disabled={busy || customIncomplete}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "6px 16px",
              borderRadius: "var(--c-radius)",
              background: "var(--c-accent)",
              color: "var(--c-on-accent)",
              border: "none",
              cursor: busy || customIncomplete ? "default" : "pointer",
              opacity: busy || customIncomplete ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550 as const, color: "var(--c-text-secondary)" }}>{label}</span>
        {hint && <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
