import { describe, it, expect } from "vitest";
import { ExitRegistry } from "./exitRegistry";

describe("ExitRegistry", () => {
  it("delivers the exit code when wait comes before resolve", async () => {
    const reg = new ExitRegistry();
    reg.register(1);
    const p = reg.wait(1);
    reg.resolve(1, 0);
    expect(await p).toEqual({ exitCode: 0 });
  });

  it("delivers the exit code when resolve comes BEFORE wait (the race)", async () => {
    const reg = new ExitRegistry();
    reg.register(2);
    reg.resolve(2, 3); // fast agent exits before anyone waits
    expect(await reg.wait(2)).toEqual({ exitCode: 3 });
  });

  it("preserves a null (killed) exit code across the race", async () => {
    const reg = new ExitRegistry();
    reg.resolve(4, null); // resolve without prior register
    expect(await reg.wait(4)).toEqual({ exitCode: null });
  });

  it("does not confuse two concurrent agents", async () => {
    const reg = new ExitRegistry();
    reg.register(10);
    reg.register(11);
    reg.resolve(11, 1);
    reg.resolve(10, 0);
    expect(await reg.wait(10)).toEqual({ exitCode: 0 });
    expect(await reg.wait(11)).toEqual({ exitCode: 1 });
  });
});
