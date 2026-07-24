import { useEffect, useState } from "react";
import { BrandLogo } from "./BrandLogo";

/**
 * Brand splash shown briefly on app launch: the Cadre mark + wordmark on the Ink
 * ground, with a gradient shimmer, then it fades out. Self-managing — mounts once
 * at the app root, dismisses itself after a short beat.
 */
export function Splash() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");

  useEffect(() => {
    const startFade = setTimeout(() => setPhase("out"), 1400);
    const remove = setTimeout(() => setPhase("gone"), 1900); // after the 480ms fade
    return () => {
      clearTimeout(startFade);
      clearTimeout(remove);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background: "var(--c-bg)",
        opacity: phase === "out" ? 0 : 1,
        transition: "opacity 480ms var(--c-ease-out)",
        pointerEvents: phase === "out" ? "none" : "auto",
      }}
    >
      <div style={{ animation: "cadre-splash-in 560ms var(--c-ease-spring) both" }}>
        <BrandLogo size={76} />
      </div>
      <div
        style={{
          fontFamily: "var(--c-font-ui)",
          fontSize: "var(--c-fs-sm)",
          color: "var(--c-text-muted)",
          letterSpacing: "0.01em",
          animation: "cadre-splash-in 560ms 120ms var(--c-ease-spring) both",
        }}
      >
        Disciplined AI development. Verified, not vibed.
      </div>
      <div
        style={{
          width: 132,
          height: 2,
          borderRadius: 2,
          overflow: "hidden",
          background: "var(--c-surface-3)",
          marginTop: 6,
        }}
      >
        <div
          style={{
            width: "42%",
            height: "100%",
            borderRadius: 2,
            background: "var(--c-grad-brand)",
            animation: "cadre-splash-slide 1.15s var(--c-ease-out) infinite",
          }}
        />
      </div>
    </div>
  );
}
