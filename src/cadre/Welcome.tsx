import { useState } from "react";
import { Hexagon, FolderOpen, ArrowRight } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";

/** First-run: open a project (Tauri) or preview the UI (browser). */
export function Welcome({ onPreview }: { onPreview: () => void }) {
  const openProject = useBmadStore((s) => s.openProject);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await openProject(path.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
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
          <span style={{ fontSize: "var(--c-fs-2xl)", fontWeight: 650 as const, letterSpacing: "-0.02em" }}>
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
            onKeyDown={(e) => e.key === "Enter" && open()}
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
            onClick={open}
            disabled={busy || !path.trim()}
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
            {busy ? "Opening…" : "Open"}
            {!busy && <ArrowRight size={14} strokeWidth={2.5} />}
          </button>
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
