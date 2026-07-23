import { create } from "zustand";

/**
 * A single, always-reachable stream of AI activity — every fleet agent's output,
 * sharding, review, brownfield analysis, and errors — so failures are diagnosable
 * in one place. Sources tag each entry; capped to a rolling buffer.
 */
export type AiLogLevel = "info" | "error";

export interface AiLogEntry {
  id: number;
  ts: number;
  source: string;
  level: AiLogLevel;
  text: string;
}

let seq = 0;
const CAP = 4000;

interface AiLogState {
  entries: AiLogEntry[];
  push: (source: string, text: string, level?: AiLogLevel) => void;
  clear: () => void;
}

export const useAiLog = create<AiLogState>((set) => ({
  entries: [],
  push: (source, text, level = "info") =>
    set((s) => {
      const next = [...s.entries, { id: ++seq, ts: Date.now(), source, level, text }];
      return { entries: next.length > CAP ? next.slice(next.length - CAP) : next };
    }),
  clear: () => set({ entries: [] }),
}));

/** Convenience for non-component callers (store actions). */
export const aiLog = (source: string, text: string, level?: AiLogLevel) =>
  useAiLog.getState().push(source, text, level);
