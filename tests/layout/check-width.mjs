/**
 * The gate the pipeline did not have.
 *
 * storyforge-app deploys to production on merge and its CI has never rendered a
 * page. On 2026-09-13 two PRs went out that made the reader unusable, and both
 * of them passed every test: the corruption only appeared on the SECOND render,
 * and the page being a third of viewport width is a layout fact that jsdom —
 * which applies no stylesheets and computes no geometry — cannot observe at all.
 *
 * So this runs a real browser at a real phone width and asserts the one thing
 * that was visibly wrong: the document must not be wider than the window.
 *
 * It is deliberately small. It does not screenshot, diff pixels, or need a
 * token, a server or a deployed build — it renders the reader's own components
 * against fixture prose through the project's own dev server. A check that is
 * cheap enough to run on every pull request is worth more than a perfect one
 * that gets switched off.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { FIXTURES } from "./fixtures.js";

const PORT = 51731;
const WIDTHS = [320, 390, 430];
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM || undefined;

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const stop = () => { try { vite.kill("SIGTERM"); } catch { /* already gone */ } };
process.on("exit", stop);

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/tests/layout/harness.html`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the dev server never came up");
}

await waitForServer();
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
const failures = [];
let checked = 0;

for (const name of Object.keys(FIXTURES)) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 780 } });
    await page.goto(`http://127.0.0.1:${PORT}/tests/layout/harness.html?fixture=${name}`, { waitUntil: "load" });
    await page.waitForSelector(name === "canary" ? "#root div" : ".prose p", { timeout: 15000 });
    const seen = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      widest: Math.max(0, ...[...document.querySelectorAll(".prose p")].map((p) => p.scrollWidth)),
    }));
    await page.close();
    checked += 1;
    // One pixel of slack for sub-pixel rounding; the failure this catches was
    // 1540 against 390.
    const overflows = seen.scrollWidth > seen.innerWidth + 1;
    const shouldOverflow = name === "canary";
    if (overflows !== shouldOverflow) {
      failures.push({ fixture: name, width, ...seen, expected: shouldOverflow ? "overflow" : "no overflow" });
    }
  }
}

await browser.close();
stop();

if (failures.length) {
  console.error("Layout check FAILED:");
  for (const f of failures) console.error(" ", JSON.stringify(f));
  console.error("\nA page wider than the window is a page that scrolls sideways on a phone.");
  process.exit(1);
}
console.log(`Layout check passed: ${checked} renders, ${WIDTHS.join("/")}px wide.`);
console.log("(The 'canary' fixture is asserted to overflow, so the check is known to be able to fail.)");
process.exit(0);
