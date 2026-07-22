import { useState } from "react";
import { Hexagon, FolderOpen, ArrowRight, Sparkles } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { isTauri } from "../lib/secrets";

/** First-run: start a new idea, open an existing project, or preview the UI. */
export function Welcome({ onPreview }: { onPreview: () => void }) {
  const openProject = useBmadStore((s) => s.openProject);
  const newProject = useBmadStore((s) => s.newProject);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"open" | "new" | null>(null);

  async function run(kind: "open" | "new") {
    if (!path.trim() || busy) return;
    if (!isTauri()) {
      setError(
        "Opening or creating a project needs the desktop app. You're on the browser preview (localhost:1420) — run `npm run tauri dev` and use the native Cadre window instead."
      );
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      if (kind === "new") await newProject(path.trim());
      else await openProject(path.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="cadre-ui"
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: 440, textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: "var(--c-space-3)" }}>
          <Hexagon size={26} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
          <span className="cadre-wordmark" style={{ fontSize: "var(--c-fs-2xl)" }}>
            cadre
          </span>
        </div>
        <div style={{ fontSize: "var(--c-fs-md)", color: "var(--c-text-secondary)", marginBottom: "var(--c-space-6)" }}>
          Disciplined AI development. <b style={{ color: "var(--c-text)" }}>Verified, not vibed.</b>
        </div>

        <div
          style={{
            display: "flex",
            gap: "var(--c-space-2)",
            background: "var(--c-surface-1)",
            border: "1px solid var(--c-border-strong)",
            borderRadius: "var(--c-radius-lg)",
            padding: "8px 8px 8px 12px",
            alignItems: "center",
          }}
        >
          <FolderOpen size={16} strokeWidth={2} style={{ color: "var(--c-text-muted)", flexShrink: 0 }} />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run("open")}
            placeholder="/path/to/your/project"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--c-text)",
              fontSize: "var(--c-fs-md)",
              fontFamily: "var(--c-font-mono)",
            }}
          />
          <button
            onClick={() => run("open")}
            disabled={!!busy || !path.trim()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              borderRadius: "var(--c-radius)",
              background: path.trim() ? "var(--c-accent)" : "var(--c-surface-3)",
              color: path.trim() ? "var(--c-on-accent)" : "var(--c-text-muted)",
              border: "none",
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              cursor: path.trim() ? "pointer" : "default",
            }}
          >
            {busy === "open" ? "Opening…" : "Open"}
            {busy !== "open" && <ArrowRight size={14} strokeWidth={2.5} />}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)", marginTop: "var(--c-space-3)" }}>
          <button
            onClick={() => run("new")}
            disabled={!!busy || !path.trim()}
            title="Scaffold a fresh Cadre project (git + docs) at that path"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              flex: 1,
              padding: "8px 12px",
              borderRadius: "var(--c-radius)",
              background: "var(--c-surface-2)",
              color: "var(--c-text)",
              border: "1px solid var(--c-border-strong)",
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              cursor: path.trim() && !busy ? "pointer" : "default",
            }}
          >
            <Sparkles size={14} strokeWidth={2} />
            {busy === "new" ? "Creating…" : "Start a new project here"}
          </button>
        </div>

        <div style={{ marginTop: "var(--c-space-3)", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", lineHeight: 1.5 }}>
          Open an <b style={{ color: "var(--c-text-muted)" }}>existing</b> project and the PM can read the whole
          codebase (twice) to plan with full context.
        </div>

        {error && (
          <div style={{ marginTop: "var(--c-space-2)", fontSize: "var(--c-fs-sm)", color: "var(--c-danger)" }}>
            {error}
          </div>
        )}

        <button
          onClick={onPreview}
          style={{
            marginTop: "var(--c-space-5)",
            background: "transparent",
            border: "none",
            color: "var(--c-text-muted)",
            fontSize: "var(--c-fs-sm)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Preview the UI (demo data)
        </button>
      </div>
    </div>
  );
}
