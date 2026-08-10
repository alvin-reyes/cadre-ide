/**
 * Extensive e2e sweep of the Cadre desktop (browser demo, mock backend).
 * Exercises the major surfaces and fails on ANY console error / uncaught exception:
 *   Build: Execute board · Fleet org-chart · Auto-execute → Done
 *   Maintain cockpit: prompt rail · thoughts dock (pages/templates) · stage → Run all → fleet tiles
 *   Chrome: theme toggle (light/dark) · Guardian/Audit findings panel · other views
 * Run: `node scripts/e2e-extensive.mjs`
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const ROOT = process.cwd();
const OUT = process.env.E2E_OUT || `${ROOT}/.e2e`;
const URL = "http://localhost:1420";
const results = [];
let fatal = false;
const step = (name, ok, note = "") => { results.push({ name, ok, note }); console.log(`  ${ok ? "✓" : "✗"} ${name}${note ? " — " + note : ""}`); };
const section = (s) => console.log("\n• " + s);

const waitForServer = async (ms = 30000) => { const d = Date.now() + ms; while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 300)); } return false; };
const until = async (fn, ms, s = 800) => { const d = Date.now() + ms; while (Date.now() < d) { try { if (await fn()) return true; } catch {} await new Promise((r) => setTimeout(r, s)); } return false; };

async function main() {
  mkdirSync(OUT, { recursive: true });
  section("starting vite…");
  const vite = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "ignore", detached: true });
  const cleanup = () => { try { process.kill(-vite.pid); } catch {} };
  process.on("exit", cleanup);
  try {
    if (!(await waitForServer())) { console.error("dev server did not start"); fatal = true; return; }
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [], pageErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message || String(e)));
    const body = () => page.evaluate(() => document.body.innerText);
    const has = async (re) => re.test(await body());
    const shot = (n) => page.screenshot({ path: `${OUT}/${n}` }).catch(() => {});
    const click = async (re, t = 4000) => { try { await page.getByRole("button", { name: re }).first().click({ timeout: t }); return true; } catch { try { await page.getByText(re, { exact: false }).first().click({ timeout: 2000 }); return true; } catch { return false; } } };

    // ── Build: boot → Execute board ──
    section("Build — boot, Execute board, Fleet, Auto-execute → Done");
    await page.goto(`${URL}/?demo=1`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(3500);
    await click(/Add features/); await page.waitForTimeout(600);
    step("Execute board renders", await has(/Execute/) && await has(/BACKLOG|stories/i));
    await shot("ext-01-execute.png");
    step("Fleet org-chart", (await click(/^Fleet$/)) && (await has(/Orchestrator|Fleet/i)));
    await shot("ext-02-fleet.png");
    await click(/Shard$/); await click(/Auto-execute/);
    step("Auto-execute → a story reaches Done", await until(async () => /\b[1-9]\d*\s+done\b/i.test(await body()), 90000, 2500));
    await shot("ext-03-done.png");

    // ── Theme toggle ──
    section("Theme — light/dark toggle");
    const beforeTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    await page.getByRole("button", { name: /light|dark theme/i }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    const afterTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    step("theme toggles data-theme", beforeTheme !== afterTheme, `${beforeTheme} → ${afterTheme}`);
    await shot("ext-04-theme.png");

    // ── Guardian/Audit findings panel ──
    section("Guardian/Audit — findings panel opens");
    await page.getByRole("button", { name: /Guardian and Audit/i }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    step("findings panel opens", await has(/Guardian & Audit|Evaluate now/i));
    await shot("ext-05-eval.png");
    await page.keyboard.press("Escape").catch(() => {});
    await click(/Close/).catch(() => {});

    // ── Maintain cockpit ──
    section("Maintain cockpit — rail, thoughts dock, stage → Run all → fleet tiles");
    await click(/Maintain/); await page.waitForTimeout(1200);
    step("Maintain view renders", await has(/Maintain|Stage tasks|Thoughts/i));
    await shot("ext-06-maintain.png");
    // Expand the prompt rail (hidden by default).
    await page.getByRole("button", { name: /Show prompt sidebar/i }).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    step("prompt rail expands (search + prompts)", await has(/Search prompts|Compose|Staged/i));
    await shot("ext-07-rail.png");
    // Stage a task + Run all.
    const composer = page.getByPlaceholder(/Compose a task/i).first();
    let ranFleet = false;
    if (await composer.count()) {
      await composer.fill("Bump the dependencies and fix any breakage.");
      await click(/Add to list/); await page.waitForTimeout(400);
      await click(/Run all/);
      ranFleet = await until(async () => /Fleet ·/.test(await body()), 15000);
    }
    step("Run all opens a Fleet tab with subagents", ranFleet);
    await shot("ext-08-fleet-tiles.png");
    // Thoughts dock: expand + a page + templates menu.
    await click(/Terminal/).catch(() => {}); await page.waitForTimeout(600);
    step("Thoughts dock present", await has(/Thoughts/i));
    await click(/Templates/).catch(() => {});
    await page.waitForTimeout(500);
    step("Thoughts templates menu opens", await has(/Explain this|Plan before coding|Write a failing test/i));
    await shot("ext-09-thoughts.png");

    await browser.close();

    // ── Verdict ──
    if (pageErrors.length) { step("no uncaught exceptions", false, `${pageErrors.length}: ${pageErrors[0]}`); fatal = true; }
    else step("no uncaught exceptions", true);
    if (consoleErrors.length) { step("no console errors", false, `${consoleErrors.length}: ${consoleErrors[0]}`); fatal = true; }
    else step("no console errors", true);

    const failedSteps = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failedSteps.length}/${results.length} checks passed ===`);
    if (failedSteps.length) { console.log("failed:", failedSteps.map((r) => r.name).join(" | ")); fatal = fatal || failedSteps.some((r) => /Done|console|uncaught/i.test(r.name)); }
    console.log(fatal ? "EXTENSIVE E2E: FAIL" : "EXTENSIVE E2E: PASS");
  } finally { cleanup(); }
}
main().catch((e) => { console.error("HARNESS ERROR:", e); fatal = true; }).finally(() => process.exit(fatal ? 1 : 0));
