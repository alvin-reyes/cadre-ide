import { describe, it, expect } from "vitest";
import {
  parseSessionMap,
  serializeSessionMap,
  resolveStorySession,
  AGENT_SESSIONS_PATH,
} from "./agentSessions";

describe("session map parsing", () => {
  it("parses a valid map", () => {
    expect(parseSessionMap('{"1.2":"abc"}')).toEqual({ "1.2": "abc" });
  });
  it("returns {} for junk / arrays / non-string values", () => {
    expect(parseSessionMap("not json")).toEqual({});
    expect(parseSessionMap("[1,2]")).toEqual({});
    expect(parseSessionMap('{"1.2":5,"1.3":"ok"}')).toEqual({ "1.3": "ok" });
  });
  it("round-trips through serialize", () => {
    const m = { "1.1": "x", "2.3": "y" };
    expect(parseSessionMap(serializeSessionMap(m))).toEqual(m);
  });
});

describe("resolveStorySession", () => {
  function memDeps(initial: Record<string, string> = {}) {
    const files = { ...initial };
    return {
      files,
      deps: {
        readFile: async (p: string) => {
          if (p in files) return files[p];
          throw new Error("ENOENT");
        },
        writeFile: async (p: string, c: string) => {
          files[p] = c;
        },
      },
    };
  }

  it("mints and persists a fresh session on first dispatch", async () => {
    const { files, deps } = memDeps();
    const res = await resolveStorySession(deps, "/proj", "1.2", () => "new-id");
    expect(res).toEqual({ sessionId: "new-id", resume: false });
    expect(files[`/proj/${AGENT_SESSIONS_PATH}`]).toContain("new-id");
  });

  it("resumes the recorded session on a later dispatch", async () => {
    const path = `/proj/${AGENT_SESSIONS_PATH}`;
    const { deps } = memDeps({ [path]: '{"1.2":"existing-id"}' });
    let called = false;
    const res = await resolveStorySession(deps, "/proj", "1.2", () => {
      called = true;
      return "should-not-be-used";
    });
    expect(res).toEqual({ sessionId: "existing-id", resume: true });
    expect(called).toBe(false);
  });

  it("keeps distinct ids per story", async () => {
    const { files, deps } = memDeps();
    let n = 0;
    await resolveStorySession(deps, "/proj", "1.1", () => `id-${++n}`);
    await resolveStorySession(deps, "/proj", "1.2", () => `id-${++n}`);
    const map = JSON.parse(files[`/proj/${AGENT_SESSIONS_PATH}`]);
    expect(map["1.1"]).toBe("id-1");
    expect(map["1.2"]).toBe("id-2");
  });
});
