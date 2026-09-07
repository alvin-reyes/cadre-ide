/**
 * Regression test — clicking a search hit inside a Markdown file must jump to
 * that line, not just open the file.
 *
 * This shipped broken in v0.13.0. The document viewer made `.md` open RENDERED
 * by default, so a search hit has to flip the Workbench into Monaco first. That
 * mounts the editor in the SAME commit that sets `gotoLine` — the reveal effect
 * ran with `editorRef.current` still null (onMount resolves afterwards), and
 * because its only dependency was `nonce`, which never changes again, the jump
 * was dropped silently. Cheap to reintroduce, invisible without a real browser,
 * and impossible to catch in vitest (node-only, no DOM).
 *
 * Run: `npm run test:search-jump`. Requires the `playwright` devDependency +
 * Chromium (`npx playwright install chromium`).
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".e2e");
const URL = "http://localhost:1420";

let failed = false;
const fail = (m) => { console.error("  FAIL:", m); failed = true; };
const ok = (m) => console.log("  ok:", m);
const step = (m) => console.log("•", m);

async function waitForServer(ms = 40000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(URL); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("• starting vite dev server…");
  const vite = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "ignore", detached: true });
  const cleanup = () => { try { process.kill(-vite.pid); } catch { /* already gone */ } };
  process.on("exit", cleanup);

  if (!(await waitForServer())) { fail("dev server did not start"); return; }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + (e.message || e)));

  step("loading /?demo=1");
  await page.goto(`${URL}/?demo=1`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(3500);

  // Demo boots the mode-choice modal, which intercepts pointer events.
  const dlg = page.locator('div[role="dialog"][aria-label*="Choose how to work"]');
  if (await dlg.count()) {
    await dlg.getByText("Build", { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  step("Files view → Search panel");
  await page.locator('button[aria-label="Files"]').first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  // The Explorer/Search switch uses `title`, not aria-label.
  await page.locator('button[title="Search"]').first().click({ timeout: 6000 });
  await page.waitForTimeout(600);

  const input = page.locator("input").first();
  if (!(await input.count())) { fail("no search input"); await browser.close(); return; }

  await input.fill("the");
  await input.press("Enter");
  await page.waitForTimeout(1800);

  const body = await page.evaluate(() => document.body.innerText);
  const md = /([\w./-]+\.md)/.exec(body);
  if (!md) { fail("no .md file in the search results — cannot exercise the regression"); await browser.close(); return; }

  step(`opening a match inside ${md[1]}`);
  await page.getByText(md[1], { exact: false }).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);

  // Only these rows call openAt(); the file header just toggles the group.
  const rows = page.locator('[title^="Line "]');
  if ((await rows.count()) === 0) { fail("no match rows to click"); await browser.close(); return; }

  const rowTitle = await rows.first().getAttribute("title");
  const expectedLine = (rowTitle || "").replace("Line ", "").trim();
  await rows.first().click({ timeout: 6000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, "search-jump.png") }).catch(() => {});

  if ((await page.locator(".monaco-editor").count()) === 0) {
    fail("Monaco did not mount — the Workbench stayed on the rendered Markdown view");
  } else {
    ok("Monaco mounted (Workbench flipped out of the rendered view)");
    // Monaco tags the cursor's gutter entry with .active-line-number.
    const active = await page.evaluate(() => {
      const el = document.querySelector(".line-numbers.active-line-number");
      return el ? (el.textContent || "").trim() : null;
    });
    if (active === null) fail("could not read the active line number from Monaco's gutter");
    else if (active === expectedLine) ok(`jumped to line ${active}, as the clicked result asked`);
    else if (active === "1") fail("active line is 1 — the reveal was dropped (the regression)");
    else fail(`jumped to line ${active}, expected ${expectedLine}`);
  }

  if (errors.length) fail(`console errors: ${JSON.stringify(errors.slice(0, 4))}`);
  else ok("0 console errors / uncaught exceptions");

  await browser.close();
  console.log(failed ? "\nSEARCH-JUMP FAIL" : "\nPASS — search result jumps to its line in a Markdown file.");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
