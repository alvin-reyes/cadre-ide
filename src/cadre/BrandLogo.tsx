/**
 * The Cadre brand logo — the mark (three offset cards resolving into a generated
 * artifact, cut by a diagonal spark) plus the "Cadre" wordmark. Inline SVG so it's
 * crisp at any size and inherits theme tokens. The mark uses the Cadre mint-green
 * brand family (the accent), dark-first (matches the app default).
 *
 * We render the wordmark from text (Space Grotesk 700, -0.03em) rather than the
 * brand-kit horizontal logo SVG, which literally spells "Carde" — this ships the
 * correct name.
 */

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      <rect x="20" y="30" width="52" height="52" rx="12" fill="#1a9e6c" />
      <rect x="30" y="22" width="52" height="52" rx="12" fill="#a7f3d0" />
      <rect x="40" y="14" width="52" height="52" rx="12" fill="#FFFFFF" />
      <path d="M78 24 L52 60 L62 60 L88 24 Z" fill="#3ecf8e" />
    </svg>
  );
}

export function BrandLogo({
  size = 28,
  wordmark = true,
  color,
}: {
  size?: number;
  wordmark?: boolean;
  /** wordmark color; defaults to the theme text token */
  color?: string;
}) {
  return (
    <span
      role="img"
      aria-label="Cadre"
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.34) }}
    >
      <BrandMark size={size} />
      {wordmark && (
        <span
          style={{
            fontFamily: "var(--c-font-display)",
            fontWeight: 700,
            fontSize: Math.round(size * 0.82),
            letterSpacing: "-0.03em",
            color: color ?? "var(--c-text)",
            lineHeight: 1,
          }}
        >
          Cadre
        </span>
      )}
    </span>
  );
}
