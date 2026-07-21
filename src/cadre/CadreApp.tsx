import { useState, useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { PlanningStudio } from "./PlanningStudio";
import { FleetView } from "./FleetView";
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
  const projectRoot = useBmadStore((s) => s.projectRoot);

  // Load the API key from the OS keychain on launch.
  useEffect(() => {
    hydrateSecrets();
  }, [hydrateSecrets]);

  // When a project opens, reload its plan + approval from disk (reload-from-git).
  useEffect(() => {
    if (projectRoot) hydrateFromProject();
  }, [projectRoot, hydrateFromProject]);

  if (!projectRoot && !preview) {
    return <Welcome onPreview={() => setPreview(true)} />;
  }

  return (
    <div
      className="cadre-ui"
      style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <TopBar phase={phase} onNavigate={setPhase} />
      <div style={{ flex: 1, minHeight: 0 }}>
        {phase === "PLAN" ? <PlanningStudio /> : <FleetView />}
      </div>
    </div>
  );
}
