import { useState, useEffect, useRef } from "react";
import { marked } from "marked";
import { Circle, Plus, Play, Cpu } from "lucide-react";
import { FleetBoard } from "./components/FleetBoard";
import { useBmadStore } from "../stores/bmadStore";
import { useCadre } from "./useCadre";
import { PROVIDERS, getProvider } from "../lib/engine/providers";
import { secretHas, secretSet } from "../lib/secrets";
import type { StoryCard } from "../lib/engine/board";
import type { Status } from "../lib/engine/status";

// How each engine Status reads in the agent pane (the thesis: cadre verifies).
function stateInfo(status: Status): { label: string; color: string; live: boolean } {
  switch (status) {
    case "InProgress":
      return { label: "Agent working — cadre verifies before Done", color: "var(--c-accent)", live: true };
    case "InReview":
      return { label: "Verifying — running the frozen command", color: "var(--c-warning)", live: true };
    case "Done":
      return { label: "Verified — Done", color: "var(--c-success)", live: false };
    case "Failed":
      return { label: "Failed verification — bounce to fix", color: "var(--c-danger)", live: false };
    case "Blocked":
      return { label: "Blocked", color: "var(--c-danger)", live: false };
    default:
      return { label: "Ready to dispatch", color: "var(--c-text-muted)", live: false };
  }
}

// Shown only in UI-preview (no project open), so the layout isn't empty.
const DEMO: StoryCard[] = [
  { id: "1.1", epic: 1, story: 1, title: "JWT sign/verify", status: "InProgress" },
  { id: "1.2", epic: 1, story: 2, title: "Login endpoint", status: "InReview" },
  { id: "1.0", epic: 1, story: 0, title: "Scaffold + config", status: "Done" },
  { id: "2.1", epic: 2, story: 1, title: "Session store", status: "Draft" },
];

export function FleetView() {
  const stories = useBmadStore((s) => s.stories);
  const projectRoot = useBmadStore((s) => s.projectRoot);
  const shardNextStory = useCadre((s) => s.shardNextStory);
  const busy = useCadre((s) => s.busy);
  const error = useCadre((s) => s.error);

  const preview = !projectRoot;
  const display = preview ? DEMO : stories;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = display.find((c) => c.id === selectedId) ?? display[0] ?? null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Fleet toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-3)",
          padding: "var(--c-space-2) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => shardNextStory(1)}
          disabled={preview || !!busy}
          title={preview ? "Open a project to shard stories" : "Run the SM to shard the next story"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-sm)",
            fontWeight: 550 as const,
            padding: "5px 12px",
            borderRadius: "var(--c-radius)",
            background: preview || busy ? "var(--c-surface-3)" : "var(--c-accent)",
            color: preview || busy ? "var(--c-text-muted)" : "var(--c-on-accent)",
            border: "none",
            cursor: preview || busy ? "default" : "pointer",
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
          Generate story (SM)
        </button>
        <span style={{ fontSize: "var(--c-fs-xs)", color: busy ? "var(--c-accent)" : error ? "var(--c-danger)" : "var(--c-text-muted)" }}>
          {busy ?? error ?? (preview ? "Preview — open a project to run the fleet." : `${stories.length} stor${stories.length === 1 ? "y" : "ies"}`)}
        </span>
        <div style={{ flex: 1 }} />
        {!preview && <FleetModelPicker />}
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <FleetBoard stories={display} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {selected ? <AgentPane card={selected} preview={preview} /> : <EmptyAgent />}
        </div>
      </div>
    </div>
  );
}

/** Choose which model the Dev fleet runs on; capture a non-Claude key if needed. */
function FleetModelPicker() {
  const fleetProvider = useCadre((s) => s.fleetProvider);
  const setFleetProvider = useCadre((s) => s.setFleetProvider);
  const provider = getProvider(fleetProvider);
  const [hasKey, setHasKey] = useState(true);
  const [keyDraft, setKeyDraft] = useState("");

  useEffect(() => {
    let alive = true;
    if (provider.id === "claude") {
      setHasKey(true); // claude falls back to the settings/keychain Anthropic key
      return;
    }
    secretHas(provider.secretKey).then((h) => {
      if (alive) setHasKey(h);
    });
    return () => {
      alive = false;
    };
  }, [provider.id, provider.secretKey]);

  async function saveKey() {
    const v = keyDraft.trim();
    if (!v) return;
    await secretSet(provider.secretKey, v);
    setKeyDraft("");
    setHasKey(true);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Cpu size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
      <select
        value={fleetProvider}
        onChange={(e) => setFleetProvider(e.target.value)}
        title="Model the Dev fleet runs on"
        style={{
          background: "var(--c-surface-2)",
          color: "var(--c-text)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--c-radius-sm)",
          fontSize: "var(--c-fs-xs)",
          padding: "3px 6px",
          fontFamily: "var(--c-font-ui)",
          cursor: "pointer",
        }}
      >
        {Object.values(PROVIDERS).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {!hasKey && (
        <>
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKey()}
            placeholder={`${provider.name} key`}
            style={{
              width: 130,
              background: "var(--c-surface-1)",
              border: "1px solid var(--c-warning)",
              borderRadius: "var(--c-radius-sm)",
              outline: "none",
              color: "var(--c-text)",
              fontSize: "var(--c-fs-xs)",
              fontFamily: "var(--c-font-mono)",
              padding: "3px 6px",
            }}
          />
          <button
            onClick={saveKey}
            style={{
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "3px 9px",
              borderRadius: "var(--c-radius-sm)",
              background: "var(--c-accent)",
              color: "var(--c-on-accent)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Save
          </button>
        </>
      )}
    </div>
  );
}

function AgentPane({ card, preview }: { card: StoryCard; preview: boolean }) {
  const dispatchStory = useCadre((s) => s.dispatchStory);
  const getStoryMarkdown = useCadre((s) => s.getStoryMarkdown);
  const busy = useCadre((s) => s.busy);
  const canDispatch = !preview && !busy && (card.status === "Draft" || card.status === "Failed");
  const info = stateInfo(card.status);

  const log = useCadre((s) => s.logs[card.id] ?? "");
  const hasLog = log.length > 0;

  const [markdown, setMarkdown] = useState<string>("");
  useEffect(() => {
    if (preview) return;
    let alive = true;
    setMarkdown("");
    getStoryMarkdown(card.epic, card.story).then((md) => {
      if (alive) setMarkdown(md);
    });
    return () => {
      alive = false;
    };
  }, [preview, card.epic, card.story, card.status, getStoryMarkdown]);

  // Default to the live Output once a dispatch has produced any; Story otherwise.
  // (Manual toggles below persist — deps only change on card switch / first output.)
  const [view, setView] = useState<"story" | "output">("story");
  useEffect(() => {
    setView(hasLog ? "output" : "story");
  }, [card.id, hasLog]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-2)",
          padding: "var(--c-space-2) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--c-fs-sm)",
            color: "var(--c-accent)",
            background: "var(--c-accent-subtle)",
            border: "1px solid var(--c-accent-ring)",
            borderRadius: "var(--c-radius-full)",
            padding: "2px 10px",
          }}
        >
          dev · story {card.id}
        </span>
        <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-muted)" }}>
          claude · branch story/{card.id}
        </span>
        <div style={{ flex: 1 }} />
        {canDispatch && (
          <button
            onClick={() => dispatchStory(card.epic, card.story)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "4px 10px",
              borderRadius: "var(--c-radius-sm)",
              background: "var(--c-accent)",
              color: "var(--c-on-accent)",
              border: "none",
              cursor: "pointer",
            }}
          >
            <Play size={12} strokeWidth={2.5} />
            Dispatch
          </button>
        )}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-xs)",
            color: info.live ? info.color : "var(--c-text-muted)",
          }}
        >
          <Circle size={7} fill="currentColor" strokeWidth={0} />
          {info.live ? "live" : "idle"}
        </span>
      </div>

      {/* Status strip — the engine, not the agent, decides Done. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          fontSize: "var(--c-fs-xs)",
          color: info.color,
          background: "var(--c-surface-1)",
          flexShrink: 0,
        }}
      >
        <Circle size={7} fill="currentColor" strokeWidth={0} />
        {info.label}
        <div style={{ flex: 1 }} />
        {!preview && (
          <div style={{ display: "flex", gap: 2 }}>
            {(["story", "output"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  fontSize: "var(--c-fs-xs)",
                  fontWeight: 550 as const,
                  textTransform: "capitalize",
                  padding: "2px 9px",
                  borderRadius: "var(--c-radius-full)",
                  border: "1px solid transparent",
                  background: view === v ? "var(--c-surface-3)" : "transparent",
                  color: view === v ? "var(--c-text)" : "var(--c-text-muted)",
                  cursor: "pointer",
                }}
              >
                {v}
                {v === "output" && hasLog && info.live ? " ·live" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {preview ? (
        <DemoTerminal />
      ) : view === "output" ? (
        <LiveTerminal log={log} empty="No agent output yet — Dispatch to run the story." />
      ) : markdown ? (
        <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-5)" }}>
          <div
            className="cadre-doc"
            style={{ fontSize: "var(--c-fs-md)", lineHeight: 1.6, color: "var(--c-text-secondary)" }}
            dangerouslySetInnerHTML={{ __html: marked.parse(markdown) as string }}
          />
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--c-text-faint)",
            fontSize: "var(--c-fs-sm)",
          }}
        >
          Loading story…
        </div>
      )}
    </>
  );
}

// Strip ANSI escape sequences so the streamed PTY output reads cleanly.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** The live agent + verification transcript, auto-scrolled to the tail. */
function LiveTerminal({ log, empty }: { log: string; empty: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (!log) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--c-text-faint)",
          fontSize: "var(--c-fs-sm)",
          background: "#14100c",
        }}
      >
        {empty}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      style={{
        flex: 1,
        background: "#14100c",
        padding: "var(--c-space-3) var(--c-space-4)",
        fontFamily: "var(--c-font-mono)",
        fontSize: "var(--c-fs-sm)",
        lineHeight: 1.55,
        color: "var(--c-text-secondary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "auto",
      }}
    >
      {stripAnsi(log)}
    </div>
  );
}

function DemoTerminal() {
  return (
    <div
      style={{
        flex: 1,
        background: "#14100c",
        padding: "var(--c-space-3) var(--c-space-4)",
        fontFamily: "var(--c-font-mono)",
        fontSize: "var(--c-fs-sm)",
        lineHeight: 1.6,
        color: "var(--c-success)",
        overflow: "auto",
      }}
    >
      <div style={{ color: "var(--c-text-muted)" }}>▸ writing the failing test first…</div>
      <div style={{ color: "var(--c-text-faint)" }}>&nbsp;&nbsp;src/auth/jwt.spec.ts</div>
      <div style={{ color: "var(--c-accent)" }}>$ pnpm test jwt</div>
      <div>&nbsp;&nbsp;✓ signs and verifies a token</div>
      <div style={{ color: "var(--c-text-muted)" }}>▸ implementing…</div>
      <div style={{ color: "var(--c-text-faint)" }}>
        &nbsp;&nbsp;(cadre runs the verification itself before Done)
      </div>
    </div>
  );
}

function EmptyAgent() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--c-text-faint)",
        fontSize: "var(--c-fs-sm)",
      }}
    >
      Select a story to watch its agent.
    </div>
  );
}
