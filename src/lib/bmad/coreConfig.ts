import { parse as parseYaml } from "yaml";

/**
 * BmadAdapter — core-config parsing (§6/§7).
 *
 * `.bmad-core/core-config.yaml` is Cadre's primary integration surface: it says
 * where every BMAD artifact lives (PRD, architecture, stories, QA) and which
 * files the dev agent always loads. Pure: yaml text in → typed config out.
 */
export interface BmadCoreConfig {
  prdFile: string;
  prdSharded: boolean;
  prdShardedLocation?: string;
  epicFilePattern?: string;
  architectureFile: string;
  architectureSharded: boolean;
  architectureShardedLocation?: string;
  /** files the dev agent always pulls into context on activation */
  devLoadAlwaysFiles: string[];
  /** where sharded story files live, e.g. "docs/stories" */
  devStoryLocation: string;
  qaLocation?: string;
  /** command namespace, e.g. "BMad" */
  slashPrefix: string;
  raw: Record<string, unknown>;
}

const str = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v : fallback;

const optStr = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

export function parseCoreConfig(yamlText: string): BmadCoreConfig {
  const raw = (parseYaml(yamlText) ?? {}) as Record<string, unknown>;
  const prd = (raw.prd ?? {}) as Record<string, unknown>;
  const arch = (raw.architecture ?? {}) as Record<string, unknown>;
  const qa = (raw.qa ?? {}) as Record<string, unknown>;
  const devLoad = Array.isArray(raw.devLoadAlwaysFiles)
    ? (raw.devLoadAlwaysFiles as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : [];

  return {
    prdFile: str(prd.prdFile, "docs/prd.md"),
    prdSharded: prd.prdSharded === true,
    prdShardedLocation: optStr(prd.prdShardedLocation),
    epicFilePattern: optStr(prd.epicFilePattern),
    architectureFile: str(arch.architectureFile, "docs/architecture.md"),
    architectureSharded: arch.architectureSharded === true,
    architectureShardedLocation: optStr(arch.architectureShardedLocation),
    devLoadAlwaysFiles: devLoad,
    devStoryLocation: str(raw.devStoryLocation, "docs/stories"),
    qaLocation: optStr(qa.qaLocation),
    slashPrefix: str(raw.slashPrefix, "BMad"),
    raw,
  };
}
