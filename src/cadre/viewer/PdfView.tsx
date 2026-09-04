import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { reportError } from "../../lib/reportError";
import type { PDFDocumentProxy } from "pdfjs-dist";

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
  const docRef = useRef<PDFDocumentProxy | null>(null);

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
        docRef.current = doc;
        setPageCount(doc.numPages);
        setPage(1);
      } catch (e) {
        if (!cancelled) setError(reportError("render pdf", e));
      }
    })();
    return () => {
      cancelled = true;
      docRef.current?.loadingTask.destroy();
      docRef.current = null;
    };
  }, [data]);

  // Draw the current page.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageCount === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const pg = await doc.getPage(page);
        if (cancelled) return;
        const viewport = pg.getViewport({ scale: 1.5 });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pg.render({ canvasContext: ctx, viewport, canvas }).promise;
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
