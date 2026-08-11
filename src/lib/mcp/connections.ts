// Pure connection registry model — no Tauri/zustand so the CLI can reuse it.
export type ConnStatus = "unconfigured" | "connected" | "error";
export interface SecretRef { field: string; keychainKey: string; target: "env" | "header"; }
export interface StdioTransport { kind: "stdio"; command: string; args: string[]; env: Record<string, string>; }
export interface HttpTransport { kind: "http"; url: string; headers: Record<string, string>; }
export type Transport = StdioTransport | HttpTransport;
export interface Connection {
  id: string; presetId: string; label: string;
  transport: Transport; secretRefs: SecretRef[];
  enabled: boolean; status: ConnStatus; toolCount?: number; lastError?: string;
}
export interface McpRegistryFile { version: 1; connections: Connection[]; }

export function addConnection(list: Connection[], c: Connection): Connection[] {
  return [...list.filter((x) => x.id !== c.id), c];
}
export function updateConnection(list: Connection[], id: string, patch: Partial<Connection>): Connection[] {
  return list.map((c) => (c.id === id ? { ...c, ...patch } : c));
}
export function removeConnection(list: Connection[], id: string): Connection[] {
  return list.filter((c) => c.id !== id);
}
export function setStatus(
  list: Connection[], id: string, status: ConnStatus,
  extra?: { toolCount?: number; lastError?: string },
): Connection[] {
  return updateConnection(list, id, {
    status,
    toolCount: extra?.toolCount,
    lastError: status === "error" ? extra?.lastError : undefined,
  });
}
export function connectionsToFile(list: Connection[]): string {
  const file: McpRegistryFile = { version: 1, connections: list };
  return JSON.stringify(file, null, 2) + "\n";
}
export function connectionsFromFile(raw: string): Connection[] {
  try {
    const parsed = JSON.parse(raw) as Partial<McpRegistryFile>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.connections)) return [];
    return parsed.connections as Connection[];
  } catch { return []; }
}
export function uniqueId(list: Connection[], base: string): string {
  const taken = new Set(list.map((c) => c.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) { const id = `${base}-${n}`; if (!taken.has(id)) return id; }
}
