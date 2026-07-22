import { describe, it, expect } from "vitest";
import {
  documentProject,
  composeDocumentPrompt,
  BROWNFIELD_DOC_PATH,
  type DocumentProjectDeps,
} from "./brownfield";

function makeDeps(cfg: { fileAfter?: (pass: number) => string }): {
  deps: DocumentProjectDeps;
  spawns: { args: string[]; cwd: string }[];
} {
  const spawns: { args: string[]; cwd: string }[] = [];
  let pass = 0;
  let current = "";
  const deps: DocumentProjectDeps = {
    spawnAgent: async (opts) => {
      spawns.push({ args: opts.args, cwd: opts.cwd });
      pass++;
      current = cfg.fileAfter ? cfg.fileAfter(pass) : `analysis after pass ${pass}`;
      return spawns.length;
    },
    waitForExit: async () => ({ exitCode: 0 }),
    readFile: async () => current,
  };
  return { deps, spawns };
}

describe("brownfield: document-project runs as agent loops, twice", () => {
  it("runs two passes by default, dispatching a claude -p analyst in the repo root", async () => {
    const { deps, spawns } = makeDeps({});
    const res = await documentProject(deps, { root: "/proj" });

    expect(res.passes).toBe(2);
    expect(spawns).toHaveLength(2);
    for (const s of spawns) {
      expect(s.args[0]).toBe("-p");
      expect(s.cwd).toBe("/proj");
    }
    expect(res.path).toBe(BROWNFIELD_DOC_PATH);
  });

  it("the first pass documents; the second reviews and hardens the prior draft", () => {
    const p1 = composeDocumentPrompt({ outPath: BROWNFIELD_DOC_PATH, pass: 1, passes: 2, prior: "" });
    expect(p1).toMatch(/read the whole repository/i);
    expect(p1).toContain(BROWNFIELD_DOC_PATH);

    const p2 = composeDocumentPrompt({
      outPath: BROWNFIELD_DOC_PATH,
      pass: 2,
      passes: 2,
      prior: "DRAFT-ONE-CONTENT",
    });
    expect(p2).toMatch(/adversarial/i);
    expect(p2).toContain("DRAFT-ONE-CONTENT"); // the second pass sees the first draft
    expect(p2).toMatch(/rewrite the FULL analysis/i);
  });

  it("honors a custom pass count", async () => {
    const { deps, spawns } = makeDeps({});
    const res = await documentProject(deps, { root: "/p", passes: 3 });
    expect(res.passes).toBe(3);
    expect(spawns).toHaveLength(3);
  });

  it("returns the final analysis content", async () => {
    const { deps } = makeDeps({ fileAfter: (p) => `pass-${p}-doc` });
    const res = await documentProject(deps, { root: "/p" });
    expect(res.content).toBe("pass-2-doc");
  });
});
