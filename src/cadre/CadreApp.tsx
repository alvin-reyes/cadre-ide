import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { TopBar } from "./components/TopBar";
import { PlanningStudio } from "./PlanningStudio";
import { FleetView } from "./FleetView";
import { TerminalPanel } from "./TerminalPanel";
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
  const [terminalOpen, setTerminalOpen] = useState(false);
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

  // Esc closes the terminal drawer.
  useEffect(() => {
    if (!terminalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTerminalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [terminalOpen]);

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
        onToggleTerminal={projectRoot ? () => setTerminalOpen((v) => !v) : undefined}
        terminalOpen={terminalOpen}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        {phase === "PLAN" ? <PlanningStudio /> : <FleetView />}
      </div>
      {terminalOpen && projectRoot && (
        <div style={{ height: 280, display: "flex", flexDirection: "column", borderTop: "1px solid var(--c-border)", flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--c-space-2)",
              padding: "4px var(--c-space-3)",
              background: "var(--c-surface-1)",
              borderBottom: "1px solid var(--c-border)",
            }}
          >
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", fontFamily: "var(--c-font-mono)" }}>
              terminal · {projectRoot}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setTerminalOpen(false)}
              title="Close terminal"
              style={{ display: "inline-flex", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer" }}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <TerminalPanel cwd={projectRoot} />
          </div>
        </div>
      )}
      <Toaster />
    </div>
  );
}
