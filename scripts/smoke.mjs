/**
 * Headless smoke test — boots the Vite dev server, drives the browser demo
 * (`/?demo=1`) through the Execute board + Fleet org chart + Auto-execute, and
 * fails on any console error / uncaught exception or if it never reaches the board.
 *
 * Run: `npm run test:smoke`. Requires the `playwright` devDependency + Chromium
 * (`npx playwright install chromium`). Screenshots go to the gitignored `.smoke/`.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".smoke");
const URL = "http://localhost:1420";
const fail = (msg) => { console.error("SMOKE FAIL:", msg); process.exitCode = 1; };

async function waitForServer(ms = 30000) {
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
  const cleanup = () => { try { process.kill(-vite.pid); } catch {} };
  process.on("exit", cleanup);

  try {
    if (!(await waitForServer())) { fail("dev server did not start"); return; }
    console.log("• dev server up; launching chromium…");
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], pageErrors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message || String(e)));
    const shot = (n) => page.screenshot({ path: join(OUT, n) }).catch(() => {});
    const clickText = async (t) => { try { await page.getByText(t, { exact: false }).first().click({ timeout: 4000 }); await page.waitForTimeout(600); } catch {} };

    console.log("• loading /?demo=1");
    await page.goto(`${URL}/?demo=1`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(3000); // splash + demo boot

    const mounted = await page.evaluate(() => { const r = document.getElementById("root"); return !!r && r.children.length > 0; });
    const body = await page.evaluate(() => document.body.innerText.slice(0, 400));
    if (!mounted) fail("#root did not mount");
    if (/Choose your AI provider/.test(body)) fail("demo landed on SignIn, not the app");
    if (!/Execute/.test(body) || !/stories/.test(body)) fail("did not land on the Execute board");
    await shot("01-landing.png");

    // Exercise the tabs + run a mock agent.
    await clickText("Fleet");    await shot("02-fleet.png");
    await clickText("Auto-execute"); // may hit the hidden tab copy; best-effort
    try { await page.locator('button:visible', { hasText: "Auto-execute" }).first().click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(4000);
    await shot("03-agent-running.png");
    await clickText("Shard");    await shot("04-kanban.png");
    await clickText("Plan");     await shot("05-plan.png");

    if (pageErrors.length) fail(`${pageErrors.length} uncaught error(s): ${pageErrors[0]}`);
    if (errors.length) fail(`${errors.length} console error(s): ${errors[0]}`);

    await browser.close();
    if (!process.exitCode) console.log(`• PASS — mounted, reached Execute, ${errors.length} console errors, ${pageErrors.length} uncaught. Screenshots in .smoke/`);
  } finally {
    cleanup();
  }
}

main().catch((e) => { console.error("SMOKE HARNESS ERROR:", e); process.exitCode = 1; });
