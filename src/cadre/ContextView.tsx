import { useEffect, useState } from "react";
import { useContextStore, type ContextEntry } from "../stores/contextStore";
import { Markdown } from "./components/Markdown";

// ---------------------------------------------------------------------------
// ContextView — two-pane browser for the Context Store
// ---------------------------------------------------------------------------

/**
 * Browse .cadre/context/*.md and .cadre/context/decisions/*.md ADRs.
 * Left pane: file list. Right pane: markdown render, inline editor, or New ADR form.
 */
export function ContextView({ root }: { root: string }) {
  const entries = useContextStore((s) => s.entries);
  const load = useContextStore((s) => s.load);
  const saveFile = useContextStore((s) => s.saveFile);
  const newAdr = useContextStore((s) => s.newAdr);

  const [selected, setSelected] = useState<ContextEntry | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState("");
  const [showNewAdr, setShowNewAdr] = useState(false);

  // Load context entries on mount / root change.
  useEffect(() => {
    load(root);
    // Reset selection when switching roots.
    setSelected(null);
    setEditMode(false);
    setShowNewAdr(false);
  }, [root, load]);

  // When entries reload, keep the selected entry in sync (e.g. after save/newAdr).
  useEffect(() => {
    if (selected) {
      const refreshed = entries.find((e) => e.path === selected.path);
      if (refreshed) setSelected(refreshed);
    }
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleSelect(entry: ContextEntry) {
    setSelected(entry);
    setEditMode(false);
    setShowNewAdr(false);
  }

  function handleEdit() {
    if (!selected) return;
    setDraft(selected.content);
    setEditMode(true);
  }

  async function handleSave() {
    if (!selected) return;
    await saveFile(root, selected.path, draft);
    setEditMode(false);
  }

  function handleCancelEdit() {
    setEditMode(false);
  }

  function handleNewAdrClick() {
    setShowNewAdr(true);
    setSelected(null);
    setEditMode(false);
  }

  // ---------------------------------------------------------------------------
  // Sub-components
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        overflow: "hidden",
        background: "var(--c-bg)",
        color: "var(--c-text)",
      }}
    >
      {/* Left pane — entry list */}
      <div
        style={{
          width: 260,
          flexShrink: 0,
          borderRight: "1px solid var(--c-border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* New ADR button */}
        <div
          style={{
            padding: "var(--c-space-2) var(--c-space-3)",
            borderBottom: "1px solid var(--c-border)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleNewAdrClick}
            className="cadre-hover"
            style={{
              width: "100%",
              padding: "6px 10px",
              background: "var(--c-accent-subtle)",
              border: "1px solid var(--c-accent-ring)",
              borderRadius: "var(--c-radius-sm)",
              color: "var(--c-accent)",
              fontSize: "var(--c-fs-sm)",
              fontWeight: 500,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            + New ADR
          </button>
        </div>

        {/* Entry list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "var(--c-space-1) 0" }}>
          {entries.length === 0 ? (
            <div
              style={{
                padding: "var(--c-space-4) var(--c-space-3)",
                color: "var(--c-text-secondary)",
                fontSize: "var(--c-fs-sm)",
                lineHeight: 1.5,
              }}
            >
              No Context Store entries yet — decisions and shared contracts will appear here.
            </div>
          ) : (
            entries.map((entry) => {
              const isSelected = selected?.path === entry.path;
              return (
                <button
                  key={entry.path}
                  onClick={() => handleSelect(entry)}
                  className="cadre-hover"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px var(--c-space-3)",
                    background: isSelected ? "var(--c-surface-3)" : "transparent",
                    border: "none",
                    borderRadius: 0,
                    cursor: "pointer",
                    color: isSelected ? "var(--c-text)" : "var(--c-text-secondary)",
                    fontSize: "var(--c-fs-sm)",
                  }}
                >
                  {entry.kind === "adr" ? (
                    <span>
                      <span style={{ fontFamily: "monospace", color: "var(--c-text-secondary)" }}>
                        #{String(entry.number ?? "?").padStart(4, "0")}
                      </span>{" "}
                      <span>{entry.title ?? entry.path.split("/").pop()}</span>
                      {entry.status && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: "var(--c-fs-xs)",
                            padding: "1px 5px",
                            borderRadius: "var(--c-radius-sm)",
                            background: statusBg(entry.status),
                            color: statusFg(entry.status),
                            fontWeight: 500,
                          }}
                        >
                          {entry.status}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span>{entry.path.split("/").pop()}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right pane */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {showNewAdr ? (
          <NewAdrForm
            onCancel={() => setShowNewAdr(false)}
            onCreate={async (adrDraft) => {
              const relPath = await newAdr(root, adrDraft);
              setShowNewAdr(false);
              // Select newly created entry.
              if (relPath) {
                // Entries will be refreshed by the store; pick by path after reload.
                const refreshed = useContextStore.getState().entries.find((e) => e.path === relPath);
                if (refreshed) setSelected(refreshed);
              }
            }}
          />
        ) : selected ? (
          <EntryPane
            entry={selected}
            editMode={editMode}
            draft={draft}
            onDraftChange={setDraft}
            onEdit={handleEdit}
            onSave={handleSave}
            onCancel={handleCancelEdit}
          />
        ) : (
          <EmptyRight entries={entries} onNewAdr={handleNewAdrClick} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EntryPane — renders or edits a selected entry
// ---------------------------------------------------------------------------

function EntryPane({
  entry,
  editMode,
  draft,
  onDraftChange,
  onEdit,
  onSave,
  onCancel,
}: {
  entry: ContextEntry;
  editMode: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      {/* Toolbar */}
      <div
        style={{
          padding: "var(--c-space-2) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-2)",
          flexShrink: 0,
          background: "var(--c-surface-1)",
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: "var(--c-fs-sm)",
            color: "var(--c-text-secondary)",
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.path}
        </span>
        {!editMode ? (
          <button
            onClick={onEdit}
            className="cadre-hover"
            style={toolbarBtn()}
          >
            Edit
          </button>
        ) : (
          <>
            <button
              onClick={onSave}
              className="cadre-hover"
              style={{ ...toolbarBtn(), background: "var(--c-accent-subtle)", color: "var(--c-accent)", borderColor: "var(--c-accent-ring)" }}
            >
              Save
            </button>
            <button onClick={onCancel} className="cadre-hover" style={toolbarBtn()}>
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-4)" }}>
        {editMode ? (
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              height: "100%",
              resize: "none",
              background: "var(--c-surface-1)",
              color: "var(--c-text)",
              border: "1px solid var(--c-border)",
              borderRadius: "var(--c-radius-sm)",
              padding: "var(--c-space-3)",
              fontFamily: "monospace",
              fontSize: "var(--c-fs-sm)",
              lineHeight: 1.6,
              boxSizing: "border-box",
            }}
          />
        ) : (
          <Markdown content={entry.content} />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// NewAdrForm — inputs for Title, Context, Decision, Consequences
// ---------------------------------------------------------------------------

function NewAdrForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (draft: { title: string; context: string; decision: string; consequences: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [decision, setDecision] = useState("");
  const [consequences, setConsequences] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    await onCreate({ title: title.trim(), context, decision, consequences });
    setCreating(false);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "var(--c-space-3) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-2)",
          flexShrink: 0,
          background: "var(--c-surface-1)",
        }}
      >
        <span style={{ flex: 1, fontSize: "var(--c-fs-base)", fontWeight: 600, color: "var(--c-text)" }}>
          New ADR
        </span>
        <button
          onClick={handleCreate}
          disabled={!title.trim() || creating}
          className="cadre-hover"
          style={{
            ...toolbarBtn(),
            background: title.trim() ? "var(--c-accent-subtle)" : undefined,
            color: title.trim() ? "var(--c-accent)" : "var(--c-text-secondary)",
            borderColor: title.trim() ? "var(--c-accent-ring)" : undefined,
            opacity: creating ? 0.6 : 1,
            cursor: !title.trim() || creating ? "not-allowed" : "pointer",
          }}
        >
          {creating ? "Creating…" : "Create"}
        </button>
        <button onClick={onCancel} className="cadre-hover" style={toolbarBtn()}>
          Cancel
        </button>
      </div>

      {/* Form */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-4)", display: "flex", flexDirection: "column", gap: "var(--c-space-3)" }}>
        <FormField label="Title" required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Use Postgres for persistent storage"
            autoFocus
            style={inputStyle()}
          />
        </FormField>

        <FormField label="Context" hint="Why is this decision needed?">
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
            placeholder="Describe the context and forces at play…"
            style={{ ...inputStyle(), resize: "vertical", fontFamily: "inherit" }}
          />
        </FormField>

        <FormField label="Decision" hint="What was decided?">
          <textarea
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            rows={4}
            placeholder="Describe the decision and its rationale…"
            style={{ ...inputStyle(), resize: "vertical", fontFamily: "inherit" }}
          />
        </FormField>

        <FormField label="Consequences" hint="What are the trade-offs?">
          <textarea
            value={consequences}
            onChange={(e) => setConsequences(e.target.value)}
            rows={4}
            placeholder="Describe the resulting context and trade-offs…"
            style={{ ...inputStyle(), resize: "vertical", fontFamily: "inherit" }}
          />
        </FormField>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FormField — label + optional hint wrapper
// ---------------------------------------------------------------------------

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        style={{
          fontSize: "var(--c-fs-sm)",
          fontWeight: 500,
          color: "var(--c-text)",
        }}
      >
        {label}
        {required && (
          <span style={{ color: "var(--c-danger, #e55)", marginLeft: 3 }}>*</span>
        )}
        {hint && (
          <span style={{ fontWeight: 400, color: "var(--c-text-secondary)", marginLeft: 6 }}>
            — {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyRight — shown when nothing is selected
// ---------------------------------------------------------------------------

function EmptyRight({
  entries,
  onNewAdr,
}: {
  entries: { path: string }[];
  onNewAdr: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--c-space-3)",
        padding: "var(--c-space-6)",
        color: "var(--c-text-secondary)",
        textAlign: "center",
      }}
    >
      {entries.length === 0 ? (
        <>
          <p style={{ fontSize: "var(--c-fs-base)", margin: 0 }}>
            No Context Store entries yet — decisions and shared contracts will appear here.
          </p>
          <button
            onClick={onNewAdr}
            className="cadre-hover"
            style={{
              padding: "8px 16px",
              background: "var(--c-accent-subtle)",
              border: "1px solid var(--c-accent-ring)",
              borderRadius: "var(--c-radius-sm)",
              color: "var(--c-accent)",
              fontSize: "var(--c-fs-sm)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + New ADR
          </button>
        </>
      ) : (
        <p style={{ fontSize: "var(--c-fs-sm)", margin: 0 }}>
          Select an entry to view it, or click <strong>+ New ADR</strong> to author a decision.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function toolbarBtn(): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: "var(--c-fs-sm)",
    background: "transparent",
    border: "1px solid var(--c-border)",
    borderRadius: "var(--c-radius-sm)",
    color: "var(--c-text-secondary)",
    cursor: "pointer",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "6px 10px",
    background: "var(--c-surface-1)",
    border: "1px solid var(--c-border)",
    borderRadius: "var(--c-radius-sm)",
    color: "var(--c-text)",
    fontSize: "var(--c-fs-sm)",
    boxSizing: "border-box",
  };
}

function statusBg(status: string): string {
  if (status === "Accepted") return "var(--c-success-subtle, rgba(34,197,94,0.15))";
  if (status === "Superseded") return "var(--c-warning-subtle, rgba(234,179,8,0.15))";
  return "var(--c-surface-2)";
}

function statusFg(status: string): string {
  if (status === "Accepted") return "var(--c-success, #16a34a)";
  if (status === "Superseded") return "var(--c-warning, #ca8a04)";
  return "var(--c-text-secondary)";
}
