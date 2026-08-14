/** Hard timeout for a single tracker agent turn (sync/fetch); a hung MCP tool must never stall the caller. */
export const AGENT_TIMEOUT_MS = 120_000;

/** Reject with `label` if `p` doesn't settle within `ms`, always clearing the
 *  timer so no dangling handle survives when `p` wins the race. Shared by the
 *  desktop stores (mcpTrackerStore, mcpIntakeStore) that bound a spawned
 *  agent's wait behind this same timeout. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
