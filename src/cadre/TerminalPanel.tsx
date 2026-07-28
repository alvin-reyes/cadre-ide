import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/settingsStore";
import { useThemeStore } from "../stores/themeStore";
import { loadBuffer, saveBuffer } from "../stores/terminalSession";
import "@xterm/xterm/css/xterm.css";

/**
 * A real terminal (xterm.js wired to a Rust PTY) so the CTO can launch shells and
 * run agents (`claude`, git, anything) by hand — the ADE-style hands-on surface.
 * An empty command spawns the login shell (pty.rs resolve_argv).
 */

type PtyEvent =
  | { type: "output"; data: number[] }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string };

/** Read a CSS token off the root, with a fallback. */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Resolve the xterm palette from the app's theme tokens (so it follows light/dark). */
function xtermTheme() {
  return {
    background: cssVar("--c-code-bg", "#14100c"),
    foreground: cssVar("--c-text", "#efe9df"),
    cursor: cssVar("--c-accent", "#d97757"),
    selectionBackground: cssVar("--c-accent-subtle", "rgba(217,119,87,0.3)"),
  };
}

export function TerminalPanel({
  cwd,
  startupCommand,
  persistId,
}: {
  cwd: string;
  startupCommand?: string;
  /** Stable id for this pane; when set, its scrollback is restored + persisted. */
  persistId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const theme = useThemeStore((s) => s.theme);

  // Re-theme the live terminal when the app theme flips (no PTY churn).
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme();
  }, [theme]);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    // Read terminal prefs once at mount (non-reactive, so changing them doesn't
    // recreate the PTY). New settings apply to the next terminal you open.
    const s = useSettingsStore.getState();
    const term = new XTerm({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      cursorStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      scrollback: s.scrollback,
      theme: xtermTheme(),
    });
    termRef.current = term;
    // Let app shortcuts (new tab / toggle panel) win over the shell for these
    // chords — returning false makes xterm ignore the key and lets it bubble.
    term.attachCustomKeyEventHandler((e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "t" || e.key === "T" || e.key === "`")) {
        return false;
      }
      return true;
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    const serialize = new SerializeAddon();
    term.loadAddon(serialize);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* not laid out yet */
    }

    // Restore this pane's previous scrollback (if any) beneath the fresh session.
    if (persistId) {
      const prior = loadBuffer(persistId);
      if (prior) term.write(prior);
    }

    let ptyId: number | null = null;
    let disposed = false;
    const encoder = new TextEncoder();

    const channel = new Channel<PtyEvent>();
    channel.onmessage = (ev) => {
      if (ev.type === "output") term.write(new Uint8Array(ev.data));
      else if (ev.type === "exit") term.write(`\r\n\x1b[90m[process exited: ${ev.code ?? "?"}]\x1b[0m\r\n`);
      else if (ev.type === "error") term.write(`\r\n\x1b[31m[pty error: ${ev.message}]\x1b[0m\r\n`);
    };

    (async () => {
      try {
        const id = await invoke<number>("create_pty", {
          rows: term.rows,
          cols: term.cols,
          cwd,
          command: null,
          args: [],
          env: null,
          onEvent: channel,
        });
        if (disposed) {
          invoke("kill_pty", { id }).catch(() => {});
          return;
        }
        ptyId = id;
        // Preload a startup command once (e.g. `claude` for the Maintain view) so
        // the user lands in a ready session rather than a bare shell. Written into
        // the login shell (not spawned as the PTY command) so the shell survives
        // when the command exits. The tty buffers input until the shell is ready.
        if (startupCommand) {
          invoke("write_pty", { id, data: Array.from(encoder.encode(startupCommand + "\n")) }).catch(() => {});
        }
      } catch (e) {
        term.write(`\r\n\x1b[31mfailed to start shell: ${String(e)}\x1b[0m\r\n`);
      }
    })();

    const dataSub = term.onData((data) => {
      if (ptyId != null) {
        invoke("write_pty", { id: ptyId, data: Array.from(encoder.encode(data)) }).catch(() => {});
      }
    });

    const doFit = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ptyId != null) {
        invoke("resize_pty", { id: ptyId, rows: term.rows, cols: term.cols }).catch(() => {});
      }
    };
    const ro = new ResizeObserver(doFit);
    ro.observe(host);
    term.focus();

    // Persist scrollback on an interval (survives any way the app closes, not just
    // a graceful unmount) and once more on teardown.
    const persistTimer =
      persistId != null
        ? setInterval(() => {
            try {
              saveBuffer(persistId, serialize.serialize());
            } catch {
              /* serialize/storage hiccup — best effort */
            }
          }, 4000)
        : null;

    return () => {
      disposed = true;
      if (persistTimer != null) clearInterval(persistTimer);
      if (persistId != null) {
        try {
          saveBuffer(persistId, serialize.serialize());
        } catch {
          /* best effort */
        }
      }
      dataSub.dispose();
      ro.disconnect();
      if (ptyId != null) invoke("kill_pty", { id: ptyId }).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [cwd, startupCommand, persistId]);

  return <div ref={ref} style={{ width: "100%", height: "100%", padding: "6px 8px", background: "var(--c-code-bg)" }} />;
}
