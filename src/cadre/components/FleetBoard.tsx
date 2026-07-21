import type { StoryCard } from "../../lib/engine/board";
import { StatusPill } from "./StatusPill";

/** The Fleet board: story cards from the reconciled `bmadStore`, outcomes-first. */
export function FleetBoard({
  stories,
  selectedId,
  onSelect,
}: {
  stories: StoryCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      style={{
        width: 232,
        borderRight: "1px solid var(--c-border)",
        padding: "var(--c-space-3)",
        overflow: "auto",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: "9px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--c-text-muted)",
          fontWeight: 600 as const,
          margin: "0 4px var(--c-space-2)",
        }}
      >
        Fleet · {stories.length} {stories.length === 1 ? "story" : "stories"}
      </div>

      {stories.length === 0 && (
        <div
          style={{
            fontSize: "var(--c-fs-sm)",
            color: "var(--c-text-faint)",
            padding: "var(--c-space-4) 4px",
            lineHeight: 1.5,
          }}
        >
          No stories yet. Approve the plan and shard it to fill the board.
        </div>
      )}

      {stories.map((card) => {
        const selected = card.id === selectedId;
        return (
          <button
            key={card.id}
            onClick={() => onSelect(card.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: selected ? "var(--c-surface-3)" : "var(--c-surface-2)",
              border: `1px solid ${selected ? "var(--c-accent-ring)" : "var(--c-border)"}`,
              borderRadius: "var(--c-radius)",
              padding: "8px 9px",
              marginBottom: 7,
              cursor: "pointer",
              transition: "border-color var(--c-dur) var(--c-ease-out)",
            }}
          >
            <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text)", marginBottom: 5 }}>
              <span style={{ color: "var(--c-text-muted)", fontFamily: "var(--c-font-mono)" }}>
                {card.id}
              </span>{" "}
              {card.title || "(untitled)"}
            </div>
            <StatusPill status={card.status} />
          </button>
        );
      })}
    </div>
  );
}
