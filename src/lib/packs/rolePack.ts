/**
 * Vertical role packs (§3.9). The engine stays general; a vertical is an
 * additive pack that contributes (1) roles/personas, (2) extra gate-roles in
 * the story pipeline, and (3) verification steps (domain tools). Everything
 * here is pure data + composition — no engine change needed to add a vertical.
 */

export interface RolePack {
  /** stable id, e.g. "web3" */
  id: string;
  name: string;
  /** persona ids the pack adds (loaded like core personas) */
  roles: string[];
  /** gate-roles appended to the story pipeline after the core gates */
  extraGates: string[];
  /** verification commands the pack contributes to the QA gate */
  verification: string[];
}

/** The core story pipeline (§5 FLEET). Verticals extend it. */
export const CORE_PIPELINE = ["dev", "reviewer", "qa"] as const;

/** The ordered gate-roles a story passes through, given the active packs. */
export function composePipeline(packs: RolePack[]): string[] {
  const gates: string[] = [...CORE_PIPELINE];
  for (const pack of packs) {
    gates.push(...pack.extraGates);
  }
  return gates;
}

/** All extra persona roles contributed by the active packs (deduped, in order). */
export function activeRoles(packs: RolePack[]): string[] {
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const pack of packs) {
    for (const role of pack.roles) {
      if (!seen.has(role)) {
        seen.add(role);
        roles.push(role);
      }
    }
  }
  return roles;
}

/**
 * The verification steps to run at the QA gate: the project's own command
 * first, then each active pack's domain checks. The engine runs each and the
 * story is only `Done` if *all* pass.
 */
export function composeVerification(
  baseCommand: string,
  packs: RolePack[]
): string[] {
  const steps: string[] = baseCommand ? [baseCommand] : [];
  for (const pack of packs) {
    steps.push(...pack.verification);
  }
  return steps;
}

/** Built-in web3 pack (the lead beachhead). Personas: resources/packs/web3/. */
export const WEB3_PACK: RolePack = {
  id: "web3",
  name: "Web3 / Smart Contracts",
  roles: ["auditor", "pentester"],
  extraGates: ["auditor", "pentester"],
  verification: ["forge test", "slither . --fail-high"],
};
