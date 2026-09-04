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
        // The browser build — the default entry (lib/index.js) pulls in
        // Node-only deps (fs, path) that don't resolve in the webview.
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
