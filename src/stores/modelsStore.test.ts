import { describe, it, expect } from "vitest";
import { mergeModelsIntoManifest } from "./modelsStore";

describe("mergeModelsIntoManifest", () => {
  it("adds a models block without clobbering other keys", () => {
    const raw = JSON.stringify({ cadre: 1, name: "Acme", repos: [{ id: "main" }], tracker: { enabled: true } });
    const out = JSON.parse(mergeModelsIntoManifest(raw, { planning: "claude-opus-4-8" }));
    expect(out.name).toBe("Acme");
    expect(out.repos).toEqual([{ id: "main" }]);
    expect(out.tracker).toEqual({ enabled: true });
    expect(out.models).toEqual({ planning: "claude-opus-4-8" });
  });

  it("merges into an existing models block", () => {
    const raw = JSON.stringify({ name: "Acme", models: { planning: "m1" } });
    const out = JSON.parse(mergeModelsIntoManifest(raw, { fleet: "kimi-k2", provider: "kimi" }));
    expect(out.models).toEqual({ planning: "m1", fleet: "kimi-k2", provider: "kimi" });
  });

  it("removes a key when patched with empty string", () => {
    const raw = JSON.stringify({ name: "Acme", models: { planning: "m1", fleet: "f1" } });
    const out = JSON.parse(mergeModelsIntoManifest(raw, { fleet: "" }));
    expect(out.models).toEqual({ planning: "m1" });
  });

  it("removes the models block entirely when it becomes empty", () => {
    const raw = JSON.stringify({ name: "Acme", models: { planning: "m1" } });
    const out = JSON.parse(mergeModelsIntoManifest(raw, { planning: "" }));
    expect("models" in out).toBe(false);
    expect(out.name).toBe("Acme");
  });

  it("starts from {} on corrupt/empty manifest", () => {
    const out = JSON.parse(mergeModelsIntoManifest("", { planning: "m1" }));
    expect(out).toEqual({ models: { planning: "m1" } });
  });
});
