import type { BmadPersona } from "./persona";

/**
 * BmadAdapter — prompt composition (§3.3).
 *
 * Turns a parsed BMAD persona into the system prompt the model receives (the
 * SDK planner for PM/Architect/…, or the `claude -p` invocation for Dev/QA).
 * This is where "BMAD content is the prompt engine" becomes concrete: Cadre
 * composes the persona's own role/identity/principles — it does not invent its
 * own instructions.
 *
 * This is the persona-only base. Per-dispatch context (the story, the
 * `devLoadAlwaysFiles`) is layered on at dispatch time, not here.
 */
export function composeSystemPrompt(persona: BmadPersona): string {
  const p = persona.persona;
  const lines: string[] = [];

  const heading = persona.title
    ? `You are ${persona.name}, the ${persona.title}.`
    : `You are ${persona.name}.`;
  lines.push(heading);

  if (p.role) lines.push(`\nRole: ${p.role}`);
  if (p.identity) lines.push(`Identity: ${p.identity}`);
  if (p.style) lines.push(`Style: ${p.style}`);
  if (p.focus) lines.push(`Focus: ${p.focus}`);

  if (p.core_principles && p.core_principles.length > 0) {
    lines.push(`\nCore principles:`);
    for (const principle of p.core_principles) {
      lines.push(`- ${principle}`);
    }
  }

  lines.push(
    `\nStay in character as ${persona.name}. Follow the BMAD method exactly; ` +
      `execute task workflows step by step and never skip a required step.`
  );

  return lines.join("\n");
}
