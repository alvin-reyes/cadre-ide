/**
 * Project-level model config, read from the `models` object in a project's
 * cadre.json. All fields optional — a missing/corrupt manifest yields {}, and
 * callers fall back to the global settings / hardcoded default. Pure and
 * framework-free (mirrors src/lib/engine/repos.ts) so it's unit-testable
 * without Zustand or Tauri.
 */
export interface ProjectModels {
  planning?: string;
  fleet?: string;
  provider?: string;
}

/** Provider ids Cadre knows how to route to (must match PROVIDERS in providers.ts). */
export const KNOWN_PROVIDER_IDS = ["claude", "deepseek", "kimi"] as const;

export function parseModels(manifestJson: string): ProjectModels {
  let manifest: { models?: unknown } = {};
  try {
    manifest = JSON.parse(manifestJson) ?? {};
  } catch {
    return {};
  }
  const raw = manifest.models;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: ProjectModels = {};
  if (typeof o.planning === "string" && o.planning) out.planning = o.planning;
  if (typeof o.fleet === "string" && o.fleet) out.fleet = o.fleet;
  if (typeof o.provider === "string" && (KNOWN_PROVIDER_IDS as readonly string[]).includes(o.provider)) {
    out.provider = o.provider;
  }
  return out;
}
