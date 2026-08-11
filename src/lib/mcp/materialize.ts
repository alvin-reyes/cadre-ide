import type { Connection } from "./connections";

export interface ClaudeMcpConfig {
  mcpServers: Record<string, {
    command?: string; args?: string[]; env?: Record<string, string>;
    url?: string; headers?: Record<string, string>;
  }>;
}
export interface RequiredSecret { envVar: string; keychainKey: string; }
export interface Materialized { config: ClaudeMcpConfig; requiredSecrets: RequiredSecret[]; }

export function materialize(list: Connection[]): Materialized {
  const config: ClaudeMcpConfig = { mcpServers: {} };
  const requiredSecrets: RequiredSecret[] = [];
  for (const c of list) {
    if (!c.enabled) continue;
    if (c.transport.kind === "stdio") {
      const env: Record<string, string> = { ...c.transport.env };
      for (const r of c.secretRefs) {
        if (r.target !== "env") continue;
        env[r.field] = `\${${r.field}}`;
        requiredSecrets.push({ envVar: r.field, keychainKey: r.keychainKey });
      }
      config.mcpServers[c.id] = { command: c.transport.command, args: c.transport.args, env };
    } else {
      const headers: Record<string, string> = { ...c.transport.headers };
      for (const r of c.secretRefs) {
        if (r.target !== "header") continue;
        headers[r.field] = `\${${r.field}}`;
        requiredSecrets.push({ envVar: r.field, keychainKey: r.keychainKey });
      }
      config.mcpServers[c.id] = { url: c.transport.url, headers };
    }
  }
  return { config, requiredSecrets };
}

export function serializeConfig(m: Materialized): string {
  return JSON.stringify(m.config, null, 2) + "\n";
}
