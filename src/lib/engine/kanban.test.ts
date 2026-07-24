import { describe, it, expect } from "vitest";
import { statusColumn, isAttention, KANBAN_COLUMNS, type KanbanColumn } from "./kanban";
import type { Status } from "./status";

// All statuses must be covered: Draft | Approved | InProgress | InReview | Done | Failed | Blocked
const ALL_STATUSES: Status[] = ["Draft", "Approved", "InProgress", "InReview", "Done", "Failed", "Blocked"];

describe("KANBAN_COLUMNS", () => {
  it("has exactly 4 columns in order", () => {
    expect(KANBAN_COLUMNS.map((c) => c.id)).toEqual([
      "backlog",
      "inProgress",
      "qa",
      "completed",
    ]);
  });

  it("has human-readable labels", () => {
    expect(KANBAN_COLUMNS.map((c) => c.label)).toEqual([
      "Backlog",
      "In Progress",
      "QA",
      "Completed",
    ]);
  });
});

describe("statusColumn — Backlog", () => {
  it("maps Draft → backlog", () => {
    expect(statusColumn("Draft")).toBe<KanbanColumn>("backlog");
  });

  it("maps Approved → backlog", () => {
    expect(statusColumn("Approved")).toBe<KanbanColumn>("backlog");
  });

  it("maps Failed → backlog (re-dispatchable)", () => {
    expect(statusColumn("Failed")).toBe<KanbanColumn>("backlog");
  });

  it("maps Blocked → backlog (re-dispatchable)", () => {
    expect(statusColumn("Blocked")).toBe<KanbanColumn>("backlog");
  });
});

describe("statusColumn — In Progress", () => {
  it("maps InProgress → inProgress", () => {
    expect(statusColumn("InProgress")).toBe<KanbanColumn>("inProgress");
  });
});

describe("statusColumn — QA", () => {
  it("maps InReview → qa", () => {
    expect(statusColumn("InReview")).toBe<KanbanColumn>("qa");
  });
});

describe("statusColumn — Completed", () => {
  it("maps Done → completed", () => {
    expect(statusColumn("Done")).toBe<KanbanColumn>("completed");
  });
});

describe("statusColumn — exhaustive coverage", () => {
  it("covers every Status value", () => {
    const expected: Record<Status, KanbanColumn> = {
      Draft: "backlog",
      Approved: "backlog",
      Failed: "backlog",
      Blocked: "backlog",
      InProgress: "inProgress",
      InReview: "qa",
      Done: "completed",
    };
    for (const status of ALL_STATUSES) {
      expect(statusColumn(status), `statusColumn("${status}")`).toBe(expected[status]);
    }
  });
});

describe("isAttention", () => {
  it("returns true for Failed", () => {
    expect(isAttention("Failed")).toBe(true);
  });

  it("returns true for Blocked", () => {
    expect(isAttention("Blocked")).toBe(true);
  });

  it("returns false for Draft", () => {
    expect(isAttention("Draft")).toBe(false);
  });

  it("returns false for Approved", () => {
    expect(isAttention("Approved")).toBe(false);
  });

  it("returns false for InProgress", () => {
    expect(isAttention("InProgress")).toBe(false);
  });

  it("returns false for InReview", () => {
    expect(isAttention("InReview")).toBe(false);
  });

  it("returns false for Done", () => {
    expect(isAttention("Done")).toBe(false);
  });

  it("covers every Status — only Failed and Blocked are attention", () => {
    const attentionStatuses = ALL_STATUSES.filter((s) => isAttention(s));
    expect(attentionStatuses.sort()).toEqual(["Blocked", "Failed"]);
  });
});
