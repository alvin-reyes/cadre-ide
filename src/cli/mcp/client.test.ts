import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { probeConnection } from "./client";
import type { Connection } from "../../lib/mcp/connections";

const stub: Connection = {
  id: "stub", presetId: "custom", label: "Stub",
  transport: { kind: "stdio", command: "node", args: ["dist-cli/cli/mcp/stubServer.js"], env: {} },
  secretRefs: [], enabled: true, status: "unconfigured",
};
const noSecret = async () => null;

describe("probeConnection", () => {
  beforeAll(() => { execFileSync("npx", ["tsc", "-p", "tsconfig.cli.json"], { stdio: "inherit" }); });

  it("connects to a stub server and lists its two tools", async () => {
    const r = await probeConnection(stub, noSecret, { timeoutMs: 15000 });
    expect(r.ok).toBe(true);
    expect(r.toolCount).toBe(2);
    expect(r.toolNames.sort()).toEqual(["echo", "ping"]);
  }, 30000);

  it("returns ok:false with an error on a bad command (times out / fails fast)", async () => {
    const bad: Connection = { ...stub, transport: { kind: "stdio", command: "node", args: ["/no/such/file.js"], env: {} } };
    const r = await probeConnection(bad, noSecret, { timeoutMs: 4000 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  }, 20000);
});
