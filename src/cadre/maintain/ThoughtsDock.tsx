/**
 * ThoughtsDock — a persistent "thoughts" composer docked under the main terminal
 * (Better-Terminal style). Jot thoughts / assemble a prompt here; Send (or ⌘/Ctrl+
 * Enter) types it into the active terminal pane and presses Enter. Backed by
 * thoughtsStore: every send is kept in HISTORY (per project), you can save named
 * NOTES, and insert reusable TEMPLATES. The composer text persists per project.
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import { Lightbulb, ChevronDown, ChevronUp, CornerDownLeft, Clock, Bookmark, LayoutTemplate, Trash2, Save } from "lucide-react";
import { sendToActive } from "../../lib/terminalBus";
import { toast } from "../../stores/toastStore";
import { useThoughtsStore, type HistoryEntry } from "../../stores/thoughtsStore";
import { BUILTIN_THOUGHT_TEMPLATES } from "../../lib/maintain/thoughtTemplates";

const EMPTY_HISTORY: HistoryEntry[] = [];
const composeKey = (root: string) => `cadre-thoughts:${root}`;
function loadText(root: string): string {
  try { return localStorage.getItem(composeKey(root)) ?? ""; } catch { return ""; }
}
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Menu = null | "templates" | "history" | "notes";

export function ThoughtsDock({ surfaceId, projectRoot }: { surfaceId: string; projectRoot: string }) {
  const [text, setText] = useState(() => loadText(projectRoot));
  const [collapsed, setCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [noteName, setNoteName] = useState("");
  const [tplName, setTplName] = useState("");

  const historyMap = useThoughtsStore((s) => s.historyByRoot);
  const pushHistory = useThoughtsStore((s) => s.pushHistory);
  const clearHistory = useThoughtsStore((s) => s.clearHistory);
  const notes = useThoughtsStore((s) => s.notes);
  const saveNote = useThoughtsStore((s) => s.saveNote);
  const deleteNote = useThoughtsStore((s) => s.deleteNote);
  const userTemplates = useThoughtsStore((s) => s.userTemplates);
  const addTemplate = useThoughtsStore((s) => s.addTemplate);
  const deleteTemplate = useThoughtsStore((s) => s.deleteTemplate);

  const history = historyMap[projectRoot] ?? EMPTY_HISTORY;
  const templates = useMemo(() => [...BUILTIN_THOUGHT_TEMPLATES, ...userTemplates], [userTemplates]);

  const update = (v: string) => {
    setText(v);
    try { localStorage.setItem(composeKey(projectRoot), v); } catch { /* unavailable */ }
  };
  const insert = (body: string) => { update(text.trim() ? `${text}\n${body}` : body); setMenu(null); };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const ok = await sendToActive(surfaceId, t + "\n");
      if (ok) pushHistory(projectRoot, t, Date.now());
      else toast("No active terminal to send to — click into a terminal first", "error");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
  };

  const toggle = (m: Menu) => setMenu((cur) => (cur === m ? null : m));
  const menuBtn = (m: Exclude<Menu, null>, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => toggle(m)}
      aria-pressed={menu === m}
      className="cadre-icon-btn cadre-hover"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 9px", fontSize: "var(--c-fs-xs)", fontWeight: 550, color: menu === m ? "var(--c-text)" : "var(--c-text-secondary)" }}
    >
      {icon}{label}
    </button>
  );

  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid var(--c-border)", background: "var(--c-surface-1)", position: "relative" }}>
      {/* Header / collapse bar */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="cadre-hover"
        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "5px var(--c-space-4)", background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-secondary)" }}
      >
        <Lightbulb size={13} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600, color: "var(--c-text)" }}>Thoughts</span>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>scratchpad → active terminal</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", color: "var(--c-text-muted)" }}>
          {collapsed ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
        </span>
      </button>

      {!collapsed && (
        <div style={{ padding: "0 var(--c-space-4) var(--c-space-3)", display: "flex", flexDirection: "column", gap: "var(--c-space-2)", position: "relative" }}>
          {/* Toolbar: templates · history · notes */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {menuBtn("templates", <LayoutTemplate size={12} strokeWidth={2} />, "Templates")}
            {menuBtn("history", <Clock size={12} strokeWidth={2} />, "History")}
            {menuBtn("notes", <Bookmark size={12} strokeWidth={2} />, "Notes")}
          </div>

          {/* Popover panel (opens over the composer; backdrop closes it) */}
          {menu && (
            <>
              <div onClick={() => setMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div className="cadre-elevate" style={{ position: "absolute", top: 34, left: "var(--c-space-4)", right: "var(--c-space-4)", zIndex: 41, maxHeight: 260, overflow: "auto", background: "var(--c-surface-1)", border: "1px solid var(--c-border-strong)", borderRadius: "var(--c-radius)", padding: "var(--c-space-2)" }}>
                {menu === "templates" && (
                  <Panel
                    saveRow={{ placeholder: "Save current as template…", value: tplName, onChange: setTplName, disabled: !text.trim() || !tplName.trim(), onSave: () => { addTemplate(tplName, text); setTplName(""); } }}
                    items={templates.map((tp) => ({ id: tp.id, title: tp.name, sub: tp.body, onClick: () => insert(tp.body), onDelete: tp.builtin ? undefined : () => deleteTemplate(tp.id) }))}
                    empty="No templates."
                  />
                )}
                {menu === "history" && (
                  <Panel
                    header={history.length > 0 ? { label: `${history.length} sent`, action: { label: "Clear", onClick: () => clearHistory(projectRoot) } } : undefined}
                    items={history.map((h) => ({ id: h.id, title: h.text, sub: hhmm(h.at), onClick: () => insert(h.text) }))}
                    empty="Nothing sent yet. Your sent thoughts will appear here."
                  />
                )}
                {menu === "notes" && (
                  <Panel
                    saveRow={{ placeholder: "Save current as note…", value: noteName, onChange: setNoteName, disabled: !text.trim() || !noteName.trim(), onSave: () => { saveNote(noteName, text, Date.now()); setNoteName(""); } }}
                    items={notes.map((n) => ({ id: n.id, title: n.name, sub: n.text, onClick: () => insert(n.text), onDelete: () => deleteNote(n.id) }))}
                    empty="No saved notes."
                  />
                )}
              </div>
            </>
          )}

          <textarea
            className="cadre-input"
            value={text}
            onChange={(e) => update(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Think out loud, draft a prompt, keep notes… ⌘/Ctrl+Enter sends it to the terminal."
            rows={3}
            style={{ width: "100%", resize: "vertical", minHeight: 56, fontFamily: "inherit", fontSize: "var(--c-fs-base)", lineHeight: 1.5, padding: "var(--c-space-2) var(--c-space-3)" }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--c-space-2)" }}>
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>Persists per project · sends are saved to History</span>
            <button
              onClick={() => void send()}
              disabled={!text.trim() || sending}
              className={text.trim() && !sending ? "cadre-btn-primary" : undefined}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--c-fs-sm)", fontWeight: 550, padding: "5px 12px", borderRadius: "var(--c-radius)", border: "none", background: text.trim() && !sending ? undefined : "var(--c-surface-3)", color: text.trim() && !sending ? undefined : "var(--c-text-muted)", cursor: text.trim() && !sending ? "pointer" : "default" }}
            >
              <CornerDownLeft size={13} strokeWidth={2.5} /> Send to terminal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Popover panel: optional save row, optional header, and a list of items ──────
interface PanelItem { id: string; title: string; sub?: string; onClick: () => void; onDelete?: () => void; }
function Panel({
  items,
  empty,
  saveRow,
  header,
}: {
  items: PanelItem[];
  empty: string;
  saveRow?: { placeholder: string; value: string; onChange: (v: string) => void; disabled: boolean; onSave: () => void };
  header?: { label: string; action?: { label: string; onClick: () => void } };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {saveRow && (
        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <input
            className="cadre-input"
            value={saveRow.value}
            onChange={(e) => saveRow.onChange(e.target.value)}
            placeholder={saveRow.placeholder}
            style={{ flex: 1, minWidth: 0, padding: "4px 9px", fontSize: "var(--c-fs-sm)" }}
          />
          <button onClick={saveRow.onSave} disabled={saveRow.disabled} className="cadre-icon-btn cadre-hover" title="Save" aria-label="Save" style={{ width: 28, height: 28, color: saveRow.disabled ? "var(--c-text-faint)" : "var(--c-text)" }}>
            <Save size={13} strokeWidth={2} />
          </button>
        </div>
      )}
      {header && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 2px" }}>
          <span className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color: "var(--c-text-muted)", letterSpacing: "0.06em" }}>{header.label}</span>
          {header.action && (
            <button onClick={header.action.onClick} className="cadre-hover" style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", background: "transparent", border: "none", cursor: "pointer", padding: "0 4px", borderRadius: "var(--c-radius-sm)" }}>
              {header.action.label}
            </button>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <div style={{ padding: "var(--c-space-2) var(--c-space-2) var(--c-space-3)", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", lineHeight: 1.5 }}>{empty}</div>
      ) : (
        items.map((it) => (
          <div key={it.id} className="cadre-hover" style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "6px 8px", borderRadius: "var(--c-radius-sm)", cursor: "pointer" }} onClick={it.onClick} title={it.sub}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
              {it.sub && <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub}</span>}
            </div>
            {it.onDelete && (
              <button onClick={(e) => { e.stopPropagation(); it.onDelete!(); }} title="Delete" aria-label="Delete" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-faint)", padding: 0, marginTop: 1, display: "inline-flex" }}>
                <Trash2 size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
