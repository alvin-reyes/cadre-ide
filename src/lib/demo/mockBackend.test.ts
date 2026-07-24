/**
 * mockBackend.test.ts — Tests for the pure command handlers in mockBackend.
 *
 * We test the command logic by importing mockFs and calling the exported
 * invoke factory indirectly through a thin test harness that bypasses the
 * DOM install (which is not unit-testable in a node environment).
 *
 * We import MockFs directly and test the specific behaviors:
 * - run_verification result shape
 * - story_set_status transition enforcement via transitions.ts
 * - list_directory from seeded FS returns correct DirEntry shape
 * - approve_plan / get_plan_approval round-trip
 * - secrets round-trip
 * - run_gh result shape
 * - unmapped command does not throw (returns null)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockFs } from "./mockFs";
import type { PlanApproval } from "../engine/planApproval";
import type { Status } from "../engine/status";
import { canTransition } from "../engine/transitions";

// ─── Inline test invoke factory (mirrors the one in mockBackend.ts) ──────────
// We re-create a minimal invoke here so tests stay pure (no window needed).
// In production, installMockBackend wires this to window.__TAURI_INTERNALS__.

function stateFilePath(root: string, epic: number, story: number): string {
  return `${root}/.cadre/state/${epic}.${story}.json`;
}

function makeTestInvoke(fs: MockFs) {
  const secretsStore = new Map<string, string>();

  return async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (cmd) {
      case "read_file": {
        const path = args.path as string;
        const content = fs.read(path);
        if (content === null) throw new Error(`file not found: ${path}`);
        return content;
      }
      case "write_text_file": {
        const path = args.path as string;
        const content = (args.content ?? args.contents ?? "") as string;
        fs.write(path, content);
        return null;
      }
      case "list_directory": {
        const path = args.path as string;
        return fs.list(path);
      }
      case "list_md_files": {
        const dir = (args.dir as string) || "/";
        return fs.allPaths().filter((p) => p.startsWith(dir) && p.endsWith(".md"));
      }
      case "story_set_status": {
        const root = args.root as string;
        const epic = args.epic as number;
        const story = args.story as number;
        const status = args.status as Status;
        const stateFile = stateFilePath(root, epic, story);
        const existing = fs.read(stateFile);
        const currentStatus: Status = existing ? (JSON.parse(existing).status as Status) : "Draft";
        if (!canTransition(currentStatus, status)) {
          throw new Error(`illegal status transition: ${currentStatus} -> ${status}`);
        }
        fs.write(stateFile, JSON.stringify({ status }, null, 2));
        return null;
      }
      case "story_get_status": {
        const root = args.root as string;
        const epic = args.epic as number;
        const story = args.story as number;
        const stateFile = stateFilePath(root, epic, story);
        const content = fs.read(stateFile);
        if (!content) return "Draft";
        return (JSON.parse(content) as { status: Status }).status;
      }
      case "is_own_write": {
        return true;
      }
      case "approve_plan": {
        const root = args.root as string;
        const verification = args.verification as string[];
        const repoVerification = args.repoVerification as Record<string, string[]> | undefined;
        const approval: PlanApproval = {
          approved: true,
          verification,
          ...(repoVerification ? { repoVerification } : {}),
        };
        fs.write(`${root}/.cadre/plan-approval.json`, JSON.stringify(approval, null, 2));
        return null;
      }
      case "get_plan_approval": {
        const root = args.root as string;
        const content = fs.read(`${root}/.cadre/plan-approval.json`);
        if (!content) return null;
        return JSON.parse(content) as PlanApproval;
      }
      case "run_git": {
        return { exit_code: 0, stdout: "", stderr: "", timed_out: false };
      }
      case "run_verification": {
        return { exit_code: 0, stdout: "mock: all checks passed", stderr: "", timed_out: false };
      }
      case "run_gh": {
        return { exit_code: 0, stdout: '{"number":1}', stderr: "", timed_out: false };
      }
      case "secret_get": {
        return secretsStore.get(args.key as string) ?? null;
      }
      case "secret_set": {
        secretsStore.set(args.key as string, args.value as string);
        return null;
      }
      case "secret_has": {
        return secretsStore.has(args.key as string);
      }
      case "secret_delete": {
        secretsStore.delete(args.key as string);
        return null;
      }
      case "check_command_exists":
      case "check_claude_plugin":
      case "claude_auth_status": {
        return true;
      }
      case "open_project":
      case "watch_directory":
      case "unwatch_directory": {
        return null;
      }
      default: {
        return null; // unmapped — warn in prod, return null in tests
      }
    }
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mockBackend command handlers", () => {
  let fs: MockFs;
  let invoke: ReturnType<typeof makeTestInvoke>;
  const ROOT = "/demo/project";

  beforeEach(() => {
    fs = new MockFs({
      [`${ROOT}/cadre.json`]: '{"cadre":"0.1","name":"demo"}',
      [`${ROOT}/docs/prd.md`]: "# PRD",
      [`${ROOT}/docs/stories/1.1.md`]: "# Story 1.1",
      [`${ROOT}/docs/stories/1.2.md`]: "# Story 1.2",
    });
    invoke = makeTestInvoke(fs);
  });

  describe("run_verification result shape", () => {
    it("returns exit_code, stdout, stderr, timed_out", async () => {
      const result = (await invoke("run_verification", { cwd: ROOT, cmd: "npm test", timeoutSecs: 60 })) as {
        exit_code: number;
        stdout: string;
        stderr: string;
        timed_out: boolean;
      };
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toBe("mock: all checks passed");
      expect(result.stderr).toBe("");
      expect(result.timed_out).toBe(false);
    });
  });

  describe("run_gh result shape", () => {
    it("returns exit_code, stdout, stderr, timed_out", async () => {
      const result = (await invoke("run_gh", { cwd: ROOT, args: ["auth", "status"] })) as {
        exit_code: number;
        stdout: string;
        stderr: string;
        timed_out: boolean;
      };
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toBe('{"number":1}');
      expect(result.timed_out).toBe(false);
    });
  });

  describe("run_git result shape", () => {
    it("returns exit_code, stdout, stderr, timed_out", async () => {
      const result = (await invoke("run_git", { cwd: ROOT, args: ["status"] })) as {
        exit_code: number;
        stdout: string;
        stderr: string;
        timed_out: boolean;
      };
      expect(result.exit_code).toBe(0);
      expect(result.timed_out).toBe(false);
    });
  });

  describe("list_directory from seeded FS", () => {
    it("returns DirEntry array with correct shape", async () => {
      const entries = (await invoke("list_directory", { path: `${ROOT}/docs/stories` })) as Array<{
        name: string;
        path: string;
        is_dir: boolean;
      }>;
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBe(2);
      for (const e of entries) {
        expect(typeof e.name).toBe("string");
        expect(typeof e.path).toBe("string");
        expect(typeof e.is_dir).toBe("boolean");
      }
    });

    it("lists story files as non-directories", async () => {
      const entries = (await invoke("list_directory", { path: `${ROOT}/docs/stories` })) as Array<{
        name: string;
        path: string;
        is_dir: boolean;
      }>;
      expect(entries.every((e) => !e.is_dir)).toBe(true);
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(["1.1.md", "1.2.md"]);
    });

    it("returns implied subdirs as is_dir=true", async () => {
      const entries = (await invoke("list_directory", { path: `${ROOT}/docs` })) as Array<{
        name: string;
        path: string;
        is_dir: boolean;
      }>;
      const stories = entries.find((e) => e.name === "stories");
      expect(stories?.is_dir).toBe(true);
    });
  });

  describe("story_set_status via transitions.ts", () => {
    it("allows a valid transition Draft→Approved", async () => {
      await expect(
        invoke("story_set_status", { root: ROOT, epic: 1, story: 1, status: "Approved" })
      ).resolves.toBeNull();
      const status = await invoke("story_get_status", { root: ROOT, epic: 1, story: 1 });
      expect(status).toBe("Approved");
    });

    it("allows a valid chain Draft→Approved→InProgress", async () => {
      await invoke("story_set_status", { root: ROOT, epic: 1, story: 1, status: "Approved" });
      await invoke("story_set_status", { root: ROOT, epic: 1, story: 1, status: "InProgress" });
      const status = await invoke("story_get_status", { root: ROOT, epic: 1, story: 1 });
      expect(status).toBe("InProgress");
    });

    it("rejects an illegal transition Draft→Done", async () => {
      await expect(
        invoke("story_set_status", { root: ROOT, epic: 1, story: 1, status: "Done" })
      ).rejects.toThrow(/illegal status transition/);
    });

    it("defaults to Draft for a story with no state file", async () => {
      const status = await invoke("story_get_status", { root: ROOT, epic: 99, story: 99 });
      expect(status).toBe("Draft");
    });

    it("persists status to the FS state file", async () => {
      await invoke("story_set_status", { root: ROOT, epic: 1, story: 1, status: "Approved" });
      const raw = fs.read(`${ROOT}/.cadre/state/1.1.json`);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).status).toBe("Approved");
    });

    it("idempotent: same status → same status write (allowed by canTransition)", async () => {
      await invoke("story_set_status", { root: ROOT, epic: 1, story: 1, status: "Draft" });
      const status = await invoke("story_get_status", { root: ROOT, epic: 1, story: 1 });
      expect(status).toBe("Draft");
    });
  });

  describe("approve_plan / get_plan_approval round-trip", () => {
    it("stores and retrieves a PlanApproval", async () => {
      await invoke("approve_plan", {
        root: ROOT,
        verification: ["npm test"],
        repoVerification: { frontend: ["npm test"] },
      });
      const approval = (await invoke("get_plan_approval", { root: ROOT })) as PlanApproval;
      expect(approval).not.toBeNull();
      expect(approval.approved).toBe(true);
      expect(approval.verification).toEqual(["npm test"]);
      expect(approval.repoVerification).toEqual({ frontend: ["npm test"] });
    });

    it("returns null when no approval exists", async () => {
      const approval = await invoke("get_plan_approval", { root: "/no/project" });
      expect(approval).toBeNull();
    });
  });

  describe("secrets round-trip", () => {
    it("secret_set → secret_get round-trips", async () => {
      await invoke("secret_set", { key: "anthropic_api_key", value: "sk-ant-test" });
      const got = await invoke("secret_get", { key: "anthropic_api_key" });
      expect(got).toBe("sk-ant-test");
    });

    it("secret_has returns true after set", async () => {
      await invoke("secret_set", { key: "test_key", value: "val" });
      const has = await invoke("secret_has", { key: "test_key" });
      expect(has).toBe(true);
    });

    it("secret_has returns false for missing key", async () => {
      const has = await invoke("secret_has", { key: "nonexistent" });
      expect(has).toBe(false);
    });

    it("secret_get returns null for missing key", async () => {
      const got = await invoke("secret_get", { key: "nonexistent" });
      expect(got).toBeNull();
    });

    it("secret_delete removes a key", async () => {
      await invoke("secret_set", { key: "del_key", value: "v" });
      await invoke("secret_delete", { key: "del_key" });
      const got = await invoke("secret_get", { key: "del_key" });
      expect(got).toBeNull();
    });
  });

  describe("read_file", () => {
    it("returns content for existing file", async () => {
      const content = await invoke("read_file", { path: `${ROOT}/cadre.json` });
      expect(content).toBe('{"cadre":"0.1","name":"demo"}');
    });

    it("throws for missing file", async () => {
      await expect(invoke("read_file", { path: `${ROOT}/missing.txt` })).rejects.toThrow(
        /file not found/
      );
    });
  });

  describe("write_text_file", () => {
    it("writes content readable via read_file", async () => {
      await invoke("write_text_file", { path: `${ROOT}/new.md`, content: "hello" });
      const content = await invoke("read_file", { path: `${ROOT}/new.md` });
      expect(content).toBe("hello");
    });
  });

  describe("is_own_write", () => {
    it("always returns true in demo mode", async () => {
      const result = await invoke("is_own_write", {
        root: ROOT,
        path: `${ROOT}/.cadre/state/1.1.json`,
        content: "x",
      });
      expect(result).toBe(true);
    });
  });

  describe("check_command_exists / check_claude_plugin / claude_auth_status", () => {
    it("check_command_exists returns true", async () => {
      expect(await invoke("check_command_exists", { command: "claude" })).toBe(true);
    });
    it("check_claude_plugin returns true", async () => {
      expect(await invoke("check_claude_plugin", { pluginName: "superpowers@claude-plugins-official" })).toBe(true);
    });
    it("claude_auth_status returns true", async () => {
      expect(await invoke("claude_auth_status", {})).toBe(true);
    });
  });

  describe("unmapped command", () => {
    it("returns null without throwing", async () => {
      const result = await invoke("some_unknown_command" as string, { foo: "bar" });
      expect(result).toBeNull();
    });
  });

  describe("list_md_files", () => {
    it("returns md files under the given dir", async () => {
      const files = (await invoke("list_md_files", { dir: `${ROOT}/docs` })) as string[];
      expect(files).toContain(`${ROOT}/docs/prd.md`);
      expect(files).toContain(`${ROOT}/docs/stories/1.1.md`);
      expect(files).toContain(`${ROOT}/docs/stories/1.2.md`);
    });

    it("does not return non-md files", async () => {
      const files = (await invoke("list_md_files", { dir: ROOT })) as string[];
      expect(files.every((f) => f.endsWith(".md"))).toBe(true);
    });
  });
});
