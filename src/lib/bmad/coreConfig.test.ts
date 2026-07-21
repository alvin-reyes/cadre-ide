import { describe, it, expect } from "vitest";
import { parseCoreConfig } from "./coreConfig";

// The real resources/bmad-core/core-config.yaml (v4.44.3).
const REAL = `# <!-- Powered by BMAD Core -->
markdownExploder: true
qa:
  qaLocation: docs/qa
prd:
  prdFile: docs/prd.md
  prdVersion: v4
  prdSharded: true
  prdShardedLocation: docs/prd
  epicFilePattern: epic-{n}*.md
architecture:
  architectureFile: docs/architecture.md
  architectureVersion: v4
  architectureSharded: true
  architectureShardedLocation: docs/architecture
customTechnicalDocuments: null
devLoadAlwaysFiles:
  - docs/architecture/coding-standards.md
  - docs/architecture/tech-stack.md
  - docs/architecture/source-tree.md
devDebugLog: .ai/debug-log.md
devStoryLocation: docs/stories
slashPrefix: BMad
`;

describe("parseCoreConfig", () => {
  it("reads artifact locations from the real config", () => {
    const c = parseCoreConfig(REAL);
    expect(c.prdFile).toBe("docs/prd.md");
    expect(c.prdSharded).toBe(true);
    expect(c.prdShardedLocation).toBe("docs/prd");
    expect(c.epicFilePattern).toBe("epic-{n}*.md");
    expect(c.architectureFile).toBe("docs/architecture.md");
    expect(c.architectureSharded).toBe(true);
    expect(c.architectureShardedLocation).toBe("docs/architecture");
    expect(c.devStoryLocation).toBe("docs/stories");
    expect(c.qaLocation).toBe("docs/qa");
    expect(c.slashPrefix).toBe("BMad");
  });

  it("reads devLoadAlwaysFiles as a string list", () => {
    const c = parseCoreConfig(REAL);
    expect(c.devLoadAlwaysFiles).toHaveLength(3);
    expect(c.devLoadAlwaysFiles).toContain(
      "docs/architecture/coding-standards.md"
    );
  });

  it("applies sensible defaults for an empty config", () => {
    const c = parseCoreConfig("");
    expect(c.prdFile).toBe("docs/prd.md");
    expect(c.architectureFile).toBe("docs/architecture.md");
    expect(c.devStoryLocation).toBe("docs/stories");
    expect(c.slashPrefix).toBe("BMad");
    expect(c.prdSharded).toBe(false);
    expect(c.devLoadAlwaysFiles).toEqual([]);
    expect(c.qaLocation).toBeUndefined();
  });
});
