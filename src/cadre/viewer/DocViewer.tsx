import { useEffect, useState, lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { viewerKind } from "../../lib/viewer/viewerKind";
import { Markdown } from "../components/Markdown";
import { reportError } from "../../lib/reportError";
import { ImageView } from "./ImageView";

// pdf.js and mammoth are heavy. Loading them lazily keeps them out of the main
// bundle (already 5.68MB) so they cost nothing until a PDF or docx is opened.
const PdfView = lazy(() => import("./PdfView").then((m) => ({ default: m.PdfView })));
const DocxView = lazy(() => import("./DocxView").then((m) => ({ default: m.DocxView })));

function Centered({ children }: { children: ReactNode }) {
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
