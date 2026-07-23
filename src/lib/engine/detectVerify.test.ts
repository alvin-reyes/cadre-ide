import { describe, it, expect } from "vitest";
import { detectVerifyCommand } from "./detectVerify";

describe("detectVerifyCommand", () => {
  it("uses the JS test script with the right runner from the lockfile", () => {
    const packageJson = JSON.stringify({ scripts: { test: "vitest run" } });
    expect(detectVerifyCommand({ packageJson })).toBe("npm test");
    expect(detectVerifyCommand({ packageJson, pnpmLock: true })).toBe("pnpm test");
    expect(detectVerifyCommand({ packageJson, yarnLock: true })).toBe("yarn test");
    expect(detectVerifyCommand({ packageJson, bunLock: true })).toBe("bun test");
  });

  it("ignores package.json with no test script", () => {
    expect(detectVerifyCommand({ packageJson: JSON.stringify({ scripts: { build: "x" } }) })).toBeNull();
  });

  it("detects Rust, Go, Python, and Makefile projects", () => {
    expect(detectVerifyCommand({ cargoToml: "[package]" })).toBe("cargo test");
    expect(detectVerifyCommand({ goMod: "module x" })).toBe("go test ./...");
    expect(detectVerifyCommand({ pyproject: "[tool.poetry]" })).toBe("pytest");
    expect(detectVerifyCommand({ makefile: "build:\n\tx\ntest:\n\tpytest" })).toBe("make test");
  });

  it("prefers a JS test script over other manifests", () => {
    const packageJson = JSON.stringify({ scripts: { test: "jest" } });
    expect(detectVerifyCommand({ packageJson, cargoToml: "[package]" })).toBe("npm test");
  });

  it("returns null when nothing is detectable and tolerates malformed json", () => {
    expect(detectVerifyCommand({})).toBeNull();
    expect(detectVerifyCommand({ packageJson: "{ not json" })).toBeNull();
  });
});
