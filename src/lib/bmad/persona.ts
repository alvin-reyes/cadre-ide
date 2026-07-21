import { parse as parseYaml } from "yaml";

/**
 * BmadAdapter — persona parsing (§3.3, §7).
 *
 * A BMAD persona is a Markdown file wrapping a single ```yaml block that holds
 * the whole definition (agent identity, persona, commands, dependencies). Cadre
 * consumes this content directly as the prompt engine — it does not invent its
 * own prompts. This module is pure (string in → typed persona out); reading the
 * file from disk is a separate concern (Tauri fs / invoke).
 */

export interface BmadPersonaDependencies {
  tasks?: string[];
  templates?: string[];
  checklists?: string[];
  data?: string[];
}

export interface BmadPersona {
  /** e.g. "dev", "pm", "architect" */
  id: string;
  /** the persona's human name, e.g. "James" */
  name: string;
  /** e.g. "Full Stack Developer" */
  title: string;
  icon?: string;
  whenToUse?: string;
  persona: {
    role?: string;
    style?: string;
    identity?: string;
    focus?: string;
    core_principles?: string[];
  };
  /** the persona's `*`-prefixed commands (shape varies by persona) */
  commands: unknown;
  dependencies?: BmadPersonaDependencies;
  /** the full parsed YAML block, for anything the typed fields don't cover */
  raw: Record<string, unknown>;
}

/** Extract the embedded ```yaml … ``` block that holds a BMAD persona definition. */
export function extractYamlBlock(markdown: string): string {
  const match = markdown.match(/```ya?ml\s*\n([\s\S]*?)```/);
  if (!match) {
    throw new Error("no ```yaml block found in persona file");
  }
  return match[1];
}

/** Parse a BMAD persona markdown file into a typed persona. */
export function parsePersona(markdown: string): BmadPersona {
  const raw = parseYaml(extractYamlBlock(markdown)) as Record<string, unknown>;
  const agent = (raw.agent ?? {}) as Record<string, unknown>;
  if (typeof agent.id !== "string") {
    throw new Error("persona is missing agent.id");
  }
  return {
    id: agent.id,
    name: typeof agent.name === "string" ? agent.name : "",
    title: typeof agent.title === "string" ? agent.title : "",
    icon: typeof agent.icon === "string" ? agent.icon : undefined,
    whenToUse: typeof agent.whenToUse === "string" ? agent.whenToUse : undefined,
    persona: (raw.persona ?? {}) as BmadPersona["persona"],
    commands: raw.commands,
    dependencies: raw.dependencies as BmadPersonaDependencies | undefined,
    raw,
  };
}
