import { type Connection, type Transport, uniqueId } from "./connections";

export interface SecretField { field: string; label: string; target: "env" | "header"; required: boolean; placeholder?: string; }
export interface Preset {
  id: string; label: string; blurb: string; docsUrl?: string;
  transport: Transport; secretFields: SecretField[]; custom?: boolean;
}

const stdio = (command: string, args: string[]): Transport => ({ kind: "stdio", command, args, env: {} });

export const CATALOG: Preset[] = [
  {
    id: "clickup", label: "ClickUp", blurb: "Tasks, lists, docs.",
    docsUrl: "https://clickup.com/api",
    transport: stdio("npx", ["-y", "@taazkareem/clickup-mcp-server"]),
    secretFields: [
      { field: "CLICKUP_API_TOKEN", label: "API token", target: "env", required: true, placeholder: "pk_…" },
      { field: "CLICKUP_TEAM_ID", label: "Team ID (optional)", target: "env", required: false },
    ],
  },
  {
    id: "github", label: "GitHub", blurb: "Issues, PRs, repos.",
    transport: stdio("npx", ["-y", "@modelcontextprotocol/server-github"]),
    secretFields: [{ field: "GITHUB_TOKEN", label: "Personal access token", target: "env", required: true, placeholder: "ghp_…" }],
  },
  {
    id: "notion", label: "Notion", blurb: "Pages and databases.",
    transport: stdio("npx", ["-y", "@notionhq/notion-mcp-server"]),
    secretFields: [{ field: "NOTION_TOKEN", label: "Integration token", target: "env", required: true, placeholder: "secret_/ntn_…" }],
  },
  {
    id: "custom", label: "Custom", blurb: "Any MCP server (stdio or HTTP).", custom: true,
    transport: stdio("", []),
    secretFields: [],
  },
];

// Seed a Connection from a preset: fields → secretRefs (keychainKey = mcp.<id>.<field>).
export function presetToConnection(preset: Preset, existing: Connection[]): Connection {
  const id = uniqueId(existing, preset.id);
  return {
    id, presetId: preset.id, label: preset.label,
    transport: structuredClone(preset.transport),
    secretRefs: preset.secretFields.map((f) => ({
      field: f.field, keychainKey: `mcp.${id}.${f.field}`, target: f.target,
    })),
    enabled: false, status: "unconfigured",
  };
}
