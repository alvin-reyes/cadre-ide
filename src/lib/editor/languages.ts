/**
 * Which Monaco language id a piece of code gets — one table shared by the file
 * editor (MonacoWrapper) and fenced blocks in rendered Markdown, so a snippet in a
 * plan doc highlights exactly like the same file opened in the Workbench.
 *
 * Lives in src/lib/ (not the component) because vitest is node-only: detection
 * inside a .tsx file could not be tested at all.
 */

/** File extension → Monaco language id. Every value must be a language Monaco ships. */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  rs: "rust", go: "go",
  py: "python", pyi: "python", pyw: "python",
  sh: "shell", bash: "shell", zsh: "shell", ksh: "shell", curl: "shell",
  java: "java", c: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", h: "c",
  rb: "ruby", swift: "swift", kt: "kotlin",
  json: "json", yaml: "yaml", yml: "yaml",
  // Monaco ships no TOML grammar; ini's [sections], key = value and # comments are
  // the closest shipped match (an unknown id would silently render plain text).
  toml: "ini", ini: "ini",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html",
  md: "markdown", markdown: "markdown",
  sql: "sql", graphql: "graphql",
  xml: "xml", svg: "xml",
  dockerfile: "dockerfile",
  mmd: "markdown", mermaid: "markdown",
  proto: "protobuf",
};

/** Whole-filename matches, checked when the extension doesn't decide. Keys are lowercase. */
const BASENAME_TO_LANGUAGE: Record<string, string> = {
  dockerfile: "dockerfile",
  // Cargo.lock is TOML — the generic `.lock` rule below would get it wrong.
  "cargo.lock": "ini",
  ".bashrc": "shell", ".bash_profile": "shell", ".bash_aliases": "shell",
  ".zshrc": "shell", ".zprofile": "shell", ".zshenv": "shell", ".profile": "shell",
};

/** Markdown fence info-string aliases → Monaco language id. Keys are lowercase. */
const FENCE_TO_LANGUAGE: Record<string, string> = {
  go: "go", golang: "go",
  rust: "rust", rs: "rust",
  ts: "typescript", typescript: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", javascript: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  node: "javascript",
  python: "python", py: "python", python3: "python", py3: "python",
  // A curl snippet IS a shell command line (flags, quoted JSON bodies, `\` continuations,
  // $VARS) — there is no curl grammar, and the shell tokenizer handles all of it.
  bash: "shell", sh: "shell", shell: "shell", zsh: "shell", ksh: "shell",
  console: "shell", terminal: "shell", "shell-session": "shell", shellsession: "shell",
  curl: "shell",
  json: "json", jsonc: "json", json5: "json",
  yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini",
  html: "html", xml: "xml", svg: "xml", css: "css", scss: "scss", less: "less",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", docker: "dockerfile",
  java: "java", kotlin: "kotlin", kt: "kotlin", swift: "swift", ruby: "ruby", rb: "ruby",
  c: "c", cpp: "cpp", "c++": "cpp", proto: "protobuf", protobuf: "protobuf",
  markdown: "markdown", md: "markdown",
};

/** Shebang interpreter → Monaco language id, for extensionless scripts. */
const SHEBANG: Array<[RegExp, string]> = [
  [/\bpython[\d.]*\b/, "python"],
  [/\b(ba|z|k|da)?sh\b/, "shell"],
  [/\b(ts-node|tsx)\b/, "typescript"],
  [/\b(node|deno|bun)\b/, "javascript"],
];

function languageFromShebang(firstLine: string): string | null {
  if (!firstLine.startsWith("#!")) return null;
  for (const [re, lang] of SHEBANG) if (re.test(firstLine)) return lang;
  return null;
}

/**
 * Monaco language id for a file. Extension wins; then a known basename; then the
 * shebang on `firstLine` (so `bin/deploy` with `#!/usr/bin/env bash` highlights).
 */
export function languageForPath(path: string, firstLine = ""): string {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  const byName = BASENAME_TO_LANGUAGE[name];
  if (byName) return byName;
  const dot = name.lastIndexOf(".");
  // dot === 0 is a dotfile (".gitignore"), not an extension.
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  const byExt = EXT_TO_LANGUAGE[ext];
  if (byExt) return byExt;
  return languageFromShebang(firstLine) ?? "plaintext";
}

/**
 * Monaco language id for a Markdown fence info string (```go, ```bash title="x"),
 * or null when unknown — the block then stays plain rather than guessing.
 */
export function languageForFence(info: string): string | null {
  const word = info.trim().split(/[\s{]/, 1)[0].toLowerCase();
  return FENCE_TO_LANGUAGE[word] ?? null;
}
