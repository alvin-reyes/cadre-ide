/**
 * Full-lifecycle e2e (browser demo, mock backend + mock Anthropic):
 *   new project → PLAN (PM writes PRD, Architect writes architecture) → approve →
 *   shard stories → EXECUTE (Auto-execute) → a story reaches DONE.
 *
 * Entry: `?demo=plan` seeds a bare greenfield project on the PLAN phase.
 * Run: `node scripts/e2e-lifecycle.mjs`  (needs playwright + chromium).
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const ROOT = process.cwd();
const OUT = process.env.E2E_OUT || `${ROOT}/.e2e`;
const URL = "http://localhost:1420";
let failed = false;
const fail = (m) => { console.error("E2E FAIL:", m); failed = true; };
const log = (m) => console.log("• " + m);

const waitForServer = async (ms = 30000) => {
  const d = Date.now() + ms;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 300)); }
  return false;
};
// Poll `fn()` until it returns truthy or timeout; returns the value or null.
const until = async (fn, ms, step = 1200) => {
  const d = Date.now() + ms;
  while (Date.now() < d) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)); }
  return null;
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  log("starting vite…");
  const vite = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "ignore", detached: true });
  const cleanup = () => { try { process.kill(-vite.pid); } catch {} };
  process.on("exit", cleanup);
  try {
    if (!(await waitForServer())) return fail("dev server did not start");
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], pageErrors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message || String(e)));
    const shot = (n) => page.screenshot({ path: `${OUT}/${n}` }).catch(() => {});
    const body = () => page.evaluate(() => document.body.innerText);
    const has = async (re) => re.test(await body());
    const click = async (re, timeout = 5000) => {
      try { await page.getByRole("button", { name: re }).first().click({ timeout }); return true; }
      catch { try { await page.getByText(re, { exact: false }).first().click({ timeout: 2500 }); return true; } catch { return false; } }
    };
    const sendComposer = async (text) => {
      const ta = page.getByPlaceholder(/Talk to the/).first();
      await ta.fill(text); await ta.press("Enter");
    };

    // ── New project on PLAN ──
    log("loading ?demo=plan");
    await page.goto(`${URL}/?demo=plan`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(4000);
    if (!(await has(/Plan/)) || !(await page.getByPlaceholder(/Talk to the/).first().isEnabled().catch(() => false)))
      { await shot("00-plan.png"); return fail("did not land on an enabled PLAN composer"); }
    await shot("00-plan.png");

    // ── PM → PRD ──
    log("PM: describe the change → PRD");
    await sendComposer("Build a simple task manager: add, complete, and delete tasks.");
    if (!(await until(() => has(/PRD ready|Go to Architect/), 30000))) { await shot("01-pm.png"); return fail("PRD was not produced"); }
    await shot("01-pm.png");

    // ── Architect → architecture ──
    log("Architect: produce the architecture + verify command");
    await click(/Go to Architect|Architect/);
    await page.waitForTimeout(1000);
    await sendComposer("Design the architecture and set the verification command.");
    // Approve gate opens once PRD + architecture exist.
    if (!(await until(() => has(/Approve|Sign off|verification/i), 30000))) { await shot("02-architect.png"); return fail("architecture / approve gate did not appear"); }
    await shot("02-architect.png");

    // ── Approve the plan: CTO sign-off — fill the verify command, then dispatch ──
    log("CTO sign-off: freeze verification + dispatch");
    const verify = page.getByPlaceholder(/npm test|cargo test|make verify|verify command/i).first();
    await verify.fill("npm test"); await page.waitForTimeout(400);
    if (!(await click(/Sign off & dispatch|Sign off|Approve/))) { await shot("03-approve.png"); return fail("could not sign off"); }
    if (!(await until(() => has(/Execute/i), 20000))) { await shot("03-approve.png"); return fail("did not advance past approval"); }
    await shot("03-approve.png");

    // ── Shard + Execute (sign-off may already shard/dispatch; do the rest best-effort) ──
    log("ensure stories are sharded + dispatched");
    await click(/Execute/); await page.waitForTimeout(1500);
    // Shard if no stories yet.
    if (!(await until(async () => /\b[1-9]\d*\s+stor(y|ies)/.test(await body()), 8000))) {
      await click(/Full backlog|Shard backlog|Add story|Shard story/);
      await until(async () => /\b[1-9]\d*\s+stor(y|ies)/.test(await body()), 40000);
    }
    await shot("04-shard.png");

    // Approve the Draft stories (Draft → Approved) so Auto-execute can dispatch them.
    log("approve the sharded stories");
    for (let i = 0; i < 8; i++) {
      const btn = page.getByRole("button", { name: /^Approve$/ }).first();
      if ((await btn.count()) === 0) break;
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
    await shot("04b-approved.png");

    // Kick the fleet.
    await click(/Auto-execute/);

    // ── Wait for a story to reach Done (board rollup "N done", NOT the phase label) ──
    log("waiting for a story to reach Done…");
    const done = await until(async () => /\b[1-9]\d*\s+done\b/i.test(await body()), 120000, 2500);
    await shot("05-done.png");
    if (!done) fail("no story reached Done (board never showed 'N done')");

    if (pageErrors.length) fail(`${pageErrors.length} uncaught: ${pageErrors[0]}`);
    if (errors.length) fail(`${errors.length} console error(s): ${errors[0]}`);
    await browser.close();
    if (!failed) log(`PASS — new → plan → approve → shard → execute → done. 0 console errors. Shots in ${OUT}`);
  } finally { cleanup(); }
}
main().catch((e) => { console.error("HARNESS ERROR:", e); failed = true; }).finally(() => process.exit(failed ? 1 : 0));
