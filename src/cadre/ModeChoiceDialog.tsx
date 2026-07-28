/**
 * ModeChoiceDialog — shown once, right after a project is opened, so the user
 * decides how they want to work on it: extend it with new features (Build) or
 * just maintain/support it (a Claude terminal in the project). The detected
 * default is pre-highlighted, but the choice is always the user's.
 *
 * Rendered by CadreApp while `modeChoicePending` is true for the active project.
 */

import { Blocks, Wrench } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { useCadre } from "./useCadre";
import type { ProjectMode } from "../lib/engine/projectMode";

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function ModeChoiceDialog() {
  const projectRoot = useBmadStore((s) => s.projectRoot);
  const suggested = useCadre((s) => s.mode);
  const chooseMode = useCadre((s) => s.chooseMode);
  const repo = projectRoot ? basename(projectRoot) : "this project";

  const pick = (mode: ProjectMode) => chooseMode(mode);

  const cards: {
    mode: ProjectMode;
    title: string;
    desc: string;
    icon: typeof Blocks;
  }[] = [
    {
      mode: "build",
      title: "Add features",
      desc: "Plan, then build new features with the verified agent fleet — spec → shard → dispatch → verify.",
      icon: Blocks,
    },
    {
      mode: "maintain",
      title: "Maintain / Support",
      desc: "Open the project in a ready Claude terminal to fix, tweak, and support it — no plan required.",
      icon: Wrench,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose how to work on this project"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        padding: "var(--c-space-4)",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          background: "var(--c-surface-1)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--c-radius-lg)",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
          padding: "var(--c-space-5)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "var(--c-fs-lg)", fontWeight: 680, color: "var(--c-text)", letterSpacing: "-0.01em" }}>
          How do you want to work on{" "}
          <span className="cadre-label-mono" style={{ color: "var(--c-accent)" }}>{repo}</span>?
        </h2>
        <p style={{ margin: "var(--c-space-2) 0 var(--c-space-4)", fontSize: "var(--c-fs-sm)", color: "var(--c-text-secondary)" }}>
          You can switch anytime from the top bar.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-3)" }}>
          {cards.map(({ mode, title, desc, icon: Icon }) => {
            const isSuggested = mode === suggested;
            return (
              <button
                key={mode}
                onClick={() => pick(mode)}
                autoFocus={isSuggested}
                className="cadre-hover"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--c-space-3)",
                  textAlign: "left",
                  width: "100%",
                  padding: "var(--c-space-3) var(--c-space-4)",
                  borderRadius: "var(--c-radius-md)",
                  background: isSuggested ? "var(--c-surface-3)" : "var(--c-surface-2)",
                  border: `1px solid ${isSuggested ? "var(--c-accent)" : "var(--c-border)"}`,
                  cursor: "pointer",
                  color: "var(--c-text)",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 34,
                    height: 34,
                    flexShrink: 0,
                    borderRadius: "var(--c-radius-sm)",
                    background: isSuggested ? "var(--c-accent)" : "var(--c-surface-3)",
                    color: isSuggested ? "var(--c-on-accent, #fff)" : "var(--c-text-secondary)",
                  }}
                >
                  <Icon size={17} strokeWidth={2} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--c-space-2)", fontSize: "var(--c-fs-md)", fontWeight: 640 }}>
                    {title}
                    {isSuggested && (
                      <span
                        style={{
                          fontSize: "var(--c-fs-2xs, 10px)",
                          fontWeight: 650,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          color: "var(--c-accent)",
                          border: "1px solid var(--c-accent)",
                          borderRadius: 999,
                          padding: "1px 7px",
                        }}
                      >
                        Suggested
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", lineHeight: 1.45 }}>{desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
