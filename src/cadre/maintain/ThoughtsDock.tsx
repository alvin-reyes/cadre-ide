/**
 * ThoughtsDock — a persistent, multi-page "thoughts" composer docked under the
 * main terminal (Better-Terminal style). Write/assemble prompts across PAGES;
 * MAXIMIZE to a full-area editor for focused writing. Send (or ⌘/Ctrl+Enter) types
 * the active page into the active terminal pane + Enter. Backed by thoughtsStore:
 * every send is kept in per-project History; save named Notes; insert Templates.
 * Pages + their text persist per project.
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import {
  Lightbulb, ChevronDown, ChevronUp, CornerDownLeft, Clock, Bookmark, LayoutTemplate,
  Trash2, Save, Maximize2, Minimize2, Plus, X,
} from "lucide-react";
import { sendToActive } from "../../lib/terminalBus";
import { toast } from "../../stores/toastStore";
import { useThoughtsStore, type HistoryEntry } from "../../stores/thoughtsStore";
import { BUILTIN_THOUGHT_TEMPLATES } from "../../lib/maintain/thoughtTemplates";

const EMPTY_HISTORY: HistoryEntry[] = [];

interface Page { id: string; text: string; }
const pagesKey = (root: string) => `cadre-thoughts-pages:${root}`;
const legacyKey = (root: string) => `cadre-thoughts:${root}`;

function genId(): string {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return `p_${Math.random().toString(36).slice(2)}`;
}
function loadPages(root: string): { pages: Page[]; activeId: string } {
  try {
    const raw = localStorage.getItem(pagesKey(root));
    if (raw) { const p = JSON.parse(raw) as { pages: Page[]; activeId: string }; if (p?.pages?.length) return p; }
    const legacy = localStorage.getItem(legacyKey(root)) ?? ""; // migrate the old single composer
    const first: Page = { id: genId(), text: legacy };
    return { pages: [first], activeId: first.id };
  } catch { const f: Page = { id: "p1", text: "" }; return { pages: [f], activeId: f.id }; }
}
function savePages(root: string, pages: Page[], activeId: string): void {
  try { localStorage.setItem(pagesKey(root), JSON.stringify({ pages, activeId })); } catch { /* unavailable */ }
}
function pageTitle(p: Page, i: number): string {
  const first = p.text.split("\n").map((l) => l.trim()).find(Boolean);
  if (!first) return `Page ${i + 1}`;
  return first.length > 22 ? first.slice(0, 22) + "…" : first;
}
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Menu = null | "templates" | "history" | "notes";

export function ThoughtsDock({ surfaceId, projectRoot }: { surfaceId: string; projectRoot: string }) {
  const [{ pages, activeId }, setDoc] = useState(() => loadPages(projectRoot));
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
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

  const active = pages.find((p) => p.id === activeId) ?? pages[0];
  const text = active.text;

  const commit = (nextPages: Page[], nextActive: string) => {
    savePages(projectRoot, nextPages, nextActive);
    setDoc({ pages: nextPages, activeId: nextActive });
  };
  const update = (v: string) => commit(pages.map((p) => (p.id === active.id ? { ...p, text: v } : p)), activeId);
  const insert = (body: string) => { update(text.trim() ? `${text}\n${body}` : body); setMenu(null); };
  const addPage = () => { const np: Page = { id: genId(), text: "" }; commit([...pages, np], np.id); };
  const closePage = (id: string) => {
    const remaining = pages.filter((p) => p.id !== id);
    if (remaining.length === 0) { const np: Page = { id: genId(), text: "" }; commit([np], np.id); return; }
    commit(remaining, activeId === id ? remaining[remaining.length - 1].id : activeId);
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const ok = await sendToActive(surfaceId, t + "\n");
      if (ok) pushHistory(projectRoot, t, Date.now());
      else toast("No active terminal to send to — click into a terminal first", "error");
    } finally { setSending(false); }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
  };

  const toggleMenu = (m: Menu) => setMenu((cur) => (cur === m ? null : m));
  const menuBtn = (m: Exclude<Menu, null>, icon: React.ReactNode, label: string) => (
    <button onClick={() => toggleMenu(m)} aria-pressed={menu === m} className="cadre-icon-btn cadre-hover" style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 9px", fontSize: "var(--c-fs-xs)", fontWeight: 550, color: menu === m ? "var(--c-text)" : "var(--c-text-secondary)" }}>
      {icon}{label}
    </button>
  );

  const bodyOpen = maximized || !collapsed;

  const rootStyle: React.CSSProperties = maximized
    ? { position: "absolute", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", background: "var(--c-surface-1)", borderTop: "1px solid var(--c-border)" }
    : { flexShrink: 0, borderTop: "1px solid var(--c-border)", background: "var(--c-surface-1)", position: "relative" };

  return (
    <div style={rootStyle}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px var(--c-space-4)", flexShrink: 0 }}>
        <Lightbulb size={13} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600, color: "var(--c-text)" }}>Thoughts</span>
        {!maximized && <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>scratchpad → active terminal</span>}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          <button onClick={() => { setMaximized((m) => !m); setCollapsed(false); }} title={maximized ? "Restore" : "Maximize"} aria-label={maximized ? "Restore thoughts" : "Maximize thoughts"} className="cadre-icon-btn cadre-hover" style={{ width: 24, height: 24 }}>
            {maximized ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
          </button>
          {!maximized && (
            <button onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} title={collapsed ? "Expand" : "Collapse"} aria-label="Toggle thoughts" className="cadre-icon-btn cadre-hover" style={{ width: 24, height: 24 }}>
              {collapsed ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
            </button>
          )}
        </span>
      </div>

      {bodyOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-2)", padding: "0 var(--c-space-4) var(--c-space-3)", position: "relative", flex: maximized ? 1 : undefined, minHeight: 0 }}>
          {/* Page tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 3, overflowX: "auto", flexShrink: 0 }}>
            {pages.map((p, i) => {
              const on = p.id === active.id;
              return (
                <div key={p.id} className="cadre-hover" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, borderRadius: "var(--c-radius-sm)", background: on ? "var(--c-surface-3)" : "transparent", border: `1px solid ${on ? "var(--c-border-strong)" : "transparent"}` }}>
                  <button onClick={() => commit(pages, p.id)} style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 4px 0 9px", fontSize: "var(--c-fs-xs)", fontWeight: 550, background: "transparent", border: "none", color: on ? "var(--c-text)" : "var(--c-text-muted)", cursor: "pointer", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pageTitle(p, i)}
                  </button>
                  <button onClick={() => closePage(p.id)} title="Close page" aria-label="Close page" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 24, background: "transparent", border: "none", color: "var(--c-text-faint)", cursor: "pointer", padding: 0 }}>
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </div>
              );
            })}
            <button onClick={addPage} title="New page" aria-label="New thoughts page" className="cadre-icon-btn cadre-hover" style={{ width: 24, height: 24, flexShrink: 0 }}>
              <Plus size={13} strokeWidth={2.5} />
            </button>
          </div>

          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {menuBtn("templates", <LayoutTemplate size={12} strokeWidth={2} />, "Templates")}
            {menuBtn("history", <Clock size={12} strokeWidth={2} />, "History")}
            {menuBtn("notes", <Bookmark size={12} strokeWidth={2} />, "Notes")}
          </div>

          {/* Popover */}
          {menu && (
            <>
              <div onClick={() => setMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div className="cadre-elevate" style={{ position: "absolute", top: 66, left: "var(--c-space-4)", right: "var(--c-space-4)", zIndex: 41, maxHeight: 280, overflow: "auto", background: "var(--c-surface-1)", border: "1px solid var(--c-border-strong)", borderRadius: "var(--c-radius)", padding: "var(--c-space-2)" }}>
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
            placeholder="Think out loud, draft prompts, keep notes… ⌘/Ctrl+Enter sends the active page to the terminal."
            rows={maximized ? undefined : 3}
            style={{ width: "100%", resize: maximized ? "none" : "vertical", flex: maximized ? 1 : undefined, minHeight: maximized ? 0 : 56, fontFamily: "inherit", fontSize: "var(--c-fs-base)", lineHeight: 1.6, padding: "var(--c-space-3)" }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--c-space-2)", flexShrink: 0 }}>
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>{pages.length} page{pages.length === 1 ? "" : "s"} · persists per project · sends saved to History</span>
            <button onClick={() => void send()} disabled={!text.trim() || sending} className={text.trim() && !sending ? "cadre-btn-primary" : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--c-fs-sm)", fontWeight: 550, padding: "6px 14px", borderRadius: "var(--c-radius)", border: "none", background: text.trim() && !sending ? undefined : "var(--c-surface-3)", color: text.trim() && !sending ? undefined : "var(--c-text-muted)", cursor: text.trim() && !sending ? "pointer" : "default" }}>
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
          <input className="cadre-input" value={saveRow.value} onChange={(e) => saveRow.onChange(e.target.value)} placeholder={saveRow.placeholder} style={{ flex: 1, minWidth: 0, padding: "4px 9px", fontSize: "var(--c-fs-sm)" }} />
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
