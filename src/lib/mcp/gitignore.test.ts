import { describe, it, expect } from "vitest";
import { mergeGitignore } from "./gitignore";

describe("mergeGitignore", () => {
  it("appends missing lines, exact-line match (no substring false-positive)", () => {
    const r = mergeGitignore("node_modules\n.cadre/mcp.json.bak\n", [".cadre/mcp.json", ".cadre/fleet.mcp.json"]);
    expect(r.changed).toBe(true);
    expect(r.content).toContain("\n.cadre/mcp.json\n");
    expect(r.content).toContain(".cadre/fleet.mcp.json");
    // .bak line must NOT have suppressed the exact .cadre/mcp.json line:
    expect(r.content.split("\n").filter((l) => l.trim() === ".cadre/mcp.json").length).toBe(1);
  });
  it("no-op when all present → changed:false, content unchanged", () => {
    const src = "a\n.cadre/mcp.json\n";
    const r = mergeGitignore(src, [".cadre/mcp.json"]);
    expect(r.changed).toBe(false);
    expect(r.content).toBe(src);
  });
  it("tolerates empty content and preserves a single trailing newline", () => {
    const r = mergeGitignore("", [".cadre/mcp.json"]);
    expect(r.changed).toBe(true);
    expect(r.content.endsWith("\n")).toBe(true);
    expect(r.content).toContain(".cadre/mcp.json");
  });
});
