import { useState } from "react";
import { TopBar } from "./components/TopBar";
import type { Phase } from "./components/PhaseStepper";
import { PlanningStudio } from "./PlanningStudio";
import { FleetView } from "./FleetView";
import { EscalationInbox } from "./EscalationInbox";

/** The Cadre Cockpit shell. Phase-driven main area (§4.3). */
export function CadreApp() {
  const [phase, setPhase] = useState<Phase>("PLAN");
  const [inboxOpen, setInboxOpen] = useState(false);

  return (
    <div
      className="cadre-ui"
      style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <TopBar
        phase={phase}
        needsYou={3}
        onNavigate={setPhase}
        onOpenNeeds={() => setInboxOpen(true)}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        {phase === "PLAN" || phase === "SHARD" ? <PlanningStudio /> : <FleetView />}
      </div>
      {inboxOpen && <EscalationInbox onClose={() => setInboxOpen(false)} />}
    </div>
  );
}
