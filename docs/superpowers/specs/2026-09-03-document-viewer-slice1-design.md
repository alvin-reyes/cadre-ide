# Document Viewer — Slice 1 (Design)

**Date:** 2026-09-03
**Status:** Approved for planning
**Scope:** Read-only rendering of PDF, Markdown, docx and images wherever a file is opened. Extraction-to-agent-context is explicitly Slice 2.

## Problem

`src/cadre/Workbench.tsx` opens **every** file the same way: `invoke("read_file")` → `std::fs::read_to_string` → Monaco. That is correct for source, and wrong for everything else:

- A **PDF**, **docx**, or **image** is not UTF-8. `read_to_string` errors, and the File view shows `Failed to read …` — the file is simply unopenable inside Cadre.
- **Markdown** opens as raw source. Specs, plans and agent-authored reports — the documents this project generates constantly — are read unrendered, with ```mermaid fences shown as code.

The pieces to fix this already exist but are not wired together: `read_file_base64` (`src-tauri/src/lib.rs:284`) reads arbitrary bytes; `src/cadre/components/Markdown.tsx` renders Markdown with marked + mermaid; and `src/components/PreviewPanel.tsx` implements image/PDF/markdown preview — but it lives in the **legacy ADE tree**, unreachable from `main.tsx`, and carries its own hand-rolled regex Markdown renderer that duplicates (worse) what `Markdown.tsx` already does.

Four use cases were confirmed, and they are why this is one shared component rather than a File-view feature: reviewing agent output, reading reference docs, Maintain-mode task attachments, and (Slice 2) feeding documents to agents.

## Decisions settled

1. **Bundled renderers, lazy-loaded** — `pdf.js` for PDF, `mammoth` for docx. Not the native webview: WebKitGTK has no PDF viewer, so `<embed>` would leave PDFs broken on Linux, and platform-native chrome cannot be themed to the app tokens. Consistency matters for a product being sold.
2. **Markdown defaults to rendered**, with a Source/Rendered toggle. Editing and `Cmd+S` continue to work unchanged in the Source pane.
3. **View only.** No text extraction, no agent plumbing. The chosen parsers expose `getTextContent()` and `extractRawText()`, so Slice 2 is additive rather than a rewrite.
4. **No new Rust.** `read_file_base64` already returns arbitrary bytes; the only Rust change is a size guard (§4).

## Architecture

### 1. Pure core (`src/lib/viewer/viewerKind.ts`)

Vitest runs **node-only over `src/**/*.test.ts`** — there is no DOM and no `.test.tsx`. So the dispatch decision must be a pure function outside the component, or it cannot be tested at all.

```ts
export type ViewerKind = "pdf" | "markdown" | "docx" | "image" | "text";

/** Which viewer renders this path. Extension-based; unknown → "text" (Monaco). */
export function viewerKind(path: string): ViewerKind;

/** MIME type for a data: URL, used by the image viewer. */
export function imageMime(path: string): string;
```

`viewerKind` owns the whole extension table (`.pdf`; `.md`/`.markdown`; `.docx`; `.png`/`.jpg`/`.jpeg`/`.gif`/`.svg`/`.webp`/`.bmp`/`.ico`). Anything unrecognised falls through to `"text"`, so today's Monaco behaviour remains the default and no existing file type regresses.

**`.doc` is deliberately not `"docx"`.** Legacy binary Word is a different format that mammoth cannot read; it falls through to `"text"` rather than rendering an error that looks like a bug.

### 2. The viewer component (`src/cadre/viewer/DocViewer.tsx`)

One component, one prop contract, embeddable by any surface:

```tsx
<DocViewer path={string} onError={(e: unknown) => void} />
```

It calls `viewerKind(path)` and renders the matching leaf: `PdfView`, `DocxView`, `ImageView`, or `Markdown` (the existing component — reused, not reimplemented). Each leaf owns its own loading and error state. `DocViewer` holds no lifecycle logic and no Tauri calls beyond reading the file, keeping it a presentation component.

**Both parsers are lazy.** `pdf.js` and `mammoth` are reached only through `await import(...)` inside the leaf that needs them. The main bundle is already 5.68 MB (1.49 MB gzipped) and Vite warns about it; a static import would make a documented problem worse for a feature most sessions never touch.

### 3. Wiring into the Workbench

`Workbench.openFile` currently sets `content` and hands it to Monaco unconditionally. It gains one branch:

- `viewerKind(path) === "text"` → today's path exactly, unchanged.
- Markdown → `DocViewer` rendered, with a Source/Rendered toggle in the existing header. Source mounts the current Monaco editor with the current save flow; the dirty dot and `Cmd+S` keep working.
- `pdf` / `docx` / `image` → `DocViewer`, and the Save button is hidden rather than disabled — these are not editable, and a permanently greyed control is noise.

The dirty-state guard in `openFile` still runs first, so switching from an edited file to a PDF cannot silently discard changes.

### 4. Size guard (`read_file_base64`)

`read_file_base64` reads a whole file and base64-encodes it — a 50 MB PDF becomes a ~67 MB string crossing the IPC boundary, which stalls the webview with no feedback. It gains a limit:

```rust
const MAX_VIEWER_BYTES: u64 = 64 * 1024 * 1024;
```

Oversized files are refused with a message naming the actual size and the cap. This is a real failure surfaced as a real error, per the errors-are-never-silent convention — `reportError()` on the frontend side, so it lands as a toast **and** an AI Log entry.

## Data flow

```
FileTree click
  └─> Workbench.openFile(path)
        └─> viewerKind(path)
              ├─ "text"                    -> read_file       -> Monaco            (unchanged)
              ├─ "markdown"                -> read_file       -> Markdown | Monaco  (toggle)
              ├─ "image"                   -> read_file_base64 -> <img src=data:>
              ├─ "pdf"                     -> read_file_base64 -> await import("pdfjs-dist")
              └─ "docx"                    -> read_file_base64 -> await import("mammoth")
```

## Safety / invariants

- **No engine changes.** This is presentation only. Nothing here touches `src/lib/engine/`, the Rust state machine, or story status — the viewer cannot affect the "engine writes Done" invariant.
- **No new write paths.** Every format except Markdown is strictly read-only; Markdown writes through the existing `write_text_file` flow, unmodified.
- **Demo mode must keep working.** `src/lib/demo/mockBackend.ts` already handles `read_file_base64`; the new size guard is Rust-side only, so the mock needs no change.

## Testing strategy

Node-environment unit tests over the pure core, which is where the real branching lives:

- `viewerKind` — every extension in the table, uppercase extensions (`.PDF`), no extension, dotfiles, a path whose *directory* contains a dot (`/a.b/README`), and `.doc` falling through to `"text"`.
- `imageMime` — each mapped extension, and the unknown fallback.
- Rust: `read_file_base64` refuses a file over the cap and accepts one under it.

UI behaviour is covered by the Playwright demo scripts, per the existing convention.

## Non-goals (Slice 1)

- Text extraction and any agent-context plumbing (Slice 2).
- Editing PDF, docx or images.
- `.doc`, `.xlsx`, `.pptx`, video, audio.
- PDF search, annotation, or printing. Page navigation and zoom only.
- Replacing or deleting the legacy `src/components/PreviewPanel.tsx` — it is unreachable dead code; removing it is unrelated cleanup and does not belong in this slice.

## Open confirmations (non-blocking)

- **First-release version.** `v0.12.0` was assumed to match `tauri.conf.json`; unrelated to this slice but noted since both land near the same tag.
- **Maintain-cockpit embedding** is in scope as a consumer of `DocViewer`, but the exact placement in the task cockpit is left to the implementation plan.
