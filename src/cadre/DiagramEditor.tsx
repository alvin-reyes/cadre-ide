/**
 * DiagramEditor.tsx — Interactive React Flow canvas with three tabs:
 *   Flow    — rectangular nodes + edges (flowchart TD)
 *   UML     — custom UmlClassNode + relationship edges (classDiagram)
 *   Mermaid — read-only live preview of the exported markup
 *
 * Same props as the original text-based editor so PlanningStudio is unchanged.
 * Exports via Task-1's flowToMermaid / umlToMermaid into the existing callbacks.
 */

import "@xyflow/react/dist/style.css";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnConnect,
} from "@xyflow/react";
import { useCallback, useRef, useState } from "react";
import { Workflow, MessageSquarePlus, FilePlus2 } from "lucide-react";
import { Modal } from "./components/Modal";
import { Markdown } from "./components/Markdown";
import { UmlClassNode } from "./diagram/UmlClassNode";
import { toFlowModel, toUmlModel, type RfNode, type RfEdge } from "./diagram/diagramMappers";
import { flowToMermaid, umlToMermaid, FLOW_SHAPES, type FlowShape } from "../lib/diagram/mermaidExport";

// ---------------------------------------------------------------------------
// Custom node types (defined outside component so RF doesn't re-register)
// ---------------------------------------------------------------------------

const nodeTypes = { umlClass: UmlClassNode };

// ---------------------------------------------------------------------------
// Default seeded graphs
// ---------------------------------------------------------------------------

const INITIAL_FLOW_NODES: Node[] = [
  { id: "1", type: "default", position: { x: 200, y: 60 }, data: { label: "Start", shape: "stadium" }, style: flowNodeStyle("stadium") },
  { id: "2", type: "default", position: { x: 200, y: 180 }, data: { label: "Process", shape: "rectangle" }, style: flowNodeStyle("rectangle") },
  { id: "3", type: "default", position: { x: 200, y: 300 }, data: { label: "End", shape: "stadium" }, style: flowNodeStyle("stadium") },
];

const INITIAL_FLOW_EDGES: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e2-3", source: "2", target: "3" },
];

const INITIAL_UML_NODES: Node[] = [
  {
    id: "u1",
    type: "umlClass",
    position: { x: 80, y: 80 },
    data: {
      name: "User",
      attributes: ["id: string", "email: string"],
      methods: ["save()", "delete()"],
    },
  },
  {
    id: "u2",
    type: "umlClass",
    position: { x: 360, y: 80 },
    data: {
      name: "Post",
      attributes: ["title: string", "body: string"],
      methods: ["publish()"],
    },
  },
];

const INITIAL_UML_EDGES: Edge[] = [
  { id: "eu1-u2", source: "u1", target: "u2", data: { relation: "association" } },
];

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type Tab = "flow" | "uml" | "mermaid";

type UmlRelationOption = "association" | "inheritance" | "composition" | "aggregation";

// ---------------------------------------------------------------------------
// DiagramEditor
// ---------------------------------------------------------------------------

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
  // Active tab
  const [tab, setTab] = useState<Tab>("flow");

  // Relation selector for new UML edges
  const [nextRelation, setNextRelation] = useState<UmlRelationOption>("association");

  // Shape for new Flow nodes (also applied to the current selection).
  const [nextShape, setNextShape] = useState<FlowShape>("rectangle");

  // Separate state for Flow and UML graphs
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState(INITIAL_FLOW_NODES);
  const [flowEdges, setFlowEdges, onFlowEdgesChange] = useEdgesState(INITIAL_FLOW_EDGES);
  const [umlNodes, setUmlNodes, onUmlNodesChange] = useNodesState(INITIAL_UML_NODES);
  const [umlEdges, setUmlEdges, onUmlEdgesChange] = useEdgesState(INITIAL_UML_EDGES);

  // Counter refs for generating unique ids
  const flowNodeCounter = useRef(INITIAL_FLOW_NODES.length + 1);
  const umlNodeCounter = useRef(INITIAL_UML_NODES.length + 1);

  // ---------------------------------------------------------------------------
  // Flow tab helpers
  // ---------------------------------------------------------------------------

  const onFlowConnect: OnConnect = useCallback(
    (params) => setFlowEdges((eds) => addEdge(params, eds)),
    [setFlowEdges]
  );

  const addFlowNode = useCallback(() => {
    const id = `f${++flowNodeCounter.current}`;
    setFlowNodes((nds) => [
      ...nds,
      {
        id,
        type: "default",
        position: { x: 80 + Math.random() * 200, y: 80 + Math.random() * 200 },
        data: { label: "Node", shape: nextShape },
        style: flowNodeStyle(nextShape),
      },
    ]);
  }, [setFlowNodes, nextShape]);

  // Set the shape: applies to every selected Flow node, and becomes the shape
  // for the NEXT added node. If nothing is selected, only the "next" default
  // changes (still useful before adding).
  const applyShape = useCallback(
    (shape: FlowShape) => {
      setNextShape(shape);
      setFlowNodes((nds) =>
        nds.map((n) =>
          n.selected
            ? { ...n, data: { ...n.data, shape }, style: { ...(n.style ?? {}), ...flowNodeStyle(shape) } }
            : n
        )
      );
    },
    [setFlowNodes]
  );

  const onFlowNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const label = window.prompt("Rename node", String(node.data.label ?? node.id));
      if (label !== null && label.trim()) {
        setFlowNodes((nds) =>
          nds.map((n) =>
            n.id === node.id ? { ...n, data: { ...n.data, label: label.trim() } } : n
          )
        );
      }
    },
    [setFlowNodes]
  );

  // ---------------------------------------------------------------------------
  // UML tab helpers
  // ---------------------------------------------------------------------------

  const onUmlConnect: OnConnect = useCallback(
    (params) =>
      setUmlEdges((eds) =>
        addEdge({ ...params, data: { relation: nextRelation } }, eds)
      ),
    [setUmlEdges, nextRelation]
  );

  const addUmlNode = useCallback(() => {
    const id = `u${++umlNodeCounter.current}`;
    setUmlNodes((nds) => [
      ...nds,
      {
        id,
        type: "umlClass",
        position: { x: 80 + Math.random() * 300, y: 80 + Math.random() * 200 },
        data: {
          name: `Class${umlNodeCounter.current}`,
          attributes: [],
          methods: [],
        },
      },
    ]);
  }, [setUmlNodes]);

  // ---------------------------------------------------------------------------
  // Mermaid export helpers
  // ---------------------------------------------------------------------------

  const buildFlowMermaid = useCallback((): string => {
    const model = toFlowModel(flowNodes as RfNode[], flowEdges as RfEdge[]);
    return flowToMermaid(model.nodes, model.edges);
  }, [flowNodes, flowEdges]);

  const buildUmlMermaid = useCallback((): string => {
    const model = toUmlModel(umlNodes as RfNode[], umlEdges as RfEdge[]);
    return umlToMermaid(model.nodes, model.edges);
  }, [umlNodes, umlEdges]);

  /** Build Mermaid from the active graph (the one that will be exported) */
  const buildMermaid = useCallback((): string => {
    return tab === "uml" ? buildUmlMermaid() : buildFlowMermaid();
  }, [tab, buildFlowMermaid, buildUmlMermaid]);

  /** Mermaid for the preview pane — shows both when on Mermaid tab */
  const previewMermaid = useCallback((): string => {
    if (tab === "mermaid") {
      // Show flow export (the primary graph). Both could be shown but keep it simple.
      return buildFlowMermaid();
    }
    return buildMermaid();
  }, [tab, buildMermaid, buildFlowMermaid]);

  // ---------------------------------------------------------------------------
  // Footer actions
  // ---------------------------------------------------------------------------

  const handleInsert = useCallback(() => {
    onInsertToDoc(buildMermaid());
    onClose();
  }, [buildMermaid, onInsertToDoc, onClose]);

  const handleAddToChat = useCallback(() => {
    onAddToChat(buildMermaid());
    onClose();
  }, [buildMermaid, onAddToChat, onClose]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Suppress unused variable warnings for setters we keep for symmetry
  void setFlowNodes;
  void setUmlNodes;
  void onUmlNodesChange;
  void onFlowNodesChange;
  void onFlowEdgesChange;
  void onUmlEdgesChange;

  return (
    <Modal
      label="Diagram — interactive flow and UML editor"
      width={960}
      maxHeightVh={92}
      onClose={onClose}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Workflow size={16} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
          <span style={{ fontSize: "var(--c-fs-lg)", fontWeight: 600, color: "var(--c-text)" }}>
            Diagram
          </span>
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
            drag to connect · double-click to rename · pick a shape per node
          </span>
        </span>
      }
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: "8px 16px 0",
          borderBottom: "1px solid var(--c-border)",
          background: "var(--c-surface-1)",
        }}
      >
        {(["flow", "uml", "mermaid"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "5px 14px 6px",
              fontSize: "var(--c-fs-sm)",
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "var(--c-text)" : "var(--c-text-muted)",
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--c-accent)" : "2px solid transparent",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {t === "flow" ? "Flow" : t === "uml" ? "UML" : "Mermaid"}
          </button>
        ))}

        {/* UML relation selector — only visible on UML tab */}
        {tab === "uml" && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingBottom: 4,
            }}
          >
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
              Next edge:
            </span>
            <select
              value={nextRelation}
              onChange={(e) => setNextRelation(e.target.value as UmlRelationOption)}
              style={{
                background: "var(--c-surface-2)",
                border: "1px solid var(--c-border-strong)",
                borderRadius: "var(--c-radius-sm)",
                color: "var(--c-text)",
                fontSize: "var(--c-fs-xs)",
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              <option value="association">Association</option>
              <option value="inheritance">Inheritance</option>
              <option value="composition">Composition</option>
              <option value="aggregation">Aggregation</option>
            </select>
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div style={{ height: "56vh", minHeight: 340, position: "relative" }}>
        {/* Flow tab */}
        {tab === "flow" && (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onFlowNodesChange}
            onEdgesChange={onFlowEdgesChange}
            onConnect={onFlowConnect}
            onNodeDoubleClick={onFlowNodeDoubleClick}
            deleteKeyCode="Delete"
            colorMode="dark"
            fitView
            style={{ background: "var(--c-code-bg)" }}
          >
            <Background color="var(--c-border)" gap={20} size={1} />
            <Controls />
            <div style={{ position: "absolute", top: 10, left: 10, zIndex: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={addFlowNode} style={toolbarBtnStyle}>
                + Node
              </button>
              <select
                value={nextShape}
                onChange={(e) => applyShape(e.target.value as FlowShape)}
                title="Shape for new nodes (and any selected node)"
                aria-label="Node shape"
                style={{
                  background: "var(--c-surface-2)",
                  border: "1px solid var(--c-border-strong)",
                  borderRadius: "var(--c-radius)",
                  color: "var(--c-text)",
                  fontSize: "var(--c-fs-xs)",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontWeight: 550,
                }}
              >
                {FLOW_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {SHAPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </ReactFlow>
        )}

        {/* UML tab */}
        {tab === "uml" && (
          <ReactFlow
            nodes={umlNodes}
            edges={umlEdges}
            onNodesChange={onUmlNodesChange}
            onEdgesChange={onUmlEdgesChange}
            onConnect={onUmlConnect}
            nodeTypes={nodeTypes}
            deleteKeyCode="Delete"
            colorMode="dark"
            fitView
            style={{ background: "var(--c-code-bg)" }}
          >
            <Background color="var(--c-border)" gap={20} size={1} />
            <Controls />
            <div style={{ position: "absolute", top: 10, left: 10, zIndex: 10 }}>
              <button onClick={addUmlNode} style={toolbarBtnStyle}>
                + Class
              </button>
            </div>
          </ReactFlow>
        )}

        {/* Mermaid tab — live read-only export */}
        {tab === "mermaid" && (
          <div
            style={{
              height: "100%",
              overflow: "auto",
              padding: "var(--c-space-3) var(--c-space-4)",
              background: "var(--c-code-bg)",
            }}
          >
            <div style={{ marginBottom: "var(--c-space-3)" }}>
              <Markdown content={"```mermaid\n" + previewMermaid() + "\n```"} />
            </div>
            <pre
              style={{
                fontFamily: "var(--c-font-mono)",
                fontSize: "var(--c-fs-xs)",
                color: "var(--c-text-secondary)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                margin: 0,
                borderTop: "1px solid var(--c-border)",
                paddingTop: "var(--c-space-2)",
              }}
            >
              {previewMermaid()}
            </pre>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-2)",
          padding: "var(--c-space-3) var(--c-space-4)",
          borderTop: "1px solid var(--c-border)",
        }}
      >
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
          {tab === "flow"
            ? "Drag handles between nodes to connect. Delete removes selected."
            : tab === "uml"
              ? "Drag handles between classes to connect. Set relation before drawing."
              : "Live Mermaid export from the Flow canvas."}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleInsert} style={btnStyle(false)}>
          <FilePlus2 size={13} strokeWidth={2} />
          Insert into {docLabel}
        </button>
        <button onClick={handleAddToChat} style={btnStyle(true)}>
          <MessageSquarePlus size={13} strokeWidth={2} />
          Add to chat
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Flow shape helpers
// ---------------------------------------------------------------------------

/** Human-readable label for each shape (picker options). */
const SHAPE_LABEL: Record<FlowShape, string> = {
  rectangle: "Rectangle (process)",
  rounded: "Rounded",
  stadium: "Stadium (start/end)",
  subroutine: "Subroutine",
  cylinder: "Cylinder (database)",
  circle: "Circle (connector)",
  diamond: "Diamond (decision)",
  hexagon: "Hexagon (prepare)",
  parallelogram: "Parallelogram (I/O)",
};

/**
 * A lightweight visual hint for a node's shape on the RF canvas via inline
 * style. React Flow's default node is a rounded box, so we approximate the
 * shape family with border-radius / clip-path / rotation — enough to
 * distinguish them at a glance. The authoritative shape lives in `data.shape`
 * and is what the Mermaid export uses; this is purely cosmetic.
 */
function flowNodeStyle(shape: FlowShape): React.CSSProperties {
  const base: React.CSSProperties = {
    background: "var(--c-surface-2)",
    border: "1px solid var(--c-border-strong)",
    color: "var(--c-text)",
    fontSize: "var(--c-fs-xs)",
  };
  switch (shape) {
    case "rounded":
      return { ...base, borderRadius: 14 };
    case "stadium":
      return { ...base, borderRadius: 999 };
    case "circle":
      return { ...base, borderRadius: "50%", width: 72, height: 72, display: "flex", alignItems: "center", justifyContent: "center" };
    case "diamond":
      return { ...base, clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)", padding: 22 };
    case "hexagon":
      return { ...base, clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)", padding: "10px 22px" };
    case "parallelogram":
      return { ...base, clipPath: "polygon(20% 0%, 100% 0%, 80% 100%, 0% 100%)", padding: "8px 22px" };
    case "cylinder":
      return { ...base, borderRadius: "50% / 12px" };
    case "subroutine":
      return { ...base, borderRadius: 2, boxShadow: "inset 3px 0 0 var(--c-border-strong), inset -3px 0 0 var(--c-border-strong)" };
    case "rectangle":
    default:
      return { ...base, borderRadius: 2 };
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const toolbarBtnStyle: React.CSSProperties = {
  background: "var(--c-surface-2)",
  border: "1px solid var(--c-border-strong)",
  borderRadius: "var(--c-radius)",
  color: "var(--c-text)",
  fontSize: "var(--c-fs-xs)",
  padding: "4px 10px",
  cursor: "pointer",
  fontWeight: 550,
};

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: "var(--c-fs-sm)",
    fontWeight: 550,
    padding: "6px 12px",
    borderRadius: "var(--c-radius)",
    background: primary ? "var(--c-accent)" : "var(--c-surface-2)",
    color: primary ? "var(--c-on-accent)" : "var(--c-text)",
    border: primary ? "none" : "1px solid var(--c-border-strong)",
    cursor: "pointer",
  };
}
