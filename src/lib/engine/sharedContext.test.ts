/**
 * sharedContext.test.ts — TDD for the shared "always files" loader.
 *
 * This module exists because the two faces had DRIFTED: the desktop injected the
 * session journal, the Context Store, ADRs and the brownfield analysis, while the
 * CLI injected only `.cadre/context/*.md` — its `name.endsWith(".md")` filter
 * silently skipped the `decisions/` directory. CLI agents therefore never saw the
 * ADRs they were (on desktop) told to obey. One loader, both faces.
 */
import { describe, it, expect } from "vitest";
import {
  loadSharedContext,
  ADR_INJECT_BUDGET_BYTES,
  type SharedContextDeps,
} from "./sharedContext";
import { ADR_DECISIONS_DIR } from "./adr";
import { SESSION_LOG_PATH } from "./sessionLog";
import { BROWNFIELD_DOC_PATH } from "./brownfield";

/** Build deps over an in-memory filesystem: absolute path → contents. */
function fakeDeps(files: Record<string, string>): SharedContextDeps {
  return {
    readFile: async (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path];
    },
    listDir: async (path) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const names = new Set<string>();
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        names.add(JSON.stringify([head, tail.length > 0]));
      }
      if (names.size === 0) throw new Error(`ENOENT ${path}`);
      return [...names].map((s) => {
        const [name, isDir] = JSON.parse(s) as [string, boolean];
        return { name, path: `${prefix}${name}`, isDir };
      });
    },
  };
}

const ROOT = "/proj";

describe("loadSharedContext", () => {
  it("returns nothing for a project with no context at all", async () => {
    expect(await loadSharedContext(ROOT, fakeDeps({}))).toEqual([]);
  });

  it("injects the session journal so an agent sees what the fleet has done", async () => {
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({ [`${ROOT}/${SESSION_LOG_PATH}`]: "# Session\n- built thing" })
    );
    expect(files.map((f) => f.path)).toContain(SESSION_LOG_PATH);
  });

  it("injects Context Store markdown", async () => {
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({ [`${ROOT}/.cadre/context/auth-api.md`]: "POST /login" })
    );
    expect(files).toEqual([{ path: ".cadre/context/auth-api.md", content: "POST /login" }]);
  });

  it("injects ADRs from the decisions subdirectory — the drift that broke the CLI", async () => {
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({
        [`${ROOT}/${ADR_DECISIONS_DIR}/0001-use-postgres.md`]: "## Decision\nPostgres",
      })
    );
    expect(files.map((f) => f.path)).toContain(`${ADR_DECISIONS_DIR}/0001-use-postgres.md`);
  });

  it("orders ADRs newest first, so the most recent decision survives truncation", async () => {
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({
        [`${ROOT}/${ADR_DECISIONS_DIR}/0001-old.md`]: "old",
        [`${ROOT}/${ADR_DECISIONS_DIR}/0002-new.md`]: "new",
      })
    );
    const adrs = files.filter((f) => f.path.startsWith(ADR_DECISIONS_DIR));
    expect(adrs[0].path).toContain("0002-new");
  });

  it("bounds ADR bytes but always injects at least the newest one", async () => {
    const huge = "x".repeat(ADR_INJECT_BUDGET_BYTES + 100);
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({
        [`${ROOT}/${ADR_DECISIONS_DIR}/0001-old.md`]: huge,
        [`${ROOT}/${ADR_DECISIONS_DIR}/0002-new.md`]: huge,
      })
    );
    const adrs = files.filter((f) => f.path.startsWith(ADR_DECISIONS_DIR) && !f.path.endsWith("_index.md"));
    expect(adrs).toHaveLength(1);
    expect(adrs[0].path).toContain("0002-new");
  });

  it("says so explicitly when ADRs were omitted, rather than truncating silently", async () => {
    const huge = "x".repeat(ADR_INJECT_BUDGET_BYTES + 100);
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({
        [`${ROOT}/${ADR_DECISIONS_DIR}/0001-old.md`]: huge,
        [`${ROOT}/${ADR_DECISIONS_DIR}/0002-new.md`]: huge,
      })
    );
    const index = files.find((f) => f.path.endsWith("_index.md"));
    expect(index?.content).toMatch(/1 older ADR\(s\) were omitted/);
  });

  it("injects the brownfield analysis for work on existing code", async () => {
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({ [`${ROOT}/${BROWNFIELD_DOC_PATH}`]: "## Stack\nRails" })
    );
    expect(files.map((f) => f.path)).toContain(BROWNFIELD_DOC_PATH);
  });

  it("caps a large brownfield analysis and marks it truncated", async () => {
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({ [`${ROOT}/${BROWNFIELD_DOC_PATH}`]: "y".repeat(80_000) })
    );
    const bf = files.find((f) => f.path === BROWNFIELD_DOC_PATH)!;
    expect(bf.content.length).toBeLessThan(80_000);
    expect(bf.content).toMatch(/truncated/);
  });

  it("skips empty files rather than injecting blank noise into the prompt", async () => {
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({
        [`${ROOT}/${SESSION_LOG_PATH}`]: "   ",
        [`${ROOT}/.cadre/context/empty.md`]: "",
      })
    );
    expect(files).toEqual([]);
  });

  it("ignores non-markdown files in the Context Store", async () => {
    const files = await loadSharedContext(
      ROOT,
      fakeDeps({
        [`${ROOT}/.cadre/context/notes.txt`]: "ignore me",
        [`${ROOT}/.cadre/context/real.md`]: "keep me",
      })
    );
    expect(files.map((f) => f.path)).toEqual([".cadre/context/real.md"]);
  });
});
