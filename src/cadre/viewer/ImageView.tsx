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
