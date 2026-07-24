import { describe, it, expect } from "vitest";
import {
  issueTitle,
  issueBody,
  statusIsClosed,
  transitionComment,
  syncStory,
  type GhRunner,
  type TrackerStory,
  type TrackerStatus,
  type SyncStoryInput,
} from "./githubTracker";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const story: TrackerStory = {
  epic: 1,
  story: 2,
  title: "Add login form",
  acceptanceCriteria: "User can log in with email and password.",
};

const storyNoAC: TrackerStory = {
  epic: 3,
  story: 7,
  title: "Export CSV",
};

/** Build a fake GhRunner that records every call and returns canned JSON for
 *  the FIRST call (create → {"number": 42}) and a generic OK for subsequent
 *  calls. Pass `exitCode` to simulate a failure on the first call. */
function makeRunner(opts?: {
  firstResponse?: string;
  failOnCall?: number; // 1-based
}): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    const callIndex = calls.length; // 1-based
    if (opts?.failOnCall !== undefined && callIndex === opts.failOnCall) {
      return { stdout: "", stderr: "API rate limit exceeded", exitCode: 1 };
    }
    const firstResponse = opts?.firstResponse ?? '{"number":42}';
    const stdout = calls.length === 1 ? firstResponse : "{}";
    return { stdout, stderr: "", exitCode: 0 };
  };
  return { gh, calls };
}

// ---------------------------------------------------------------------------
// issueTitle
// ---------------------------------------------------------------------------

describe("issueTitle", () => {
  it("formats [epic.story] title", () => {
    expect(issueTitle(story)).toBe("[1.2] Add login form");
  });

  it("uses correct numbers for other stories", () => {
    expect(issueTitle(storyNoAC)).toBe("[3.7] Export CSV");
  });
});

// ---------------------------------------------------------------------------
// issueBody
// ---------------------------------------------------------------------------

describe("issueBody", () => {
  it("includes acceptance criteria when present", () => {
    const body = issueBody(story);
    expect(body).toContain("User can log in with email and password.");
  });

  it("includes Tracked by Cadre footer", () => {
    const body = issueBody(story);
    expect(body).toContain("Tracked by Cadre");
  });

  it("still has footer when no acceptance criteria", () => {
    const body = issueBody(storyNoAC);
    expect(body).toContain("Tracked by Cadre");
    // Should not have an empty AC section that looks weird
    expect(body).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
// statusIsClosed
// ---------------------------------------------------------------------------

describe("statusIsClosed", () => {
  it("returns true only for Done", () => {
    expect(statusIsClosed("Done")).toBe(true);
  });

  const others: TrackerStatus[] = [
    "Draft",
    "Approved",
    "InProgress",
    "InReview",
    "Failed",
    "Blocked",
  ];
  for (const s of others) {
    it(`returns false for ${s}`, () => {
      expect(statusIsClosed(s)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// transitionComment
// ---------------------------------------------------------------------------

describe("transitionComment", () => {
  it("Done with a cmd → contains Verified and the command", () => {
    const comment = transitionComment("Done", "pnpm test");
    expect(comment).toContain("Verified");
    expect(comment).toContain("pnpm test");
  });

  it("Done without cmd → contains Verified", () => {
    const comment = transitionComment("Done");
    expect(comment).toContain("Verified");
  });

  it("InReview → contains InReview", () => {
    const comment = transitionComment("InReview");
    expect(comment).toContain("InReview");
  });

  it("Failed → contains Failed", () => {
    const comment = transitionComment("Failed");
    expect(comment).toContain("Failed");
  });

  it("Blocked → contains Blocked", () => {
    const comment = transitionComment("Blocked");
    expect(comment).toContain("Blocked");
  });

  it("Draft → contains Draft", () => {
    const comment = transitionComment("Draft");
    expect(comment).toContain("Draft");
  });
});

// ---------------------------------------------------------------------------
// syncStory — create (no issueNumber)
// ---------------------------------------------------------------------------

describe("syncStory — create", () => {
  it("calls gh api POST to create the issue and returns issueNumber 42", async () => {
    const { gh, calls } = makeRunner({ firstResponse: '{"number":42}' });
    const input: SyncStoryInput = {
      repo: "owner/repo",
      story,
      status: "InProgress",
    };
    const result = await syncStory(gh, input);
    expect(result.issueNumber).toBe(42);
    // First call must be a POST create — no -X flag (gh api defaults to POST on body)
    expect(calls[0]).toContain("api");
    expect(calls[0].some((a) => a.includes("repos/owner/repo/issues"))).toBe(true);
    expect(calls[0].some((a) => a.startsWith("title="))).toBe(true);
    // Should NOT close the issue for InProgress
    const patchCall = calls.find(
      (c) => c.includes("-X") && c[c.indexOf("-X") + 1] === "PATCH"
    );
    expect(patchCall).toBeUndefined();
  });

  it("passes -f title=… and -f body=… in the create call", async () => {
    const { gh, calls } = makeRunner({ firstResponse: '{"number":42}' });
    await syncStory(gh, { repo: "owner/repo", story, status: "Draft" });
    const createArgs = calls[0];
    // Check -f title=…
    const titleIdx = createArgs.indexOf("-f");
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    const titleArg = createArgs[titleIdx + 1];
    expect(titleArg).toMatch(/^title=/);
    expect(titleArg).toContain("[1.2] Add login form");
  });

  it("does NOT post a state PATCH when creating a non-Done issue", async () => {
    const { gh, calls } = makeRunner({ firstResponse: '{"number":42}' });
    await syncStory(gh, { repo: "owner/repo", story, status: "Approved" });
    // Only create + comment (if any). No PATCH.
    const hasPatch = calls.some(
      (c) => c.includes("-X") && c[c.indexOf("-X") + 1] === "PATCH"
    );
    expect(hasPatch).toBe(false);
  });

  it("on first sync with Done → create, then PATCH closed, then post verified comment", async () => {
    const { gh, calls } = makeRunner({ firstResponse: '{"number":42}' });
    await syncStory(gh, {
      repo: "owner/repo",
      story,
      status: "Done",
      verifyCmd: "pnpm test",
    });

    // Call 1: create
    expect(calls[0].some((a) => a.includes("repos/owner/repo/issues"))).toBe(true);
    const notPatch = !calls[0].includes("-X");
    expect(notPatch).toBe(true);

    // Call 2: PATCH state=closed
    const patchCall = calls.find(
      (c) => c.includes("-X") && c[c.indexOf("-X") + 1] === "PATCH"
    );
    expect(patchCall).toBeDefined();
    expect(patchCall!.some((a) => a === "state=closed")).toBe(true);

    // Call 3: post comment
    const commentCall = calls.find((c) =>
      c.some((a) => a.includes("/comments"))
    );
    expect(commentCall).toBeDefined();
    const bodyArg = commentCall!.find((a) => a.startsWith("body="));
    expect(bodyArg).toContain("Verified");
    expect(bodyArg).toContain("pnpm test");
  });
});

// ---------------------------------------------------------------------------
// syncStory — update (with issueNumber)
// ---------------------------------------------------------------------------

describe("syncStory — update", () => {
  it("PATCHes state=open for InReview and posts a transition comment", async () => {
    const { gh, calls } = makeRunner();
    const input: SyncStoryInput = {
      repo: "owner/repo",
      story,
      status: "InReview",
      issueNumber: 42,
    };
    const result = await syncStory(gh, input);
    expect(result.issueNumber).toBe(42);

    // No create call
    const createCall = calls.find(
      (c) =>
        c.some((a) => a.includes("repos/owner/repo/issues")) &&
        !c.includes("-X") &&
        !c.some((a) => a.includes("/comments"))
    );
    expect(createCall).toBeUndefined();

    // PATCH call with state=open
    const patchCall = calls.find(
      (c) => c.includes("-X") && c[c.indexOf("-X") + 1] === "PATCH"
    );
    expect(patchCall).toBeDefined();
    expect(patchCall!.some((a) => a === "state=open")).toBe(true);
    expect(patchCall!.some((a) => a.includes("repos/owner/repo/issues/42"))).toBe(true);

    // Comment call
    const commentCall = calls.find((c) =>
      c.some((a) => a.includes("/comments"))
    );
    expect(commentCall).toBeDefined();
    const bodyArg = commentCall!.find((a) => a.startsWith("body="));
    expect(bodyArg).toContain("InReview");
  });

  it("PATCHes state=closed and posts verified comment for Done", async () => {
    const { gh, calls } = makeRunner();
    await syncStory(gh, {
      repo: "owner/repo",
      story,
      status: "Done",
      issueNumber: 42,
      verifyCmd: "cargo test",
    });

    const patchCall = calls.find(
      (c) => c.includes("-X") && c[c.indexOf("-X") + 1] === "PATCH"
    );
    expect(patchCall).toBeDefined();
    expect(patchCall!.some((a) => a === "state=closed")).toBe(true);

    const commentCall = calls.find((c) =>
      c.some((a) => a.includes("/comments"))
    );
    expect(commentCall).toBeDefined();
    const bodyArg = commentCall!.find((a) => a.startsWith("body="));
    expect(bodyArg).toContain("Verified");
    expect(bodyArg).toContain("cargo test");
  });

  it("does NOT call create when issueNumber is provided", async () => {
    const { gh, calls } = makeRunner();
    await syncStory(gh, {
      repo: "owner/repo",
      story,
      status: "Blocked",
      issueNumber: 99,
    });
    // There should be no call whose URL is repos/…/issues without a number suffix and without /comments
    const bareCreateCall = calls.find(
      (c) =>
        c.some((a) => /repos\/.+\/issues$/.test(a)) &&
        !c.some((a) => a.includes("/comments"))
    );
    expect(bareCreateCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// syncStory — error handling
// ---------------------------------------------------------------------------

describe("syncStory — errors", () => {
  it("throws when the first gh call returns exitCode !== 0", async () => {
    const { gh } = makeRunner({ failOnCall: 1 });
    await expect(
      syncStory(gh, { repo: "owner/repo", story, status: "InProgress" })
    ).rejects.toThrow("API rate limit exceeded");
  });

  it("throws when the PATCH call fails (update path)", async () => {
    const { gh } = makeRunner({ failOnCall: 1 });
    await expect(
      syncStory(gh, {
        repo: "owner/repo",
        story,
        status: "InReview",
        issueNumber: 42,
      })
    ).rejects.toThrow("API rate limit exceeded");
  });

  it("throws when the comment call fails", async () => {
    // 2nd call fails: for update path that's the comment call
    const { gh } = makeRunner({ failOnCall: 2 });
    await expect(
      syncStory(gh, {
        repo: "owner/repo",
        story,
        status: "InReview",
        issueNumber: 42,
      })
    ).rejects.toThrow("API rate limit exceeded");
  });
});
