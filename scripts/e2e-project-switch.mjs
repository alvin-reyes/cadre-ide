/**
 * Regression test for the project-scoped cockpit fix.
 *
 * The bug: the Maintain cockpit and the dock terminal were both keyed
 * `key={projectRoot}`, so switching project tabs unmounted their subtree and
 * TerminalPanel's cleanup called kill_pty — killing the PTY and the `claude`
 * session inside it. Before the fix this script observed a teardown of a pane that
 * had been alive for ~14s; after it, switching tabs must tear down nothing.
 *
 * Evidence comes from the `[cadre:pty]` instrumentation. StrictMode double-mounts in
 * dev also log a teardown, but always with `pty=-` / `alive=0.0s` — only teardowns of
 * a pane with a real pty id and non-zero uptime count as the regression.
 *
 * Run: `npm run test:project-switch`. Requires playwright + Chromium.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".smoke");
const URL = "http://localhost:1420";
const fail = (m) => { console.error("PROJECT-SWITCH FAIL:", m); process.exitCode = 1; };

/** A teardown that matters: a real pty id and a pane that had actually been alive. */
function isLiveTeardown(line) {
  if (!line.includes("teardown")) return false;
  const pty = (line.match(/pty=(\S+)/) || [])[1];
  const alive = parseFloat((line.match(/alive=([\d.]+)s/) || [])[1] ?? "0");
  return pty !== "-" && alive > 0.5; // StrictMode remounts are pty=- / alive=0.0s
}

async function waitForServer(ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(URL); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const vite = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "ignore", detached: true });
  const cleanup = () => { try { process.kill(-vite.pid); } catch { /* gone */ } };
  process.on("exit", cleanup);

  let browser;
  try {
    if (!(await waitForServer())) { fail("dev server did not start"); return; }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

    const pty = [];
    page.on("console", (m) => { const t = m.text(); if (t.includes("[cadre:pty]")) pty.push(t); });

    await page.goto(`${URL}/?demo=1`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(4500);

    // The dock rail sits under a transparent overlay, and this test is about React
    // mount behaviour rather than click ergonomics — dispatch straight at the element.
    const click = (prefix) => page.evaluate((p) => {
      const b = [...document.querySelectorAll("button")]
        .find((x) => (x.getAttribute("aria-label") || "").startsWith(p));
      if (!b) return false;
      b.click();
      return true;
    }, prefix);

    console.log("• opening the dock terminal for project A");
    if (!(await click("Terminal"))) { fail("Terminal dock button not found"); return; }
    await page.waitForTimeout(3000);

    console.log("• opening a second project");
    if (!(await click("Open another project"))) { fail("+ project button not found"); return; }
    await page.waitForTimeout(6000);

    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((x) => x.getAttribute("aria-label"))
        .filter((l) => l && l.startsWith("Switch to project")).length
    );
    if (tabs < 2) { fail(`expected 2 project tabs, got ${tabs}`); return; }

    // Let project B's terminals get comfortably past the StrictMode noise window, so
    // any teardown we see afterwards is unambiguously a live pane being destroyed.
    await page.waitForTimeout(6000);

    // ── THE TRIGGER ──────────────────────────────────────────────────────────
    const before = pty.length;
    console.log("• switching back to project A");
    if (!(await click("Switch to project acme"))) { fail("project A tab not found"); return; }
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(OUT, "project-switch.png") }).catch(() => {});

    const caused = pty.slice(before);
    const live = caused.filter(isLiveTeardown);

    console.log(`\npty lines caused by the switch: ${caused.length}`);
    caused.forEach((l) => console.log("   " + l));

    if (live.length > 0) {
      console.error("\nLive panes torn down by a project switch:");
      live.forEach((l) => console.error("   " + l));
      fail(`${live.length} live PTY teardown(s) on a project switch — the cockpit is not project-scoped`);
    } else {
      console.log("\n• PASS — switching project tabs tore down no live PTY.");
    }
  } catch (e) {
    fail(String(e).split("\n")[0]);
  } finally {
    try { await browser?.close(); } catch { /* already closed */ }
    cleanup();
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
