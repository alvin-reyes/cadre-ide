/**
 * PromptsRail — the prompt library. A search box over grouped categories
 * (Favorites first); clicking a prompt inserts its body into the Thoughts
 * composer (onPick). Users can favorite any prompt and add/edit/delete their own.
 */
import { useState } from "react";
import { Search, Star, Plus, Pencil, Trash2 } from "lucide-react";
import { usePromptsStore } from "../../stores/promptsStore";
import { searchPrompts, groupByCategory, PROMPT_CATEGORIES, type PromptCategory } from "../../lib/maintain/prompts";

export function PromptsRail({ onPick }: { onPick: (body: string) => void }) {
  const userPrompts = usePromptsStore((s) => s.userPrompts);
  const favoriteIds = usePromptsStore((s) => s.favoriteIds);
  const allPrompts = usePromptsStore((s) => s.allPrompts);
  const toggleFavorite = usePromptsStore((s) => s.toggleFavorite);
  const addPrompt = usePromptsStore((s) => s.addPrompt);
  const updatePrompt = usePromptsStore((s) => s.updatePrompt);
  const deletePrompt = usePromptsStore((s) => s.deletePrompt);

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  // The id of the user prompt currently being edited (null = the editor is in
  // "new prompt" mode). Editing reuses the SAME draft state + editor markup as
  // add, so Save branches on this: set → updatePrompt, null → addPrompt.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string; category: PromptCategory }>({ title: "", body: "", category: "Testing" });

  const resetEditor = () => { setDraft({ title: "", body: "", category: "Testing" }); setAdding(false); setEditingId(null); };
  const startEdit = (p: { id: string; title: string; body: string; category: PromptCategory }) => {
    setDraft({ title: p.title, body: p.body, category: p.category });
    setEditingId(p.id);
    setAdding(true);
  };

  // allPrompts() reads BUILTIN + userPrompts; subscribe to userPrompts so it re-renders on add/delete.
  void userPrompts;
  const groups = groupByCategory(searchPrompts(allPrompts(), query), favoriteIds);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "var(--c-space-2) var(--c-space-3)", borderBottom: "1px solid var(--c-border)" }}>
        <Search size={13} style={{ color: "var(--c-text-muted)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search prompts…"
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--c-text)", fontSize: "var(--c-fs-sm)" }}
        />
        <button onClick={() => (adding ? resetEditor() : setAdding(true))} title="New prompt" aria-label="New prompt" className="cadre-hover" style={{ display: "inline-flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)", color: "var(--c-text-secondary)", cursor: "pointer" }}>
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </div>

      {adding && (
        <div style={{ padding: "var(--c-space-2) var(--c-space-3)", borderBottom: "1px solid var(--c-border)", display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
          <input className="cadre-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" style={{ padding: "5px 9px", fontSize: "var(--c-fs-sm)" }} />
          <textarea className="cadre-input" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Prompt body" rows={3} style={{ padding: "5px 9px", fontSize: "var(--c-fs-sm)", resize: "none", lineHeight: 1.5 }} />
          <select className="cadre-input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as PromptCategory })} style={{ padding: "5px 9px", fontSize: "var(--c-fs-sm)" }}>
            {PROMPT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            className="cadre-btn-primary"
            disabled={!draft.title.trim() || !draft.body.trim()}
            onClick={() => {
              const patch = { title: draft.title.trim(), body: draft.body.trim(), category: draft.category };
              // Editing an existing user prompt patches it in place; otherwise mint a new one.
              if (editingId) updatePrompt(editingId, patch);
              else addPrompt(patch);
              resetEditor();
            }}
            style={{ fontSize: "var(--c-fs-sm)", padding: "5px 12px", borderRadius: "var(--c-radius)", border: "none", cursor: "pointer" }}
          >
            {editingId ? "Save changes" : "Save prompt"}
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-2) var(--c-space-3)" }}>
        {groups.map((g) => (
          <div key={g.category} style={{ marginBottom: "var(--c-space-3)" }}>
            <div className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color: "var(--c-text-muted)", letterSpacing: "0.06em", marginBottom: 4 }}>{g.category}</div>
            {g.prompts.map((p) => (
              <div key={`${g.category}:${p.id}`} className="cadre-hover" style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", borderRadius: "var(--c-radius-sm)", cursor: "pointer" }} onClick={() => onPick(p.body)} title={p.body}>
                <button onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }} title="Favorite" aria-label="Toggle favorite" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", color: favoriteIds.includes(p.id) ? "var(--c-warning)" : "var(--c-text-faint)" }}>
                  <Star size={12} strokeWidth={2} fill={favoriteIds.includes(p.id) ? "currentColor" : "none"} />
                </button>
                <span style={{ flex: 1, minWidth: 0, fontSize: "var(--c-fs-sm)", color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                {!p.builtin && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); startEdit(p); }} title="Edit prompt" aria-label="Edit prompt" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", color: "var(--c-text-faint)" }}>
                      <Pencil size={12} strokeWidth={2} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deletePrompt(p.id); }} title="Delete prompt" aria-label="Delete prompt" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", color: "var(--c-text-faint)" }}>
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
