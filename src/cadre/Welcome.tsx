import { useEffect, useRef, useState } from "react";
import { Hexagon, FolderOpen, ArrowRight, Sparkles, KeyRound, Eye, EyeOff, Check } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useBmadStore } from "../stores/bmadStore";
import { useSettingsStore } from "../stores/settingsStore";
import { isTauri } from "../lib/secrets";

/** First-run: start a new idea, open an existing project, or preview the UI. */
export function Welcome({ onPreview }: { onPreview: () => void }) {
  const openProject = useBmadStore((s) => s.openProject);
  const newProject = useBmadStore((s) => s.newProject);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"open" | "new" | null>(null);

  // Anthropic API key — settable here so it's ready before opening a project.
  // Stored in the OS keychain (setAnthropicApiKey mirrors it there).
  const anthropicKey = useSettingsStore((s) => s.anthropicApiKey);
  const setAnthropicKey = useSettingsStore((s) => s.setAnthropicApiKey);
  const [keyDraft, setKeyDraft] = useState("");
  const [revealKey, setRevealKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const keyTouched = useRef(false);
  // Reflect a key hydrated from the keychain after mount — but never clobber an
  // in-progress edit if hydration lands while the user is typing.
  useEffect(() => {
    if (!keyTouched.current) setKeyDraft(anthropicKey);
  }, [anthropicKey]);
  function saveKey() {
    setAnthropicKey(keyDraft.trim());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1600);
  }

  async function browse() {
    if (!isTauri()) {
      setError("The folder picker needs the desktop app — run `npm run tauri dev` and use the native Cadre window.");
      return;
    }
    try {
      const dir = await openDialog({ directory: true, multiple: false, title: "Choose a project folder" });
      if (typeof dir === "string") {
        setPath(dir);
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    }
  }

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

  // Start-new goes straight to the folder picker; the chosen folder becomes the
  // project root where everything (cadre.json, docs, git) is scaffolded.
  async function startNew() {
    if (busy) return;
    if (!isTauri()) {
      setError(
        "Creating a project needs the desktop app. You're on the browser preview (localhost:1420) — run `npm run tauri dev` and use the native Cadre window instead."
      );
      return;
    }
    let dir: string | null = null;
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: "Choose a folder for the new project" });
      if (typeof picked === "string") dir = picked;
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!dir) return; // cancelled
    setPath(dir);
    setBusy("new");
    setError(null);
    try {
      await newProject(dir);
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
          <button
            onClick={browse}
            title="Browse for a folder"
            style={{ display: "inline-flex", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", flexShrink: 0, padding: 0 }}
          >
            <FolderOpen size={16} strokeWidth={2} />
          </button>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run("open")}
            placeholder="Browse or paste a folder path…"
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
            onClick={startNew}
            disabled={!!busy}
            title="Pick a folder — Cadre scaffolds a fresh project (git + docs) inside it"
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
              cursor: busy ? "default" : "pointer",
            }}
          >
            <Sparkles size={14} strokeWidth={2} />
            {busy === "new" ? "Creating…" : "Start a new project…"}
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

        {/* Anthropic API key — set it now so planning works the moment a project opens. */}
        <div style={{ marginTop: "var(--c-space-5)", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <KeyRound size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
            <span style={{ fontSize: "var(--c-fs-xs)", fontWeight: 550 as const, color: "var(--c-text-secondary)" }}>
              Anthropic API key
            </span>
            {anthropicKey && !keySaved && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--c-fs-xs)", color: "var(--c-success)" }}>
                <Check size={11} strokeWidth={3} /> set
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type={revealKey ? "text" : "password"}
                value={keyDraft}
                onChange={(e) => {
                  keyTouched.current = true;
                  setKeyDraft(e.target.value);
                  setKeySaved(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && keyDraft.trim() && saveKey()}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  background: "var(--c-surface-1)",
                  border: "1px solid var(--c-border-strong)",
                  borderRadius: "var(--c-radius)",
                  outline: "none",
                  color: "var(--c-text)",
                  fontSize: "var(--c-fs-sm)",
                  fontFamily: "var(--c-font-mono)",
                  padding: "7px 34px 7px 10px",
                }}
              />
              <button
                onClick={() => setRevealKey((r) => !r)}
                title={revealKey ? "Hide" : "Reveal"}
                tabIndex={-1}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "inline-flex", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", padding: 4 }}
              >
                {revealKey ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
              </button>
            </div>
            <button
              onClick={saveKey}
              disabled={!keyDraft.trim()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--c-fs-sm)",
                fontWeight: 550 as const,
                padding: "0 14px",
                borderRadius: "var(--c-radius)",
                background: keySaved ? "var(--c-success-subtle)" : keyDraft.trim() ? "var(--c-accent)" : "var(--c-surface-3)",
                color: keySaved ? "var(--c-success)" : keyDraft.trim() ? "var(--c-on-accent)" : "var(--c-text-muted)",
                border: "none",
                cursor: keyDraft.trim() ? "pointer" : "default",
                flexShrink: 0,
              }}
            >
              {keySaved ? <Check size={14} strokeWidth={2.5} /> : null}
              {keySaved ? "Saved" : "Save"}
            </button>
          </div>
          <div style={{ marginTop: 5, fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
            {isTauri()
              ? "Stored in your OS keychain. Get one at console.anthropic.com."
              : "Browser preview — kept in memory only; the desktop app saves it to the keychain."}
          </div>
        </div>

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
