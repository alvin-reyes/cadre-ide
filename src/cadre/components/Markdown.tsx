import { useEffect, useRef } from "react";
import { marked } from "marked";
import mermaid from "mermaid";
import { useThemeStore } from "../../stores/themeStore";
import { languageForFence } from "../../lib/editor/languages";
import { highlightCodeBlock } from "../../lib/editor/highlight";

/**
 * Renders Markdown, and upgrades ```mermaid fenced blocks into rendered SVG
 * diagrams (the documentation standard, §3.11 — every doc is elaborate, with
 * diagrams). Other fences (```go, ```rust, ```ts, ```python, ```bash, ```curl …) get
 * Monaco-grammar syntax highlighting — see src/lib/editor/. Used by the Planning
 * Studio doc pane, the doc viewer, the copilot chat and the fleet story view.
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

    // Syntax-highlight every other fence we have a grammar for (```go, ```bash, ```curl …);
    // unknown fences stay plain. marked puts the info string's first word in the class.
    for (const code of Array.from(el.querySelectorAll<HTMLElement>('pre > code[class*="language-"]'))) {
      const info = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1] ?? "";
      const lang = languageForFence(info);
      if (!lang) continue;
      highlightCodeBlock(code, lang, () => cancelled).catch((e) => {
        // Cosmetic: the block is already readable as plain text, so no toast — but not silent.
        console.warn(`[markdown] could not highlight a ${info} block:`, e);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [content, theme]);

  return <div ref={ref} className={className} />;
}
