import { useState } from "react";
import { Database, Plus, Trash2, Check } from "lucide-react";
import { useRepos } from "../stores/reposStore";
import { useBmadStore } from "../stores/bmadStore";
import { DEFAULT_REPO_ID } from "../lib/engine/repos";

/**
 * RepoRegistry — manage the cadre.json repo registry from the UI.
 * Lists registered repos with add / remove / inline-verify-edit.
 * Rendered inside the Settings modal as a collapsible section.
 */

const inputStyle = {
  background: "var(--c-surface-2)",
  border: "1px solid var(--c-border-strong)",
  borderRadius: "var(--c-radius)",
  outline: "none",
  color: "var(--c-text)",
  fontSize: "var(--c-fs-sm)",
  fontFamily: "var(--c-font-mono)",
  padding: "6px 9px",
} as const;

export function RepoRegistry() {
  const repos = useRepos((s) => s.repos);
  const addRepo = useRepos((s) => s.addRepo);
  const removeRepo = useRepos((s) => s.removeRepo);
  const setVerify = useRepos((s) => s.setVerify);
  const projectRoot = useBmadStore((s) => s.projectRoot);

  // Draft for adding a new repo
  const [draft, setDraft] = useState({ id: "", name: "", path: "", verify: "" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Per-repo inline verify edit state (id → current draft value)
  const [verifyDrafts, setVerifyDrafts] = useState<Record<string, string>>({});
  const [verifySaved, setVerifySaved] = useState<Record<string, boolean>>({});

  if (!projectRoot) {
    return (
      <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)", padding: "var(--c-space-3) 0" }}>
        Open a project to manage its repo registry.
      </div>
    );
  }

  // TypeScript can't narrow across async function boundaries; root is guaranteed non-null above.
  const root = projectRoot as string;

  async function handleAdd() {
    const id = draft.id.trim();
    const name = draft.name.trim() || id;
    const path = draft.path.trim();
    if (!id) { setAddError("Repo id is required."); return; }
    if (!path) { setAddError("Repo path is required."); return; }
    if (id === DEFAULT_REPO_ID && repos.some((r) => r.id === DEFAULT_REPO_ID)) {
      setAddError(`A repo with id "${DEFAULT_REPO_ID}" already exists.`); return;
    }
    setAddError(null);
    await addRepo(root, { id, name, path, ...(draft.verify.trim() ? { verify: draft.verify.trim() } : {}) });
    setDraft({ id: "", name: "", path: "", verify: "" });
    setAdding(false);
  }

  async function handleRemove(id: string) {
    if (id === DEFAULT_REPO_ID && repos.length === 1) {
      // Don't remove the last (main) repo — it's the project default
      return;
    }
    await removeRepo(root, id);
  }

  function startVerifyEdit(id: string, current: string) {
    setVerifyDrafts((d) => ({ ...d, [id]: current }));
  }

  async function saveVerify(id: string) {
    const v = verifyDrafts[id] ?? "";
    await setVerify(root, id, v);
    setVerifySaved((s) => ({ ...s, [id]: true }));
    setTimeout(() => setVerifySaved((s) => ({ ...s, [id]: false })), 1600);
  }

  return (
    <div>
      {/* Repo list */}
      {repos.length === 0 ? (
        <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)", padding: "var(--c-space-2) 0" }}>
          No repos registered yet — the default is the project root.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-2)", marginBottom: "var(--c-space-3)" }}>
          {repos.map((repo) => {
            const isMain = repo.id === DEFAULT_REPO_ID;
            const verifyDraft = verifyDrafts[repo.id] ?? repo.verify ?? "";
            const editing = repo.id in verifyDrafts;
            const saved = !!verifySaved[repo.id];
            return (
              <div
                key={repo.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "10px 12px",
                  borderRadius: "var(--c-radius)",
                  background: "var(--c-surface-2)",
                  border: "1px solid var(--c-border)",
                }}
              >
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: "var(--c-fs-xs)",
                      fontFamily: "var(--c-font-mono)",
                      fontWeight: 600 as const,
                      color: isMain ? "var(--c-accent)" : "var(--c-text)",
                      background: isMain ? "var(--c-accent-subtle)" : "var(--c-surface-3)",
                      border: `1px solid ${isMain ? "var(--c-accent-ring)" : "var(--c-border)"}`,
                      borderRadius: "var(--c-radius-full)",
                      padding: "1px 8px",
                    }}
                  >
                    {repo.id}
                  </span>
                  {repo.name !== repo.id && (
                    <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-secondary)" }}>{repo.name}</span>
                  )}
                  <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {repo.path}
                  </span>
                  {!isMain && (
                    <button
                      onClick={() => handleRemove(repo.id)}
                      title={`Remove repo "${repo.id}"`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 24,
                        height: 24,
                        borderRadius: "var(--c-radius-sm)",
                        background: "transparent",
                        border: "none",
                        color: "var(--c-text-muted)",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  )}
                </div>

                {/* Verify row */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", flexShrink: 0 }}>verify:</span>
                  {editing ? (
                    <>
                      <input
                        value={verifyDraft}
                        onChange={(e) => setVerifyDrafts((d) => ({ ...d, [repo.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && saveVerify(repo.id)}
                        placeholder="e.g. npm test"
                        style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: "var(--c-fs-xs)" }}
                      />
                      <button
                        onClick={() => saveVerify(repo.id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: "var(--c-fs-xs)",
                          fontWeight: 550 as const,
                          padding: "4px 10px",
                          borderRadius: "var(--c-radius-sm)",
                          background: saved ? "var(--c-success-subtle)" : "var(--c-accent)",
                          color: saved ? "var(--c-success)" : "var(--c-on-accent)",
                          border: "none",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        {saved ? <Check size={11} strokeWidth={2.5} /> : null}
                        {saved ? "Saved" : "Save"}
                      </button>
                      <button
                        onClick={() => setVerifyDrafts((d) => { const n = { ...d }; delete n[repo.id]; return n; })}
                        style={{
                          fontSize: "var(--c-fs-xs)",
                          padding: "4px 8px",
                          borderRadius: "var(--c-radius-sm)",
                          background: "transparent",
                          color: "var(--c-text-muted)",
                          border: "1px solid var(--c-border)",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => startVerifyEdit(repo.id, repo.verify ?? "")}
                      style={{
                        fontSize: "var(--c-fs-xs)",
                        fontFamily: "var(--c-font-mono)",
                        color: repo.verify ? "var(--c-text-secondary)" : "var(--c-text-muted)",
                        background: "transparent",
                        border: "1px solid var(--c-border)",
                        borderRadius: "var(--c-radius-sm)",
                        padding: "3px 8px",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {repo.verify || "not set — click to configure"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add repo form */}
      {adding ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--c-space-2)",
            padding: "10px 12px",
            borderRadius: "var(--c-radius)",
            background: "var(--c-surface-2)",
            border: "1px solid var(--c-border-strong)",
          }}
        >
          <div style={{ fontSize: "var(--c-fs-xs)", fontWeight: 600 as const, color: "var(--c-text-secondary)" }}>Add repo</div>
          {addError && (
            <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-danger)" }}>{addError}</div>
          )}
          <div style={{ display: "flex", gap: "var(--c-space-2)", flexWrap: "wrap" }}>
            <input
              value={draft.id}
              onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
              placeholder="id (e.g. backend)"
              style={{ ...inputStyle, flex: "1 1 80px", minWidth: 80 }}
            />
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="name (optional)"
              style={{ ...inputStyle, flex: "1 1 120px", minWidth: 80 }}
            />
            <input
              value={draft.path}
              onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
              placeholder="path (e.g. ../other-repo)"
              style={{ ...inputStyle, flex: "2 1 160px", minWidth: 120 }}
            />
            <input
              value={draft.verify}
              onChange={(e) => setDraft((d) => ({ ...d, verify: e.target.value }))}
              placeholder="verify cmd (optional)"
              style={{ ...inputStyle, flex: "2 1 160px", minWidth: 120 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleAdd}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--c-fs-sm)",
                fontWeight: 550 as const,
                padding: "5px 12px",
                borderRadius: "var(--c-radius)",
                background: "var(--c-accent)",
                color: "var(--c-on-accent)",
                border: "none",
                cursor: "pointer",
              }}
            >
              <Plus size={13} strokeWidth={2.5} />
              Add
            </button>
            <button
              onClick={() => { setAdding(false); setAddError(null); setDraft({ id: "", name: "", path: "", verify: "" }); }}
              style={{
                fontSize: "var(--c-fs-sm)",
                padding: "5px 12px",
                borderRadius: "var(--c-radius)",
                background: "transparent",
                color: "var(--c-text-secondary)",
                border: "1px solid var(--c-border-strong)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-sm)",
            fontWeight: 550 as const,
            padding: "5px 12px",
            borderRadius: "var(--c-radius)",
            background: "transparent",
            color: "var(--c-text-secondary)",
            border: "1px solid var(--c-border-strong)",
            cursor: "pointer",
          }}
        >
          <Plus size={13} strokeWidth={2.5} />
          Add repo
        </button>
      )}
    </div>
  );
}

/** Section wrapper matching Settings.tsx style */
export function RepoSection() {
  return (
    <div style={{ padding: "var(--c-space-4)", borderBottom: "1px solid var(--c-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <Database size={15} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-md)", fontWeight: 600 as const, color: "var(--c-text)" }}>Repos</span>
      </div>
      <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", marginBottom: "var(--c-space-3)" }}>
        Code repositories this Cadre project dispatches work into. Each repo needs a verify command for the per-repo approval gate.
      </div>
      <RepoRegistry />
    </div>
  );
}
