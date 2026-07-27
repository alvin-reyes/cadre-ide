/**
 * mermaidExport.ts — Pure Mermaid serialization module.
 *
 * Converts a node/edge diagram model (FlowNode/FlowEdge for flowcharts,
 * UmlNode/UmlEdge for class diagrams) into valid Mermaid markup that the
 * planning agent can read as text.
 *
 * No React, no Tauri, no store imports — purely functional.
 */

// ---------------------------------------------------------------------------
// Flow diagram types
// ---------------------------------------------------------------------------

/**
 * Flowchart node shapes. Each maps to a Mermaid bracket syntax:
 *   rectangle     A["label"]    process (default)
 *   rounded       A("label")    rounded process
 *   stadium       A(["label"])  terminator (start/end)
 *   subroutine    A[["label"]]  predefined process
 *   cylinder      A[("label")]  database
 *   circle        A(("label"))  connector
 *   diamond       A{"label"}    decision
 *   hexagon       A{{"label"}}  preparation
 *   parallelogram A[/"label"/]  input/output
 */
export type FlowShape =
  | "rectangle"
  | "rounded"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "diamond"
  | "hexagon"
  | "parallelogram";

/** All shapes, in a stable UI/picker order. */
export const FLOW_SHAPES: FlowShape[] = [
  "rectangle",
  "rounded",
  "stadium",
  "subroutine",
  "cylinder",
  "circle",
  "diamond",
  "hexagon",
  "parallelogram",
];

export interface FlowNode {
  id: string;
  label: string;
  /** Node shape; defaults to "rectangle" when omitted. */
  shape?: FlowShape;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

// ---------------------------------------------------------------------------
// UML class diagram types
// ---------------------------------------------------------------------------

export interface UmlClassData {
  name: string;
  attributes: string[];
  methods: string[];
}

export interface UmlNode {
  id: string;
  data: UmlClassData;
}

export type UmlRelation = "inheritance" | "composition" | "aggregation" | "association";

export interface UmlEdge {
  id: string;
  source: string;
  target: string;
  relation: UmlRelation;
  label?: string;
}

// ---------------------------------------------------------------------------
// Arrow map for UML relations
// ---------------------------------------------------------------------------

const UML_ARROW: Record<UmlRelation, string> = {
  inheritance: "<|--",
  composition: "*--",
  aggregation: "o--",
  association: "-->",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a string into a valid Mermaid identifier.
 *
 * Rules:
 *   - Collapse runs of whitespace to a single `_`
 *   - Remove any character that is not [A-Za-z0-9_]
 *   - Trim leading/trailing underscores produced by leading/trailing spaces
 *   - Fall back to `"node"` if the result is empty
 */
export function safeMermaidId(raw: string): string {
  const sanitized = raw
    // collapse whitespace runs → single underscore
    .replace(/\s+/g, "_")
    // drop any char that is not alnum or underscore
    .replace(/[^A-Za-z0-9_]/g, "")
    // trim underscores at start/end (from leading/trailing spaces)
    .replace(/^_+|_+$/g, "")
    // collapse consecutive underscores that may have appeared after stripping
    .replace(/_+/g, "_");

  return sanitized.length > 0 ? sanitized : "node";
}

/**
 * Escape a string for use inside Mermaid node label brackets `["..."]`
 * or pipe-delimited edge labels `|...|`.
 *
 * Mermaid chokes on:
 *   - Double quotes   → replace with a typographic quote or strip
 *   - Newlines / CR   → replace with a space
 *   - Pipe characters → replace with a hyphen (would close |label|)
 */
function escapeLabel(label: string): string {
  return label
    .replace(/\r?\n/g, " ")   // newlines → space
    .replace(/"/g, "'")        // double quotes → single quotes
    .replace(/\|/g, "-");      // pipes → hyphen
}

// ---------------------------------------------------------------------------
// flowToMermaid
// ---------------------------------------------------------------------------

/**
 * Wrap a label in the Mermaid bracket syntax for a given shape.
 * Unknown/omitted shapes fall back to the rectangle form `["label"]`.
 */
function shapeWrap(label: string, shape: FlowShape | undefined): string {
  const l = `"${escapeLabel(label)}"`;
  switch (shape) {
    case "rounded": return `(${l})`;
    case "stadium": return `([${l}])`;
    case "subroutine": return `[[${l}]]`;
    case "cylinder": return `[(${l})]`;
    case "circle": return `((${l}))`;
    case "diamond": return `{${l}}`;
    case "hexagon": return `{{${l}}}`;
    case "parallelogram": return `[/${l}/]`;
    case "rectangle":
    default: return `[${l}]`;
  }
}

/**
 * Serialize a flowchart model to Mermaid `flowchart TD` markup.
 *
 * Each node renders in its `shape`'s bracket syntax (default: rectangle).
 * Empty inputs produce `"flowchart TD"` — a valid, parseable Mermaid diagram.
 */
export function flowToMermaid(nodes: FlowNode[], edges: FlowEdge[]): string {
  const lines: string[] = ["flowchart TD"];

  for (const node of nodes) {
    lines.push(`${node.id}${shapeWrap(node.label, node.shape)}`);
  }

  for (const edge of edges) {
    if (edge.label !== undefined && edge.label !== "") {
      lines.push(`${edge.source} -->|${escapeLabel(edge.label)}| ${edge.target}`);
    } else {
      lines.push(`${edge.source} --> ${edge.target}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// umlToMermaid
// ---------------------------------------------------------------------------

/**
 * Serialize a UML class diagram model to Mermaid `classDiagram` markup.
 *
 * - Each UmlNode becomes a `class Name { ... }` block with attributes then methods.
 * - Each UmlEdge becomes a relationship line: `SourceClass ARROW TargetClass`.
 *   Edges reference node ids; this function resolves them to class names.
 * - Edges whose source or target id is not found are silently skipped.
 *
 * Empty inputs produce `"classDiagram"` — valid Mermaid.
 */
export function umlToMermaid(nodes: UmlNode[], edges: UmlEdge[]): string {
  const lines: string[] = ["classDiagram"];

  // Build id → class name map for edge resolution
  const idToName = new Map<string, string>(
    nodes.map((n) => [n.id, n.data.name])
  );

  // Render class blocks
  for (const node of nodes) {
    const safeId = safeMermaidId(node.data.name);
    const members: string[] = [
      ...node.data.attributes.map((a) => `  ${escapeLabel(a)}`),
      ...node.data.methods.map((m) => `  ${escapeLabel(m)}`),
    ];
    lines.push(`class ${safeId} {`);
    for (const member of members) {
      lines.push(member);
    }
    lines.push("}");
  }

  // Render relationship lines
  for (const edge of edges) {
    const sourceName = idToName.get(edge.source);
    const targetName = idToName.get(edge.target);
    if (sourceName === undefined || targetName === undefined) {
      // Skip edges referencing unknown node ids
      continue;
    }
    const arrow = UML_ARROW[edge.relation];
    const safeSource = safeMermaidId(sourceName);
    const safeTarget = safeMermaidId(targetName);
    lines.push(`${safeSource} ${arrow} ${safeTarget}`);
  }

  // If only the header was added (no nodes or edges), return just the header
  return lines.length === 1 ? lines[0] : lines.join("\n");
}
