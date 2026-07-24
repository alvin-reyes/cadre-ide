# Interactive Diagram + UML Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Mermaid *text* editor with an **interactive diagramming tool** (drag nodes, draw connections) that also has a **UML class-diagram view**, and **exports to Mermaid** so the planning agent still reads the diagram as text.

**Architecture:** A React Flow (`@xyflow/react`, already installed) canvas with three tabs — **Flow** (boxes + arrows), **UML** (class nodes + relationship edges), and **Mermaid** (the exported text, hand-editable). On "Insert to doc" / "Add to chat" the canvas is serialized to Mermaid by a pure `mermaidExport` module (`flowchart` for Flow, `classDiagram` for UML) and passed to the existing `onInsertToDoc(mermaid)` / `onAddToChat(mermaid)` callbacks. The component keeps its current props so it drops into `PlanningStudio` unchanged.

**Tech Stack:** React 19 + TS, `@xyflow/react`, Vitest.

## Global Constraints
- Preserve the `DiagramEditor` props: `{ docLabel, onClose, onAddToChat(src: string), onInsertToDoc(src: string) }` — output is Mermaid markup (the agent-readable contract stays).
- Preserve all 526 tests + tsc + build green. The pure export is unit-tested; the canvas is validated by build + the demo smoke.
- Use `--c-*` tokens; React Flow's default CSS is imported once; custom nodes match the app's dark theme.

## File Structure
- `src/lib/diagram/mermaidExport.ts` *(new, pure)* — the node/edge model types + `flowToMermaid` + `umlToMermaid`. Unit-tested.
- `src/cadre/DiagramEditor.tsx` *(rewrite)* — the React Flow canvas (Flow / UML / Mermaid tabs) + palette + export.
- `src/cadre/diagram/UmlClassNode.tsx` *(new)* — the custom React Flow node for a UML class (name + attributes + methods, editable).

---

## Task 1: Pure Mermaid export (model + serializers)

**Files:** `src/lib/diagram/mermaidExport.ts` (+ test).

**Produces:**
```ts
export interface FlowNode { id: string; label: string; }
export interface FlowEdge { id: string; source: string; target: string; label?: string; }
export interface UmlClassData { name: string; attributes: string[]; methods: string[]; }
export interface UmlNode { id: string; data: UmlClassData; }
export type UmlRelation = "inheritance" | "composition" | "aggregation" | "association";
export interface UmlEdge { id: string; source: string; target: string; relation: UmlRelation; label?: string; }

export function flowToMermaid(nodes: FlowNode[], edges: FlowEdge[]): string;
export function umlToMermaid(nodes: UmlNode[], edges: UmlEdge[]): string;
export function safeMermaidId(raw: string): string; // sanitize a class/node name → a valid mermaid id (alnum+_, no spaces)
```

- [ ] **Step 1: Write failing tests** (`mermaidExport.test.ts`):
  - `flowToMermaid([{id:"a",label:"Start"},{id:"b",label:"End"}], [{id:"e",source:"a",target:"b",label:"go"}])` → contains `flowchart TD`, `a["Start"]`, `b["End"]`, and `a -->|go| b` (label optional → `a --> b`).
  - `umlToMermaid([{id:"u",data:{name:"User",attributes:["id: string","name: string"],methods:["save()"]}}], [])` → contains `classDiagram`, `class User {`, `id: string`, `name: string`, `save()`.
  - Relations map to the right mermaid arrows: inheritance `<|--`, composition `*--`, aggregation `o--`, association `-->`. e.g. `{source:"Base",target:"Derived",relation:"inheritance"}` → `Base <|-- Derived`.
  - `safeMermaidId("Order Item!")` → `Order_Item` (no spaces/punct); labels with quotes/newlines don't break the output (escape or strip).
  - Empty nodes → a minimal valid `flowchart TD` / `classDiagram` (no crash).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** `flowToMermaid`: header `flowchart TD`, one line per node `${id}["${escapeLabel(label)}"]`, one per edge `${source} -->${label?`|${escapeLabel(label)}|`:""} ${target}`. `umlToMermaid`: header `classDiagram`, a `class ${safeId(name)} {\n  ${attr}\n  ${method}\n}` block per node, then a relationship line per edge using the arrow map (source/target order as given). `safeMermaidId` strips to `[A-Za-z0-9_]`, collapses spaces to `_`. Escape/strip characters that break mermaid in labels.
- [ ] **Step 4: Run — PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(diagram): pure Mermaid export (flowchart + UML classDiagram)`

## Task 2: The interactive React Flow editor

**Files:** Rewrite `src/cadre/DiagramEditor.tsx`; create `src/cadre/diagram/UmlClassNode.tsx`. Read the CURRENT `DiagramEditor.tsx` first (props, Modal usage, `onAddToChat`/`onInsertToDoc`/`onClose`/`docLabel`) — keep the exact props.

- [ ] **Step 1: Canvas scaffold.** In `DiagramEditor.tsx`, import `@xyflow/react` (+ `import "@xyflow/react/dist/style.css"` once) and render a `<ReactFlow>` inside the existing `<Modal>`. Manage `nodes`/`edges` with `useNodesState`/`useEdgesState`; wire `onConnect` (addEdge) so users drag connections between node handles. Add zoom/pan controls (`<Controls/>`, `<Background/>`). Style the wrapper to the modal size; apply the dark theme (React Flow supports a `colorMode="dark"` prop and CSS vars — set node/edge colors from `--c-*`).
- [ ] **Step 2: Tabs — Flow / UML / Mermaid.** A small tab bar. **Flow** = default React Flow rectangular nodes with an editable label (double-click to rename; a "+ Node" button adds one). **UML** = the `UmlClassNode` custom node type (Step 3). **Mermaid** = a read-only (or editable) `<textarea>`/`<Markdown>` showing the live export of the current canvas (regenerated from nodes/edges via Task 1's serializers). Keep separate node/edge state per mode OR one state with a mode flag — simplest: separate Flow vs UML graphs, export the active one.
- [ ] **Step 3: `UmlClassNode`.** A custom React Flow node: a class card with an editable **name** (top), an **attributes** list, and a **methods** list, each with a small "+ add" and inline-edit (click to edit a line, Enter to commit). Source/target `<Handle>`s so classes can be connected. For the relationship TYPE, a lightweight control on the edge or a mode selector (e.g., a dropdown in a toolbar: the next drawn edge's relation = inheritance/composition/aggregation/association) — pick the simplest that lets a user set the relation; default association. Style with `--c-*` tokens.
- [ ] **Step 4: Export + wire the actions.** Keep the footer actions from the old editor: **Insert into `{docLabel}`** → build the Mermaid via `flowToMermaid`/`umlToMermaid` for the active mode and call `onInsertToDoc(mermaid)` then `onClose()`; **Add to chat** → `onAddToChat(mermaid)`. Map the React Flow nodes/edges → the Task-1 model (node id/label, UML class data, edge source/target/relation). The Mermaid tab shows the same output live.
- [ ] **Step 5: Verify** `npx tsc --noEmit`, `npx vitest run` (526 + Task 1 tests), `npm run build`, and `npm run test:smoke` all green. (The smoke doesn't open the editor, but must still pass — the new import/CSS must not break the app boot.) If you can, add a tiny test for the nodes→model mapping helper (extract it pure).
- [ ] **Step 6: Manual checklist (human):** open the diagram tool from the Plan composer → Flow tab: add nodes, connect them, rename → Insert → confirm a `flowchart` block lands in the doc. UML tab: add a class, add attributes/methods, connect two classes with inheritance → Insert → confirm a `classDiagram` block with the class + `<|--`. Mermaid tab reflects the canvas.
- [ ] **Step 7: Commit** — `feat(diagram): interactive React Flow editor with Flow + UML class views (Mermaid export)`

---

## Self-Review

**Spec coverage:** interactive canvas (drag nodes/connect) → Task 2; UML class view → Task 2 Step 3 + `umlToMermaid`; Mermaid export (agent-readable) → Task 1 + Task 2 Step 4; drop-in (same props) → Task 2 Global Constraints.

**Type consistency:** `FlowNode`/`FlowEdge`/`UmlNode`/`UmlEdge`/`flowToMermaid`/`umlToMermaid` (Task 1) consumed by Task 2's export wiring. `DiagramEditor` props unchanged (`onAddToChat`/`onInsertToDoc`/`onClose`/`docLabel`).

**Risk notes for reviewers:** (1) the nodes/edges → Mermaid mapping must produce VALID mermaid (safe ids, escaped labels) — the pure tests guard this. (2) React Flow's CSS import + dark theming must not leak/break the rest of the app (scope styles to the editor). (3) keep the Mermaid output contract so the planning agent still reads diagrams as text.
