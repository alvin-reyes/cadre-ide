import { describe, it, expect } from "vitest";
import { languageForPath, languageForFence } from "./languages";

describe("languageForPath", () => {
  it.each([
    ["cmd/server/main.go", "go"],
    ["src-tauri/src/pty.rs", "rust"],
    ["src/lib/engine/dispatch.ts", "typescript"],
    ["src/cadre/Workbench.tsx", "typescript"],
    ["vite.config.mts", "typescript"],
    ["tools/gen.py", "python"],
    ["stubs/api.pyi", "python"],
    ["scripts/setup.sh", "shell"],
    ["scripts/setup.bash", "shell"],
    ["requests/create-user.curl", "shell"],
    ["Cargo.toml", "ini"],
  ])("%s → %s", (path, lang) => {
    expect(languageForPath(path)).toBe(lang);
  });

  it("matches known basenames, case-insensitively", () => {
    expect(languageForPath("/home/me/.zshrc")).toBe("shell");
    expect(languageForPath("/home/me/.bashrc")).toBe("shell");
    expect(languageForPath("docker/Dockerfile")).toBe("dockerfile");
    // Cargo.lock is TOML, not the JSON a generic `.lock` guess would give it.
    expect(languageForPath("src-tauri/Cargo.lock")).toBe("ini");
  });

  it("falls back to the shebang for extensionless scripts", () => {
    expect(languageForPath("bin/deploy", "#!/usr/bin/env bash")).toBe("shell");
    expect(languageForPath("bin/deploy", "#!/bin/sh")).toBe("shell");
    expect(languageForPath("bin/tool", "#!/usr/bin/env python3")).toBe("python");
    expect(languageForPath("bin/cli", "#!/usr/bin/env node")).toBe("javascript");
    expect(languageForPath("bin/cli", "#!/usr/bin/env -S npx tsx")).toBe("typescript");
  });

  it("lets the extension win over a shebang", () => {
    expect(languageForPath("run.py", "#!/bin/bash")).toBe("python");
  });

  it("is plaintext for unknown files and non-shebang first lines", () => {
    expect(languageForPath("notes.txt")).toBe("plaintext");
    expect(languageForPath("yarn.lock")).toBe("plaintext");
    expect(languageForPath(".gitignore")).toBe("plaintext");
    expect(languageForPath("README", "# bash tips")).toBe("plaintext");
  });
});

describe("languageForFence", () => {
  it.each([
    ["go", "go"], ["golang", "go"],
    ["rust", "rust"], ["rs", "rust"],
    ["ts", "typescript"], ["typescript", "typescript"], ["tsx", "typescript"],
    ["python", "python"], ["py", "python"], ["python3", "python"],
    ["bash", "shell"], ["sh", "shell"], ["shell", "shell"], ["zsh", "shell"], ["console", "shell"],
    ["curl", "shell"],
  ])("```%s → %s", (info, lang) => {
    expect(languageForFence(info)).toBe(lang);
  });

  it("uses only the first word and ignores case and attributes", () => {
    expect(languageForFence("Bash title=\"install\"")).toBe("shell");
    expect(languageForFence("  TS ")).toBe("typescript");
    expect(languageForFence("go{linenos}")).toBe("go");
  });

  it("returns null for unknown or empty fences so they stay plain", () => {
    expect(languageForFence("brainfuck")).toBeNull();
    expect(languageForFence("")).toBeNull();
    // mermaid is rendered as a diagram, never tokenized.
    expect(languageForFence("mermaid")).toBeNull();
  });
});
