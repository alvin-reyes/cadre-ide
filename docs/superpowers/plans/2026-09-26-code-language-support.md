# Code Language Support — Implementation Plan

Spec: `docs/superpowers/specs/2026-09-26-code-language-support-design.md`

1. **`src/lib/editor/languages.ts` + test.** Move `EXT_TO_LANGUAGE` out of `MonacoWrapper.tsx`;
   add `languageForPath(path, firstLine?)` (ext → basename → shebang) and
   `languageForFence(info)` (alias table, `curl` → `shell`, unknown → `null`).
2. **`src/lib/editor/segments.ts` + test.** Pure: `tokenClass(type)` and
   `lineSegments(line, tokens)` → `{ text, cls }[]` sliced from the original line.
3. **`MonacoWrapper.tsx`** uses `languageForPath(filePath, firstLine(content))`.
4. **`src/lib/editor/highlight.ts`** (Monaco glue, not unit-tested): `highlightCodeBlock(codeEl, lang)`
   — await grammar load, `monaco.editor.tokenize`, rebuild the `<code>` children from segments.
5. **`Markdown.tsx`**: after `marked.parse`, highlight every non-mermaid `code[class*=language-]`
   whose fence resolves; skip if the effect was cancelled.
6. **`tokens.css`**: `--c-syn-*` tokens (dark + light) and `.cadre-syn-*` classes.
7. Verify: `npm run build`, `npm run test`, all demo e2e scripts; a Playwright probe rendering a
   Markdown doc with go/rust/ts/python/bash/curl fences and asserting spans + exact `textContent`.
