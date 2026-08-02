import { useState, useEffect, useRef } from "react";
import { LayoutGrid, FolderTree, SquareTerminal, Library } from "lucide-react";
import { TopBar } from "./components/TopBar";
import { PhaseStepper } from "./components/PhaseStepper";
import { PlanningStudio } from "./PlanningStudio";
import { ExecuteView } from "./ExecuteView";
import { MaintainView } from "./MaintainView";
import { ModeChoiceDialog } from "./ModeChoiceDialog";
import { Workbench } from "./Workbench";
import { TerminalTabs } from "./TerminalTabs";
import { Team } from "./Team";
import { Settings } from "./Settings";
import { AiLog } from "./AiLog";
import { OrchestratorChat } from "./OrchestratorChat";
import { Toaster } from "./Toaster";
import { Welcome } from "./Welcome";
import { SignIn, useHasCredential } from "./SignIn";
import { ProjectTabs } from "./ProjectTabs";
import { useBmadStore } from "../stores/bmadStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useCadre } from "./useCadre";
import { useOpenProjects } from "../stores/openProjectsStore";
import { loadView, saveView } from "../stores/viewPreference";
import { reportError } from "../lib/reportError";
import { useRepos } from "../stores/reposStore";
import { useModelsStore } from "../stores/modelsStore";
import { ContextView } from "./ContextView";

/** The four top-level views, switched via the dock rail. Orchestrator is default. */
type MainView = "orchestrator" | "files" | "terminal" | "context";

function isMainView(v: string | null): v is MainView {
  return v === "orchestrator" || v === "files" || v === "terminal" || v === "context";
}

/** The Cadre Cockpit shell — three main views (Orchestrator · File · Terminal). */
export function CadreApp() {
  const phase = useCadre((s) => s.phase);
  const mode = useCadre((s) => s.mode);
  const modeChoicePending = useCadre((s) => s.modeChoicePending);
  const setPhase = useCadre((s) => s.setPhase);
  const hydrateFromProject = useCadre((s) => s.hydrateFromProject);
  const setActiveProject = useCadre((s) => s.setActiveProject);
  const hydrateSecrets = useSettingsStore((s) => s.hydrateSecrets);
  const showSettings = useSettingsStore((s) => s.showSettings);
  const setShowSettings = useSettingsStore((s) => s.setShowSettings);
  const [preview, setPreview] = useState(false);
  const [signInDone, setSignInDone] = useState(false);
  const { checked: credChecked, hasCredential } = useHasCredential();
  const [view, setView] = useState<MainView>("orchestrator");
  // Files/Terminal/Context mount on first visit and stay mounted (hidden) so editor
  // buffers, terminal PTY sessions, and context store state survive switching away.
  const [filesMounted, setFilesMounted] = useState(false);
  const [termMounted, setTermMounted] = useState(false);
  const [ctxMounted, setCtxMounted] = useState(false);
  // Maintain cockpit mounts the first time a project enters Maintain mode and then
  // stays mounted (hidden in Build mode) so its Claude terminal survives mode switches.
  const [maintainMounted, setMaintainMounted] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const projectRoot = useBmadStore((s) => s.projectRoot);
  // Guard so the restore-on-launch effect runs exactly once per app session.
  const restoredRef = useRef(false);

  // Lazy-mount a view the first time it's opened.
  useEffect(() => {
    if (view === "files") setFilesMounted(true);
    if (view === "terminal") setTermMounted(true);
    if (view === "context") setCtxMounted(true);
  }, [view]);

  // Mount the Maintain cockpit the first time this project enters Maintain mode;
  // once mounted it stays mounted (just hidden) so toggling Build⇄Maintain keeps
  // the Claude terminal alive instead of killing its PTY.
  useEffect(() => {
    if (mode === "maintain") setMaintainMounted(true);
  }, [mode]);

  // A different project drops the other views — including the Maintain cockpit, so
  // a project switch doesn't leak the previous project's Claude terminal into the
  // newly-active one — then restores the view this project was last left on.
  useEffect(() => {
    const saved = projectRoot ? loadView(projectRoot) : null;
    const restored: MainView = isMainView(saved) ? saved : "orchestrator";
    setView(restored);
    setFilesMounted(restored === "files");
    setTermMounted(restored === "terminal");
    setCtxMounted(restored === "context");
    // Drop the previous project's Maintain cockpit, but if THIS project already
    // opens in Maintain mode keep it mounted. A hard `false` here would race the
    // [mode] effect (both fire in the same commit on open) and win, leaving the
    // cockpit unmounted and the main area blank. Reading `mode` (committed value
    // at the time projectRoot changed) is deliberate; it must NOT be a dep, or a
    // mere Build⇄Maintain toggle would reset the active view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setMaintainMounted(mode === "maintain");
  }, [projectRoot]);

  // Persist the active view for this project so reopening lands on it.
  useEffect(() => {
    if (projectRoot) saveView(projectRoot, view);
  }, [projectRoot, view]);

  // Phase gating: EXECUTE opens once the plan is approved; DONE only when all stories are Done.
  const planApproved = useCadre((s) => s.verification.length > 0);
  const stories = useBmadStore((s) => s.stories);
  const allDone = stories.length > 0 && stories.every((st) => st.status === "Done");
  const unlocked = { PLAN: true, EXECUTE: planApproved, DONE: allDone } as const;

  useEffect(() => {
    hydrateSecrets();
  }, [hydrateSecrets]);

  // Restore all persisted open projects on launch — runs exactly once (ref guard).
  // For each remembered root, registers its watchers in bmadStore. Then makes the
  // previously-active project foreground across all three stores.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const { roots, activeRoot } = useOpenProjects.getState();
    if (roots.length === 0) return;
    const target = activeRoot ?? roots[0];
    // Open each project in the background (registers watchers + hydrates board).
    // A project that fails to open (e.g. git-init failure) is surfaced but must not
    // abort the others or become an unhandled rejection.
    Promise.all(
      roots.map((r) =>
        useBmadStore.getState().openProject(r).catch((e) => reportError("open project", e))
      )
    ).then(() => {
      // After all projects are open, point the foreground at the previously-active one.
      useBmadStore.getState().setActiveProject(target);
      useCadre.getState().setActiveProject(target);
      useOpenProjects.getState().setActive(target);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (projectRoot) {
      // Point useCadre's foreground at this project (seeds/mirrors its slice), then
      // reload the plan into that slice from disk.
      setActiveProject(projectRoot);
      hydrateFromProject();
      // Load the repo registry from cadre.json so RepoRegistry and per-repo verify gate are current.
      useRepos.getState().load(projectRoot);
      // Load this project's model config from cadre.json (falls back to global when absent).
      useModelsStore.getState().load(projectRoot);
      // Ensure the tab list always knows about this project (covers the Welcome
      // first-open path and any other direct openProject call).
      const { roots } = useOpenProjects.getState();
      if (!roots.includes(projectRoot)) {
        const name = projectRoot.split("/").filter(Boolean).pop() ?? projectRoot;
        useOpenProjects.getState().open(projectRoot, name);
      }
    }
  }, [projectRoot, setActiveProject, hydrateFromProject]);

  // Terminal shortcuts: Ctrl/Cmd+` toggles the Terminal view; Ctrl/Cmd+T opens it
  // and adds a session (dispatched to the mounted TerminalTabs).
  useEffect(() => {
    if (!projectRoot) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setView((v) => (v === "terminal" ? "orchestrator" : "terminal"));
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setView("terminal");
        // Target the dock terminal surface specifically — other mounted TerminalTabs
        // (e.g. the hidden Maintain cockpit) must not also spawn a tab/PTY.
        if (termMounted && projectRoot)
          window.dispatchEvent(new CustomEvent("cadre:new-terminal", { detail: { surfaceId: `dock:${projectRoot}` } }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectRoot, termMounted]);

  // Show SignIn when: credential check is done, no usable credential, and user
  // hasn't completed sign-in yet. An existing Anthropic-key user skips this entirely
  // because hasCredential will be true from hydrateSecrets loading on mount.
  // While credChecked is false we render nothing briefly to avoid a flash of signin.
  if (!projectRoot && !preview) {
    if (!credChecked) return null;
    if (!hasCredential && !signInDone) {
      return <SignIn onDone={() => setSignInDone(true)} />;
    }
    return <Welcome onPreview={() => setPreview(true)} />;
  }

  const hidden = (on: boolean) => ({ position: "absolute" as const, inset: 0, display: on ? "block" : "none" });

  return (
    <div className="cadre-ui" style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar onOpenTeam={() => setTeamOpen(true)} onOpenSettings={() => setShowSettings(true)} onOpenLog={() => setLogOpen(true)} />

      {/* Project tab strip — shows when at least one project is open. */}
      {projectRoot && <ProjectTabs />}

      {/* The Orchestrator carries the discipline stepper; the other views don't.
          Maintain mode is not plan-gated, so it hides the stepper entirely. */}
      {view === "orchestrator" && mode !== "maintain" && (
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
          <PhaseStepper current={phase} onNavigate={setPhase} unlocked={unlocked} />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {/* Orchestrator — always mounted (holds chat/plan state), just hidden.
              The Build plan/execute shell and the Maintain cockpit BOTH stay
              mounted and toggle by visibility, so switching Build⇄Maintain never
              tears down the other's state (notably the Claude terminal's PTY). */}
          <div style={hidden(view === "orchestrator")}>
            {/* Build plan/execute shell — shown in Build mode. */}
            <div style={hidden(mode !== "maintain")}>
              {phase === "PLAN" ? <PlanningStudio /> : <ExecuteView />}
            </div>

            {/* Maintenance cockpit — lazy-mounted, then kept mounted (hidden in
                Build mode) so the Claude session survives mode switches. */}
            {maintainMounted && projectRoot && (
              <div style={hidden(mode === "maintain")}>
                <MaintainView />
              </div>
            )}
          </div>

          {/* File view — tree + editable code. */}
          {filesMounted && projectRoot && (
            <div style={hidden(view === "files")}>
              <Workbench root={projectRoot} />
            </div>
          )}

          {/* Terminal view — multi-session, PTYs persist while hidden. */}
          {termMounted && projectRoot && (
            <div style={hidden(view === "terminal")}>
              <TerminalTabs key={projectRoot} cwd={projectRoot} surfaceId={`dock:${projectRoot}`} />
            </div>
          )}

          {/* Context view — browses .cadre/context and ADRs; store state persists. */}
          {ctxMounted && projectRoot && (
            <div style={hidden(view === "context")}>
              <ContextView root={projectRoot} />
            </div>
          )}
        </div>

        {projectRoot && <DockRail active={view} onSelect={setView} />}
      </div>

      {projectRoot && modeChoicePending && <ModeChoiceDialog />}

      {teamOpen && <Team onClose={() => setTeamOpen(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {logOpen && <AiLog onClose={() => setLogOpen(false)} />}
      {projectRoot && mode !== "maintain" && <OrchestratorChat />}
      <Toaster />
    </div>
  );
}

/** Right-edge activity bar — switches the three main views. */
function DockRail({ active, onSelect }: { active: MainView; onSelect: (v: MainView) => void }) {
  const items: { id: MainView; icon: typeof FolderTree; label: string }[] = [
    { id: "orchestrator", icon: LayoutGrid, label: "Orchestrator" },
    { id: "files", icon: FolderTree, label: "Files" },
    { id: "terminal", icon: SquareTerminal, label: "Terminal — ⌃`" },
    { id: "context", icon: Library, label: "Context — decisions & contracts" },
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
            aria-label={label}
            aria-pressed={on}
            className="cadre-hover"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
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
