import { describe, it, expect } from "vitest";
import { makeTask, taskBranch, setTaskStatus } from "./tasks";

describe("maintain tasks", () => {
  it("taskBranch namespaces under task/", () => {
    expect(taskBranch("a1b2")).toBe("task/a1b2");
  });
  it("makeTask starts queued with a task/ branch", () => {
    const t = makeTask("a1b2", "bump deps", 1000);
    expect(t).toEqual({ id: "a1b2", prompt: "bump deps", status: "queued", branch: "task/a1b2", createdAt: 1000 });
  });
  it("setTaskStatus updates only the matching task, immutably", () => {
    const a = makeTask("a", "x", 1);
    const b = makeTask("b", "y", 2);
    const next = setTaskStatus([a, b], "a", "running");
    expect(next.find((t) => t.id === "a")!.status).toBe("running");
    expect(next.find((t) => t.id === "b")!.status).toBe("queued");
    expect(next).not.toBe([a, b]); // new array
  });
});
