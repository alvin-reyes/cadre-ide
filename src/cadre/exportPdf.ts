/**
 * Export rendered document HTML to PDF via the print dialog (Save as PDF).
 * We print the ALREADY-rendered `.cadre-doc` HTML, so Mermaid diagrams (inline
 * SVG) come along. A self-contained light stylesheet makes the PDF readable.
 */

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 40px;
    color: #1c1815;
    background: #fff;
    font: 15px/1.7 "Inter", -apple-system, system-ui, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1.doc-title {
    font-family: "Newsreader", Georgia, serif;
    font-size: 26px;
    margin: 0 0 4px;
  }
  .doc-meta { color: #8a7e6e; font-size: 12px; margin: 0 0 24px; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 .5em; }
  h1, h2 { font-family: "Newsreader", Georgia, serif; }
  h2 { border-bottom: 1px solid #e7e1d6; padding-bottom: .3em; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 .85em; }
  ul, ol { padding-left: 1.4em; }
  li { margin: .25em 0; }
  a { color: #b0552f; text-decoration: none; }
  code { font-family: "SF Mono", ui-monospace, monospace; font-size: .9em; background: #f3efe8; border: 1px solid #e7e1d6; border-radius: 4px; padding: .1em .35em; }
  pre { background: #f7f4ee; border: 1px solid #e7e1d6; border-radius: 8px; padding: 12px; overflow: auto; }
  pre code { background: none; border: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e7e1d6; padding: 6px 10px; text-align: left; }
  th { background: #f7f4ee; }
  .cadre-mermaid { display: flex; justify-content: center; margin: 1.2em 0; }
  .cadre-mermaid svg { max-width: 100%; height: auto; }
  blockquote { padding-left: 1em; border-left: 2px solid #e7e1d6; color: #6b6357; }
  @page { margin: 18mm; }
`;

export function exportHtmlToPdf(title: string, bodyHtml: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  const safeTitle = title.replace(/[<>&]/g, "");
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8" /><title>${safeTitle}</title>` +
      `<style>${PRINT_CSS}</style></head><body>` +
      `<h1 class="doc-title">${safeTitle}</h1>` +
      `<div class="doc-meta">Cadre · exported ${new Date().toLocaleString()}</div>` +
      bodyHtml +
      `</body></html>`
  );
  doc.close();

  const win = iframe.contentWindow;
  if (!win) {
    document.body.removeChild(iframe);
    return;
  }
  // Give the iframe a moment to lay out, then print; clean up after.
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, 350);
}
