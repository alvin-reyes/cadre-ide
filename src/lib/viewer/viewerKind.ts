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
