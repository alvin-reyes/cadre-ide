import { useState, useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { PlanningStudio } from "./PlanningStudio";
import { FleetView } from "./FleetView";
import { Workbench } from "./Workbench";
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
  const [preview, setPreview] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const projectRoot = useBmadStore((s) => s.projectRoot);

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
      if (e.key === "Escape") setWorkbenchOpen(false);
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
        onToggleWorkbench={projectRoot ? () => setWorkbenchOpen((v) => !v) : undefined}
        workbenchOpen={workbenchOpen}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {phase === "PLAN" ? <PlanningStudio /> : <FleetView />}
        </div>
        {workbenchOpen && projectRoot && (
          <div style={{ width: 420, flexShrink: 0, borderLeft: "1px solid var(--c-border)", minHeight: 0 }}>
            <Workbench root={projectRoot} />
          </div>
        )}
      </div>
      <Toaster />
    </div>
  );
}
