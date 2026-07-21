import { useState } from "react";
import { Terminal, FolderTree, FileCode2, Eye, Database, Circle, Plus, Play } from "lucide-react";
import { FleetBoard } from "./components/FleetBoard";
import { useBmadStore } from "../stores/bmadStore";
import { useCadre } from "./useCadre";
import type { StoryCard } from "../lib/engine/board";

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
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <FleetBoard stories={display} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {selected ? <AgentPane card={selected} preview={preview} /> : <EmptyAgent />}
        </div>
        <Dock />
      </div>
    </div>
  );
}

function AgentPane({ card, preview }: { card: StoryCard; preview: boolean }) {
  const running = card.status === "InProgress" || card.status === "InReview";
  const dispatchStory = useCadre((s) => s.dispatchStory);
  const busy = useCadre((s) => s.busy);
  const canDispatch = !preview && !busy && (card.status === "Draft" || card.status === "Failed");
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
            color: running ? "var(--c-success)" : "var(--c-text-muted)",
          }}
        >
          <Circle size={7} fill="currentColor" strokeWidth={0} />
          {running ? "live" : "idle"}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          background: "#0a0a0f",
          margin: 0,
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
    </>
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

function Dock() {
  const items = [
    { icon: Terminal, label: "Terminal" },
    { icon: FolderTree, label: "Files" },
    { icon: FileCode2, label: "Code" },
    { icon: Eye, label: "Preview" },
    { icon: Database, label: "Database" },
  ];
  return (
    <div
      style={{
        width: 46,
        borderLeft: "1px solid var(--c-border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "var(--c-space-3) 0",
        flexShrink: 0,
      }}
    >
      {items.map(({ icon: Icon, label }) => (
        <button
          key={label}
          title={label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: "var(--c-radius-sm)",
            background: "var(--c-surface-2)",
            border: "1px solid var(--c-border)",
            color: "var(--c-text-secondary)",
            cursor: "pointer",
          }}
        >
          <Icon size={15} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
