/**
 * mermaidExport.test.ts — TDD for the pure Mermaid serialization module.
 *
 * Covers:
 *   - flowToMermaid: flowchart TD header, node lines, labeled/unlabeled edges
 *   - umlToMermaid: classDiagram header, class blocks, all four relation arrows
 *   - safeMermaidId: strips invalid chars, collapses spaces, ensures non-empty
 *   - Edge cases: empty inputs produce minimal valid headers; quotes/newlines
 *     in labels don't break the output.
 */
import { describe, it, expect } from "vitest";
import {
  flowToMermaid,
  umlToMermaid,
  safeMermaidId,
  type FlowNode,
  type FlowEdge,
  type UmlNode,
  type UmlEdge,
} from "./mermaidExport";

// ---------------------------------------------------------------------------
// safeMermaidId
// ---------------------------------------------------------------------------
describe("safeMermaidId", () => {
  it("strips spaces and punctuation, producing a valid id", () => {
    expect(safeMermaidId("Order Item!")).toBe("Order_Item");
  });

  it("collapses multiple spaces to a single underscore", () => {
    expect(safeMermaidId("My  Class  Name")).toBe("My_Class_Name");
  });

  it("preserves alphanumeric and underscore characters", () => {
    expect(safeMermaidId("UserAccount_v2")).toBe("UserAccount_v2");
  });

  it("falls back to 'node' when the result would be empty", () => {
    expect(safeMermaidId("!!!")).toBe("node");
    expect(safeMermaidId("")).toBe("node");
  });

  it("strips leading/trailing underscores produced by edge whitespace", () => {
    // spaces at edges collapse to underscores, then get trimmed
    const result = safeMermaidId("  hello  ");
    expect(result).toMatch(/^[A-Za-z0-9_]+$/);
    expect(result).not.toMatch(/^_|_$/);
  });
});

// ---------------------------------------------------------------------------
// flowToMermaid
// ---------------------------------------------------------------------------
describe("flowToMermaid", () => {
  it("produces the flowchart TD header", () => {
    const out = flowToMermaid([], []);
    expect(out.startsWith("flowchart TD")).toBe(true);
  });

  it("empty inputs → minimal valid output, no crash", () => {
    expect(flowToMermaid([], [])).toBe("flowchart TD");
  });

  it("renders node lines with quoted labels", () => {
    const nodes: FlowNode[] = [
      { id: "a", label: "Start" },
      { id: "b", label: "End" },
    ];
    const out = flowToMermaid(nodes, []);
    expect(out).toContain('a["Start"]');
    expect(out).toContain('b["End"]');
  });

  it("renders a labeled edge", () => {
    const nodes: FlowNode[] = [
      { id: "a", label: "Start" },
      { id: "b", label: "End" },
    ];
    const edges: FlowEdge[] = [{ id: "e1", source: "a", target: "b", label: "go" }];
    const out = flowToMermaid(nodes, edges);
    expect(out).toContain("a -->|go| b");
  });

  it("renders an unlabeled edge", () => {
    const nodes: FlowNode[] = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    const edges: FlowEdge[] = [{ id: "e1", source: "a", target: "b" }];
    const out = flowToMermaid(nodes, edges);
    expect(out).toContain("a --> b");
    // must NOT contain pipe notation for unlabeled edge
    expect(out).not.toMatch(/a -->\|.*\| b/);
  });

  it("escapes double quotes in labels so output is valid mermaid", () => {
    const nodes: FlowNode[] = [{ id: "x", label: 'Say "hello"' }];
    const out = flowToMermaid(nodes, []);
    // The output must not contain a bare unescaped double-quote inside the brackets
    // (the label wrapping quotes are expected but inner quotes must be escaped/removed)
    const lineMatch = out.match(/x\["(.*)"\]/);
    expect(lineMatch).not.toBeNull();
    // inner content should not contain a raw " that would close the mermaid string early
    const inner = lineMatch![1];
    expect(inner).not.toContain('"');
  });

  it("strips newlines in labels so output is valid mermaid", () => {
    const nodes: FlowNode[] = [{ id: "x", label: "line1\nline2" }];
    const out = flowToMermaid(nodes, []);
    expect(out).not.toContain("\n\n"); // no extra blank lines from label
    const lineMatch = out.match(/x\["(.*)"\]/);
    expect(lineMatch).not.toBeNull();
    expect(lineMatch![1]).not.toContain("\n");
  });

  it("full round-trip: nodes + labeled + unlabeled edges", () => {
    const nodes: FlowNode[] = [
      { id: "a", label: "Start" },
      { id: "b", label: "End" },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "a", target: "b", label: "go" },
      { id: "e2", source: "b", target: "a" },
    ];
    const out = flowToMermaid(nodes, edges);
    expect(out).toContain("flowchart TD");
    expect(out).toContain('a["Start"]');
    expect(out).toContain('b["End"]');
    expect(out).toContain("a -->|go| b");
    expect(out).toContain("b --> a");
  });
});

// ---------------------------------------------------------------------------
// umlToMermaid
// ---------------------------------------------------------------------------
describe("umlToMermaid", () => {
  it("produces the classDiagram header", () => {
    const out = umlToMermaid([], []);
    expect(out.startsWith("classDiagram")).toBe(true);
  });

  it("empty inputs → minimal valid output, no crash", () => {
    expect(umlToMermaid([], [])).toBe("classDiagram");
  });

  it("renders a class block with attributes and methods", () => {
    const nodes: UmlNode[] = [
      {
        id: "u1",
        data: {
          name: "User",
          attributes: ["id: string", "name: string"],
          methods: ["save()"],
        },
      },
    ];
    const out = umlToMermaid(nodes, []);
    expect(out).toContain("classDiagram");
    expect(out).toContain("class User {");
    expect(out).toContain("id: string");
    expect(out).toContain("name: string");
    expect(out).toContain("save()");
  });

  it("sanitizes class names with safeMermaidId", () => {
    const nodes: UmlNode[] = [
      { id: "n1", data: { name: "Order Item", attributes: [], methods: [] } },
    ];
    const out = umlToMermaid(nodes, []);
    expect(out).toContain("class Order_Item {");
    expect(out).not.toContain("class Order Item");
  });

  it("maps inheritance relation to <|-- arrow", () => {
    const nodes: UmlNode[] = [
      { id: "n1", data: { name: "Base", attributes: [], methods: [] } },
      { id: "n2", data: { name: "Derived", attributes: [], methods: [] } },
    ];
    const edges: UmlEdge[] = [
      { id: "e1", source: "n1", target: "n2", relation: "inheritance" },
    ];
    const out = umlToMermaid(nodes, edges);
    expect(out).toContain("Base <|-- Derived");
  });

  it("maps composition relation to *-- arrow", () => {
    const nodes: UmlNode[] = [
      { id: "n1", data: { name: "Car", attributes: [], methods: [] } },
      { id: "n2", data: { name: "Engine", attributes: [], methods: [] } },
    ];
    const edges: UmlEdge[] = [
      { id: "e1", source: "n1", target: "n2", relation: "composition" },
    ];
    const out = umlToMermaid(nodes, edges);
    expect(out).toContain("Car *-- Engine");
  });

  it("maps aggregation relation to o-- arrow", () => {
    const nodes: UmlNode[] = [
      { id: "n1", data: { name: "Team", attributes: [], methods: [] } },
      { id: "n2", data: { name: "Player", attributes: [], methods: [] } },
    ];
    const edges: UmlEdge[] = [
      { id: "e1", source: "n1", target: "n2", relation: "aggregation" },
    ];
    const out = umlToMermaid(nodes, edges);
    expect(out).toContain("Team o-- Player");
  });

  it("maps association relation to --> arrow", () => {
    const nodes: UmlNode[] = [
      { id: "n1", data: { name: "Order", attributes: [], methods: [] } },
      { id: "n2", data: { name: "Customer", attributes: [], methods: [] } },
    ];
    const edges: UmlEdge[] = [
      { id: "e1", source: "n1", target: "n2", relation: "association" },
    ];
    const out = umlToMermaid(nodes, edges);
    expect(out).toContain("Order --> Customer");
  });

  it("resolves edge source/target node ids to class names", () => {
    // edge references node ids ("n1", "n2"), NOT names ("Foo", "Bar")
    const nodes: UmlNode[] = [
      { id: "n1", data: { name: "Foo", attributes: [], methods: [] } },
      { id: "n2", data: { name: "Bar", attributes: [], methods: [] } },
    ];
    const edges: UmlEdge[] = [
      { id: "e1", source: "n1", target: "n2", relation: "association" },
    ];
    const out = umlToMermaid(nodes, edges);
    // Output uses class names, not raw ids
    expect(out).toContain("Foo --> Bar");
    expect(out).not.toContain("n1 --> n2");
  });

  it("skips edges where source or target node id is not found", () => {
    const nodes: UmlNode[] = [
      { id: "n1", data: { name: "Foo", attributes: [], methods: [] } },
    ];
    const edges: UmlEdge[] = [
      { id: "e1", source: "n1", target: "n999", relation: "association" },
    ];
    // Should not throw; just omit the edge
    expect(() => umlToMermaid(nodes, edges)).not.toThrow();
    const out = umlToMermaid(nodes, edges);
    // The bad edge must not appear
    expect(out).not.toContain("n999");
  });

  it("renders multiple classes correctly", () => {
    const nodes: UmlNode[] = [
      { id: "u1", data: { name: "User", attributes: ["id: string"], methods: ["save()"] } },
      { id: "p1", data: { name: "Post", attributes: ["title: string"], methods: ["publish()"] } },
    ];
    const edges: UmlEdge[] = [
      { id: "e1", source: "u1", target: "p1", relation: "association" },
    ];
    const out = umlToMermaid(nodes, edges);
    expect(out).toContain("class User {");
    expect(out).toContain("class Post {");
    expect(out).toContain("User --> Post");
  });
});
