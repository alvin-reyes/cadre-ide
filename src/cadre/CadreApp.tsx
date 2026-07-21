import { useState } from "react";
import { TopBar } from "./components/TopBar";
import type { Phase } from "./components/PhaseStepper";
import { PlanningStudio } from "./PlanningStudio";
import { FleetView } from "./FleetView";
import { EscalationInbox } from "./EscalationInbox";
import { Welcome } from "./Welcome";
import { useBmadStore } from "../stores/bmadStore";

/** The Cadre Cockpit shell. Phase-driven main area (§4.3). */
export function CadreApp() {
  const [phase, setPhase] = useState<Phase>("PLAN");
  const [inboxOpen, setInboxOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const projectRoot = useBmadStore((s) => s.projectRoot);

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
