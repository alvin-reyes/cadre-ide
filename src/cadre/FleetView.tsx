import { useState } from "react";
import { Terminal, FolderTree, FileCode2, Eye, Database, Circle } from "lucide-react";
import { FleetBoard } from "./components/FleetBoard";
import { useBmadStore } from "../stores/bmadStore";
import type { StoryCard } from "../lib/engine/board";

// Shown until a real project's stories flow in via the reconciler.
const DEMO: StoryCard[] = [
  { id: "1.1", epic: 1, story: 1, title: "JWT sign/verify", status: "InProgress" },
  { id: "1.2", epic: 1, story: 2, title: "Login endpoint", status: "InReview" },
  { id: "1.0", epic: 1, story: 0, title: "Scaffold + config", status: "Done" },
  { id: "2.1", epic: 2, story: 1, title: "Session store", status: "Draft" },
];

export function FleetView() {
  const stories = useBmadStore((s) => s.stories);
  const display = stories.length ? stories : DEMO;
  const [selectedId, setSelectedId] = useState<string | null>(display[0]?.id ?? null);
  const selected = display.find((c) => c.id === selectedId) ?? null;

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <FleetBoard stories={display} selectedId={selectedId} onSelect={setSelectedId} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {selected ? <AgentPane card={selected} /> : <EmptyAgent />}
      </div>
      <Dock />
    </div>
  );
}

function AgentPane({ card }: { card: StoryCard }) {
  const running = card.status === "InProgress" || card.status === "InReview";
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
