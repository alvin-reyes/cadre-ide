import { useRef, useCallback, useEffect, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import { languageForPath } from "../../lib/editor/languages";

interface MonacoWrapperProps {
  filePath: string;
  content: string;
  onChange: (value: string) => void;
  onSave: () => void;
  theme?: string;
  /** When set, scroll to and highlight this 1-based line (e.g. a search-result jump). */
  gotoLine?: { line: number; col?: number; nonce: number } | null;
}

export default function MonacoWrapper({ filePath, content, onChange, onSave, theme = "vs-dark", gotoLine }: MonacoWrapperProps) {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  // onMount runs once, so its Ctrl+S action must call through a ref that always
  // points at the latest onSave — otherwise it saves a stale closure's content.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // The first line only matters for extensionless scripts (shebang detection).
  const nl = content.indexOf("\n");
  const language = languageForPath(filePath, nl === -1 ? content : content.slice(0, nl));

  // The goto-line effect below can run BEFORE the editor exists (see its comment),
  // so it needs a reactive signal that mounting has happened — a ref alone cannot
  // re-trigger an effect.
  const [editorReady, setEditorReady] = useState(false);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    editor.addAction({
      id: "save-file",
      label: "Save File",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSaveRef.current(),
    });
    editor.focus();
    setEditorReady(true);
  }, []);

  // Jump to a line when a search result is clicked. `nonce` forces re-run even when
  // clicking the same line twice.
  //
  // `editorReady` is a dependency because a search hit can MOUNT this editor and
  // set gotoLine in the same commit — clicking a result in a Markdown file flips
  // the Workbench out of the rendered view into Monaco. In that case this effect
  // runs first, with editorRef.current still null (onMount resolves afterwards),
  // and since `nonce` never changes again the reveal would be dropped silently.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !gotoLine) return;
    const line = gotoLine.line;
    const col = gotoLine.col ?? 1;
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: col });
    ed.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoLine?.nonce, editorReady]);

  // `path` gives each file its own model (clean undo history, no cursor bleed);
  // `value` stays controlled. No manual setValue — that fought the controlled prop.
  return (
    <Editor
      height="100%"
      path={filePath}
      language={language}
      value={content}
      theme={theme}
      onChange={(value) => onChange(value ?? "")}
      onMount={handleMount}
      options={{
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        minimap: { enabled: true },
        lineNumbers: "on",
        wordWrap: "off",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        padding: { top: 8 },
      }}
    />
  );
}
