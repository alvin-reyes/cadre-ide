/**
 * Pure helpers for `cadre connect` / `connections` / `disconnect` (src/cli/cadre.ts).
 * Extracted so the arg-parsing / formatting logic is unit-testable without
 * exercising the CLI's I/O (keychain, fs, MCP probe) — see connectCli.test.ts.
 *
 * NEVER put a secret VALUE into anything these functions return that's meant
 * for stdout (formatConnectionLine, error messages) — only ids/labels/status.
 */

import type { Connection } from "../../lib/mcp/connections";
import type { Preset, SecretField } from "../../lib/mcp/catalog";

/** Parse `--field K=V` pairs into a map, splitting on the FIRST `=` only
 *  (so a value containing `=` — e.g. a base64 secret — survives intact). */
export function parseFieldFlags(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const key = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (key) out[key] = value;
  }
  return out;
}

/** The preset's first required secret field — where `--token` lands. */
export function primaryRequiredField(preset: Preset): SecretField | undefined {
  return preset.secretFields.find((f) => f.required);
}

export interface CollectSecretsOpts {
  /** Value from `--token`, if given. */
  token?: string;
  /** Values from `--field K=V`, keyed by field name. */
  fields: Record<string, string>;
  /** Fallback for the primary required field (e.g. `process.env.CADRE_MCP_TOKEN`). */
  envToken?: string;
}

export interface CollectSecretsResult {
  /** field name → value, ready to hand to `upsertConnection`. */
  secrets: Record<string, string>;
  /** Required field names still missing a value after token/fields/env. */
  missing: string[];
}

/** Merge `--field` values, `--token` (→ the primary required field), and an
 *  env fallback (also → the primary required field) into one secrets map,
 *  then report which required fields are still unfilled. `--field` always
 *  wins over `--token`/env for the same field name. */
export function collectSecrets(preset: Preset, opts: CollectSecretsOpts): CollectSecretsResult {
  const secrets: Record<string, string> = { ...opts.fields };
  const primary = primaryRequiredField(preset);
  if (primary && secrets[primary.field] === undefined) {
    if (opts.token !== undefined) secrets[primary.field] = opts.token;
    else if (opts.envToken !== undefined) secrets[primary.field] = opts.envToken;
  }
  const missing = preset.secretFields
    .filter((f) => f.required && secrets[f.field] === undefined)
    .map((f) => f.field);
  return { secrets, missing };
}

/** Map a secrets-by-field map to a secrets-by-keychainKey map for `conn`, the
 *  shape `probeConnection`'s `resolveSecret` needs. No I/O, no secret VALUE
 *  is logged — this only reshapes the object callers already hold. */
export function secretsByKeychainKey(conn: Connection, secrets: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of conn.secretRefs) {
    const value = secrets[ref.field];
    if (value !== undefined) out[ref.keychainKey] = value;
  }
  return out;
}

export interface CustomTransportOpts {
  command?: string;
  args?: string;
  url?: string;
}

/** Build the `custom` preset's transport from `--command`/`--args`/`--url`.
 *  http (`--url`) wins if both are given; neither → an error, no transport. */
export function buildCustomTransport(
  opts: CustomTransportOpts
): { transport: Connection["transport"] } | { error: string } {
  if (opts.url) {
    return { transport: { kind: "http", url: opts.url, headers: {} } };
  }
  if (opts.command) {
    const args = opts.args
      ? opts.args.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : [];
    return { transport: { kind: "stdio", command: opts.command, args, env: {} } };
  }
  return { error: "custom preset requires --command (+ optional --args) for stdio, or --url for http" };
}

export interface ParsedConnectArgs {
  /** Bare positionals in order: `[presetId, projectDir?]`. */
  positional: string[];
  token?: string;
  /** Raw `K=V` strings from each `--field`, still unparsed (feed to `parseFieldFlags`). */
  fields: string[];
  asTracker: boolean;
  command?: string;
  args?: string;
  url?: string;
}

/** Parse `cadre connect`'s argv (everything after the presetId slot). Unlike
 *  `main()`'s generic `positional = rest.filter(a => !a.startsWith("-"))`,
 *  this MUST consume each value-flag's value too — otherwise `--token abc`
 *  leaks `abc` into the positionals and gets read back as a projectDir. */
export function parseConnectArgv(rest: string[]): ParsedConnectArgs {
  const positional: string[] = [];
  const fields: string[] = [];
  let token: string | undefined;
  let asTracker = false;
  let command: string | undefined;
  let args: string | undefined;
  let url: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--token") token = rest[++i];
    else if (a === "--field") {
      const v = rest[++i];
      if (v !== undefined) fields.push(v);
    } else if (a === "--as-tracker") asTracker = true;
    else if (a === "--command") command = rest[++i];
    else if (a === "--args") args = rest[++i];
    else if (a === "--url") url = rest[++i];
    else if (!a.startsWith("-")) positional.push(a);
    // unknown flags are silently ignored, matching the rest of the CLI's minimal parsing
  }

  return { positional, token, fields, asTracker, command, args, url };
}

/** One line for `cadre connections`: id · label · status · N tools[ · tracker].
 *  Never includes a secret value — only fields already public in the registry. */
export function formatConnectionLine(conn: Connection): string {
  const tools = `${conn.toolCount ?? "-"} tools`;
  const tracker = conn.role === "tracker" ? " · tracker" : "";
  return `${conn.id} · ${conn.label} · ${conn.status} · ${tools}${tracker}`;
}
