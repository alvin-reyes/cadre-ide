import { create } from "zustand";

/**
 * Running token + cost meter. Every Anthropic SDK call (planning turns, SM
 * tool calls, adversarial reviews) records its usage here so the Cockpit can
 * show exactly what a session is costing.
 */

// Approximate USD per 1M tokens (input, output). Estimates — labelled "~" in the UI.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "kimi-k2": { in: 0.6, out: 2.5 },
  "deepseek-v4-pro": { in: 0.3, out: 1.2 },
};

function priceFor(model: string): { in: number; out: number } {
  return PRICING[model] ?? { in: 3, out: 15 };
}

interface UsageState {
  input: number;
  output: number;
  calls: number;
  costUsd: number;
  record: (input: number, output: number, model: string) => void;
  reset: () => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  input: 0,
  output: 0,
  calls: 0,
  costUsd: 0,
  record: (input, output, model) =>
    set((s) => {
      const p = priceFor(model);
      const cost = (input / 1_000_000) * p.in + (output / 1_000_000) * p.out;
      return {
        input: s.input + input,
        output: s.output + output,
        calls: s.calls + 1,
        costUsd: s.costUsd + cost,
      };
    }),
  reset: () => set({ input: 0, output: 0, calls: 0, costUsd: 0 }),
}));

/** Record usage from an SDK response's `usage` block (safe no-op if absent). */
export function recordUsage(
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined,
  model: string
) {
  if (!usage) return;
  useUsageStore.getState().record(usage.input_tokens ?? 0, usage.output_tokens ?? 0, model);
}
