import { useEffect, useRef, useState } from "react";
import { Plug, Github, ListChecks, NotebookText, Pencil, Trash2 } from "lucide-react";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useBmadStore } from "../../stores/bmadStore";
import { CATALOG, presetToConnection, type Preset } from "../../lib/mcp/catalog";
import type { Connection } from "../../lib/mcp/connections";
import { ConnectionModal } from "./ConnectionModal";

/**
 * ConnectionsView — the plug-and-play home for MCP tool connections. A catalog
 * grid of presets (click a tile → configure + test in a modal) above a list of
 * already-registered connections (status, tool count, enable toggle, edit, remove).
 * Mounted inside Settings' "Connections" section, which supplies the header/subtitle.
 */

const PRESET_ICONS: Record<string, typeof Plug> = {
  github: Github,
  clickup: ListChecks,
  notion: NotebookText,
  custom: Plug,
};

function presetIcon(id: string): typeof Plug {
  return PRESET_ICONS[id] ?? Plug;
}

function statusMeta(c: Connection): { label: string; color: string; bg: string } {
  if (c.status === "connected") {
    const n = c.toolCount ?? 0;
    return { label: `Connected · ${n} tool${n === 1 ? "" : "s"}`, color: "var(--c-success)", bg: "var(--c-success-subtle)" };
  }
  if (c.status === "error") {
    return { label: "Error", color: "var(--c-danger)", bg: "var(--c-danger-subtle)" };
  }
  return { label: "Not connected", color: "var(--c-text-muted)", bg: "var(--c-surface-3)" };
}

export function ConnectionsView() {
  const root = useBmadStore((s) => s.projectRoot);
  const connections = useConnectionsStore((s) => s.connections);
  const load = useConnectionsStore((s) => s.load);
  const remove = useConnectionsStore((s) => s.remove);
  const setEnabled = useConnectionsStore((s) => s.setEnabled);

  const [modal, setModal] = useState<{ preset: Preset; connection: Connection; isNew: boolean } | null>(null);

  // Inline two-step "confirm before remove" — Remove deletes keychain secrets
  // irreversibly, so a single accidental click must not do it. First click
  // arms the row; a second click within a few seconds (or on the same row)
  // actually removes. Any other interaction, or the timer lapsing, disarms it.
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (root) void load(root);
  }, [root, load]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  function cancelRemove() {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
    setConfirmingRemoveId(null);
  }

  if (!root) {
    return (
      <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)", padding: "var(--c-space-2) 0" }}>
        Open a project to add connections.
      </div>
    );
  }

  // const (not a hoisted `function`) so TS's narrowing of `root` from the
  // `if (!root)` guard above carries through into this closure.
  const handleRemoveClick = (id: string) => {
    if (confirmingRemoveId === id) {
      cancelRemove();
      void remove(root, id);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingRemoveId(id);
    confirmTimerRef.current = setTimeout(() => setConfirmingRemoveId(null), 3000);
  };

  function openPreset(preset: Preset) {
    cancelRemove();
    setModal({ preset, connection: presetToConnection(preset, connections), isNew: true });
  }

  function openEdit(conn: Connection) {
    cancelRemove();
    const preset = CATALOG.find((p) => p.id === conn.presetId) ?? CATALOG.find((p) => p.id === "custom")!;
    setModal({ preset, connection: conn, isNew: false });
  }

  return (
    <div>
      {/* Catalog grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: "var(--c-space-2)",
          marginBottom: "var(--c-space-3)",
        }}
      >
        {CATALOG.map((preset) => {
          const Icon = presetIcon(preset.id);
          return (
            <button
              key={preset.id}
              onClick={() => openPreset(preset)}
              className="cadre-elevate cadre-hover"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 6,
                padding: "10px 12px",
                borderRadius: "var(--c-radius)",
                background: "var(--c-surface-2)",
                border: "1px solid var(--c-border)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Icon size={17} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
              <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600 as const, color: "var(--c-text)" }}>{preset.label}</span>
              <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>{preset.blurb}</span>
            </button>
          );
        })}
      </div>

      {/* Connected list */}
      {connections.length === 0 ? (
        <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)", padding: "var(--c-space-2) 0" }}>
          No connections yet — pick a tool above to get started.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
          {connections.map((c) => {
            const meta = statusMeta(c);
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: "var(--c-radius)",
                  background: "var(--c-surface-2)",
                  border: "1px solid var(--c-border)",
                }}
              >
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => {
                    cancelRemove();
                    void setEnabled(root, c.id, e.target.checked);
                  }}
                  title={c.enabled ? "Disable" : "Enable"}
                  aria-label={`${c.enabled ? "Disable" : "Enable"} ${c.label}`}
                  style={{ accentColor: "var(--c-accent)", cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550 as const, color: "var(--c-text)", flexShrink: 0 }}>
                  {c.label}
                </span>
                <span
                  className="cadre-label-mono"
                  style={{
                    fontSize: "9px",
                    fontWeight: 600 as const,
                    padding: "2px 7px",
                    borderRadius: "var(--c-radius-sm)",
                    background: meta.bg,
                    color: meta.color,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {meta.label}
                </span>
                {c.status === "error" && c.lastError && (
                  <span
                    style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}
                    title={c.lastError}
                  >
                    {c.lastError}
                  </span>
                )}
                <div style={{ marginLeft: "auto", display: "inline-flex", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => openEdit(c)} title="Edit" aria-label={`Edit ${c.label}`} className="cadre-icon-btn" style={{ width: 24, height: 24 }}>
                    <Pencil size={12} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => handleRemoveClick(c.id)}
                    onBlur={() => {
                      if (confirmingRemoveId === c.id) cancelRemove();
                    }}
                    title={confirmingRemoveId === c.id ? "Click again to permanently remove" : "Remove"}
                    aria-label={confirmingRemoveId === c.id ? `Confirm remove ${c.label}` : `Remove ${c.label}`}
                    className="cadre-icon-btn"
                    style={
                      confirmingRemoveId === c.id
                        ? {
                            width: "auto",
                            height: 24,
                            padding: "0 8px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            background: "var(--c-danger-subtle)",
                            color: "var(--c-danger)",
                            border: "1px solid var(--c-danger)",
                            fontSize: "var(--c-fs-xs)",
                            fontWeight: 600 as const,
                            whiteSpace: "nowrap",
                          }
                        : { width: 24, height: 24 }
                    }
                  >
                    <Trash2 size={12} strokeWidth={2} />
                    {confirmingRemoveId === c.id && "Confirm remove?"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <ConnectionModal
          root={root}
          preset={modal.preset}
          connection={modal.connection}
          isNew={modal.isNew}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
