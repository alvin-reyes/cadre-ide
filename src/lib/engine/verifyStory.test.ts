import { describe, it, expect } from "vitest";
import {
  verifyStory,
  type VerifyDeps,
  type VerificationRun,
} from "./verifyStory";
import type { Status } from "./status";

/** Deps whose verification returns a scripted sequence of runs. */
function deps(runs: VerificationRun[]) {
  const written: Status[] = [];
  let i = 0;
  const d: VerifyDeps = {
    runVerification: async () => runs[Math.min(i++, runs.length - 1)],
    setStatus: async (_e, _s, status) => {
      written.push(status);
    },
  };
  return { d, written };
}

const base = { epic: 1, story: 1, cwd: "/wt", commands: ["pnpm test"], timeoutSecs: 60 };

describe("verifyStory", () => {
  it("writes Done when the test runs green", async () => {
    const { d, written } = deps([{ exitCode: 0, timedOut: false }]);
    const r = await verifyStory(d, base);
    expect(r).toEqual({ status: "Done", passed: true, attempts: 1 });
    expect(written).toEqual(["Done"]);
  });

  it("writes Failed when the test fails (no retries)", async () => {
    const { d, written } = deps([{ exitCode: 1, timedOut: false }]);
    const r = await verifyStory(d, base);
    expect(r).toEqual({ status: "Failed", passed: false, attempts: 1 });
    expect(written).toEqual(["Failed"]);
  });

  it("recovers a flaky suite within the retry ceiling", async () => {
    const { d, written } = deps([
      { exitCode: 1, timedOut: false },
      { exitCode: 0, timedOut: false },
    ]);
    const r = await verifyStory(d, { ...base, retriesOnNonZero: 2 });
    expect(r.status).toBe("Done");
    expect(r.attempts).toBe(2);
    expect(written).toEqual(["Done"]);
  });

  it("backs off between retries when retryDelayMs is set", async () => {
    const { d } = deps([
      { exitCode: 1, timedOut: false },
      { exitCode: 0, timedOut: false },
    ]);
    const start = Date.now();
    const r = await verifyStory(d, { ...base, retriesOnNonZero: 2, retryDelayMs: 20 });
    expect(r.status).toBe("Done");
    expect(Date.now() - start).toBeGreaterThanOrEqual(15); // waited before retrying
  });

  it("fails after exhausting the retry ceiling", async () => {
    const { d } = deps([{ exitCode: 1, timedOut: false }]);
    const r = await verifyStory(d, { ...base, retriesOnNonZero: 2 });
    expect(r.status).toBe("Failed");
    expect(r.attempts).toBe(3); // 1 + 2 retries
  });

  it("treats a timeout as Failed", async () => {
    const { d } = deps([{ exitCode: null, timedOut: true }]);
    const r = await verifyStory(d, base);
    expect(r.status).toBe("Failed");
  });

  it("requires ALL steps to pass (a failing pack check blocks Done)", async () => {
    // e.g. `pnpm test` passes but `slither` fails
    let calls = 0;
    const written: string[] = [];
    const d = {
      runVerification: async () => {
        calls++;
        return calls === 1
          ? { exitCode: 0, timedOut: false } // step 1 (pnpm test) passes
          : { exitCode: 1, timedOut: false }; // step 2 (slither) fails
      },
      setStatus: async (_e: number, _s: number, status: "Done" | "Failed") => {
        written.push(status);
      },
    };
    const r = await verifyStory(d as never, {
      ...base,
      commands: ["pnpm test", "slither . --fail-high"],
    });
    expect(r.status).toBe("Failed");
    expect(calls).toBe(2); // both steps attempted
    expect(written).toEqual(["Failed"]);
  });

  it("is Done only when every step passes", async () => {
    let calls = 0;
    const d = {
      runVerification: async () => {
        calls++;
        return { exitCode: 0, timedOut: false };
      },
      setStatus: async () => {},
    };
    const r = await verifyStory(d as never, {
      ...base,
      commands: ["pnpm test", "slither ."],
    });
    expect(r.status).toBe("Done");
    expect(calls).toBe(2);
  });

  it("never returns Done without a green run (agent cannot self-report)", async () => {
    // even if exit code is null-but-not-timeout, only exit 0 passes
    const { d } = deps([{ exitCode: null, timedOut: false }]);
    const r = await verifyStory(d, base);
    expect(r.passed).toBe(false);
    expect(r.status).toBe("Failed");
  });
});
