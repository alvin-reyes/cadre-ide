/**
 * Syntax-highlights a rendered Markdown code block with Monaco's own grammars, so a
 * ```go snippet in a plan doc looks like main.go opened in the Workbench. Monaco is
 * already in the main chunk (main.tsx imports monacoSetup) — no extra dependency.
 *
 * The DOM is rebuilt from `lineSegments` of the original text via textContent: copy
 * stays byte-identical and there is no HTML string to escape (see segments.ts for
 * why colorize()'s HTML is unusable).
 */
import * as monaco from "monaco-editor";
import { lineSegments } from "./segments";

// Monaco's basic-language grammars load lazily, and editor.tokenize() is synchronous: on
// a language not yet loaded it silently returns one plain token per line. colorize()
// is the only public API that awaits the load (it waits on the tokenizer's load
// status), so it's called once per language purely as a "ready" barrier.
const ready = new Map<string, Promise<unknown>>();
function grammarReady(lang: string): Promise<unknown> {
  let p = ready.get(lang);
  if (!p) {
    p = monaco.editor.colorize("", lang, {}).catch(() => undefined);
    ready.set(lang, p);
  }
  return p;
}

/**
 * Replace `code`'s children with highlighted spans. `isCancelled` lets the caller drop
 * the result when the Markdown re-rendered while the grammar was loading.
 */
export async function highlightCodeBlock(
  code: HTMLElement,
  lang: string,
  isCancelled: () => boolean,
): Promise<void> {
  await grammarReady(lang);
  if (isCancelled() || !code.isConnected) return;

  const text = (code.textContent ?? "").replace(/\n$/, "");
  const lines = text.split("\n");
  const tokens = monaco.editor.tokenize(text, lang);

  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    for (const seg of lineSegments(line, tokens[i] ?? [])) {
      if (seg.cls) {
        const span = document.createElement("span");
        span.className = `cadre-syn-${seg.cls}`;
        span.textContent = seg.text;
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(seg.text));
      }
    }
    if (i < lines.length - 1) frag.appendChild(document.createTextNode("\n"));
  });
  code.replaceChildren(frag);
  code.dataset.highlighted = lang;
}
