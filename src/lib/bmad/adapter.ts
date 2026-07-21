import { parseCoreConfig, type BmadCoreConfig } from "./coreConfig";
import { parsePersona, type BmadPersona } from "./persona";
import { parseTemplate, type BmadTemplate } from "./template";
import { composeSystemPrompt } from "./prompt";

/**
 * Reads a file under the project's `.bmad-core/`, by path relative to that
 * directory (e.g. "agents/dev.md"). In production this wraps a Tauri
 * `read_file` invoke; in tests it's a plain map. Keeping it injected keeps the
 * adapter pure and testable.
 */
export type BmadFileReader = (relPath: string) => Promise<string>;

/**
 * BmadAdapter (§3.3, §6): the single seam through which Cadre consumes the real
 * upstream BMAD content — parsing personas / templates / config and composing
 * them into prompts. Nothing else in Cadre touches `.bmad-core` directly.
 */
export class BmadAdapter {
  constructor(private readonly readFile: BmadFileReader) {}

  loadConfig(): Promise<BmadCoreConfig> {
    return this.readFile("core-config.yaml").then(parseCoreConfig);
  }

  loadPersona(id: string): Promise<BmadPersona> {
    return this.readFile(`agents/${id}.md`).then(parsePersona);
  }

  loadTemplate(name: string): Promise<BmadTemplate> {
    return this.readFile(`templates/${name}.yaml`).then(parseTemplate);
  }

  /** Load a persona and compose its system prompt in one step. */
  async systemPromptFor(id: string): Promise<string> {
    return composeSystemPrompt(await this.loadPersona(id));
  }
}
