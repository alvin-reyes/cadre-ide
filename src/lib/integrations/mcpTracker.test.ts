import { describe, it, expect } from "vitest";
import {
  taskKey, shouldSync, buildSyncPrompt, parseSyncResult,
  trackerToFile, trackerFromFile, emptyTrackerFile,
  recordEpicLink, epicTicket, aggregateEpicStatus, buildEpicSyncPrompt,
} from "./mcpTracker";

describe("mcpTracker core", () => {
  it("taskKey + shouldSync policy", () => {
    expect(taskKey({ epic: 1, story: 2 })).toBe("1.2");
    expect(shouldSync("Draft")).toBe(false);
    expect(shouldSync("Approved")).toBe(false);
    for (const s of ["InProgress","InReview","Done","Failed","Blocked"] as const)
      expect(shouldSync(s)).toBe(true);
  });

  it("buildSyncPrompt embeds story, status, verify, existing id, and demands strict JSON", () => {
    const p = buildSyncPrompt({
      story: { epic: 1, story: 2, title: "Add login", acceptanceCriteria: "user can log in" },
      status: "Done", verifyCmd: "npm test", existing: { taskId: "abc123" },
    });
    expect(p).toMatch(/1\.2|\[1\.2\]/);
    expect(p).toContain("Add login");
    expect(p).toContain("Done");
    expect(p).toContain("npm test");
    expect(p).toContain("abc123");            // update, not create
    expect(p).toMatch(/only.*json/i);          // strict-JSON demand
  });

  it("buildSyncPrompt without existing id instructs create", () => {
    const p = buildSyncPrompt({ story: { epic: 2, story: 1, title: "X" }, status: "InProgress" });
    expect(p).toMatch(/creat/i);
  });

  it("parseSyncResult extracts JSON from prose, throws on no id", () => {
    expect(parseSyncResult('done: {"taskId":"T-9","url":"https://x/T-9"}')).toEqual({ taskId: "T-9", url: "https://x/T-9" });
    expect(parseSyncResult('{"taskId":"T-1"}')).toEqual({ taskId: "T-1" });
    expect(() => parseSyncResult("no json here")).toThrow();
    expect(() => parseSyncResult('{"url":"x"}')).toThrow();   // missing taskId
  });

  it("parseSyncResult handles arbitrarily nested JSON objects (multi-level brace nesting)", () => {
    expect(parseSyncResult('{"taskId":"T-9","meta":{"a":{"b":1}}}')).toEqual({ taskId: "T-9" });
    // Nested object appearing before the real reply must not stop the scan
    // from finding the trailing (actual) result.
    expect(
      parseSyncResult('context: {"unrelated":{"nested":true}}\nresult: {"taskId":"T-10","url":"https://x/T-10"}'),
    ).toEqual({ taskId: "T-10", url: "https://x/T-10" });
  });

  it("tracker file round-trips; malformed → null; empty helper", () => {
    const f = emptyTrackerFile("clickup");
    expect(f).toEqual({ version: 1, connectionId: "clickup", tasks: {}, epics: {} });
    const withTask: typeof f = { ...f, tasks: { "1.2": { taskId: "T-9" } } };
    expect(trackerFromFile(trackerToFile(withTask))).toEqual(withTask);
    expect(trackerFromFile("{bad")).toBeNull();
    expect(trackerFromFile(JSON.stringify({ version: 9 }))).toBeNull();
  });

  it("recordEpicLink and epicTicket: round-trip stores and retrieves epic links", () => {
    const f = emptyTrackerFile("clickup");
    const withLink = recordEpicLink(f, 1, { ticketId: "E-1", url: "https://example.com/E-1" });
    expect(epicTicket(withLink, 1)).toEqual({ ticketId: "E-1", url: "https://example.com/E-1" });
    expect(epicTicket(withLink, 2)).toBeUndefined();
  });

  it("recordEpicLink is immutable and preserves existing tasks and epics", () => {
    const f = emptyTrackerFile("clickup");
    const withTask: typeof f = { ...f, tasks: { "1.1": { taskId: "T-1" } } };
    const withLink = recordEpicLink(withTask, 1, { ticketId: "E-1" });

    // Input should not be mutated
    expect(withTask.epics).toEqual({});

    // New file should preserve tasks and have the epic link
    expect(withLink.tasks).toEqual({ "1.1": { taskId: "T-1" } });
    expect(epicTicket(withLink, 1)).toEqual({ ticketId: "E-1" });
  });

  it("recordEpicLink preserves existing epic links", () => {
    const f = emptyTrackerFile("clickup");
    const withLink1 = recordEpicLink(f, 1, { ticketId: "E-1" });
    const withLink2 = recordEpicLink(withLink1, 2, { ticketId: "E-2", url: "https://example.com/E-2" });

    expect(epicTicket(withLink2, 1)).toEqual({ ticketId: "E-1" });
    expect(epicTicket(withLink2, 2)).toEqual({ ticketId: "E-2", url: "https://example.com/E-2" });
  });

  it("trackerFromFile normalizes missing epics key to {} for back-compat", () => {
    const oldFileJson = JSON.stringify({
      version: 1,
      connectionId: "clickup",
      tasks: { "1.1": { taskId: "T-1" } },
      // epics deliberately omitted
    });

    const parsed = trackerFromFile(oldFileJson);
    expect(parsed).not.toBeNull();
    expect(parsed!.epics).toEqual({});
    expect(parsed!.tasks).toEqual({ "1.1": { taskId: "T-1" } });
  });

  it("trackerToFile → trackerFromFile preserves epics", () => {
    const f = emptyTrackerFile("clickup");
    const withEpic = recordEpicLink(f, 1, { ticketId: "E-1", url: "https://example.com/E-1" });
    const withTask = { ...withEpic, tasks: { "1.1": { taskId: "T-1" } } };

    const json = trackerToFile(withTask);
    const roundTripped = trackerFromFile(json);

    expect(roundTripped).toEqual(withTask);
    expect(epicTicket(roundTripped!, 1)).toEqual({ ticketId: "E-1", url: "https://example.com/E-1" });
  });
});

describe("aggregateEpicStatus", () => {
  it("all Done → Done", () => expect(aggregateEpicStatus(["Done","Done"])).toBe("Done"));
  it("any Blocked/Failed (not all done) → Blocked", () => {
    expect(aggregateEpicStatus(["Done","Blocked"])).toBe("Blocked");
    expect(aggregateEpicStatus(["InProgress","Failed"])).toBe("Blocked");
  });
  it("any active (no blocked, not all done) → InProgress", () => {
    expect(aggregateEpicStatus(["Done","InProgress"])).toBe("InProgress");
    expect(aggregateEpicStatus(["InReview","Draft"])).toBe("InProgress");
  });
  it("all Draft/Approved or empty → null", () => {
    expect(aggregateEpicStatus(["Draft","Approved"])).toBeNull();
    expect(aggregateEpicStatus([])).toBeNull();
  });
  it("Blocked wins over active when not all done", () => {
    expect(aggregateEpicStatus(["InProgress","Blocked","Done"])).toBe("Blocked");
  });
});

describe("buildEpicSyncPrompt", () => {
  it("names the ticket, aggregate status, the changed story + progress, demands strict JSON", () => {
    const p = buildEpicSyncPrompt({ ticketId: "TCK-42", aggregateStatus: "Done",
      changedStory: "1.2", changedStatus: "Done", doneCount: 3, totalCount: 3, verifyCmd: "npm test" });
    expect(p).toContain("TCK-42");
    expect(p).toContain("Done");
    expect(p).toContain("1.2");
    expect(p).toMatch(/3\s*\/\s*3|3 of 3/);
    expect(p).toContain("npm test");
    expect(p).toMatch(/update/i);           // update the ticket, not create
    expect(p).toMatch(/only.*json/i);
  });
});
