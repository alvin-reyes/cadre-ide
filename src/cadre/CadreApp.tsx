import { useState } from "react";
import { TopBar } from "./components/TopBar";
import type { Phase } from "./components/PhaseStepper";
import { PlanningStudio } from "./PlanningStudio";

/** The Cadre Cockpit shell. Phase-driven main area (§4.3). */
export function CadreApp() {
  const [phase] = useState<Phase>("PLAN");

  return (
    <div
      className="cadre-ui"
      style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <TopBar phase={phase} />
      <div style={{ flex: 1, minHeight: 0 }}>
        {phase === "PLAN" && <PlanningStudio />}
      </div>
    </div>
  );
}
