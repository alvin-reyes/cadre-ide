import { ArrowUp, ArrowDown, PanelRight, Users, Sun, Moon, SunMoon, Settings as SettingsIcon, ScrollText, Blocks, Wrench } from "lucide-react";
import { useUsageStore } from "../../stores/usageStore";
import { useThemeStore } from "../../stores/themeStore";
import { useBmadStore } from "../../stores/bmadStore";
import { useCadre } from "../useCadre";
import type { ProjectMode } from "../../lib/engine/projectMode";
import { BrandLogo } from "../BrandLogo";
import { WorkspacesMenu } from "./WorkspacesMenu";

/** Build ⇄ Maintain switch — lets the user change how they work on the open project
 *  at any time (the on-open ModeChoiceDialog is the first prompt; this is the escape). */
function ModeSwitch() {
  const projectRoot = useBmadStore((s) => s.projectRoot);
  const mode = useCadre((s) => s.mode);
  const modeChoicePending = useCadre((s) => s.modeChoicePending);
  const chooseMode = useCadre((s) => s.chooseMode);
  // Hidden until a project is open and the initial choice has been made.
  if (!projectRoot || modeChoicePending) return null;

  const seg = (m: ProjectMode, label: string, Icon: typeof Blocks) => {
    const on = mode === m;
    return (
      <button
        onClick={() => chooseMode(m)}
        aria-pressed={on}
        title={m === "build" ? "Build — plan & add features" : "Maintain — Claude terminal in the project"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 24,
          padding: "0 10px",
          borderRadius: "var(--c-radius-sm)",
          background: on ? "var(--c-surface-3)" : "transparent",
          border: "none",
          color: on ? "var(--c-accent)" : "var(--c-text-muted)",
          fontSize: "var(--c-fs-xs)",
          fontWeight: 600 as const,
          cursor: "pointer",
        }}
      >
        <Icon size={13} strokeWidth={2} />
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: 2, borderRadius: "var(--c-radius-md)", background: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}>
      {seg("build", "Build", Blocks)}
      {seg("maintain", "Maintain", Wrench)}
    </div>
  );
}

function fmtK(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

// macOS uses an overlay titlebar (see tauri.conf.json titleBarStyle), so the
// traffic-light buttons float over the top-left of our content. Pad the bar's
// left edge on macOS so the wordmark clears them.
const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** The Cockpit top bar: wordmark + tools + session token/cost meter. The phase
 *  stepper lives in its own centered PhaseBar just below (see CadreApp). */
export function TopBar({
  onToggleWorkbench,
  workbenchOpen,
  onOpenTeam,
  onOpenSettings,
  onOpenLog,
}: {
  onToggleWorkbench?: () => void;
  workbenchOpen?: boolean;
  onOpenTeam?: () => void;
  onOpenSettings?: () => void;
  onOpenLog?: () => void;
}) {
  const input = useUsageStore((s) => s.input);
  const output = useUsageStore((s) => s.output);
  const cost = useUsageStore((s) => s.costUsd);
  const calls = useUsageStore((s) => s.calls);
  const themeMode = useThemeStore((s) => s.mode);
  const cycleTheme = useThemeStore((s) => s.cycle);
  const ThemeIcon = themeMode === "auto" ? SunMoon : themeMode === "light" ? Sun : Moon;
  const themeTitle =
    themeMode === "auto"
      ? "Theme: Auto (follows time of day) — click for Light"
      : themeMode === "light"
        ? "Theme: Light — click for Dark"
        : "Theme: Dark — click for Auto";

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--c-space-4)",
        padding: "var(--c-space-2) var(--c-space-4)",
        paddingLeft: IS_MAC ? 82 : undefined,
        background: "var(--c-surface-1)",
        borderBottom: "1px solid var(--c-border)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, pointerEvents: "none" }}>
        <BrandLogo size={20} />
      </div>

      <ModeSwitch />

      <div style={{ flex: 1 }} />

      <WorkspacesMenu />

      {onOpenTeam && (
        <button
          onClick={onOpenTeam}
          title="Team — your agent fleet"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 24,
            padding: "0 9px",
            borderRadius: "var(--c-radius-sm)",
            background: "transparent",
            border: "1px solid var(--c-border)",
            color: "var(--c-text-secondary)",
            fontSize: "var(--c-fs-xs)",
            fontWeight: 550 as const,
            cursor: "pointer",
          }}
        >
          <Users size={14} strokeWidth={2} />
          Team
        </button>
      )}

      {onOpenLog && (
        <button
          onClick={onOpenLog}
          title="AI activity log"
          aria-label="AI activity log"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 24,
            borderRadius: "var(--c-radius-sm)",
            background: "transparent",
            border: "1px solid var(--c-border)",
            color: "var(--c-text-secondary)",
            cursor: "pointer",
          }}
        >
          <ScrollText size={15} strokeWidth={2} />
        </button>
      )}

      <button
        onClick={cycleTheme}
        title={themeTitle}
        aria-label={themeTitle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 24,
          borderRadius: "var(--c-radius-sm)",
          background: "transparent",
          border: "1px solid var(--c-border)",
          color: themeMode === "auto" ? "var(--c-accent)" : "var(--c-text-secondary)",
          cursor: "pointer",
        }}
      >
        <ThemeIcon size={15} strokeWidth={2} />
      </button>

      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          title="Settings — API keys & models"
          aria-label="Settings — API keys and models"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 24,
            borderRadius: "var(--c-radius-sm)",
            background: "transparent",
            border: "1px solid var(--c-border)",
            color: "var(--c-text-secondary)",
            cursor: "pointer",
          }}
        >
          <SettingsIcon size={15} strokeWidth={2} />
        </button>
      )}

      {onToggleWorkbench && (
        <button
          onClick={onToggleWorkbench}
          title="Toggle Workbench (Files · Code · Terminal)"
          aria-label="Toggle Workbench"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 24,
            borderRadius: "var(--c-radius-sm)",
            background: workbenchOpen ? "var(--c-surface-3)" : "transparent",
            border: "1px solid var(--c-border)",
            color: workbenchOpen ? "var(--c-accent)" : "var(--c-text-secondary)",
            cursor: "pointer",
          }}
        >
          <PanelRight size={15} strokeWidth={2} />
        </button>
      )}

      <div
        title={`${calls} model call${calls === 1 ? "" : "s"} this session · ${input.toLocaleString()} in / ${output.toLocaleString()} out tokens · estimated cost`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: "var(--c-fs-xs)",
          fontFamily: "var(--c-font-mono)",
          color: "var(--c-text-muted)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <ArrowUp size={11} strokeWidth={2.5} />
          {fmtK(input)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <ArrowDown size={11} strokeWidth={2.5} />
          {fmtK(output)}
        </span>
        <span style={{ color: "var(--c-text-secondary)" }}>~${cost.toFixed(cost < 1 ? 3 : 2)}</span>
      </div>
    </div>
  );
}
