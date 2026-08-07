import { describe, it, expect } from "vitest";
import { taskBranch, makeStagedTask, removeStaged, makeBatch, appendSubagentLog, setSubagentStatus } from "./tasks";

describe("staging + batch", () => {
  it("taskBranch namespaces under task/", () => {
    expect(taskBranch("a1b2")).toBe("task/a1b2");
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
  it("makeBatch turns staged tasks into running subagents on task/ branches", () => {
    const batch = makeBatch("btch", [makeStagedTask("a", "x", 1)], 5000);
    expect(batch).toEqual({
      id: "btch", createdAt: 5000,
      subagents: [{ taskId: "a", prompt: "x", branch: "task/a", status: "running", log: "" }],
    });
  });
  it("appendSubagentLog accumulates only the matching subagent", () => {
    const b = makeBatch("btch", [makeStagedTask("a", "x", 1), makeStagedTask("b", "y", 2)], 1);
    const next = appendSubagentLog([b], "btch", "a", "hello");
    expect(next[0].subagents.find((s) => s.taskId === "a")!.log).toBe("hello");
    expect(next[0].subagents.find((s) => s.taskId === "b")!.log).toBe("");
  });
  it("setSubagentStatus updates only the matching subagent", () => {
    const b = makeBatch("btch", [makeStagedTask("a", "x", 1)], 1);
    const next = setSubagentStatus([b], "btch", "a", "done");
    expect(next[0].subagents[0].status).toBe("done");
  });
});
