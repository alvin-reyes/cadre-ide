import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/settingsStore";
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

export function TerminalPanel({ cwd }: { cwd: string }) {
  const ref = useRef<HTMLDivElement>(null);

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
      theme: {
        background: "#14100c",
        foreground: "#efe9df",
        cursor: "#d97757",
        selectionBackground: "rgba(217,119,87,0.3)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* not laid out yet */
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

    return () => {
      disposed = true;
      dataSub.dispose();
      ro.disconnect();
      if (ptyId != null) invoke("kill_pty", { id: ptyId }).catch(() => {});
      term.dispose();
    };
  }, [cwd]);

  return <div ref={ref} style={{ width: "100%", height: "100%", padding: "6px 8px", background: "#14100c" }} />;
}
