import { useState } from "react";
import { Workflow, MessageSquarePlus, FilePlus2 } from "lucide-react";
import { Modal } from "./components/Modal";
import { Markdown } from "./components/Markdown";

/**
 * Sketch an app flow as a Mermaid diagram with a live preview. The diagram is plain
 * Mermaid markup, so the planning agent reads and analyzes it directly (no image /
 * vision needed). "Add to chat" attaches the markup to the conversation; "Insert
 * into <doc>" appends it as a ```mermaid block to the current document.
 */

const TEMPLATE = `flowchart TD
  A[Landing] --> B{Signed in?}
  B -- No --> C[Login / Sign up]
  B -- Yes --> D[Dashboard]
  C --> D
  D --> E[Core feature]
  D --> F[Settings]`;

export function DiagramEditor({
  docLabel,
  onClose,
  onAddToChat,
  onInsertToDoc,
}: {
  docLabel: string;
  onClose: () => void;
  onAddToChat: (src: string) => void;
  onInsertToDoc: (src: string) => void;
}) {
  const [src, setSrc] = useState(TEMPLATE);
  const trimmed = src.trim();

  return (
    <Modal
      label="Diagram — sketch an app flow"
      width={880}
      onClose={onClose}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Workflow size={16} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
          <span style={{ fontSize: "var(--c-fs-lg)", fontWeight: 600 as const, color: "var(--c-text)" }}>Diagram</span>
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>Mermaid flowchart — the agent reads the markup</span>
        </span>
      }
    >
      <div style={{ display: "flex", height: "58vh", minHeight: 340 }}>
        <textarea
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          spellCheck={false}
          aria-label="Mermaid source"
          style={{
            width: "44%",
            flexShrink: 0,
            resize: "none",
            background: "var(--c-code-bg)",
            border: "none",
            borderRight: "1px solid var(--c-border)",
            outline: "none",
            color: "var(--c-text-secondary)",
            fontFamily: "var(--c-font-mono)",
            fontSize: "var(--c-fs-sm)",
            lineHeight: 1.6,
            padding: "var(--c-space-3)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "var(--c-space-3)" }}>
          {trimmed ? (
            <Markdown content={"```mermaid\n" + src + "\n```"} />
          ) : (
            <div style={{ color: "var(--c-text-faint)", fontSize: "var(--c-fs-sm)" }}>Type Mermaid on the left to preview it here.</div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)", padding: "var(--c-space-3) var(--c-space-4)", borderTop: "1px solid var(--c-border)" }}>
        <a
          href="https://mermaid.js.org/intro/syntax-reference.html"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", textDecoration: "none" }}
        >
          Mermaid syntax ↗
        </a>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => onInsertToDoc(trimmed)}
          disabled={!trimmed}
          style={btnStyle(false, !trimmed)}
        >
          <FilePlus2 size={13} strokeWidth={2} />
          Insert into {docLabel}
        </button>
        <button
          onClick={() => {
            onAddToChat(trimmed);
            onClose();
          }}
          disabled={!trimmed}
          style={btnStyle(true, !trimmed)}
        >
          <MessageSquarePlus size={13} strokeWidth={2} />
          Add to chat
        </button>
      </div>
    </Modal>
  );
}

function btnStyle(primary: boolean, disabled: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: "var(--c-fs-sm)",
    fontWeight: 550 as const,
    padding: "6px 12px",
    borderRadius: "var(--c-radius)",
    background: disabled ? "var(--c-surface-3)" : primary ? "var(--c-accent)" : "var(--c-surface-2)",
    color: disabled ? "var(--c-text-muted)" : primary ? "var(--c-on-accent)" : "var(--c-text)",
    border: primary ? "none" : "1px solid var(--c-border-strong)",
    cursor: disabled ? "default" : "pointer",
  } as const;
}
