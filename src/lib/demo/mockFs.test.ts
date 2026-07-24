import { describe, it, expect, beforeEach } from "vitest";
import { MockFs } from "./mockFs";

describe("MockFs", () => {
  let fs: MockFs;

  beforeEach(() => {
    fs = new MockFs({
      "/project/cadre.json": '{"cadre":"0.1","name":"demo"}',
      "/project/docs/prd.md": "# PRD\nThis is the product requirements document.",
      "/project/docs/stories/1.1.md": "# Story 1.1",
      "/project/docs/stories/1.2.md": "# Story 1.2",
      "/project/.cadre/state/1.1.json": '{"status":"Draft"}',
    });
  });

  describe("read", () => {
    it("returns content for an existing file", () => {
      expect(fs.read("/project/cadre.json")).toBe('{"cadre":"0.1","name":"demo"}');
    });

    it("returns null for a missing file", () => {
      expect(fs.read("/project/nonexistent.txt")).toBeNull();
    });

    it("trims trailing slashes from path", () => {
      expect(fs.read("/project/cadre.json/")).toBe('{"cadre":"0.1","name":"demo"}');
    });
  });

  describe("write", () => {
    it("writes a new file", () => {
      fs.write("/project/README.md", "# Hello");
      expect(fs.read("/project/README.md")).toBe("# Hello");
    });

    it("overwrites an existing file", () => {
      fs.write("/project/cadre.json", '{"updated":true}');
      expect(fs.read("/project/cadre.json")).toBe('{"updated":true}');
    });

    it("creates files with implicit parent dirs", () => {
      fs.write("/project/deep/nested/file.txt", "content");
      expect(fs.read("/project/deep/nested/file.txt")).toBe("content");
    });
  });

  describe("exists", () => {
    it("returns true for an existing file", () => {
      expect(fs.exists("/project/cadre.json")).toBe(true);
    });

    it("returns false for a missing file", () => {
      expect(fs.exists("/project/missing.md")).toBe(false);
    });

    it("returns true for an implied directory", () => {
      expect(fs.exists("/project/docs")).toBe(true);
    });

    it("returns false for a non-existent directory", () => {
      expect(fs.exists("/project/empty-dir")).toBe(false);
    });
  });

  describe("mkdir", () => {
    it("is a no-op (dirs are implicit)", () => {
      // Should not throw
      expect(() => fs.mkdir("/project/newdir")).not.toThrow();
    });
  });

  describe("list", () => {
    it("lists direct children of a directory", () => {
      const entries = fs.list("/project");
      const names = entries.map((e) => e.name).sort();
      expect(names).toContain("cadre.json");
      expect(names).toContain("docs");
      expect(names).toContain(".cadre");
    });

    it("marks files as is_dir=false", () => {
      const entries = fs.list("/project");
      const cadre = entries.find((e) => e.name === "cadre.json");
      expect(cadre?.is_dir).toBe(false);
    });

    it("marks implied subdirectories as is_dir=true", () => {
      const entries = fs.list("/project");
      const docs = entries.find((e) => e.name === "docs");
      expect(docs?.is_dir).toBe(true);
    });

    it("returns correct path for entries", () => {
      const entries = fs.list("/project");
      const cadre = entries.find((e) => e.name === "cadre.json");
      expect(cadre?.path).toBe("/project/cadre.json");
      const docs = entries.find((e) => e.name === "docs");
      expect(docs?.path).toBe("/project/docs");
    });

    it("lists nested directory contents", () => {
      const entries = fs.list("/project/docs/stories");
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(["1.1.md", "1.2.md"]);
      expect(entries.every((e) => !e.is_dir)).toBe(true);
    });

    it("returns empty array for an empty or non-existent directory", () => {
      expect(fs.list("/project/nonexistent")).toEqual([]);
    });

    it("does not list grandchildren", () => {
      const entries = fs.list("/project/docs");
      // Should only see 'stories' (subdir), 'prd.md' (file) — not 1.1.md etc.
      const names = entries.map((e) => e.name).sort();
      expect(names).toContain("prd.md");
      expect(names).toContain("stories");
      expect(names).not.toContain("1.1.md");
    });

    it("derives implied subdirs without duplicates", () => {
      const entries = fs.list("/project/docs");
      const storiesEntries = entries.filter((e) => e.name === "stories");
      expect(storiesEntries).toHaveLength(1);
    });
  });

  describe("remove", () => {
    it("removes an existing file", () => {
      fs.remove("/project/cadre.json");
      expect(fs.read("/project/cadre.json")).toBeNull();
    });

    it("is a no-op for a missing file", () => {
      expect(() => fs.remove("/project/nonexistent.txt")).not.toThrow();
    });
  });

  describe("seeding", () => {
    it("initializes with all seed files readable", () => {
      expect(fs.read("/project/docs/prd.md")).toContain("PRD");
      expect(fs.read("/project/.cadre/state/1.1.json")).toContain("Draft");
    });
  });
});
