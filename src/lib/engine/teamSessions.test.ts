import { describe, it, expect } from "vitest";
import {
  parseAgentSessions,
  serializeAgentSessions,
  decideAgentSession,
  resolveAgentSession,
  TEAM_SESSIONS_PATH,
} from "./teamSessions";

// ---------------------------------------------------------------------------
// parseAgentSessions — tolerant parse
// ---------------------------------------------------------------------------
describe("parseAgentSessions", () => {
  it("parses a valid map", () => {
    const json = JSON.stringify({
      "agent-0": { sessionId: "sess-1", taskCount: 3 },
    });
    expect(parseAgentSessions(json)).toEqual({
      "agent-0": { sessionId: "sess-1", taskCount: 3 },
    });
  });

  it("returns {} for missing / empty input", () => {
    expect(parseAgentSessions("")).toEqual({});
  });

  it("returns {} for corrupt JSON", () => {
    expect(parseAgentSessions("not json {{")).toEqual({});
  });

  it("returns {} when JSON is not an object (array)", () => {
    expect(parseAgentSessions("[1,2,3]")).toEqual({});
  });

  it("returns {} when JSON is not an object (string)", () => {
    expect(parseAgentSessions('"hello"')).toEqual({});
  });

  it("returns {} for null", () => {
    expect(parseAgentSessions("null")).toEqual({});
  });

  it("drops entries with missing sessionId", () => {
    const json = JSON.stringify({
      "agent-0": { sessionId: "sess-1", taskCount: 2 },
      "agent-1": { taskCount: 2 }, // missing sessionId
    });
    expect(parseAgentSessions(json)).toEqual({
      "agent-0": { sessionId: "sess-1", taskCount: 2 },
    });
  });

  it("drops entries with non-string sessionId", () => {
    const json = JSON.stringify({
      "agent-0": { sessionId: 42, taskCount: 2 },
      "agent-1": { sessionId: "good", taskCount: 1 },
    });
    expect(parseAgentSessions(json)).toEqual({
      "agent-1": { sessionId: "good", taskCount: 1 },
    });
  });

  it("drops entries with non-number taskCount", () => {
    const json = JSON.stringify({
      "agent-0": { sessionId: "sess-1", taskCount: "two" },
      "agent-1": { sessionId: "sess-2", taskCount: 3 },
    });
    expect(parseAgentSessions(json)).toEqual({
      "agent-1": { sessionId: "sess-2", taskCount: 3 },
    });
  });

  it("drops entries where the value is not an object", () => {
    const json = JSON.stringify({
      "agent-0": "not-an-object",
      "agent-1": { sessionId: "sess-2", taskCount: 1 },
    });
    expect(parseAgentSessions(json)).toEqual({
      "agent-1": { sessionId: "sess-2", taskCount: 1 },
    });
  });
});

// ---------------------------------------------------------------------------
// serializeAgentSessions — pretty JSON + trailing newline, round-trips
// ---------------------------------------------------------------------------
describe("serializeAgentSessions", () => {
  it("round-trips through parseAgentSessions", () => {
    const map = {
      "agent-0": { sessionId: "sess-1", taskCount: 2 },
      "agent-1": { sessionId: "sess-2", taskCount: 5 },
    };
    expect(parseAgentSessions(serializeAgentSessions(map))).toEqual(map);
  });

  it("produces pretty JSON with trailing newline", () => {
    const map = { "agent-0": { sessionId: "s", taskCount: 1 } };
    const out = serializeAgentSessions(map);
    expect(out.endsWith("\n")).toBe(true);
    // pretty-printed: contains newlines inside (not single-line)
    expect(out.split("\n").length).toBeGreaterThan(2);
  });

  it("handles an empty map", () => {
    expect(serializeAgentSessions({})).toBe("{}\n");
  });
});

// ---------------------------------------------------------------------------
// decideAgentSession — the pure decision function
// ---------------------------------------------------------------------------
describe("decideAgentSession", () => {
  // (a) undefined entry → fresh, taskCount === 1, resume false
  it("(a) undefined entry → fresh session, taskCount 1, resume false", () => {
    const result = decideAgentSession(undefined, 5, "new-sess");
    expect(result).toEqual({
      sessionId: "new-sess",
      resume: false,
      next: { sessionId: "new-sess", taskCount: 1 },
    });
  });

  // (b) entry exists AND taskCount < K → resume, sessionId preserved, taskCount incremented
  it("(b) taskCount < K → resume, same sessionId, taskCount incremented", () => {
    const entry = { sessionId: "existing-sess", taskCount: 3 };
    const result = decideAgentSession(entry, 5, "new-sess");
    expect(result).toEqual({
      sessionId: "existing-sess",
      resume: true,
      next: { sessionId: "existing-sess", taskCount: 4 },
    });
  });

  it("(b) taskCount 1 < K 5 → resume", () => {
    const entry = { sessionId: "sess-a", taskCount: 1 };
    const result = decideAgentSession(entry, 5, "fresh");
    expect(result.resume).toBe(true);
    expect(result.sessionId).toBe("sess-a");
    expect(result.next.taskCount).toBe(2);
  });

  // (c) entry exists AND taskCount === K → fresh (new id), taskCount === 1
  it("(c) taskCount === K → fresh session, new id, taskCount 1, resume false", () => {
    const entry = { sessionId: "old-sess", taskCount: 5 };
    const result = decideAgentSession(entry, 5, "brand-new");
    expect(result).toEqual({
      sessionId: "brand-new",
      resume: false,
      next: { sessionId: "brand-new", taskCount: 1 },
    });
  });

  // (d) taskCount > K — also resets (defensive)
  it("(d) taskCount > K → fresh session, reset to count 1", () => {
    const entry = { sessionId: "old-sess", taskCount: 7 };
    const result = decideAgentSession(entry, 5, "newer");
    expect(result.resume).toBe(false);
    expect(result.sessionId).toBe("newer");
    expect(result.next.taskCount).toBe(1);
  });

  // resetK boundary: K=1 means every task after the first gets a fresh session
  it("(d) resetK=1, taskCount=1 → always reset", () => {
    const entry = { sessionId: "sess-x", taskCount: 1 };
    const result = decideAgentSession(entry, 1, "fresh-id");
    expect(result.resume).toBe(false);
    expect(result.sessionId).toBe("fresh-id");
    expect(result.next.taskCount).toBe(1);
  });

  it("(d) resetK=1, undefined entry → fresh (taskCount 1)", () => {
    const result = decideAgentSession(undefined, 1, "only-id");
    expect(result.resume).toBe(false);
    expect(result.sessionId).toBe("only-id");
    expect(result.next.taskCount).toBe(1);
  });

  it("(b) taskCount=K-1 → resume (not reset)", () => {
    const entry = { sessionId: "sess-b", taskCount: 4 };
    const result = decideAgentSession(entry, 5, "new-id");
    expect(result.resume).toBe(true);
    expect(result.sessionId).toBe("sess-b");
    expect(result.next.taskCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// resolveAgentSession — read+parse, decide, write back, return
// ---------------------------------------------------------------------------
describe("resolveAgentSession", () => {
  /** In-memory file store + injected deps. */
  function memDeps(initial: Record<string, string> = {}) {
    const files: Record<string, string> = { ...initial };
    return {
      files,
      deps: {
        readFile: async (p: string): Promise<string> => {
          if (p in files) return files[p];
          throw new Error("ENOENT");
        },
        writeFile: async (p: string, c: string): Promise<void> => {
          files[p] = c;
        },
      },
    };
  }

  /** Deterministic id generator: "sess-1", "sess-2", … */
  function makeCounter() {
    let n = 0;
    return () => `sess-${++n}`;
  }

  it("first call for agent-0 mints + persists (resume false, taskCount 1)", async () => {
    const { files, deps } = memDeps();
    const genId = makeCounter();
    const result = await resolveAgentSession(deps, "/proj", "agent-0", 5, genId);

    expect(result).toEqual({ sessionId: "sess-1", resume: false });

    // Persisted to the correct path
    const stored = parseAgentSessions(files[`/proj/${TEAM_SESSIONS_PATH}`]);
    expect(stored["agent-0"]).toEqual({ sessionId: "sess-1", taskCount: 1 });
  });

  it("second call resumes (resume true, taskCount 2)", async () => {
    const { files, deps } = memDeps();
    const genId = makeCounter();

    // First call
    await resolveAgentSession(deps, "/proj", "agent-0", 5, genId);

    // Second call — should resume
    const result = await resolveAgentSession(deps, "/proj", "agent-0", 5, genId);
    expect(result).toEqual({ sessionId: "sess-1", resume: true });

    const stored = parseAgentSessions(files[`/proj/${TEAM_SESSIONS_PATH}`]);
    expect(stored["agent-0"]).toEqual({ sessionId: "sess-1", taskCount: 2 });
  });

  it("call at taskCount===K resets to a new id (resume false, taskCount 1)", async () => {
    const { files, deps } = memDeps();
    const genId = makeCounter();
    const K = 3;

    // Drive to taskCount = K
    for (let i = 0; i < K; i++) {
      await resolveAgentSession(deps, "/proj", "agent-0", K, genId);
    }

    // At this point taskCount === K. The next call should reset.
    const result = await resolveAgentSession(deps, "/proj", "agent-0", K, genId);
    expect(result.resume).toBe(false);
    // genId was called K times already (sess-1 through sess-K), so new id is sess-(K+1)
    expect(result.sessionId).toBe(`sess-${K + 1}`);

    const stored = parseAgentSessions(files[`/proj/${TEAM_SESSIONS_PATH}`]);
    expect(stored["agent-0"]).toEqual({
      sessionId: `sess-${K + 1}`,
      taskCount: 1,
    });
  });

  it("keeps distinct sessions for different agents", async () => {
    const { files, deps } = memDeps();
    const genId = makeCounter();

    await resolveAgentSession(deps, "/proj", "agent-0", 5, genId);
    await resolveAgentSession(deps, "/proj", "agent-1", 5, genId);

    const stored = parseAgentSessions(files[`/proj/${TEAM_SESSIONS_PATH}`]);
    expect(stored["agent-0"].sessionId).toBe("sess-1");
    expect(stored["agent-1"].sessionId).toBe("sess-2");
  });

  it("tolerates a missing/corrupt file (starts fresh)", async () => {
    const { deps } = memDeps(); // no pre-seeded file → readFile throws
    const genId = makeCounter();
    const result = await resolveAgentSession(deps, "/proj", "agent-0", 5, genId);
    expect(result).toEqual({ sessionId: "sess-1", resume: false });
  });

  it("uses the correct TEAM_SESSIONS_PATH under root", async () => {
    const { files, deps } = memDeps();
    const genId = makeCounter();
    await resolveAgentSession(deps, "/my/root", "agent-0", 5, genId);
    expect(`/my/root/${TEAM_SESSIONS_PATH}` in files).toBe(true);
  });
});
