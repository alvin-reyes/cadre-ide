interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

export interface AgentExit {
  exitCode: number | null;
}

/**
 * Tracks per-PTY exit results and fixes the race (#3) where a fast agent's exit
 * event arrives before — or concurrently with — `waitForExit`. The resolved
 * value is *retained until consumed*, so a late waiter still observes the real
 * exit code (the old code deleted the entry on exit, losing it). Cleanup happens
 * only after `wait` reads the value.
 */
export class ExitRegistry {
  private entries = new Map<number, Deferred<AgentExit>>();

  /** Ensure a slot exists for `id` (idempotent). */
  register(id: number): void {
    if (!this.entries.has(id)) {
      this.entries.set(id, deferred<AgentExit>());
    }
  }

  /** Record the exit code for `id` (may arrive before or after `wait`). */
  resolve(id: number, exitCode: number | null): void {
    this.register(id);
    this.entries.get(id)!.resolve({ exitCode });
  }

  /** Await the exit result for `id`, then drop the slot. */
  async wait(id: number): Promise<AgentExit> {
    this.register(id);
    const result = await this.entries.get(id)!.promise;
    this.entries.delete(id);
    return result;
  }
}
