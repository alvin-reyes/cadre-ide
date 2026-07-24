/**
 * diagramMappers.test.ts — Unit tests for the pure React Flow → model mappers.
 *
 * These tests verify that `toFlowModel` and `toUmlModel` produce the correct
 * FlowNode/FlowEdge/UmlNode/UmlEdge models that the Task-1 serializers expect.
 */

import { describe, it, expect } from "vitest";
import { toFlowModel, toUmlModel } from "./diagramMappers";

// ---------------------------------------------------------------------------
// toFlowModel
// ---------------------------------------------------------------------------

describe("toFlowModel", () => {
  it("maps nodes with string data.label to FlowNode", () => {
    const nodes = [{ id: "n1", data: { label: "Start" } }];
    const { nodes: result } = toFlowModel(nodes, []);
    expect(result).toEqual([{ id: "n1", label: "Start" }]);
  });

  it("falls back to node id when data.label is absent", () => {
    const nodes = [{ id: "n1", data: {} }];
    const { nodes: result } = toFlowModel(nodes, []);
    expect(result[0].label).toBe("n1");
  });

  it("falls back to node id when data.label is not a string", () => {
    const nodes = [{ id: "n1", data: { label: 42 } }];
    const { nodes: result } = toFlowModel(nodes, []);
    expect(result[0].label).toBe("n1");
  });

  it("maps edges with source/target", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2" }];
    const { edges: result } = toFlowModel([], edges);
    expect(result[0]).toMatchObject({ id: "e1", source: "n1", target: "n2" });
  });

  it("includes edge label when present", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2", label: "calls" }];
    const { edges: result } = toFlowModel([], edges);
    expect(result[0].label).toBe("calls");
  });

  it("omits label key when edge label is absent", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2" }];
    const { edges: result } = toFlowModel([], edges);
    expect("label" in result[0]).toBe(false);
  });

  it("omits label key when edge label is null", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2", label: null }];
    const { edges: result } = toFlowModel([], edges);
    expect("label" in result[0]).toBe(false);
  });

  it("handles empty input without crashing", () => {
    const { nodes, edges } = toFlowModel([], []);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it("maps multiple nodes and edges", () => {
    const nodes = [
      { id: "a", data: { label: "Alpha" } },
      { id: "b", data: { label: "Beta" } },
    ];
    const edges = [
      { id: "e1", source: "a", target: "b", label: "go" },
      { id: "e2", source: "b", target: "a" },
    ];
    const { nodes: rn, edges: re } = toFlowModel(nodes, edges);
    expect(rn).toHaveLength(2);
    expect(re).toHaveLength(2);
    expect(rn[0]).toEqual({ id: "a", label: "Alpha" });
    expect(re[0].label).toBe("go");
    expect("label" in re[1]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toUmlModel
// ---------------------------------------------------------------------------

describe("toUmlModel", () => {
  it("maps node data to UmlClassData shape", () => {
    const nodes = [
      {
        id: "u1",
        data: {
          name: "User",
          attributes: ["id: string", "name: string"],
          methods: ["save()"],
        },
      },
    ];
    const { nodes: result } = toUmlModel(nodes, []);
    expect(result[0]).toEqual({
      id: "u1",
      data: { name: "User", attributes: ["id: string", "name: string"], methods: ["save()"] },
    });
  });

  it("falls back to node id when name is absent", () => {
    const nodes = [{ id: "n1", data: {} }];
    const { nodes: result } = toUmlModel(nodes, []);
    expect(result[0].data.name).toBe("n1");
  });

  it("falls back to empty arrays when attributes/methods are absent", () => {
    const nodes = [{ id: "n1", data: { name: "Foo" } }];
    const { nodes: result } = toUmlModel(nodes, []);
    expect(result[0].data.attributes).toEqual([]);
    expect(result[0].data.methods).toEqual([]);
  });

  it("uses association as the default relation when data.relation is absent", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2" }];
    const { edges: result } = toUmlModel([], edges);
    expect(result[0].relation).toBe("association");
  });

  it("uses association when data.relation is an invalid value", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2", data: { relation: "unknown" } }];
    const { edges: result } = toUmlModel([], edges);
    expect(result[0].relation).toBe("association");
  });

  it("reads inheritance relation from edge data", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2", data: { relation: "inheritance" } }];
    const { edges: result } = toUmlModel([], edges);
    expect(result[0].relation).toBe("inheritance");
  });

  it("reads composition relation from edge data", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2", data: { relation: "composition" } }];
    const { edges: result } = toUmlModel([], edges);
    expect(result[0].relation).toBe("composition");
  });

  it("reads aggregation relation from edge data", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2", data: { relation: "aggregation" } }];
    const { edges: result } = toUmlModel([], edges);
    expect(result[0].relation).toBe("aggregation");
  });

  it("reads association relation from edge data", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2", data: { relation: "association" } }];
    const { edges: result } = toUmlModel([], edges);
    expect(result[0].relation).toBe("association");
  });

  it("handles empty input without crashing", () => {
    const { nodes, edges } = toUmlModel([], []);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it("round-trips through umlToMermaid via the mappers", async () => {
    // Integration: mapper output feeds directly into Task-1 serializer
    const { umlToMermaid } = await import("../../lib/diagram/mermaidExport");
    const nodes = [
      {
        id: "n1",
        data: { name: "Animal", attributes: ["name: string"], methods: ["speak()"] },
      },
      {
        id: "n2",
        data: { name: "Dog", attributes: [], methods: ["bark()"] },
      },
    ];
    const edges = [
      { id: "e1", source: "n1", target: "n2", data: { relation: "inheritance" } },
    ];
    const model = toUmlModel(nodes, edges);
    const mermaid = umlToMermaid(model.nodes, model.edges);
    expect(mermaid).toContain("classDiagram");
    expect(mermaid).toContain("class Animal {");
    expect(mermaid).toContain("class Dog {");
    expect(mermaid).toContain("Animal <|-- Dog");
  });
});
