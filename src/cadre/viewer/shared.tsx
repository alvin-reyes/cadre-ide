import type { ReactNode } from "react";

/**
 * Shared helpers for the doc-viewer leaves (PdfView, DocxView, DocViewer).
 * Kept deliberately small: the deeper asymmetry between PdfView and DocxView
 * (cancellation refs, error classification) is NOT unified here — mammoth has
 * no cancel, pdf.js does, and forcing a shared shape for that would be worse
 * than the duplication it replaces.
 */

/** base64 → raw bytes. Used to hand a file's contents to pdf.js (as-is) or to
 * mammoth (via `.buffer`, since this Uint8Array is freshly allocated and not
 * a view over a larger backing buffer, so `.buffer` is exactly the file). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Flex-centered pane, used for loading/empty/error states across all three
 * viewer leaves. `color` overrides the default muted tone (e.g. for errors). */
export function Centered({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: color ?? "var(--c-text-faint)",
        fontSize: "var(--c-fs-sm)",
        padding: "var(--c-space-5)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}
