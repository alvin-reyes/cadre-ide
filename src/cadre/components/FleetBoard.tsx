import { useState, useEffect } from "react";
import { ShieldCheck, ShieldAlert, Gavel } from "lucide-react";
import type { StoryCard } from "../../lib/engine/board";
import { StatusPill } from "./StatusPill";
import { useCadre, isInterrupted } from "../useCadre";
import { useRepos } from "../../stores/reposStore";
import { aggregateReviews } from "../../lib/engine/reviewFleet";
import { parseStoryRepo } from "../../lib/engine/shard";
import { DEFAULT_REPO_ID } from "../../lib/engine/repos";

/** Compact adversarial-review verdict for a story card (review fleet, at a glance). */
function ReviewBadge({ storyId }: { storyId: string }) {
  const review = useCadre((s) => s.codeReviews[storyId]);
  if (!review) return null;
  if (review.status === "reviewing") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--c-fs-xs)", color: "var(--c-accent)" }}>
        <Gavel size={11} strokeWidth={2} /> reviewing
      </span>
    );
  }
  if (!review.reviews || review.reviews.length === 0) return null;
  const agg = aggregateReviews(review.reviews);
  return agg.verdict === "block" ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--c-fs-xs)", color: "var(--c-warning)", fontWeight: 600 as const }}>
      <ShieldAlert size={11} strokeWidth={2.5} /> {agg.findingCount}
    </span>
  ) : (
    <ShieldCheck size={12} strokeWidth={2.5} style={{ color: "var(--c-success)" }} />
  );
}

/**
 * Async repo chip: loads the story's markdown once and shows its repo id.
 * Hidden when only one repo is registered (single-repo projects look unchanged).
 */
function RepoChip({ epic, story }: { epic: number; story: number }) {
  const repos = useRepos((s) => s.repos);
  const getStoryMarkdown = useCadre((s) => s.getStoryMarkdown);
  const [repoId, setRepoId] = useState<string | null>(null);

  // Only show when there are multiple repos
  const multiRepo = repos.length > 1;

  useEffect(() => {
    if (!multiRepo) return;
    let alive = true;
    getStoryMarkdown(epic, story).then((md) => {
      if (alive) setRepoId(parseStoryRepo(md));
    });
    return () => { alive = false; };
  }, [epic, story, multiRepo, getStoryMarkdown]);

  if (!multiRepo || !repoId || repoId === DEFAULT_REPO_ID) return null;

  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "var(--c-font-mono)",
        fontWeight: 600 as const,
        color: "var(--c-accent)",
        background: "var(--c-accent-subtle)",
        border: "1px solid var(--c-accent-ring)",
        borderRadius: "var(--c-radius-full)",
        padding: "1px 6px",
        flexShrink: 0,
        lineHeight: 1.6,
      }}
    >
      {repoId}
    </span>
  );
}

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
  const active = useCadre((s) => s.active);
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
              <StatusPill status={card.status} interrupted={isInterrupted(card.status, active, card.epic, card.story)} />
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <RepoChip epic={card.epic} story={card.story} />
                <ReviewBadge storyId={card.id} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
