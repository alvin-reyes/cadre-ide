import { useEffect, useRef } from "react";
import { marked } from "marked";
import mermaid from "mermaid";

/**
 * Renders Markdown, and upgrades ```mermaid fenced blocks into rendered SVG
 * diagrams (the documentation standard, §3.11 — every doc is elaborate, with
 * diagrams). Used by the Planning Studio doc pane and the fleet story view.
 */

let initialized = false;
let idCounter = 0;

function ensureInit() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "dark",
    fontFamily: "Inter, system-ui, sans-serif",
  });
  initialized = true;
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    el.innerHTML = marked.parse(content) as string;

    const blocks = Array.from(el.querySelectorAll<HTMLElement>("code.language-mermaid"));
    if (blocks.length > 0) {
      ensureInit();
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
  }, [content]);

  return <div ref={ref} className={className} />;
}
