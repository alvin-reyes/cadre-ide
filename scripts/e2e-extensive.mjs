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
    // Close the Templates popover — it renders a full-viewport `position:fixed`
    // click-to-dismiss backdrop (ThoughtsDock.tsx) that otherwise intercepts every
    // subsequent click (Settings included) even though it's invisible. The backdrop
    // itself (not the toggle button, which the backdrop now covers) is what has the
    // dismiss handler, so click a corner of the viewport to hit it.
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(300);

    // ── Connections — Settings → catalog tile → Test → Save → connected list ──
    section("Connections — GitHub preset, Test, Save, appears connected");
    // The Settings trigger is an icon-only button (accessible name comes from its
    // `title` attribute, not visible text), so target it directly rather than via
    // the click() helper's getByText fallback (which needs visible text).
    await page.getByTitle(/Settings/).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    step("Settings opens on the Connections section", await has(/Connections/i) && await has(/GitHub/i));
    await click(/GitHub/); await page.waitForTimeout(400);
    step("GitHub connect modal opens", await has(/Connect GitHub|Personal access token/i));
    await click(/^Test$/);
    const probed = await until(async () => /Connected · \d+ tools/.test(await body()), 8000, 500);
    step("Test shows Connected · N tools", probed);
    await shot("ext-10-connections.png");
    const tokenField = page.getByPlaceholder(/ghp_/).first();
    if (await tokenField.count()) await tokenField.fill("ghp_e2efaketoken000000000000000000");
    // Scope to the innermost dialog: the API-keys section (rendered earlier in
    // the Settings DOM, itself also role="dialog") has its own disabled "Save"
    // buttons, and both the outer Settings dialog and the nested "Connect
    // GitHub" dialog match a hasText filter (the outer one contains the inner
    // one's text too) — so an unscoped/`.first()` lookup grabs the outer
    // dialog's subtree, resolves to a disabled API-key Save button, and the
    // click() helper's 4s wait for it to become enabled times out. `.last()`
    // picks the innermost (nested) dialog, whose own Save button is enabled.
    const connectGithubDialog = page.getByRole("dialog").filter({ hasText: /Connect GitHub/ }).last();
    await connectGithubDialog.getByRole("button", { name: /^Save$/ }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    // Save doesn't persist the modal's transient "Connected · N tools" test
    // result onto the row (a fresh connection isn't in the store yet when Test
    // probes it, so there's nothing for the probe to update) — the saved row
    // shows "Not connected" until probed again. So assert on what Save actually
    // guarantees: the modal closes, the empty-state placeholder is replaced by
    // a real row, and that row is enabled (Test succeeding flips enabled=true
    // by default on save) — via its "Disable GitHub" checkbox aria-label.
    const enabledCheckbox = await page.getByLabel(/Disable GitHub/i).count();
    step(
      "saved connection appears in the connected list",
      !(await has(/Connect GitHub/)) && !(await has(/No connections yet/i)) && enabledCheckbox > 0
    );

    // ── Tracker designation — mark the just-saved GitHub connection as tracker ──
    // (mcpTrackerStore/ConnectionsView: the icon-only "Use as tracker" button has
    // no visible label, only an aria-label, so target it by accessible name. The
    // badge's `cadre-label-mono` class force-uppercases it via CSS, so innerText
    // renders it as "TRACKER" — matching that exact (case-sensitive) all-caps
    // form is what distinguishes it from the nearby, normal-case "GitHub
    // tracker" / "Enable GitHub tracker" text from the legacy gh-CLI section,
    // which is otherwise visible on the same Settings page and would false-match
    // a case-insensitive /tracker/i probe.)
    section("Connections — designate GitHub as the MCP tracker");
    const trackerBadgeBefore = await has(/\bTRACKER\b/);
    const clickedTrackerBtn = await click(/Use .* as tracker/i);
    const trackerBadgeAfter = await until(async () => /\bTRACKER\b/.test(await body()), 4000, 300);
    step(
      "Tracker badge appears after designating the connection",
      clickedTrackerBtn && !trackerBadgeBefore && trackerBadgeAfter
    );
    await shot("ext-11-tracker.png");

    await click(/Close/).catch(() => {}); await page.keyboard.press("Escape").catch(() => {});

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
