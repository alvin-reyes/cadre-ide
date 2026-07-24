import { describe, it, expect } from "vitest";
import { parseRepos, resolveRepoPath, repoWorktreePath, findRepo, DEFAULT_REPO_ID } from "./repos";

describe("repos registry", () => {
  it("defaults to a single 'main' repo at '.' when no repos are declared", () => {
    expect(parseRepos('{"name":"Acme"}')).toEqual([{ id: "main", name: "Acme", path: "." }]);
    expect(parseRepos("not json")).toEqual([{ id: "main", name: "main", path: "." }]);
  });

  it("parses a declared repo list", () => {
    const json = JSON.stringify({ name: "Acme", repos: [
      { id: "web", name: "Web", path: "../acme-web", verify: "npm test" },
      { id: "api", path: "../acme-api" },
    ]});
    expect(parseRepos(json)).toEqual([
      { id: "web", name: "Web", path: "../acme-web", verify: "npm test" },
      { id: "api", name: "api", path: "../acme-api" },
    ]);
  });

  it("resolves paths: '.' → root, relative → joined, absolute → itself", () => {
    expect(resolveRepoPath("/proj", ".")).toBe("/proj");
    expect(resolveRepoPath("/proj", "../web")).toBe("/web");
    expect(resolveRepoPath("/proj", "/abs/api")).toBe("/abs/api");
  });

  it("namespaces worktrees by repo id", () => {
    expect(repoWorktreePath("/proj", "web", 1, 2)).toBe("/proj/.cadre/worktrees/web/1.2");
  });

  it("findRepo falls back to the first repo on an unknown id", () => {
    const repos = [{ id: "web", name: "Web", path: "../w" }, { id: "api", name: "api", path: "../a" }];
    expect(findRepo(repos, "api").id).toBe("api");
    expect(findRepo(repos, "ghost").id).toBe("web");
    expect(findRepo([], DEFAULT_REPO_ID)).toEqual({ id: "main", name: "main", path: "." });
  });
});
