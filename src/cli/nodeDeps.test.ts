import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile as fsReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";

import { runGit, runGitQuery, setStatus, getStatus, getPlanApproval } from "./nodeDeps";
import { nodeRunStoryDeps } from "./nodeDeps";

const execFile = promisify(execFileCb);

describe("nodeDeps", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cadre-nodedeps-"));
    await execFile("git", ["init", "-q"], { cwd: dir });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runGitQuery returns exit 0 inside a git repo", async () => {
    const res = await runGitQuery(["rev-parse", "--is-inside-work-tree"], dir);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("true");
  });

  it("runGitQuery reports a non-zero exit without throwing", async () => {
    const res = await runGitQuery(["rev-parse", "--verify", "does-not-exist"], dir);
    expect(res.exitCode).not.toBe(0);
  });

  it("runGit throws on a failing git command", async () => {
    await expect(runGit(["not-a-real-git-command"], dir)).rejects.toThrow(/git/);
  });

  it("spawnAgent + waitForExit resolves the real exit code", async () => {
    const deps = nodeRunStoryDeps(dir);
    const okId = await deps.spawnAgent({ command: "node", args: ["-e", "process.exit(0)"], cwd: dir });
    expect(await deps.waitForExit(okId)).toEqual({ exitCode: 0 });

    const failId = await deps.spawnAgent({ command: "node", args: ["-e", "process.exit(3)"], cwd: dir });
    expect(await deps.waitForExit(failId)).toEqual({ exitCode: 3 });
  });

  it("spawnAgent streams stdout to the output sink", async () => {
    let captured = "";
    const deps = nodeRunStoryDeps(dir, (chunk) => (captured += chunk));
    const id = await deps.spawnAgent({
      command: "node",
      args: ["-e", "process.stdout.write('hello-sink')"],
      cwd: dir,
    });
    await deps.waitForExit(id);
    expect(captured).toContain("hello-sink");
  });

  it("runVerification returns the command's real exit code", async () => {
    const deps = nodeRunStoryDeps(dir);
    expect(await deps.runVerification(dir, "exit 0", 30)).toEqual({ exitCode: 0, timedOut: false });
    expect(await deps.runVerification(dir, "exit 7", 30)).toEqual({ exitCode: 7, timedOut: false });
  });

  it("runVerification flags a wall-clock timeout", async () => {
    const deps = nodeRunStoryDeps(dir);
    const res = await deps.runVerification(dir, "sleep 5", 1);
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).not.toBe(0);
  });

  it("setStatus writes a Rust-compatible state file and getStatus reads it back", async () => {
    await setStatus(dir, 1, 2, "Approved");
    const raw = await fsReadFile(join(dir, ".cadre", "state", "1.2.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ epic: 1, story: 2, status: "Approved" });
    expect(await getStatus(dir, 1, 2)).toBe("Approved");
    expect(await getStatus(dir, 9, 9)).toBeNull();
  });

  it("getPlanApproval returns null when unapproved and parses the frozen plan", async () => {
    expect(await getPlanApproval(dir)).toBeNull();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".cadre", "approvals"), { recursive: true });
    await writeFile(
      join(dir, ".cadre", "approvals", "plan.json"),
      JSON.stringify({ approved: true, verification: ["npm test"], repoVerification: {} })
    );
    const approval = await getPlanApproval(dir);
    expect(approval?.approved).toBe(true);
    expect(approval?.verification).toEqual(["npm test"]);
  });
});
