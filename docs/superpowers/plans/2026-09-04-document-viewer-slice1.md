# Document Viewer Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PDF, Markdown, docx and image files viewable in Cadre's File view instead of failing on `read_to_string` or opening as binary in Monaco.

**Architecture:** A pure `viewerKind(path)` function in `src/lib/viewer/` decides which renderer a file gets; a single `DocViewer` component in `src/cadre/viewer/` dispatches to four leaf renderers. `pdfjs-dist` and `mammoth` are reached only through `await import()` so the already-oversized main bundle does not grow. `Workbench.tsx` gains one branch: unrecognised extensions keep today's Monaco path untouched.

**Tech Stack:** React 19, TypeScript (strict), Vite, Vitest (node env), Tauri v2 (Rust commands), `pdfjs-dist` ^6.3.289, `mammoth` ^1.12.2.

**Spec:** `docs/superpowers/specs/2026-09-03-document-viewer-slice1-design.md`

## Global Constraints

- **Vitest runs in the node environment over `src/**/*.test.ts` only.** There is no DOM and no `.test.tsx`. Component behaviour cannot be unit tested — put logic in `src/lib/` and test it there. Tasks 3–6 are verified by `npm run build` plus a manual check in the running app.
- **`tsconfig.json` sets `strict`, `noUnusedLocals`, `noUnusedParameters`.** An unused import fails `npm run build`, not just lint.
- **Errors surface through `reportError(source, err)`** from `src/lib/reportError.ts` — a toast *and* a persistent AI Log entry. Never swallow a failure.
- **Both parsers must be lazy** (`await import(...)` inside the leaf component). A static import is a plan violation: the main bundle is already 5.68 MB and Vite warns about it.
- **Commits are conventional with a scope**, e.g. `feat(viewer):`, `test(viewer):`, `fix(viewer):`.
- **New UI goes under `src/cadre/`.** `src/components/` is the legacy ADE tree — do not extend it, and do not delete `src/components/PreviewPanel.tsx` (explicit non-goal).
- **Do not modify `src/lib/engine/` or `src-tauri/src/cadre_state.rs`.** This slice is presentation only.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/viewer/viewerKind.ts` | **Create.** Pure format dispatch: `fileExt`, `viewerKind`, `imageMime`. |
| `src/lib/viewer/viewerKind.test.ts` | **Create.** Node tests for the above. |
| `src-tauri/src/lib.rs` | **Modify.** Size guard on `read_file_base64` + pure `check_viewer_size` helper + tests. |
| `src/cadre/viewer/DocViewer.tsx` | **Create.** Dispatch shell + shared file-loading hook. |
| `src/cadre/viewer/ImageView.tsx` | **Create.** Renders an image from a data URL. |
| `src/cadre/viewer/PdfView.tsx` | **Create.** Lazy `pdfjs-dist`, canvas page rendering, page nav. |
| `src/cadre/viewer/DocxView.tsx` | **Create.** Lazy `mammoth`, docx → HTML. |
| `src/cadre/Workbench.tsx` | **Modify.** Route by `viewerKind`; Markdown Source/Rendered toggle. |

---

### Task 1: Pure format dispatch

**Files:**
- Create: `src/lib/viewer/viewerKind.ts`
- Test: `src/lib/viewer/viewerKind.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ViewerKind = "pdf" | "markdown" | "docx" | "image" | "text"`; `fileExt(path: string): string`; `viewerKind(path: string): ViewerKind`; `imageMime(path: string): string`. Tasks 3–6 all import from here.

- [ ] **Step 1: Write the failing test**

Create `src/lib/viewer/viewerKind.test.ts`:

```ts
/**
 * viewerKind.test.ts — TDD for the pure viewer-dispatch module.
 *
 * Covers:
 *   - viewerKind: every supported extension, case-insensitivity, and the
 *     "text" fallback that preserves today's Monaco behaviour
 *   - .doc deliberately falling through to "text" (mammoth cannot read the
 *     legacy binary format; routing it to the docx viewer would surface an
 *     error that looks like a bug)
 *   - fileExt edge cases: dotfiles, no extension, a dot in a parent directory
 *   - imageMime: mapped types and the octet-stream fallback
 */
import { describe, it, expect } from "vitest";
import { fileExt, viewerKind, imageMime } from "./viewerKind";

describe("fileExt", () => {
  it("returns the lowercased extension", () => {
    expect(fileExt("/a/b/report.PDF")).toBe("pdf");
    expect(fileExt("notes.md")).toBe("md");
  });

  it("returns empty for a file with no extension", () => {
    expect(fileExt("/a/b/README")).toBe("");
  });

  it("treats a dotfile as having no extension", () => {
    expect(fileExt("/a/.gitignore")).toBe("");
  });

  it("ignores dots in parent directories", () => {
    expect(fileExt("/a.b/README")).toBe("");
    expect(fileExt("/a.b/notes.md")).toBe("md");
  });
});

describe("viewerKind", () => {
  it("routes PDFs", () => {
    expect(viewerKind("spec.pdf")).toBe("pdf");
    expect(viewerKind("SPEC.PDF")).toBe("pdf");
  });

  it("routes Markdown", () => {
    expect(viewerKind("readme.md")).toBe("markdown");
    expect(viewerKind("readme.markdown")).toBe("markdown");
  });

  it("routes docx", () => {
    expect(viewerKind("brief.docx")).toBe("docx");
  });

  it("routes images", () => {
    for (const p of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.svg", "a.webp", "a.bmp", "a.ico"]) {
      expect(viewerKind(p)).toBe("image");
    }
  });

  it("falls back to text for source files, so Monaco keeps them", () => {
    expect(viewerKind("src/main.tsx")).toBe("text");
    expect(viewerKind("Cargo.toml")).toBe("text");
    expect(viewerKind("/a/README")).toBe("text");
  });

  it("sends legacy .doc to text, not the docx viewer", () => {
    expect(viewerKind("old.doc")).toBe("text");
  });
});

describe("imageMime", () => {
  it("maps known image extensions", () => {
    expect(imageMime("a.png")).toBe("image/png");
    expect(imageMime("a.jpg")).toBe("image/jpeg");
    expect(imageMime("a.jpeg")).toBe("image/jpeg");
    expect(imageMime("a.svg")).toBe("image/svg+xml");
    expect(imageMime("a.ico")).toBe("image/x-icon");
  });

  it("falls back to octet-stream", () => {
    expect(imageMime("a.txt")).toBe("application/octet-stream");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/viewer/viewerKind.test.ts`
Expected: FAIL — `Failed to resolve import "./viewerKind"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/viewer/viewerKind.ts`:

```ts
/**
 * Which renderer a file gets in the File view.
 *
 * This lives in src/lib/ rather than in the component because vitest runs
 * node-only with no DOM — dispatch logic inside a .tsx file could not be
 * tested at all. "text" is the fallback so any unrecognised file keeps the
 * existing Monaco behaviour.
 */

export type ViewerKind = "pdf" | "markdown" | "docx" | "image" | "text";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

/** Lowercased extension of a path, or "" when there is none. */
export function fileExt(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  // dot === 0 is a dotfile (".gitignore"), not an extension.
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function viewerKind(path: string): ViewerKind {
  const ext = fileExt(path);
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  // Legacy binary .doc is NOT docx — mammoth cannot read it, so it falls
  // through to text rather than rendering an error that looks like a bug.
  if (ext === "docx") return "docx";
  if (ext in IMAGE_MIME) return "image";
  return "text";
}

/** MIME type for an image data: URL. */
export function imageMime(path: string): string {
  return IMAGE_MIME[fileExt(path)] ?? "application/octet-stream";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/viewer/viewerKind.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewer/viewerKind.ts src/lib/viewer/viewerKind.test.ts
git commit -m "feat(viewer): pure format dispatch (viewerKind/imageMime)"
```

---

### Task 2: Size guard on `read_file_base64`

**Files:**
- Modify: `src-tauri/src/lib.rs` (the `read_file_base64` command, currently ~line 284)

**Interfaces:**
- Consumes: nothing.
- Produces: `check_viewer_size(len: u64) -> Result<(), String>` (pure, testable); `read_file_base64` now returns `Err` for oversized files.

**Why:** `read_file_base64` reads a whole file and base64-encodes it, so a 50 MB PDF becomes a ~67 MB string crossing the IPC boundary and stalls the webview with no feedback. The guard turns a hang into a legible error.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod viewer_size_tests {
    use super::check_viewer_size;
    use super::MAX_VIEWER_BYTES;

    #[test]
    fn accepts_a_file_under_the_cap() {
        assert!(check_viewer_size(1024).is_ok());
        assert!(check_viewer_size(MAX_VIEWER_BYTES).is_ok());
    }

    #[test]
    fn rejects_a_file_over_the_cap() {
        let err = check_viewer_size(MAX_VIEWER_BYTES + 1).unwrap_err();
        // The message must name both numbers so the user knows how far over it is.
        assert!(err.contains("64"), "expected the cap in the message, got: {err}");
        assert!(err.to_lowercase().contains("too large"), "got: {err}");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml viewer_size`
Expected: FAIL — `cannot find function check_viewer_size in this scope`.

- [ ] **Step 3: Write minimal implementation**

In `src-tauri/src/lib.rs`, add above `read_file_base64`:

```rust
/// Cap on files the document viewer will load. base64 inflates by ~4/3 and the
/// whole string crosses the IPC boundary at once, so an unbounded read stalls
/// the webview with no feedback. A refusal the user can read beats a hang.
pub const MAX_VIEWER_BYTES: u64 = 64 * 1024 * 1024;

pub fn check_viewer_size(len: u64) -> Result<(), String> {
    if len > MAX_VIEWER_BYTES {
        return Err(format!(
            "File is too large to preview: {:.1} MB (limit {} MB)",
            len as f64 / 1_048_576.0,
            MAX_VIEWER_BYTES / 1_048_576
        ));
    }
    Ok(())
}
```

Then modify `read_file_base64` to check size before reading:

```rust
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let resolved = if path.starts_with("~/") {
        let home = get_home_dir();
        path.replacen("~", &home, 1)
    } else {
        path.clone()
    };
    // Check the size BEFORE reading, so an oversized file is never loaded at all.
    let meta = std::fs::metadata(&resolved)
        .map_err(|e| format!("Failed to stat {}: {}", resolved, e))?;
    check_viewer_size(meta.len())?;
    let bytes = std::fs::read(&resolved).map_err(|e| format!("Failed to read {}: {}", resolved, e))?;
    Ok(STANDARD.encode(bytes))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml viewer_size`
Expected: PASS, 2 tests.

Then confirm nothing else broke: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, 32 tests (30 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(viewer): cap read_file_base64 so a huge file cannot stall the webview"
```

---

### Task 3: DocViewer shell + ImageView

**Files:**
- Create: `src/cadre/viewer/DocViewer.tsx`
- Create: `src/cadre/viewer/ImageView.tsx`

**Interfaces:**
- Consumes: `viewerKind`, `imageMime` (Task 1); `read_file_base64` (Task 2); `Markdown` from `src/cadre/components/Markdown.tsx`; `reportError` from `src/lib/reportError.ts`.
- Produces: `<DocViewer path={string} />`; `useFileBase64(path: string)` returning `{ data: string | null; error: string | null; loading: boolean }`. Tasks 4–6 import `DocViewer`.

**Note:** No unit test — vitest has no DOM. Verified by build + manual check.

- [ ] **Step 1: Write ImageView**

Create `src/cadre/viewer/ImageView.tsx`:

```tsx
import { imageMime } from "../../lib/viewer/viewerKind";

/** Renders an image from base64 file bytes, letterboxed inside the pane. */
export function ImageView({ path, data }: { path: string; data: string }) {
  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--c-space-4)",
        background: "var(--c-surface-1)",
      }}
    >
      <img
        src={`data:${imageMime(path)};base64,${data}`}
        alt={path.split("/").pop() ?? "image"}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the DocViewer shell**

Create `src/cadre/viewer/DocViewer.tsx`:

```tsx
import { useEffect, useState, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { viewerKind } from "../../lib/viewer/viewerKind";
import { Markdown } from "../components/Markdown";
import { reportError } from "../../lib/reportError";
import { ImageView } from "./ImageView";

// pdf.js and mammoth are heavy. Loading them lazily keeps them out of the main
// bundle (already 5.68MB) so they cost nothing until a PDF or docx is opened.
const PdfView = lazy(() => import("./PdfView").then((m) => ({ default: m.PdfView })));
const DocxView = lazy(() => import("./DocxView").then((m) => ({ default: m.DocxView })));

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--c-text-faint)",
        fontSize: "var(--c-fs-sm)",
        padding: "var(--c-space-5)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

/** Load a file's bytes as base64. Errors surface as a toast + AI Log entry. */
function useFileBase64(path: string, enabled: boolean) {
  const [data, setData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setData(null);
    setError(null);
    invoke<string>("read_file_base64", { path })
      .then((b64) => {
        if (!cancelled) setData(b64);
      })
      .catch((e) => {
        if (cancelled) return;
        // reportError gives the toast + persistent log; keep a local copy for the pane.
        setError(reportError(`open ${path.split("/").pop()}`, e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);

  return { data, error };
}

/** Load a file as text. Used for Markdown. */
function useFileText(path: string, enabled: boolean) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setText(null);
    setError(null);
    invoke<string>("read_file", { path })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(reportError(`open ${path.split("/").pop()}`, e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);

  return { text, error };
}

/**
 * Renders a non-source file: PDF, Markdown, docx or image. Read-only — the
 * Markdown source path stays in Monaco (see Workbench).
 */
export function DocViewer({ path }: { path: string }) {
  const kind = viewerKind(path);
  const binary = kind === "pdf" || kind === "docx" || kind === "image";
  const { data, error: binErr } = useFileBase64(path, binary);
  const { text, error: txtErr } = useFileText(path, kind === "markdown");

  const error = binErr ?? txtErr;
  if (error) return <Centered><span style={{ color: "var(--c-danger)" }}>{error}</span></Centered>;

  if (kind === "markdown") {
    if (text === null) return <Centered>Loading…</Centered>;
    return (
      <div style={{ height: "100%", overflow: "auto", padding: "var(--c-space-5)" }}>
        <Markdown content={text} className="cadre-doc" />
      </div>
    );
  }

  if (data === null) return <Centered>Loading…</Centered>;
  if (kind === "image") return <ImageView path={path} data={data} />;

  return (
    <Suspense fallback={<Centered>Loading viewer…</Centered>}>
      {kind === "pdf" ? <PdfView data={data} /> : <DocxView data={data} />}
    </Suspense>
  );
}
```

- [ ] **Step 3: Create placeholder leaves so the build resolves**

`PdfView` and `DocxView` are implemented in Tasks 4 and 5, but `DocViewer` imports them now. Create minimal stubs so `npm run build` passes:

`src/cadre/viewer/PdfView.tsx`:

```tsx
export function PdfView({ data }: { data: string }) {
  return <div>PDF viewer not implemented yet ({data.length} bytes of base64)</div>;
}
```

`src/cadre/viewer/DocxView.tsx`:

```tsx
export function DocxView({ data }: { data: string }) {
  return <div>docx viewer not implemented yet ({data.length} bytes of base64)</div>;
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: PASS. If it fails on an unused import, remove it — `noUnusedLocals` is enforced.

- [ ] **Step 5: Commit**

```bash
git add src/cadre/viewer/
git commit -m "feat(viewer): DocViewer shell with image and markdown rendering"
```

---

### Task 4: PdfView

**Files:**
- Modify: `src/cadre/viewer/PdfView.tsx` (replace the Task 3 stub)
- Modify: `package.json` (add `pdfjs-dist`)

**Interfaces:**
- Consumes: base64 file bytes as `data: string`.
- Produces: `<PdfView data={string} />` with page navigation.

- [ ] **Step 1: Install the dependency**

```bash
npm install pdfjs-dist@^6.3.289
```

- [ ] **Step 2: Implement PdfView**

Replace `src/cadre/viewer/PdfView.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { reportError } from "../../lib/reportError";

/** base64 → bytes, for handing the raw PDF to pdf.js. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Renders a PDF with pdf.js. Bundled rather than using the webview's native
 * viewer because WebKitGTK (Linux) has none — <embed> would leave PDFs broken
 * there — and native chrome cannot follow the app's theme tokens.
 */
export function PdfView({ data }: { data: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // Holds the loaded PDFDocumentProxy between renders without re-parsing.
  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);

  // Parse the document once per file.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Vite resolves ?url to an emitted asset path; pdf.js needs its worker
        // as a separate file or it silently falls back to (much slower) main-thread parsing.
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjs.getDocument({ data: base64ToBytes(data) }).promise;
        if (cancelled) return;
        docRef.current = doc as never;
        setPageCount(doc.numPages);
        setPage(1);
      } catch (e) {
        if (!cancelled) setError(reportError("render pdf", e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  // Draw the current page.
  useEffect(() => {
    const doc = docRef.current as { getPage: (n: number) => Promise<never> } | null;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageCount === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const pg = await doc.getPage(page);
        if (cancelled) return;
        const viewport = (pg as { getViewport: (o: { scale: number }) => { width: number; height: number } }).getViewport({ scale: 1.5 });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await (pg as { render: (o: unknown) => { promise: Promise<void> } }).render({ canvasContext: ctx, viewport, canvas }).promise;
      } catch (e) {
        if (!cancelled) setError(reportError("render pdf page", e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, pageCount]);

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-danger)", fontSize: "var(--c-fs-sm)", padding: "var(--c-space-5)" }}>
        {error}
      </div>
    );
  }

  const btn = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: "var(--c-radius-sm)",
    background: "transparent",
    border: "1px solid var(--c-border)",
    color: "var(--c-text-muted)",
    cursor: "pointer",
  } as const;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--c-surface-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px var(--c-space-3)", borderBottom: "1px solid var(--c-border)", flexShrink: 0 }}>
        <button style={btn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft size={13} strokeWidth={2} />
        </button>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", fontFamily: "var(--c-font-mono)" }}>
          {pageCount === 0 ? "…" : `${page} / ${pageCount}`}
        </span>
        <button style={btn} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} aria-label="Next page">
          <ChevronRight size={13} strokeWidth={2} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", padding: "var(--c-space-4)" }}>
        <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "fit-content", boxShadow: "0 1px 8px rgba(0,0,0,0.18)" }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: PASS, and the output should list a **separate** `pdf`-related chunk. If `pdfjs` bytes land in `index-*.js`, the lazy import was defeated — check that no other file statically imports `PdfView`.

- [ ] **Step 4: Verify manually**

Run `npm run tauri dev`, open the File view, click a `.pdf`. Expected: page 1 renders, arrows move between pages. If the page is blank, open devtools and check for a worker 404 — that means the `?url` import did not resolve.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/cadre/viewer/PdfView.tsx
git commit -m "feat(viewer): render PDFs with lazy-loaded pdf.js"
```

---

### Task 5: DocxView

**Files:**
- Modify: `src/cadre/viewer/DocxView.tsx` (replace the Task 3 stub)
- Modify: `package.json` (add `mammoth`)

**Interfaces:**
- Consumes: base64 file bytes as `data: string`.
- Produces: `<DocxView data={string} />`.

- [ ] **Step 1: Install the dependency**

```bash
npm install mammoth@^1.12.2
```

- [ ] **Step 2: Implement DocxView**

Replace `src/cadre/viewer/DocxView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { reportError } from "../../lib/reportError";

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Renders a .docx by converting it to HTML with mammoth. Only Word's own
 * semantic styles survive the conversion — this is a reading view, not a
 * fidelity-preserving renderer.
 */
export function DocxView({ data }: { data: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The browser build — the default entry pulls in Node-only deps.
        const mammoth = await import("mammoth/mammoth.browser.js");
        const result = await mammoth.convertToHtml({ arrayBuffer: base64ToArrayBuffer(data) });
        if (!cancelled) setHtml(result.value);
      } catch (e) {
        if (!cancelled) setError(reportError("render docx", e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-danger)", fontSize: "var(--c-fs-sm)", padding: "var(--c-space-5)" }}>
        {error}
      </div>
    );
  }
  if (html === null) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text-faint)", fontSize: "var(--c-fs-sm)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "var(--c-space-5)" }}>
      {/* mammoth emits a constrained HTML subset from a local file the user chose to open. */}
      <div className="cadre-doc" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
```

- [ ] **Step 3: Handle the type declaration**

`mammoth/mammoth.browser.js` may have no bundled types, which fails `strict`. If `npm run build` reports "Could not find a declaration file", create `src/types/mammoth-browser.d.ts`:

```ts
declare module "mammoth/mammoth.browser.js" {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: PASS, with a separate mammoth chunk.

- [ ] **Step 5: Verify manually**

Run `npm run tauri dev`, open a `.docx`. Expected: readable text with headings and lists. If the import path fails at runtime, try `await import("mammoth")` instead and re-verify — the browser-build path differs between mammoth releases.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/cadre/viewer/DocxView.tsx src/types/
git commit -m "feat(viewer): render .docx with lazy-loaded mammoth"
```

---

### Task 6: Wire into the Workbench

**Files:**
- Modify: `src/cadre/Workbench.tsx`

**Interfaces:**
- Consumes: `viewerKind` (Task 1), `DocViewer` (Task 3).
- Produces: the finished feature.

- [ ] **Step 1: Add imports and view state**

In `src/cadre/Workbench.tsx`, add to the imports:

```tsx
import { viewerKind } from "../lib/viewer/viewerKind";
import { DocViewer } from "./viewer/DocViewer";
import { Eye, Code2 } from "lucide-react";
```

Inside the component, after the existing `const [gotoLine, setGotoLine] = ...`:

```tsx
// Markdown opens rendered (reading is the common case) but stays editable via
// this toggle — the Source pane is the unchanged Monaco + Cmd+S flow.
const [mdSource, setMdSource] = useState(false);
const kind = openPath ? viewerKind(openPath) : "text";
const isMarkdown = kind === "markdown";
// Markdown in Source mode is the only non-"text" kind that still uses Monaco.
const usesEditor = kind === "text" || (isMarkdown && mdSource);
```

- [ ] **Step 2: Reset the toggle when the file changes**

A `.md` left in Source mode must not force the next `.md` open in Source. In `openFile`, after `setOpenPath(path)`, add:

```tsx
setMdSource(false);
```

- [ ] **Step 3: Guard the read for binary files**

`openFile` calls `read_file` unconditionally, which throws on a PDF. Replace the body of `openFile`'s `try` block with:

```tsx
      // Binary formats are read by DocViewer itself (read_file_base64);
      // read_file would fail here on invalid UTF-8.
      const text = viewerKind(path) === "text" || viewerKind(path) === "markdown"
        ? await invoke<string>("read_file", { path })
        : "";
      setOpenPath(path);
      setMdSource(false);
      setContent(text);
      setSaved(text);
      setError(null);
```

- [ ] **Step 4: Hide Save for read-only kinds and add the Markdown toggle**

Replace the Save `<button>` block with:

```tsx
        {isMarkdown && (
          <button
            onClick={() => setMdSource((v) => !v)}
            title={mdSource ? "Show rendered Markdown" : "Edit Markdown source"}
            aria-pressed={mdSource}
            className="cadre-hover"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--c-fs-xs)", fontWeight: 550 as const, padding: "4px 10px", borderRadius: "var(--c-radius-sm)", background: "transparent", color: "var(--c-text-muted)", border: "1px solid var(--c-border)", cursor: "pointer" }}
          >
            {mdSource ? <Eye size={12} strokeWidth={2} /> : <Code2 size={12} strokeWidth={2} />}
            {mdSource ? "Rendered" : "Source"}
          </button>
        )}
        {usesEditor && (
          <button
            onClick={save}
            disabled={!dirty}
            title="Save (Ctrl/Cmd+S)"
            aria-label="Save file"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "4px 10px",
              borderRadius: "var(--c-radius-sm)",
              background: dirty ? "var(--c-accent)" : "var(--c-surface-2)",
              color: dirty ? "var(--c-on-accent)" : "var(--c-text-muted)",
              border: "none",
              cursor: dirty ? "pointer" : "default",
            }}
          >
            <Save size={12} strokeWidth={2} />
            Save
          </button>
        )}
```

- [ ] **Step 5: Route the editor pane**

Replace the `{openPath ? (<MonacoWrapper ... />) : (...)}` block with:

```tsx
          {!openPath ? (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text-faint)", fontSize: "var(--c-fs-sm)", textAlign: "center", padding: "var(--c-space-5)" }}>
              Select a file in the tree to view and edit it.
            </div>
          ) : usesEditor ? (
            <MonacoWrapper
              filePath={openPath}
              content={content}
              onChange={setContent}
              onSave={save}
              theme={theme === "light" ? "vs" : "vs-dark"}
              gotoLine={gotoLine}
            />
          ) : (
            <DocViewer path={openPath} />
          )}
```

- [ ] **Step 6: Verify the build and the full suite**

Run: `npm run build && npm test`
Expected: both PASS. `noUnusedLocals` will flag any import left over from the edit.

- [ ] **Step 7: Verify manually**

Run `npm run tauri dev` and confirm each case:
- A `.ts` file → Monaco, Save present, `Cmd+S` works (unchanged).
- A `.md` file → rendered, with mermaid diagrams drawn; Source toggle switches to Monaco; edit + `Cmd+S` saves; toggling back shows the edit.
- A `.png` → renders. A `.pdf` → renders with page nav. A `.docx` → renders text.
- Switching from an edited `.ts` to a `.pdf` → still prompts about discarding changes.

- [ ] **Step 8: Commit**

```bash
git add src/cadre/Workbench.tsx
git commit -m "feat(viewer): route the File view by format, markdown rendered by default"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Pure core (`viewerKind`, `imageMime`) | Task 1 |
| §2 DocViewer + lazy parsers | Tasks 3, 4, 5 |
| §3 Workbench wiring + Markdown toggle | Task 6 |
| §4 Size guard | Task 2 |
| Testing strategy (node tests + Rust test) | Tasks 1, 2 |
| Non-goals (no extraction, no `.doc`, PreviewPanel untouched) | Respected — `.doc` asserted as `"text"` in Task 1 |

**Type consistency:** `ViewerKind` is defined once (Task 1) and consumed unchanged in Tasks 3 and 6. `PdfView`/`DocxView` both take `{ data: string }`, matching the stubs in Task 3 and the `DocViewer` call sites. `check_viewer_size` is named identically in the implementation and the test.

**Known risk, called out rather than hidden:** the `mammoth/mammoth.browser.js` import path and the `pdfjs-dist/build/pdf.worker.mjs?url` path are version-sensitive. Both tasks include an explicit verification step and a fallback, because a wrong path fails at runtime rather than at build time.
