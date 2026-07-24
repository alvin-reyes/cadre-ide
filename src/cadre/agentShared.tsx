/**
 * agentShared — shared agent UI helpers used by KanbanBoard.
 *
 * Single source of truth for:
 *   stateInfo, stripAnsi, LiveTerminal, FleetModelPicker
 */

import { useState, useEffect, useRef } from "react";
import { Cpu } from "lucide-react";
import { useCadre } from "./useCadre";
import { PROVIDERS, getProvider } from "../lib/engine/providers";
import { secretHas, secretSet } from "../lib/secrets";
import type { Status } from "../lib/engine/status";

// How each engine Status reads in the agent pane (the thesis: cadre verifies).
export function stateInfo(status: Status): { label: string; color: string; live: boolean } {
  switch (status) {
    case "InProgress":
      return { label: "Agent working — cadre verifies before Done", color: "var(--c-accent)", live: true };
    case "InReview":
      return { label: "Verifying — running the frozen command", color: "var(--c-warning)", live: true };
    case "Done":
      return { label: "Verified — Done", color: "var(--c-success)", live: false };
    case "Failed":
      return { label: "Failed verification — bounce to fix", color: "var(--c-danger)", live: false };
    case "Blocked":
      return { label: "Blocked — couldn't integrate; resolve it, then re-dispatch", color: "var(--c-danger)", live: false };
    default:
      return { label: "Ready to dispatch", color: "var(--c-text-muted)", live: false };
  }
}

// Strip ANSI escape sequences so the streamed PTY output reads cleanly.
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** The live agent + verification transcript, auto-scrolled to the tail.
 *  Sized to sit inside a Kanban card's expanded section (capped height, rounded). */
export function LiveTerminal({ log, empty }: { log: string; empty: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (!log) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--c-text-faint)",
          fontSize: "var(--c-fs-sm)",
          background: "var(--c-code-bg)",
          padding: "var(--c-space-4)",
          borderRadius: "var(--c-radius)",
        }}
      >
        {empty}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      style={{
        background: "var(--c-code-bg)",
        padding: "var(--c-space-3) var(--c-space-4)",
        fontFamily: "var(--c-font-mono)",
        fontSize: "var(--c-fs-xs)",
        lineHeight: 1.6,
        color: "var(--c-text-secondary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "auto",
        maxHeight: 260,
        borderRadius: "var(--c-radius)",
        marginTop: "var(--c-space-2)",
      }}
    >
      {stripAnsi(log)}
    </div>
  );
}

/** Choose which model the Dev fleet runs on; capture a non-Claude key if needed. */
export function FleetModelPicker() {
  const fleetProvider = useCadre((s) => s.fleetProvider);
  const setFleetProvider = useCadre((s) => s.setFleetProvider);
  const provider = getProvider(fleetProvider);
  const [hasKey, setHasKey] = useState(true);
  const [keyDraft, setKeyDraft] = useState("");

  useEffect(() => {
    let alive = true;
    if (provider.id === "claude") {
      setHasKey(true); // claude falls back to the settings/keychain Anthropic key
      return;
    }
    secretHas(provider.secretKey).then((h) => {
      if (alive) setHasKey(h);
    });
    return () => {
      alive = false;
    };
  }, [provider.id, provider.secretKey]);

  async function saveKey() {
    const v = keyDraft.trim();
    if (!v) return;
    await secretSet(provider.secretKey, v);
    setKeyDraft("");
    setHasKey(true);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Cpu size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
      <select
        value={fleetProvider}
        onChange={(e) => setFleetProvider(e.target.value)}
        title="Model the Dev fleet runs on"
        style={{
          background: "var(--c-surface-2)",
          color: "var(--c-text)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--c-radius-sm)",
          fontSize: "var(--c-fs-xs)",
          padding: "3px 6px",
          fontFamily: "var(--c-font-ui)",
          cursor: "pointer",
        }}
      >
        {Object.values(PROVIDERS).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {!hasKey && (
        <>
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKey()}
            placeholder={`${provider.name} key`}
            style={{
              width: 130,
              background: "var(--c-surface-1)",
              border: "1px solid var(--c-warning)",
              borderRadius: "var(--c-radius-sm)",
              outline: "none",
              color: "var(--c-text)",
              fontSize: "var(--c-fs-xs)",
              fontFamily: "var(--c-font-mono)",
              padding: "3px 6px",
            }}
          />
          <button
            onClick={saveKey}
            style={{
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "3px 9px",
              borderRadius: "var(--c-radius-sm)",
              background: "var(--c-accent)",
              color: "var(--c-on-accent)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Save
          </button>
        </>
      )}
    </div>
  );
}
