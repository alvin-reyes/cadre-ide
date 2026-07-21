import type { BmadPersona } from "../bmad/persona";
import type { BmadTemplate } from "../bmad/template";
import { composeSystemPrompt } from "../bmad/prompt";

/**
 * The system prompt for a planning persona (PM → PRD, Architect → architecture)
 * to produce its document following the BMAD template. Composes the persona's
 * own identity (composeSystemPrompt) with the template's section outline and the
 * produce-the-document instruction. Pure: persona + template in → prompt out.
 */
export function planningSystemPrompt(
  persona: BmadPersona,
  template: BmadTemplate,
  artifactName: string
): string {
  const base = composeSystemPrompt(persona);
  const sections = template.sections.map((s) => `- ${s.title}`).join("\n");
  return [
    base,
    "",
    `You are producing the project's ${artifactName}. Work with the user to shape ` +
      `it, then output the complete document in Markdown, covering every required ` +
      `section below. Do not invent facts; ask when unsure.`,
    "",
    "Required sections:",
    sections,
  ].join("\n");
}
