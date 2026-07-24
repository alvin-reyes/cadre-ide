import { toast } from "../stores/toastStore";
import { aiLog } from "../stores/aiLogStore";

/** Extract a human-readable message from any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/**
 * Surface an error consistently: a toast (transient) AND a persistent error-level
 * entry in the AI Log (so failures are never swallowed and are diagnosable in one place).
 * `source` tags the log entry (e.g. "dispatch 1.2", "planning", "approve"). Returns the message.
 */
export function reportError(source: string, err: unknown, opts?: { toastMessage?: string }): string {
  const text = errorMessage(err);
  toast(opts?.toastMessage ?? text, "error");
  aiLog(source, text, "error");
  return text;
}
