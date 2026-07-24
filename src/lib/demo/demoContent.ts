/**
 * demoContent.ts — Canned demo data for the demo mode build agent.
 *
 * Provides realistic build transcript lines that the mock PTY agent streams
 * over the Channel, mimicking what a real Claude agent would print while
 * implementing a story.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PtyEvent =
  | { type: "output"; data: number[] }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string };

// ─── Transcript ───────────────────────────────────────────────────────────────

/**
 * Returns 6–12 short, realistic lines a build agent would print while
 * implementing a story. Optionally interpolates the story label.
 */
export function buildTranscript(label?: string): string[] {
  const story = label ? `"${label}"` : "the story";
  return [
    `Reading ${story}…`,
    "Checking out a fresh worktree…",
    "Writing failing test…",
    "Running tests — 1 failing, 0 passing",
    "Implementing the feature…",
    "Running tests — all passing",
    "Running linter — no issues",
    "Committing changes…",
    "Pushing branch…",
    "Done. Story complete.",
  ];
}

// ─── streamTranscript ────────────────────────────────────────────────────────

/**
 * Schedule PTY events for a transcript of lines.
 *
 * Each line is emitted as `{ type: "output", data: number[] }` (UTF-8 bytes)
 * spaced ~tick ms apart, then a final `{ type: "exit", code: 0 }` is emitted.
 *
 * Returns a `stop()` function that cancels pending events and (if called before
 * the stream finishes) emits `{ type: "exit", code: 143 }` instead.
 *
 * The `schedule` option (default: `setTimeout`) can be injected for
 * deterministic unit tests that use a fake/immediate timer.
 */
export function streamTranscript(
  emit: (e: PtyEvent) => void,
  lines: string[],
  opts?: {
    tick?: number;
    schedule?: (fn: () => void, ms: number) => unknown;
  }
): { stop: () => void } {
  const tick = opts?.tick ?? 300;
  const schedule = opts?.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const handles: unknown[] = [];
  let stopped = false;

  // Schedule each line at an increasing offset.
  lines.forEach((line, i) => {
    const h = schedule(() => {
      if (stopped) return;
      const bytes = Array.from(new TextEncoder().encode(line + "\r\n"));
      emit({ type: "output", data: bytes });
    }, tick * (i + 1));
    handles.push(h);
  });

  // Schedule the exit event after all lines.
  const exitHandle = schedule(() => {
    if (stopped) return;
    stopped = true;
    emit({ type: "exit", code: 0 });
  }, tick * (lines.length + 1));
  handles.push(exitHandle);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    for (const h of handles) {
      clearTimeout(h as ReturnType<typeof setTimeout>);
    }
    emit({ type: "exit", code: 143 });
  }

  return { stop };
}
