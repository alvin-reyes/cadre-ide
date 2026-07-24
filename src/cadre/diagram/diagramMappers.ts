/**
 * diagramMappers.ts — Pure mappers from React Flow node/edge state
 * to the Task-1 mermaidExport model types.
 *
 * These are extracted as pure, testable functions so the DiagramEditor
 * component stays thin and the mapping logic can be verified in isolation.
 *
 * No React, no @xyflow/react runtime needed — only the minimal node/edge
 * shape (id, data, source, target) that React Flow guarantees.
 */

import type { FlowNode, FlowEdge, UmlNode, UmlEdge, UmlRelation } from "../../lib/diagram/mermaidExport";

// ---------------------------------------------------------------------------
// Minimal RF shapes (only what the mappers need — avoids importing RF types)
// ---------------------------------------------------------------------------

export interface RfNode {
  id: string;
  data: Record<string, unknown>;
}

export interface RfEdge {
  id: string;
  source: string;
  target: string;
  label?: string | null;
  data?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// toFlowModel
// ---------------------------------------------------------------------------

/**
 * Map React Flow nodes/edges (from the Flow tab) to the FlowNode/FlowEdge
 * model consumed by flowToMermaid.
 *
 * - Node label is taken from `data.label` (string) if present, else the node id.
 * - Edge label is taken from the RF edge `label` field (optional).
 */
export function toFlowModel(
  nodes: RfNode[],
  edges: RfEdge[]
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const flowNodes: FlowNode[] = nodes.map((n) => ({
    id: n.id,
    label: typeof n.data.label === "string" ? n.data.label : n.id,
  }));

  const flowEdges: FlowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.label ? { label: String(e.label) } : {}),
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

// ---------------------------------------------------------------------------
// toUmlModel
// ---------------------------------------------------------------------------

/**
 * Map React Flow nodes/edges (from the UML tab) to the UmlNode/UmlEdge
 * model consumed by umlToMermaid.
 *
 * - Node data is expected to be UmlClassData: { name, attributes, methods }
 * - Edge relation is read from `data.relation` (UmlRelation); defaults to "association".
 */
export function toUmlModel(
  nodes: RfNode[],
  edges: RfEdge[]
): { nodes: UmlNode[]; edges: UmlEdge[] } {
  const umlNodes: UmlNode[] = nodes.map((n) => ({
    id: n.id,
    data: {
      name: typeof n.data.name === "string" ? n.data.name : n.id,
      attributes: Array.isArray(n.data.attributes)
        ? (n.data.attributes as string[])
        : [],
      methods: Array.isArray(n.data.methods)
        ? (n.data.methods as string[])
        : [],
    },
  }));

  const VALID_RELATIONS: UmlRelation[] = [
    "inheritance",
    "composition",
    "aggregation",
    "association",
  ];

  const umlEdges: UmlEdge[] = edges.map((e) => {
    const relation =
      e.data &&
      typeof e.data.relation === "string" &&
      VALID_RELATIONS.includes(e.data.relation as UmlRelation)
        ? (e.data.relation as UmlRelation)
        : "association";

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      relation,
    };
  });

  return { nodes: umlNodes, edges: umlEdges };
}
