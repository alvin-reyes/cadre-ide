import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  renderSessionEntry,
  tailSessionLog,
  appendSessionEntry,
  SESSION_LOG_HEADER,
  SESSION_LOG_PATH,
} from "./sessionLog";

const TS = Date.UTC(2026, 6, 24, 4, 35); // 2026-07-24 04:35 UTC

describe("sessionLog formatting", () => {
  it("formats a compact UTC timestamp", () => {
    expect(formatTimestamp(TS)).toBe("2026-07-24 04:35");
  });

  it("renders a bullet entry", () => {
    expect(renderSessionEntry(TS, "dispatched story 1.2")).toBe("- `2026-07-24 04:35` dispatched story 1.2");
  });
});

describe("tailSessionLog", () => {
  it("returns content unchanged (normalized trailing newline) when under the cap", () => {
    const c = `${SESSION_LOG_HEADER}\n- \`t\` a\n- \`t\` b`;
    expect(tailSessionLog(c, 60)).toBe(c + "\n");
  });

  it("keeps only the last N bullets and re-seeds the header", () => {
    const bullets = Array.from({ length: 5 }, (_, i) => `- \`t\` e${i}`).join("\n");
    const out = tailSessionLog(`${SESSION_LOG_HEADER}\n${bullets}`, 2);
    expect(out).toContain("older entries trimmed");
    expect(out).toContain("- `t` e3");
    expect(out).toContain("- `t` e4");
    expect(out).not.toContain("- `t` e0");
  });
});

describe("appendSessionEntry", () => {
  function memDeps(initial: Record<string, string> = {}) {
    const files = { ...initial };
    return {
      files,
      deps: {
        readFile: async (p: string) => {
          if (p in files) return files[p];
          throw new Error("ENOENT");
        },
        writeFile: async (p: string, c: string) => {
          files[p] = c;
        },
      },
    };
  }

  it("seeds the header on first write and appends the entry", async () => {
    const { files, deps } = memDeps();
    await appendSessionEntry(deps, "/proj", TS, "approved the plan");
    const written = files[`/proj/${SESSION_LOG_PATH}`];
    expect(written).toContain("# Session journal");
    expect(written).toContain("- `2026-07-24 04:35` approved the plan");
  });

  it("appends to an existing journal without dropping prior entries", async () => {
    const path = `/proj/${SESSION_LOG_PATH}`;
    const { files, deps } = memDeps({ [path]: `${SESSION_LOG_HEADER}\n- \`old\` earlier event\n` });
    await appendSessionEntry(deps, "/proj", TS, "dispatched story 1.1");
    expect(files[path]).toContain("earlier event");
    expect(files[path]).toContain("dispatched story 1.1");
  });
});
