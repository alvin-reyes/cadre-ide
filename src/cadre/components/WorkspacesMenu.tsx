import { useState } from "react";
import { LayoutGrid, Save, Trash2, RotateCcw, Loader2 } from "lucide-react";
import { useWorkspaceSnapshots } from "../../stores/workspaceSnapshots";
import { useOpenProjects } from "../../stores/openProjectsStore";
import { captureSession, restoreSession } from "../../lib/session/workspace";
import { reportError } from "../../lib/reportError";

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `w_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Save/restore named workspace snapshots (open projects + their modes + views). */
export function WorkspacesMenu() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);
  const snapshots = useWorkspaceSnapshots((s) => s.snapshots);
  const save = useWorkspaceSnapshots((s) => s.save);
  const remove = useWorkspaceSnapshots((s) => s.remove);
  const openCount = useOpenProjects((s) => s.roots.length);

  const doSave = () => {
    if (openCount === 0) return;
    save(captureSession(name, newId(), Date.now()));
    setName("");
  };

  const doRestore = async (id: string) => {
    const snap = snapshots.find((s) => s.id === id);
    if (!snap || restoring) return;
    setRestoring(id);
    try {
      await restoreSession(snap);
      setOpen(false);
    } catch (e) {
      reportError("restore workspace", e, { toastMessage: "Could not restore that workspace" });
    } finally {
      setRestoring(null);
    }
  };

  const btnBase = {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    height: 24,
    borderRadius: "var(--c-radius-sm)",
    border: "1px solid var(--c-border)",
    background: "transparent",
    color: "var(--c-text-secondary)",
    cursor: "pointer" as const,
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Workspaces — save & restore sessions"
        aria-label="Workspaces"
        aria-expanded={open}
        style={{ ...btnBase, gap: 5, padding: "0 9px", fontSize: "var(--c-fs-xs)", fontWeight: 550 as const, color: open ? "var(--c-accent)" : "var(--c-text-secondary)" }}
      >
        <LayoutGrid size={14} strokeWidth={2} />
        Workspaces
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 41,
              width: 320,
              background: "var(--c-surface-1)",
              border: "1px solid var(--c-border)",
              borderRadius: "var(--c-radius-md)",
              boxShadow: "0 16px 40px -14px rgba(0,0,0,0.55)",
              overflow: "hidden",
            }}
          >
            {/* Save current session */}
            <div style={{ padding: "var(--c-space-3)", borderBottom: "1px solid var(--c-border)" }}>
              <div style={{ fontSize: "var(--c-fs-2xs, 10px)", fontWeight: 650, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--c-text-faint)", marginBottom: 6 }}>
                Save current session
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSave()}
                  placeholder={openCount === 0 ? "No projects open" : "Workspace name…"}
                  disabled={openCount === 0}
                  aria-label="Workspace name"
                  style={{ flex: 1, minWidth: 0, height: 28, padding: "0 9px", fontSize: "var(--c-fs-xs)", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)", color: "var(--c-text)" }}
                />
                <button
                  onClick={doSave}
                  disabled={openCount === 0}
                  className={openCount === 0 ? undefined : "cadre-btn-primary"}
                  title="Save this session"
                  aria-label="Save workspace"
                  style={{ ...btnBase, height: 28, gap: 5, padding: "0 11px", fontSize: "var(--c-fs-xs)", fontWeight: 600 as const, opacity: openCount === 0 ? 0.5 : 1 }}
                >
                  <Save size={13} strokeWidth={2} />
                  Save
                </button>
              </div>
            </div>

            {/* Saved list */}
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {snapshots.length === 0 ? (
                <div style={{ padding: "var(--c-space-4)", textAlign: "center", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
                  No saved workspaces yet.
                </div>
              ) : (
                snapshots.map((s) => (
                  <div
                    key={s.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px var(--c-space-3)", borderBottom: "1px solid var(--c-border)" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.name}
                      </div>
                      <div style={{ fontSize: "var(--c-fs-2xs, 10px)", color: "var(--c-text-faint)" }}>
                        {s.projects.length} project{s.projects.length === 1 ? "" : "s"} · {ago(s.savedAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => doRestore(s.id)}
                      disabled={restoring !== null}
                      title="Restore this workspace"
                      aria-label={`Restore ${s.name}`}
                      className="cadre-hover"
                      style={{ ...btnBase, width: 28, color: "var(--c-accent)" }}
                    >
                      {restoring === s.id ? <Loader2 size={13} strokeWidth={2} className="cadre-spin" /> : <RotateCcw size={13} strokeWidth={2} />}
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      title="Delete this workspace"
                      aria-label={`Delete ${s.name}`}
                      className="cadre-hover"
                      style={{ ...btnBase, width: 28, color: "var(--c-text-faint)" }}
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
