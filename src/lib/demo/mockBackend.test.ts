/**
 * mockBackend.test.ts — Tests for the real command handlers in mockBackend.
 *
 * We import createMockInvoke directly so we exercise the REAL implementation,
 * not an inline copy. This ensures fixes in mockBackend.ts are actually covered.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockFs } from "./mockFs";
import { createMockInvoke } from "./mockBackend";
import type { PlanApproval } from "../engine/planApproval";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mockBackend command handlers", () => {
  let fs: MockFs;
  let invoke: ReturnType<typeof createMockInvoke>;
  const ROOT = "/demo/project";

  beforeEach(() => {
    fs = new MockFs({
      [`${ROOT}/cadre.json`]: '{"cadre":"0.1","name":"demo"}',
      [`${ROOT}/docs/prd.md`]: "# PRD",
      [`${ROOT}/docs/stories/1.1.md`]: "# Story 1.1",
      [`${ROOT}/docs/stories/1.2.md`]: "# Story 1.2",
    });
    invoke = createMockInvoke(fs);
  });

  describe("create_pty review agent writes an accept marker (demo fidelity)", () => {
    it("writes {verdict:accept} to the .cadre/reviews marker named in the agent's prompt", async () => {
      const marker = `${ROOT}/.cadre/reviews/1.4.correctness.json`;
      await invoke("create_pty", {
        rows: 24, cols: 80,
        cwd: `${ROOT}/.cadre/worktrees/story-1.4`,
        command: "claude",
        args: ["--dangerously-skip-permissions", "-p", `Review the code. When finished, write your findings as JSON to \`${marker}\` with the shape ...`],
        onEvent: { onmessage: () => {} },
      });
      const raw = fs.read(marker);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({ verdict: "accept", findings: [] });
    });
    it("does NOT write a review marker for a non-review (dev) agent", async () => {
      await invoke("create_pty", {
        rows: 24, cols: 80,
        cwd: `${ROOT}/.cadre/worktrees/story-1.5`,
        command: "claude",
        args: ["--dangerously-skip-permissions", "-p", "Implement story 1.5 following the plan."],
        onEvent: { onmessage: () => {} },
      });
      expect(fs.read(`${ROOT}/.cadre/reviews/1.5.correctness.json`)).toBeNull();
    });
  });

  describe("watch_directory fires events for runtime writes (board reconcile)", () => {
    it("notifies a matching watcher when a file is written under its dir + extension", async () => {
      const events: { type: string; path: string }[] = [];
      await invoke("watch_directory", { dir: `${ROOT}/docs/stories`, extensions: ["md"], onEvent: { onmessage: (e: { type: string; path: string }) => events.push(e) } });
      await invoke("write_text_file", { path: `${ROOT}/docs/stories/1.1.scaffold.md`, content: "# 1.1" });
      expect(events).toEqual([{ type: "created", path: `${ROOT}/docs/stories/1.1.scaffold.md` }]);
    });
    it("does not notify for a wrong extension or a different dir", async () => {
      const events: { type: string; path: string }[] = [];
      await invoke("watch_directory", { dir: `${ROOT}/docs/stories`, extensions: ["md"], onEvent: { onmessage: (e: { type: string; path: string }) => events.push(e) } });
      await invoke("write_text_file", { path: `${ROOT}/docs/stories/notes.txt`, content: "x" });
      await invoke("write_text_file", { path: `${ROOT}/other/foo.md`, content: "x" });
      expect(events).toEqual([]);
    });
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

    it("persists status to the FS state file with {epic,story,status} shape", async () => {
      await invoke("story_set_status", { root: ROOT, epic: 1, story: 1, status: "Approved" });
      const raw = fs.read(`${ROOT}/.cadre/state/1.1.json`);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      // Real handler writes {epic, story, status} — board.ts reconcile reads epic+story
      expect(parsed.epic).toBe(1);
      expect(parsed.story).toBe(1);
      expect(parsed.status).toBe("Approved");
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
    it("always returns false in demo mode (so hydrate scan reconciles seeded statuses)", async () => {
      const result = await invoke("is_own_write", {
        root: ROOT,
        path: `${ROOT}/.cadre/state/1.1.json`,
        content: "x",
      });
      // Must be false: a true here suppresses watcher reconciliation and leaves
      // all stories as Draft even though state files are seeded.
      expect(result).toBe(false);
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

  describe("mcp_probe", () => {
    it("returns a JSON string with the canned ok payload (toolCount=12, 12 toolNames)", async () => {
      const raw = await invoke("mcp_probe", { connectionJson: '{"id":"github"}' });
      expect(typeof raw).toBe("string");
      const parsed = JSON.parse(raw as string) as { ok: boolean; toolCount: number; toolNames: string[] };
      expect(parsed.ok).toBe(true);
      expect(parsed.toolCount).toBe(12);
      expect(parsed.toolNames).toHaveLength(12);
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

  describe("plugin no-op commands (Fix 5)", () => {
    it("plugin:clipboard-manager|read_image resolves null without warning", async () => {
      const result = await invoke("plugin:clipboard-manager|read_image", {});
      expect(result).toBeNull();
    });

    it("plugin:opener|open_url resolves null without warning", async () => {
      const result = await invoke("plugin:opener|open_url", { url: "https://example.com" });
      expect(result).toBeNull();
    });
  });
});
