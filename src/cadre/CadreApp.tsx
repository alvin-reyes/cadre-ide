import { useState, useEffect } from "react";
import { FolderTree, FileCode2, SquareTerminal } from "lucide-react";
import { TopBar } from "./components/TopBar";
import { PlanningStudio } from "./PlanningStudio";
import { FleetView } from "./FleetView";
import { Workbench, type WorkbenchTab } from "./Workbench";
import { Team } from "./Team";
import { Settings } from "./Settings";
import { Toaster } from "./Toaster";
import { Welcome } from "./Welcome";
import { useBmadStore } from "../stores/bmadStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useCadre } from "./useCadre";

/** The Cadre Cockpit shell. Phase-driven main area (§4.3). */
export function CadreApp() {
  const phase = useCadre((s) => s.phase);
  const setPhase = useCadre((s) => s.setPhase);
  const hydrateFromProject = useCadre((s) => s.hydrateFromProject);
  const hydrateSecrets = useSettingsStore((s) => s.hydrateSecrets);
  const showSettings = useSettingsStore((s) => s.showSettings);
  const setShowSettings = useSettingsStore((s) => s.setShowSettings);
  const [preview, setPreview] = useState(false);
  const [wbTab, setWbTab] = useState<WorkbenchTab | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const workbenchOpen = wbTab !== null;
  const projectRoot = useBmadStore((s) => s.projectRoot);

  // Open the Workbench (Files) automatically when a project opens, so the toolset is visible.
  useEffect(() => {
    if (projectRoot) setWbTab("files");
  }, [projectRoot]);

  // Phase gating: SHARD/FLEET open only once the plan is approved; DONE only when
  // there are stories and they're all Done. Planning "finalizes" at approval.
  const planApproved = useCadre((s) => s.verification.length > 0);
  const stories = useBmadStore((s) => s.stories);
  const allDone = stories.length > 0 && stories.every((st) => st.status === "Done");
  const unlocked = { PLAN: true, SHARD: planApproved, FLEET: planApproved, DONE: allDone } as const;

  // Load the API key from the OS keychain on launch.
  useEffect(() => {
    hydrateSecrets();
  }, [hydrateSecrets]);

  // When a project opens, reload its plan + approval from disk (reload-from-git).
  useEffect(() => {
    if (projectRoot) hydrateFromProject();
  }, [projectRoot, hydrateFromProject]);

  // Esc closes the Workbench panel.
  useEffect(() => {
    if (!workbenchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWbTab(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workbenchOpen]);

  if (!projectRoot && !preview) {
    return <Welcome onPreview={() => setPreview(true)} />;
  }

  return (
    <div
      className="cadre-ui"
      style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <TopBar
        phase={phase}
        onNavigate={setPhase}
        unlocked={unlocked}
        onToggleWorkbench={projectRoot ? () => setWbTab((t) => (t ? null : "files")) : undefined}
        workbenchOpen={workbenchOpen}
        onOpenTeam={() => setTeamOpen(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {phase === "PLAN" ? <PlanningStudio /> : <FleetView />}
        </div>
        {wbTab && projectRoot && (
          <div style={{ width: 420, flexShrink: 0, borderLeft: "1px solid var(--c-border)", minHeight: 0 }}>
            <Workbench root={projectRoot} tab={wbTab} onTab={setWbTab} />
          </div>
        )}
        {projectRoot && (
          <DockRail active={wbTab} onSelect={(t) => setWbTab((cur) => (cur === t ? null : t))} />
        )}
      </div>
      {teamOpen && <Team onClose={() => setTeamOpen(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <Toaster />
    </div>
  );
}

/** Always-visible activity bar so the toolset is discoverable at a glance. */
function DockRail({
  active,
  onSelect,
}: {
  active: WorkbenchTab | null;
  onSelect: (t: WorkbenchTab) => void;
}) {
  const items: { id: WorkbenchTab; icon: typeof FolderTree; label: string }[] = [
    { id: "files", icon: FolderTree, label: "Files" },
    { id: "code", icon: FileCode2, label: "Code" },
    { id: "terminal", icon: SquareTerminal, label: "Terminal" },
  ];
  return (
    <div
      style={{
        width: 46,
        flexShrink: 0,
        borderLeft: "1px solid var(--c-border)",
        background: "var(--c-surface-1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "var(--c-space-3) 0",
      }}
    >
      {items.map(({ id, icon: Icon, label }) => {
        const on = active === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            title={label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "var(--c-radius-sm)",
              background: on ? "var(--c-accent-subtle)" : "transparent",
              border: `1px solid ${on ? "var(--c-accent-ring)" : "var(--c-border)"}`,
              color: on ? "var(--c-accent)" : "var(--c-text-secondary)",
              cursor: "pointer",
            }}
          >
            <Icon size={16} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
