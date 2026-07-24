import type { CSSProperties } from "react";
import {
  Crown,
  PencilRuler,
  Ruler,
  Palette,
  Gavel,
  ClipboardCheck,
  Code2,
  ShieldAlert,
  FlaskConical,
  Rocket,
  Search,
  BookText,
} from "lucide-react";
import { Modal } from "./components/Modal";
import { useCadre } from "./useCadre";
import { useBmadStore } from "../stores/bmadStore";
import { useSettingsStore } from "../stores/settingsStore";
import { agentLabel, reconcileSlots } from "../lib/engine/agentSlots";

/**
 * The Team view — the CTO's org chart of the agent fleet: who's on the team, what
 * each does, and which model tier they run on. Mirrors the real roster wired in
 * the app (planning personas, adversarial reviewers, the dev/QA/deploy fleet).
 */

type Tier = "Opus" | "Sonnet" | "You";
interface Member {
  name: string;
  role: string;
  icon: typeof Crown;
  tier: Tier;
  planned?: boolean;
}

const PLANNING: Member[] = [
  { name: "Analyst", role: "Discovery & research — the project brief", icon: Search, tier: "Opus" },
  { name: "PM", role: "Requirements lead & orchestrator — owns the PRD", icon: PencilRuler, tier: "Opus" },
  { name: "Architect", role: "System design + the verification command", icon: Ruler, tier: "Opus" },
  { name: "Designer", role: "UX spec + live HTML mockup", icon: Palette, tier: "Opus" },
  { name: "Technical Writer", role: "Plans & drafts the documentation", icon: BookText, tier: "Opus" },
];

const REVIEW: Member[] = [
  { name: "Adversarial critics", role: "One per artifact (PM/Architect/Designer) — default-to-reject", icon: Gavel, tier: "Opus" },
  { name: "Plan validation", role: "Whole-plan check that backs your CTO sign-off", icon: ClipboardCheck, tier: "Opus" },
];

const FLEET: Member[] = [
  { name: "Dev agent", role: "Implements the story test-first (claude -p in a worktree)", icon: Code2, tier: "Sonnet" },
  { name: "Code reviewers ×3", role: "Diverse lenses — correctness · security · story-fit", icon: ShieldAlert, tier: "Sonnet" },
  { name: "QA", role: "Mandatory gate + committed test report", icon: FlaskConical, tier: "Sonnet", planned: true },
  { name: "Deployer", role: "Engine-run deploy + health check", icon: Rocket, tier: "Sonnet", planned: true },
];

function TierBadge({ tier }: { tier: Tier }) {
  const map: Record<Tier, { bg: string; fg: string }> = {
    Opus: { bg: "var(--c-accent-subtle)", fg: "var(--c-accent)" },
    Sonnet: { bg: "var(--c-surface-3)", fg: "var(--c-text-secondary)" },
    You: { bg: "var(--c-success-subtle)", fg: "var(--c-success)" },
  };
  const c = map[tier];
  return (
    <span style={{ fontSize: 10, fontWeight: 600 as const, color: c.fg, background: c.bg, borderRadius: "var(--c-radius-full)", padding: "1px 8px", flexShrink: 0 }}>
      {tier}
    </span>
  );
}

type Live = { label: string; kind: "active" | "done" | "idle" };

function StatusPill({ live }: { live: Live }) {
  const color = live.kind === "done" ? "var(--c-success)" : live.kind === "active" ? "var(--c-accent)" : "var(--c-text-muted)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--c-fs-xs)", color, flexShrink: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
      {live.label}
    </span>
  );
}

function MemberRow({ m, live }: { m: Member; live?: Live }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius)", opacity: m.planned ? 0.6 : 1 }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--c-surface-3)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text-secondary)", flexShrink: 0 }}>
        <m.icon size={14} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text)", fontWeight: 550 as const }}>
          {m.name}
          {m.planned && <span style={{ marginLeft: 6, fontSize: 9, color: "var(--c-text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>planned</span>}
        </div>
        <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>{m.role}</div>
      </div>
      {live && <StatusPill live={live} />}
      <TierBadge tier={m.tier} />
    </div>
  );
}

const sectionLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--c-text-muted)",
  fontWeight: 600 as const,
  margin: "4px 2px",
};

export function Team({ onClose }: { onClose: () => void }) {
  const prd = useCadre((s) => s.prd);
  const architecture = useCadre((s) => s.architecture);
  const uxSpec = useCadre((s) => s.uxSpec);
  const analystBrief = useCadre((s) => s.analystBrief);
  const techDocs = useCadre((s) => s.techDocs);
  const stories = useBmadStore((s) => s.stories);

  // Team pool
  const useTeamPool = useSettingsStore((s) => s.useTeamPool);
  const teamSize = useSettingsStore((s) => s.teamSize);
  const agentSlots = useCadre((s) => s.agentSlots);

  const planningLive = (name: string): Live | undefined => {
    const ready = (has: boolean): Live => (has ? { label: "ready", kind: "done" } : { label: "idle", kind: "idle" });
    if (name === "PM") return prd.trim() ? { label: "PRD ready", kind: "done" } : { label: "idle", kind: "idle" };
    if (name === "Analyst") return ready(!!analystBrief.trim());
    if (name === "Architect") return ready(!!architecture.trim());
    if (name === "Designer") return ready(!!uxSpec.trim());
    if (name === "Technical Writer") return ready(!!techDocs.trim());
    return undefined;
  };

  const counts = { building: 0, blocked: 0, done: 0, draft: 0 };
  for (const s of stories) {
    if (s.status === "InProgress" || s.status === "InReview") counts.building++;
    else if (s.status === "Blocked" || s.status === "Failed") counts.blocked++;
    else if (s.status === "Done") counts.done++;
    else counts.draft++;
  }

  return (
    <Modal
      label="Team — your agent fleet"
      width={560}
      onClose={onClose}
      title={
        <>
          <span className="cadre-wordmark" style={{ fontSize: "var(--c-fs-lg)" }}>Team</span>
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>your agent fleet · Opus thinks, Sonnet builds</span>
        </>
      }
    >
        <div style={{ padding: "var(--c-space-4)", display: "flex", flexDirection: "column", gap: "var(--c-space-4)" }}>
          {/* You — the CTO */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--c-success-subtle)", border: "1px solid var(--c-accent-ring)", borderRadius: "var(--c-radius)" }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--c-surface-2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-success)", flexShrink: 0 }}>
              <Crown size={16} strokeWidth={2} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "var(--c-fs-md)", color: "var(--c-text)", fontWeight: 600 as const }}>You · CTO</div>
              <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)" }}>Direct the fleet, hold the sign-off, vouch for the build. Everyone reports up to you.</div>
            </div>
            <TierBadge tier="You" />
          </div>

          <div style={{ textAlign: "center", color: "var(--c-text-faint)", fontSize: "var(--c-fs-xs)" }}>│</div>

          <div>
            <div style={sectionLabel}>Planning — they create</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PLANNING.map((m) => <MemberRow key={m.name} m={m} live={planningLive(m.name)} />)}
            </div>
          </div>

          <div>
            <div style={sectionLabel}>Adversarial review — they pressure-test</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {REVIEW.map((m) => <MemberRow key={m.name} m={m} />)}
            </div>
          </div>

          <div>
            <div style={sectionLabel}>Fleet — they build & ship (per story)</div>
            {useTeamPool ? (
              /* ── Team-pool mode: list agent slots ── */
              (() => {
                // Derive slots from teamSize via reconcileSlots so the roster
                // matches teamSize immediately after the user changes it.
                const slotsToShow = reconcileSlots(teamSize, agentSlots);

                function slotLive(status: "idle" | "working" | "verifying"): Live {
                  if (status === "working") return { label: "working", kind: "active" };
                  if (status === "verifying") return { label: "verifying", kind: "active" };
                  return { label: "idle", kind: "idle" };
                }

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {slotsToShow.map((slot) => {
                      const storyCard = slot.currentStory
                        ? stories.find((s) => s.id === slot.currentStory)
                        : null;
                      const assignment = storyCard
                        ? `${storyCard.epic}.${storyCard.story} · ${storyCard.title ?? slot.currentStory}`
                        : "No task assigned";

                      const m: Member = {
                        name: agentLabel(slot.agentId),
                        role: assignment,
                        icon: Code2,
                        tier: "Sonnet",
                      };
                      return <MemberRow key={slot.agentId} m={m} live={slotLive(slot.status)} />;
                    })}
                  </div>
                );
              })()
            ) : (
              /* ── Classic mode: existing static fleet rows ── */
              <>
                <div style={{ display: "flex", gap: 12, padding: "0 2px 6px", fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
                  {stories.length === 0 ? (
                    <span>No stories yet.</span>
                  ) : (
                    <>
                      <span>{stories.length} stories</span>
                      {counts.building > 0 && <span style={{ color: "var(--c-accent)" }}>{counts.building} building</span>}
                      {counts.blocked > 0 && <span style={{ color: "var(--c-warning)" }}>{counts.blocked} blocked</span>}
                      {counts.done > 0 && <span style={{ color: "var(--c-success)" }}>{counts.done} done</span>}
                    </>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {FLEET.map((m) => <MemberRow key={m.name} m={m} />)}
                </div>
              </>
            )}
          </div>
        </div>
    </Modal>
  );
}
