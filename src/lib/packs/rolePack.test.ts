import { describe, it, expect } from "vitest";
import {
  composePipeline,
  activeRoles,
  composeVerification,
  WEB3_PACK,
  type RolePack,
} from "./rolePack";

describe("composePipeline", () => {
  it("is the core pipeline with no packs", () => {
    expect(composePipeline([])).toEqual(["dev", "reviewer", "qa"]);
  });

  it("appends a pack's extra gates after the core gates", () => {
    expect(composePipeline([WEB3_PACK])).toEqual([
      "dev",
      "reviewer",
      "qa",
      "auditor",
      "pentester",
    ]);
  });
});

describe("activeRoles", () => {
  it("collects pack roles (deduped, in order)", () => {
    const other: RolePack = {
      id: "x",
      name: "X",
      roles: ["auditor", "reviewer2"],
      extraGates: [],
      verification: [],
    };
    expect(activeRoles([WEB3_PACK, other])).toEqual([
      "auditor",
      "pentester",
      "reviewer2",
    ]);
  });

  it("is empty with no packs", () => {
    expect(activeRoles([])).toEqual([]);
  });
});

describe("composeVerification", () => {
  it("runs the project's command first, then each pack's checks", () => {
    expect(composeVerification("pnpm test", [WEB3_PACK])).toEqual([
      "pnpm test",
      "forge test",
      "slither . --fail-high",
    ]);
  });

  it("omits an empty base command", () => {
    expect(composeVerification("", [])).toEqual([]);
  });
});
