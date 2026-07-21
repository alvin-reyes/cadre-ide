import { parse as parseYaml } from "yaml";

/**
 * BmadAdapter — template parsing (§6).
 *
 * BMAD templates (prd-tmpl / architecture-tmpl / story-tmpl) are YAML with
 * `owner`/`editors` per section — this is what backs section ownership (e.g.
 * only the dev agent may write the "Dev Agent Record", only QA the "QA Results").
 * Cadre uses this for best-effort ownership checks and to know the output
 * filename pattern. Pure: yaml text in → typed template out.
 */
export interface BmadTemplateSection {
  id: string;
  title: string;
  /** the persona role that owns this section, e.g. "dev-agent" */
  owner?: string;
  /** persona roles allowed to edit this section */
  editors: string[];
}

export interface BmadTemplate {
  id: string;
  name: string;
  /** output path pattern, e.g. "docs/stories/{{epic_num}}.{{story_num}}.md" */
  outputFilename?: string;
  outputTitle?: string;
  /** all sections (nested flattened), in document order */
  sections: BmadTemplateSection[];
  raw: Record<string, unknown>;
}

function flattenSections(nodes: unknown): BmadTemplateSection[] {
  if (!Array.isArray(nodes)) return [];
  const out: BmadTemplateSection[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const rec = node as Record<string, unknown>;
    if (typeof rec.id === "string") {
      out.push({
        id: rec.id,
        title: typeof rec.title === "string" ? rec.title : "",
        owner: typeof rec.owner === "string" ? rec.owner : undefined,
        editors: Array.isArray(rec.editors)
          ? (rec.editors as unknown[]).filter(
              (x): x is string => typeof x === "string"
            )
          : [],
      });
    }
    if (Array.isArray(rec.sections)) {
      out.push(...flattenSections(rec.sections));
    }
  }
  return out;
}

export function parseTemplate(yamlText: string): BmadTemplate {
  const raw = (parseYaml(yamlText) ?? {}) as Record<string, unknown>;
  const template = (raw.template ?? {}) as Record<string, unknown>;
  const output = (template.output ?? {}) as Record<string, unknown>;
  return {
    id: typeof template.id === "string" ? template.id : "",
    name: typeof template.name === "string" ? template.name : "",
    outputFilename:
      typeof output.filename === "string" ? output.filename : undefined,
    outputTitle: typeof output.title === "string" ? output.title : undefined,
    sections: flattenSections(raw.sections),
    raw,
  };
}

/** True if `agentRole` is allowed to edit the section with `sectionId`. */
export function canEdit(
  template: BmadTemplate,
  sectionId: string,
  agentRole: string
): boolean {
  const section = template.sections.find((s) => s.id === sectionId);
  return section ? section.editors.includes(agentRole) : false;
}
