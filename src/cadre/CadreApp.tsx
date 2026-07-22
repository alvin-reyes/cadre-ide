import { useState, useEffect } from "react";
import { FolderTree, FileCode2, SquareTerminal } from "lucide-react";
import { TopBar } from "./components/TopBar";
import { PhaseStepper } from "./components/PhaseStepper";
import { PlanningStudio } from "./PlanningStudio";
import { FleetView } from "./FleetView";
import { Workbench, type WorkbenchTab } from "./Workbench";
import { TerminalWorkspace } from "./TerminalWorkspace";

/** Dock-rail entries: the side-panel Workbench tabs plus the large Terminal pane. */
type RailId = WorkbenchTab | "terminal";
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
  const [termOpen, setTermOpen] = useState(false);
  // Once opened, the Terminal stays MOUNTED (just hidden when closed) so its PTY
  // sessions and running processes survive closing/reopening or switching views.
  const [termMounted, setTermMounted] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const workbenchOpen = wbTab !== null;
  const projectRoot = useBmadStore((s) => s.projectRoot);

  // The dock rail routes Files/Code to the side Workbench and Terminal to the
  // large main-area pane (an alternative to the Plan/Fleet view).
  const railActive: RailId | null = termOpen ? "terminal" : wbTab;
  function onRailSelect(id: RailId) {
    if (id === "terminal") setTermOpen((v) => !v);
    else setWbTab((cur) => (cur === id ? null : id));
  }
  // Navigating phases returns you to the phase view (out of the terminal pane).
  function navigate(p: typeof phase) {
    setTermOpen(false);
    setPhase(p);
  }

  // Open the Workbench (Files) automatically when a project opens, so the toolset is visible.
  useEffect(() => {
    if (projectRoot) setWbTab("files");
  }, [projectRoot]);

  // First time the Terminal opens, mount it for good (kept alive while hidden).
  useEffect(() => {
    if (termOpen) setTermMounted(true);
  }, [termOpen]);

  // A different project means a different cwd — drop the old terminal sessions.
  useEffect(() => {
    setTermMounted(false);
    setTermOpen(false);
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

  // Ctrl/Cmd + ` toggles the large Terminal pane (IDE convention).
  useEffect(() => {
    if (!projectRoot) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setTermOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectRoot]);

  // Esc closes the large Terminal pane first, else the Workbench panel.
  useEffect(() => {
    if (!workbenchOpen && !termOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (termOpen) setTermOpen(false);
      else setWbTab(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workbenchOpen, termOpen]);

  if (!projectRoot && !preview) {
    return <Welcome onPreview={() => setPreview(true)} />;
  }

  return (
    <div
      className="cadre-ui"
      style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <TopBar
        onToggleWorkbench={projectRoot ? () => setWbTab((t) => (t ? null : "files")) : undefined}
        workbenchOpen={workbenchOpen}
        onOpenTeam={() => setTeamOpen(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      {/* Discipline tracker — centered on its own bar so it's clearly visible. */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "7px var(--c-space-4)",
          background: "var(--c-bg)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
        }}
      >
        <PhaseStepper current={phase} onNavigate={navigate} unlocked={unlocked} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {/* Phase view — hidden (not unmounted) while the terminal is showing. */}
          <div style={{ height: "100%", display: termOpen ? "none" : "block" }}>
            {phase === "PLAN" ? <PlanningStudio /> : <FleetView />}
          </div>
          {/* Terminal — mounted once opened, then only toggled visible, so its PTY
              sessions persist across close/reopen and view switches. */}
          {termMounted && projectRoot && (
            <div style={{ position: "absolute", inset: 0, display: termOpen ? "block" : "none" }}>
              <TerminalWorkspace root={projectRoot} onClose={() => setTermOpen(false)} />
            </div>
          )}
        </div>
        {wbTab && projectRoot && (
          <div style={{ width: 420, flexShrink: 0, borderLeft: "1px solid var(--c-border)", minHeight: 0 }}>
            <Workbench root={projectRoot} tab={wbTab} onTab={setWbTab} />
          </div>
        )}
        {projectRoot && (
          <DockRail active={railActive} onSelect={onRailSelect} />
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
  active: RailId | null;
  onSelect: (t: RailId) => void;
}) {
  const items: { id: RailId; icon: typeof FolderTree; label: string }[] = [
    { id: "files", icon: FolderTree, label: "Files" },
    { id: "code", icon: FileCode2, label: "Code" },
    { id: "terminal", icon: SquareTerminal, label: "Terminal — ⌃` (large pane)" },
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
