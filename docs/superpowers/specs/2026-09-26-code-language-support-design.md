# Code Language Support: Editor + Rendered Markdown (Design)

**Date:** 2026-09-26
**Status:** Approved for planning
**Scope:** First-class Go, Rust, TypeScript, Python, Bash/shell and curl in (a) the Monaco file
editor and (b) fenced code blocks in rendered Markdown. Presentation only — no engine, state
machine, or Tauri changes.

## Problem

Two different surfaces show code, and they disagree:

| Surface | Today |
|---|---|
| Monaco file editor (`Workbench` → `MonacoWrapper`) | Highlights `.go` `.rs` `.ts` `.py` `.sh`, but detection is extension-only: `.mts/.cts/.mjs/.cjs`, `.pyi`, `.bashrc`/`.zshrc`/`.profile`, and extensionless scripts with a `#!/usr/bin/env python3` or `#!/bin/bash` shebang all open as plain text. `toml` maps to a language id Monaco doesn't have (silent plain text), and `.lock` → `json` mis-highlights `Cargo.lock` (TOML). |
| Rendered Markdown (`components/Markdown.tsx`: plan docs, story view, doc viewer, copilot chat) | **No highlighting at all.** ```` ```go ````, ```` ```rust ````, ```` ```bash ````, ```` ```curl ```` all render monochrome. The planning personas and agents emit exactly these fences constantly. |

The detection table also lives inside a `.tsx` component, so it has no tests (vitest is node-only).

## Decisions

1. **One language table in `src/lib/editor/languages.ts`**, pure and unit-tested, used by both
   surfaces: `languageForPath(path, firstLine?)` for files (extension → basename → shebang) and
   `languageForFence(info)` for Markdown info strings (aliases: `golang`, `rs`, `tsx`, `py`,
   `python3`, `sh`, `zsh`, `console`, `curl`, …). Unknown fences return `null` and stay plain.

2. **`curl` is shell.** There is no curl grammar; a curl snippet *is* a shell command line
   (flags, quoted JSON bodies, `\` continuations, `$VARS`), and Monaco's shell tokenizer handles it.
   `.curl` files map the same way.

3. **Reuse Monaco's tokenizers for Markdown — no new dependency.** Monaco is already in the main
   chunk (`main.tsx` imports `monacoSetup`), and its grammars are what the editor uses, so a
   snippet looks the same in a doc and in the file.

4. **Tokenize, don't `colorize()`.** `monaco.editor.colorize()` returns HTML in which every space
   and tab is a U+00A0 non-breaking space (`viewLineRenderer.js`). A copied `curl … -H 'x: y'`
   then fails in a real shell, and Go tabs are lost. Instead: `monaco.editor.tokenize()` gives
   `(offset, type)` per line; we slice the **original text** into `<span>`s via `textContent`.
   Copy is byte-identical, and there is no HTML string to escape.
   `colorize("", lang)` is still awaited once per language purely to force Monaco's lazy grammar
   load (its public API exposes no other "wait until tokenizer ready").

5. **Colours are design tokens, not Monaco's theme.** Token types (`keyword.go`, `string.sh`, …)
   collapse to a small set of classes (`keyword`, `string`, `number`, `comment`, `type`,
   `variable`, `operator`, `tag`, `attribute`, `regexp`), styled by `--c-syn-*` tokens with a
   light-theme override. This follows the app theme with no global `monaco.editor.setTheme()`
   side effect on open editors, and keeps to the restrained palette (violet keywords, the rest
   muted).

6. **Small file-editor fixes ride along**: `toml` and `Cargo.lock` → Monaco's `ini` (sections,
   `key = value`, `#` comments: the closest shipped grammar); other `.lock` → plain text.

## Non-goals

- Language servers / IntelliSense for Go, Rust, Python (Monaco only ships TS/JSON/CSS/HTML workers).
- Highlighting inside the legacy `src/components/` Markdown renderers.
- A "copy" button on code blocks (worth doing; separate slice).

## Testing

- `languages.test.ts`: every requested language via extension, basename, shebang, and fence alias;
  `curl` → shell; unknown → `plaintext` / `null`; shebang ignored when an extension already decides.
- `segments.test.ts`: token → class mapping; slicing preserves text exactly (tabs, spaces,
  unicode), including empty lines and a token stream that starts past offset 0.
- Demo-mode e2e scripts must still pass with 0 console errors (Markdown renders on the Plan and
  Execute paths).
