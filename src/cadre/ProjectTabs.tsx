import { Plus, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useBmadStore } from "../stores/bmadStore";
import { useOpenProjects } from "../stores/openProjectsStore";
import { useCadre } from "./useCadre";
import { isTauri } from "../lib/secrets";
import { reportError } from "../lib/reportError";

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Keep all three project stores in sync when switching the foreground project.
 * Every consumer of "which project is active" reads from these stores, so they
 * must always agree.
 */
function selectProject(root: string) {
  useOpenProjects.getState().setActive(root);
  useBmadStore.getState().setActiveProject(root);
  useCadre.getState().setActiveProject(root);
}

/**
 * Close a project: remove it from the engine store and the tab list, then
 * switch to whatever tab becomes active after the close.
 */
function closeProject(root: string) {
  useBmadStore.getState().closeProject(root);
  useOpenProjects.getState().close(root);
  // After close, pick up the newly-computed activeRoot from the tab store.
  const { activeRoot } = useOpenProjects.getState();
  if (activeRoot) {
    selectProject(activeRoot);
  }
}

/**
 * A horizontal tab strip showing every open project. Matches the TerminalTabs
 * visual style (--c-* design tokens, same strip height + border-bottom pattern).
 */
export function ProjectTabs() {
  const roots = useOpenProjects((s) => s.roots);
  const activeRoot = useOpenProjects((s) => s.activeRoot);
  const names = useOpenProjects((s) => s.names);
  const openProject = useBmadStore((s) => s.openProject);

  async function addProject() {
    if (!isTauri()) return;
    try {
      const dir = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose a project folder",
      });
      if (typeof dir !== "string") return;
      const name = basename(dir);
      await openProject(dir);
      useOpenProjects.getState().open(dir, name);
      selectProject(dir);
    } catch (e) {
      reportError("open project", e);
    }
  }

  if (roots.length === 0) return null;

  const railBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: "var(--c-radius-sm)",
    background: "transparent",
    border: "1px solid var(--c-border)",
    color: "var(--c-text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
    marginLeft: 2,
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "3px 6px",
        borderBottom: "1px solid var(--c-border)",
        background: "var(--c-surface-1)",
        flexShrink: 0,
        overflowX: "auto",
      }}
    >
      {roots.map((root) => {
        const on = root === activeRoot;
        const label = names[root] ?? basename(root);
        return (
          <div
            key={root}
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "var(--c-radius-sm)",
              background: on ? "var(--c-surface-3)" : "transparent",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => selectProject(root)}
              aria-pressed={on}
              aria-label={`Switch to project ${label}`}
              className="cadre-hover"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 26,
                fontSize: "var(--c-fs-xs)",
                fontWeight: 550 as const,
                padding: "0 4px 0 10px",
                borderRadius: "var(--c-radius-sm) 0 0 var(--c-radius-sm)",
                background: "transparent",
                border: "none",
                color: on ? "var(--c-text)" : "var(--c-text-muted)",
                cursor: "pointer",
                maxWidth: 180,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={root}
            >
              {label}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeProject(root);
              }}
              aria-label={`Close project ${label}`}
              title="Close project"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 26,
                borderRadius: "0 var(--c-radius-sm) var(--c-radius-sm) 0",
                background: "transparent",
                border: "none",
                color: on ? "var(--c-text-secondary)" : "var(--c-text-faint)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </div>
        );
      })}

      <button
        onClick={addProject}
        title="Open another project"
        aria-label="Open another project"
        className="cadre-hover"
        style={railBtn}
      >
        <Plus size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}
