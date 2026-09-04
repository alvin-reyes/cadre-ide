import { useEffect, useState } from "react";
import { reportError } from "../../lib/reportError";
import { base64ToBytes, Centered } from "./shared";

const SAFE_HREF_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * mammoth escapes text and attribute *values*, but does not vet hyperlink
 * schemes — a crafted .docx can carry a `javascript:` URI in an `<a href>`.
 * That matters more here than an ordinary XSS sink: `tauri.conf.json` sets
 * `"csp": null`, so a clicked payload runs on the same origin as Tauri IPC
 * and can reach `invoke`. Rewrite anything outside the allowlist (http,
 * https, mailto, and in-document `#` anchors) before the HTML ever touches
 * the DOM. Uses the browser's own DOMParser rather than a new dependency.
 */
function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) continue; // in-document bookmark/anchor — safe
    let safe = false;
    try {
      // Resolved against an opaque base so a bare "javascript:..." reports
      // its own scheme instead of being treated as a relative path.
      safe = SAFE_HREF_SCHEMES.has(new URL(href, "about:blank").protocol);
    } catch {
      safe = false;
    }
    if (!safe) a.removeAttribute("href");
  }
  return doc.body.innerHTML;
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
        // `.buffer` is exactly the file's bytes (base64ToBytes allocates a
        // fresh, unshared Uint8Array), so this cast is safe.
        const result = await mammoth.convertToHtml({ arrayBuffer: base64ToBytes(data).buffer as ArrayBuffer });
        if (!cancelled) setHtml(sanitizeHtml(result.value));
      } catch (e) {
        if (!cancelled) setError(reportError("render docx", e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error) return <Centered color="var(--c-danger)">{error}</Centered>;
  if (html === null) return <Centered>Loading…</Centered>;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "var(--c-space-5)" }}>
      {/* mammoth's HTML, with hyperlink hrefs sanitized to a safe-scheme allowlist above. */}
      <div className="cadre-doc" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
