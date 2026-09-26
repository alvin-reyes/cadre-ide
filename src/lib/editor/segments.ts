/**
 * Turns Monaco's per-line token stream into styled segments of the ORIGINAL text.
 *
 * Why not monaco.editor.colorize()? Its HTML renders every space and tab as U+00A0,
 * so a copied `curl … -H 'x: y'` breaks in a real shell and Go's tabs are lost.
 * Slicing the source ourselves keeps copy byte-identical. Pure, so it's testable.
 */

/** Minimal shape of monaco.editor.Token — kept local so this module needs no monaco import. */
export interface LineToken {
  offset: number;
  type: string;
}

export type SynClass =
  | "keyword" | "string" | "number" | "comment" | "type"
  | "variable" | "attribute" | "tag" | "regexp";

export interface Segment {
  text: string;
  cls: SynClass | null;
}

/**
 * Collapse Monarch token types ("keyword.go", "type.identifier.ts", "attribute.name.shell")
 * to the handful of classes the palette styles. Identifiers, delimiters and anything
 * unknown return null and take the block's base colour — a restrained palette, not a
 * rainbow.
 */
export function tokenClass(type: string): SynClass | null {
  const head = type.split(".")[0];
  switch (head) {
    case "keyword":
      return "keyword";
    case "string":
      return "string";
    case "number":
    case "constants": // shell's $?-style constants
      return "number";
    case "comment":
      return "comment";
    case "type":
      return "type";
    case "variable":
      return "variable";
    case "attribute": // shell flags (-X, --header) and HTML attributes
    case "annotation":
      return "attribute";
    case "metatag": // shebang lines, ini/toml [sections]
    case "tag":
      return "tag";
    case "regexp":
      return "regexp";
    default:
      return null;
  }
}

/**
 * Slice one line into segments at token offsets. Adjacent tokens that map to the same
 * class are merged so the DOM stays small. Any text before the first token is unstyled.
 */
export function lineSegments(line: string, tokens: readonly LineToken[]): Segment[] {
  const out: Segment[] = [];
  const push = (text: string, cls: SynClass | null) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.text += text;
    else out.push({ text, cls });
  };
  if (tokens.length === 0 || tokens[0].offset > 0) {
    push(line.slice(0, tokens.length ? tokens[0].offset : line.length), null);
  }
  for (let i = 0; i < tokens.length; i++) {
    const start = tokens[i].offset;
    const end = i + 1 < tokens.length ? tokens[i + 1].offset : line.length;
    push(line.slice(start, end), tokenClass(tokens[i].type));
  }
  return out;
}
