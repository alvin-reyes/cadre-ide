import { describe, it, expect } from "vitest";
import {
  taskBranch, makeStagedTask, removeStaged, makeBatch, taskWorktreePath,
  setSubagentStatus, removeSubagent, removeBatch, moveSubagent,
} from "./tasks";

describe("staging + batch", () => {
  it("taskBranch namespaces under task/", () => {
    expect(taskBranch("a1b2")).toBe("task/a1b2");
  });
  it("taskWorktreePath is deterministic under .cadre/worktrees", () => {
    expect(taskWorktreePath("/repo", "a1")).toBe("/repo/.cadre/worktrees/task-a1");
  });
  it("makeStagedTask holds the prompt", () => {
    expect(makeStagedTask("a1", "bump deps", 1000)).toEqual({ id: "a1", prompt: "bump deps", createdAt: 1000 });
  });
  it("removeStaged drops one immutably", () => {
    const list = [makeStagedTask("a", "x", 1), makeStagedTask("b", "y", 2)];
    const next = removeStaged(list, "a");
    expect(next.map((t) => t.id)).toEqual(["b"]);
    expect(next).not.toBe(list);
  });
  it("makeBatch turns staged tasks into preparing subagents with worktree paths", () => {
    const batch = makeBatch("btch", [makeStagedTask("a", "x", 1)], 5000, "/repo");
    expect(batch).toEqual({
      id: "btch", createdAt: 5000,
      subagents: [{ taskId: "a", prompt: "x", branch: "task/a", worktree: "/repo/.cadre/worktrees/task-a", status: "preparing" }],
    });
  });
  it("setSubagentStatus updates only the matching subagent (preparing → running)", () => {
    const b = makeBatch("btch", [makeStagedTask("a", "x", 1), makeStagedTask("b", "y", 2)], 1, "/r");
    const next = setSubagentStatus([b], "btch", "a", "running");
    expect(next[0].subagents.find((s) => s.taskId === "a")!.status).toBe("running");
    expect(next[0].subagents.find((s) => s.taskId === "b")!.status).toBe("preparing");
  });
  it("removeSubagent drops one subagent immutably, keeping the batch", () => {
    const b = makeBatch("btch", [makeStagedTask("a", "x", 1), makeStagedTask("b", "y", 2)], 1, "/r");
    const next = removeSubagent([b], "btch", "a");
    expect(next[0].subagents.map((s) => s.taskId)).toEqual(["b"]);
    expect(next).not.toBe([b]);
  });
  it("removeBatch drops the whole batch", () => {
    const b1 = makeBatch("b1", [makeStagedTask("a", "x", 1)], 1, "/r");
    const b2 = makeBatch("b2", [makeStagedTask("c", "z", 3)], 2, "/r");
    expect(removeBatch([b1, b2], "b1").map((b) => b.id)).toEqual(["b2"]);
  });
  it("moveSubagent reorders one subagent to another's position", () => {
    const b = makeBatch("btch", [makeStagedTask("a", "x", 1), makeStagedTask("b", "y", 2), makeStagedTask("c", "z", 3)], 1, "/r");
    // move "c" to where "a" is → c, a, b
    expect(moveSubagent([b], "btch", "c", "a")[0].subagents.map((s) => s.taskId)).toEqual(["c", "a", "b"]);
    // no-op when from === to
    expect(moveSubagent([b], "btch", "a", "a")[0].subagents.map((s) => s.taskId)).toEqual(["a", "b", "c"]);
  });
});
