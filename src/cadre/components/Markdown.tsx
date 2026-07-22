import { useEffect, useRef } from "react";
import { marked } from "marked";
import mermaid from "mermaid";
import { useThemeStore } from "../../stores/themeStore";

/**
 * Renders Markdown, and upgrades ```mermaid fenced blocks into rendered SVG
 * diagrams (the documentation standard, §3.11 — every doc is elaborate, with
 * diagrams). Used by the Planning Studio doc pane and the fleet story view.
 */

let idCounter = 0;
let currentMermaidTheme: string | null = null;

/** (Re)initialize mermaid for the given app theme — diagrams follow light/dark. */
function ensureInit(appTheme: "dark" | "light") {
  const mermaidTheme = appTheme === "light" ? "neutral" : "dark";
  if (currentMermaidTheme === mermaidTheme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: mermaidTheme,
    fontFamily: "Inter, system-ui, sans-serif",
  });
  currentMermaidTheme = mermaidTheme;
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    el.innerHTML = marked.parse(content) as string;

    const blocks = Array.from(el.querySelectorAll<HTMLElement>("code.language-mermaid"));
    if (blocks.length > 0) {
      ensureInit(theme);
      for (const code of blocks) {
        const src = (code.textContent ?? "").trim();
        const id = `cadre-mmd-${idCounter++}`;
        mermaid
          .render(id, src)
          .then(({ svg }) => {
            if (cancelled) return;
            const wrap = document.createElement("div");
            wrap.className = "cadre-mermaid";
            wrap.innerHTML = svg;
            code.closest("pre")?.replaceWith(wrap);
          })
          .catch(() => {
            /* invalid diagram — leave the code block as-is */
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [content, theme]);

  return <div ref={ref} className={className} />;
}
