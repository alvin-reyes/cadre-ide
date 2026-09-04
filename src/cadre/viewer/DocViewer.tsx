import { useEffect, useState, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { viewerKind } from "../../lib/viewer/viewerKind";
import { Markdown } from "../components/Markdown";
import { reportError } from "../../lib/reportError";
import { ImageView } from "./ImageView";
import { Centered } from "./shared";

// pdf.js and mammoth are heavy. Loading them lazily keeps them out of the main
// bundle (already 5.68MB) so they cost nothing until a PDF or docx is opened.
const PdfView = lazy(() => import("./PdfView").then((m) => ({ default: m.PdfView })));
const DocxView = lazy(() => import("./DocxView").then((m) => ({ default: m.DocxView })));

/** Load a file's bytes as base64. Errors surface as a toast + AI Log entry. */
function useFileBase64(path: string, enabled: boolean) {
  const [data, setData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Clear stale state from a previously-viewed file BEFORE bailing out on
    // `enabled` — otherwise an error left over from e.g. an oversized PDF
    // stays set (binErr) and renders on top of every markdown file opened
    // afterwards, since it never gets a chance to be cleared for this format.
    if (!enabled) {
      setData(null);
      setError(null);
      return;
    }
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

/**
 * Load a file as text. Used for Markdown.
 *
 * When `text` is supplied (the live editor buffer, from Workbench), it is
 * used directly and no `read_file` invoke happens at all — avoids reading
 * the same bytes over IPC twice, and keeps the rendered view in sync with
 * unsaved edits instead of showing what's on disk.
 */
function useFileText(path: string, enabled: boolean, text?: string) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (text !== undefined) {
      setLoaded(text);
      setError(null);
      return;
    }
    // Same ordering fix as useFileBase64: clear stale state before bailing.
    if (!enabled) {
      setLoaded(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoaded(null);
    setError(null);
    invoke<string>("read_file", { path })
      .then((t) => {
        if (!cancelled) setLoaded(t);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(reportError(`open ${path.split("/").pop()}`, e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, enabled, text]);

  return { text: loaded, error };
}

/**
 * Renders a non-source file: PDF, Markdown, docx or image. Read-only — the
 * Markdown source path stays in Monaco (see Workbench).
 *
 * `text`, when supplied, is the caller's already-in-memory buffer for `path`
 * (Workbench passes the live editor content for markdown) — see useFileText.
 */
export function DocViewer({ path, text }: { path: string; text?: string }) {
  const kind = viewerKind(path);
  const binary = kind === "pdf" || kind === "docx" || kind === "image";
  const { data, error: binErr } = useFileBase64(path, binary);
  const { text: mdText, error: txtErr } = useFileText(path, kind === "markdown", text);

  const error = binErr ?? txtErr;
  if (error) return <Centered color="var(--c-danger)">{error}</Centered>;

  if (kind === "markdown") {
    if (mdText === null) return <Centered>Loading…</Centered>;
    return (
      <div style={{ height: "100%", overflow: "auto", padding: "var(--c-space-5)" }}>
        <Markdown content={mdText} className="cadre-doc" />
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
