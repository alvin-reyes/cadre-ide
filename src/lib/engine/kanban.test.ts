import { describe, it, expect } from "vitest";
import { statusColumn, isAttention, rollupCounts, groupIntoLanes, selectRunningAgents, storyRole, KANBAN_COLUMNS, type KanbanColumn } from "./kanban";
import type { Status } from "./status";
import type { StoryCard } from "./board";

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

// ── rollupCounts ──────────────────────────────────────────────────────────────

describe("rollupCounts", () => {
  it("returns all zeros for an empty array", () => {
    expect(rollupCounts([])).toEqual({ backlog: 0, inProgress: 0, qa: 0, completed: 0 });
  });

  it("counts a single Done card as completed", () => {
    expect(rollupCounts([{ status: "Done" }])).toEqual({ backlog: 0, inProgress: 0, qa: 0, completed: 1 });
  });

  it("counts InProgress correctly", () => {
    expect(rollupCounts([{ status: "InProgress" }])).toEqual({ backlog: 0, inProgress: 1, qa: 0, completed: 0 });
  });

  it("counts InReview as qa", () => {
    expect(rollupCounts([{ status: "InReview" }])).toEqual({ backlog: 0, inProgress: 0, qa: 1, completed: 0 });
  });

  it("counts Draft/Approved/Failed/Blocked as backlog", () => {
    const cards = (["Draft", "Approved", "Failed", "Blocked"] as Status[]).map((s) => ({ status: s }));
    expect(rollupCounts(cards)).toEqual({ backlog: 4, inProgress: 0, qa: 0, completed: 0 });
  });

  it("counts mixed statuses correctly", () => {
    const cards = [
      { status: "Done" as Status },
      { status: "Done" as Status },
      { status: "InProgress" as Status },
      { status: "InReview" as Status },
      { status: "Draft" as Status },
      { status: "Approved" as Status },
      { status: "Failed" as Status },
    ];
    expect(rollupCounts(cards)).toEqual({ backlog: 3, inProgress: 1, qa: 1, completed: 2 });
  });
});

// ── groupIntoLanes ────────────────────────────────────────────────────────────

describe("groupIntoLanes", () => {
  const epics = [{ number: 1 }, { number: 2 }, { number: 3 }];

  it("returns empty buckets and no otherCards when cards is empty", () => {
    const { epicBuckets, otherCards } = groupIntoLanes([], epics);
    expect(otherCards).toEqual([]);
    expect(epicBuckets.get(1)).toEqual([]);
    expect(epicBuckets.get(2)).toEqual([]);
    expect(epicBuckets.get(3)).toEqual([]);
  });

  it("places a card with a matching epic into the correct bucket", () => {
    const cards = [{ id: "1.1", epic: 1, story: 1 }];
    const { epicBuckets, otherCards } = groupIntoLanes(cards, epics);
    expect(epicBuckets.get(1)).toEqual([{ id: "1.1", epic: 1, story: 1 }]);
    expect(epicBuckets.get(2)).toEqual([]);
    expect(otherCards).toEqual([]);
  });

  it("places cards with unmatched epic into otherCards", () => {
    const cards = [{ id: "9.1", epic: 9, story: 1 }];
    const { epicBuckets, otherCards } = groupIntoLanes(cards, epics);
    expect(otherCards).toEqual([{ id: "9.1", epic: 9, story: 1 }]);
    expect(epicBuckets.get(1)).toEqual([]);
  });

  it("splits correctly when some cards match and some do not", () => {
    const cards = [
      { id: "1.1", epic: 1, story: 1 },
      { id: "2.1", epic: 2, story: 1 },
      { id: "9.1", epic: 9, story: 1 },
      { id: "8.1", epic: 8, story: 1 },
    ];
    const { epicBuckets, otherCards } = groupIntoLanes(cards, epics);
    expect(epicBuckets.get(1)).toHaveLength(1);
    expect(epicBuckets.get(2)).toHaveLength(1);
    expect(epicBuckets.get(3)).toHaveLength(0);
    expect(otherCards).toHaveLength(2);
    // No card is dropped or duplicated
    const allCards = [...epicBuckets.get(1)!, ...epicBuckets.get(2)!, ...epicBuckets.get(3)!, ...otherCards];
    expect(allCards).toHaveLength(4);
    expect(allCards.map((c) => c.id).sort()).toEqual(["1.1", "2.1", "8.1", "9.1"]);
  });

  it("handles no epics — all cards go to otherCards", () => {
    const cards = [{ id: "1.1", epic: 1, story: 1 }, { id: "2.1", epic: 2, story: 1 }];
    const { epicBuckets, otherCards } = groupIntoLanes(cards, []);
    expect(epicBuckets.size).toBe(0);
    expect(otherCards).toHaveLength(2);
  });

  it("does not duplicate cards when multiple cards share an epic", () => {
    const cards = [
      { id: "1.1", epic: 1, story: 1 },
      { id: "1.2", epic: 1, story: 2 },
      { id: "1.3", epic: 1, story: 3 },
    ];
    const { epicBuckets, otherCards } = groupIntoLanes(cards, epics);
    expect(epicBuckets.get(1)).toHaveLength(3);
    expect(otherCards).toHaveLength(0);
    // Total count intact
    const total = [...epicBuckets.values()].reduce((s, a) => s + a.length, 0) + otherCards.length;
    expect(total).toBe(3);
  });
});

// ── selectRunningAgents ───────────────────────────────────────────────────────

function makeCard(id: string, status: Status): StoryCard {
  const [epic, story] = id.split(".").map(Number);
  return { id, epic, story, status };
}

describe("selectRunningAgents", () => {
  it("returns empty array when stories is empty", () => {
    expect(selectRunningAgents([], {})).toEqual([]);
  });

  it("includes InProgress stories", () => {
    const cards = [makeCard("1.1", "InProgress")];
    expect(selectRunningAgents(cards, {})).toHaveLength(1);
  });

  it("includes InReview stories", () => {
    const cards = [makeCard("1.2", "InReview")];
    expect(selectRunningAgents(cards, {})).toHaveLength(1);
  });

  it("includes Approved story when active[id] is true (dispatch in-flight)", () => {
    const cards = [makeCard("1.3", "Approved")];
    expect(selectRunningAgents(cards, { "1.3": true })).toHaveLength(1);
  });

  it("excludes Approved story when active[id] is not set", () => {
    const cards = [makeCard("1.4", "Approved")];
    expect(selectRunningAgents(cards, {})).toHaveLength(0);
  });

  it("excludes Draft story when not active", () => {
    const cards = [makeCard("1.5", "Draft")];
    expect(selectRunningAgents(cards, {})).toHaveLength(0);
  });

  it("excludes Done story when not active", () => {
    const cards = [makeCard("1.6", "Done")];
    expect(selectRunningAgents(cards, {})).toHaveLength(0);
  });

  it("returns only running/active stories from a mixed set", () => {
    const cards = [
      makeCard("1.1", "InProgress"),
      makeCard("1.2", "InReview"),
      makeCard("1.3", "Approved"),   // active → included
      makeCard("1.4", "Approved"),   // not active → excluded
      makeCard("1.5", "Draft"),
      makeCard("1.6", "Done"),
      makeCard("1.7", "Failed"),
    ];
    const result = selectRunningAgents(cards, { "1.3": true });
    expect(result.map((c) => c.id).sort()).toEqual(["1.1", "1.2", "1.3"]);
  });
});

describe("storyRole", () => {
  it("maps the [phase] tag to a fleet role", () => {
    expect(storyRole("[ops] Deploy runbook").label).toBe("DevOps");
    expect(storyRole("[devops] CI/CD pipeline").label).toBe("DevOps");
    expect(storyRole("[deployment] Blue-green rollout").label).toBe("DevOps");
    expect(storyRole("[documentation] API reference").label).toBe("Docs");
    expect(storyRole("[docs] README").label).toBe("Docs");
    expect(storyRole("[testing] E2E suite").label).toBe("QA");
    expect(storyRole("[qa] Acceptance tests").label).toBe("QA");
    expect(storyRole("[backend] Task CRUD").label).toBe("Dev");
    expect(storyRole("[frontend] Task list UI").label).toBe("Dev");
  });
  it("defaults to Dev when there is no phase tag", () => {
    expect(storyRole("Add task feature").label).toBe("Dev");
    expect(storyRole("").label).toBe("Dev");
  });
});
