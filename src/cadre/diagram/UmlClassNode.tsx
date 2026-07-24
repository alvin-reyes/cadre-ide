import { useState, useCallback, useRef, useEffect } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { UmlClassData } from "../../lib/diagram/mermaidExport";

/**
 * UmlClassNode — a custom React Flow node that represents a UML class.
 *
 * Data shape: UmlClassData { name, attributes: string[], methods: string[] }
 * — matches the Task-1 model so the mapper reads it directly.
 *
 * Features:
 * - Editable name (click to edit, Enter/Escape to commit/cancel)
 * - Editable attribute and method lines with + add affordance
 * - Inline line editor (click line to edit, Enter commits, Escape cancels)
 * - Source + target Handles (top/bottom) so classes can be connected
 * - Styled with --c-* tokens to match app dark theme
 */

export type UmlClassNodeData = UmlClassData;

// ---------------------------------------------------------------------------
// Inline editable line component
// ---------------------------------------------------------------------------

function EditableLine({
  value,
  onCommit,
  onDelete,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  onDelete: () => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "") {
      onDelete();
    } else {
      onCommit(trimmed);
    }
  }, [draft, onCommit, onDelete]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
  }, [value]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
          // Don't let RF handle delete/backspace while editing
          e.stopPropagation();
        }}
        onBlur={commit}
        placeholder={placeholder}
        style={{
          width: "100%",
          background: "var(--c-surface-3)",
          border: "1px solid var(--c-accent)",
          borderRadius: 3,
          color: "var(--c-text)",
          fontFamily: "var(--c-font-mono)",
          fontSize: "var(--c-fs-xs)",
          padding: "1px 4px",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <div
      onClick={() => { setEditing(true); setDraft(value); }}
      title="Click to edit"
      style={{
        fontFamily: "var(--c-font-mono)",
        fontSize: "var(--c-fs-xs)",
        color: "var(--c-text-secondary)",
        padding: "1px 4px",
        borderRadius: 3,
        cursor: "text",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
      }}
    >
      {value || <span style={{ color: "var(--c-text-faint)" }}>{placeholder}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditableName — top section
// ---------------------------------------------------------------------------

function EditableName({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed) onCommit(trimmed);
    else setDraft(value);
  }, [draft, value, onCommit]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(value); }
          e.stopPropagation();
        }}
        onBlur={commit}
        style={{
          width: "100%",
          background: "var(--c-surface-3)",
          border: "1px solid var(--c-accent)",
          borderRadius: 3,
          color: "var(--c-text)",
          fontFamily: "inherit",
          fontSize: "var(--c-fs-sm)",
          fontWeight: 600,
          padding: "1px 6px",
          outline: "none",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <div
      onClick={() => { setEditing(true); setDraft(value); }}
      title="Click to rename"
      style={{
        fontWeight: 600,
        fontSize: "var(--c-fs-sm)",
        color: "var(--c-text)",
        cursor: "text",
        textAlign: "center",
        padding: "2px 6px",
        borderRadius: 3,
      }}
    >
      {value}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UmlClassNode
// ---------------------------------------------------------------------------

export function UmlClassNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const classData = data as unknown as UmlClassNodeData;

  const updateData = useCallback(
    (patch: Partial<UmlClassData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
        )
      );
    },
    [id, setNodes]
  );

  const setName = useCallback((name: string) => updateData({ name }), [updateData]);

  const setAttr = useCallback(
    (idx: number, val: string) => {
      const next = [...classData.attributes];
      next[idx] = val;
      updateData({ attributes: next });
    },
    [classData.attributes, updateData]
  );

  const deleteAttr = useCallback(
    (idx: number) => {
      const next = classData.attributes.filter((_, i) => i !== idx);
      updateData({ attributes: next });
    },
    [classData.attributes, updateData]
  );

  const addAttr = useCallback(() => {
    updateData({ attributes: [...classData.attributes, "attribute: Type"] });
  }, [classData.attributes, updateData]);

  const setMethod = useCallback(
    (idx: number, val: string) => {
      const next = [...classData.methods];
      next[idx] = val;
      updateData({ methods: next });
    },
    [classData.methods, updateData]
  );

  const deleteMethod = useCallback(
    (idx: number) => {
      const next = classData.methods.filter((_, i) => i !== idx);
      updateData({ methods: next });
    },
    [classData.methods, updateData]
  );

  const addMethod = useCallback(() => {
    updateData({ methods: [...classData.methods, "method()"] });
  }, [classData.methods, updateData]);

  const addBtnStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    background: "none",
    border: "none",
    color: "var(--c-text-faint)",
    fontSize: "var(--c-fs-xs)",
    fontFamily: "var(--c-font-mono)",
    cursor: "pointer",
    textAlign: "left",
    padding: "1px 4px",
    marginTop: 2,
  };

  return (
    <div
      style={{
        minWidth: 160,
        maxWidth: 260,
        background: "var(--c-surface-2)",
        border: `1px solid ${selected ? "var(--c-accent)" : "var(--c-border-strong)"}`,
        borderRadius: "var(--c-radius)",
        boxShadow: selected ? "0 0 0 2px var(--c-accent)" : "var(--c-elev-1)",
        overflow: "hidden",
        fontSize: "var(--c-fs-sm)",
        color: "var(--c-text)",
        userSelect: "none",
      }}
    >
      {/* Top handle */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "var(--c-accent)", border: "none", width: 8, height: 8 }}
      />

      {/* Class name header */}
      <div
        style={{
          background: "var(--c-surface-3)",
          borderBottom: "1px solid var(--c-border)",
          padding: "6px 8px 5px",
          textAlign: "center",
          fontSize: "var(--c-fs-xs)",
          color: "var(--c-text-muted)",
          letterSpacing: "0.04em",
        }}
      >
        <div style={{ fontSize: "0.65em", marginBottom: 2, textTransform: "uppercase" }}>«class»</div>
        <EditableName value={classData.name} onCommit={setName} />
      </div>

      {/* Attributes section */}
      <div
        style={{
          borderBottom: "1px solid var(--c-border)",
          padding: "4px 6px",
          minHeight: 24,
        }}
      >
        {classData.attributes.map((attr, i) => (
          <EditableLine
            key={i}
            value={attr}
            placeholder="attribute: Type"
            onCommit={(v) => setAttr(i, v)}
            onDelete={() => deleteAttr(i)}
          />
        ))}
        <button style={addBtnStyle} onClick={addAttr} title="Add attribute">
          + attribute
        </button>
      </div>

      {/* Methods section */}
      <div style={{ padding: "4px 6px", minHeight: 24 }}>
        {classData.methods.map((method, i) => (
          <EditableLine
            key={i}
            value={method}
            placeholder="method()"
            onCommit={(v) => setMethod(i, v)}
            onDelete={() => deleteMethod(i)}
          />
        ))}
        <button style={addBtnStyle} onClick={addMethod} title="Add method">
          + method
        </button>
      </div>

      {/* Bottom handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "var(--c-accent)", border: "none", width: 8, height: 8 }}
      />
    </div>
  );
}
