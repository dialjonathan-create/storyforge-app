/**
 * The gate the pipeline did not have.
 *
 * storyforge-app deploys to production on merge, and its CI has never rendered
 * a page. On 2026-09-13 two PRs went out that made the reader unusable on the
 * family's phones, and both passed every test in the suite: the prose corrupted
 * itself only on the SECOND render, and "the page is a third of viewport width"
 * is a layout fact that jsdom — which applies no stylesheets and computes no
 * geometry — cannot observe at all.
 *
 * So this renders the reader's own components in a real browser at real phone
 * widths and asserts the one thing that was visibly wrong: the document must
 * not be wider than the window.
 *
 * It builds its own harness and serves the output from a plain node server.
 * The first version started `vite` as a background process and polled it, and
 * the CI runner lost that race on the first run — a check that flakes is a
 * check that gets deleted.
 *
 * It needs no token, no deployed build and no network. It is deliberately small:
 * a cheap check that runs on every pull request is worth more than a thorough
 * one that gets switched off.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { FIXTURES } from "./fixtures.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(HERE, ".dist");
const WIDTHS = [320, 390, 430];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
// Vite keeps the input's path inside the output, so the page lands nested.
const HARNESS = "tests/layout/harness.html";

execFileSync("npx", ["vite", "build", "--config", path.join(HERE, "vite.layout.config.js")],
             { stdio: "inherit" });

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(DIST, urlPath === "/" ? HARNESS : urlPath);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ["--no-sandbox"],
});
const failures = [];
let checked = 0;

for (const name of Object.keys(FIXTURES)) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 780 } });
    await page.goto(`http://127.0.0.1:${port}/${HARNESS}?fixture=${name}`, { waitUntil: "load" });
    await page.waitForSelector(name === "canary" ? "#root div" : ".prose p", { timeout: 20000 });
    const seen = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      widest: Math.max(0, ...[...document.querySelectorAll(".prose p")].map((p) => p.scrollWidth)),
    }));
    await page.close();
    checked += 1;
    // One pixel of slack for sub-pixel rounding. The failure this exists to
    // catch was 1540 against 390.
    const overflows = seen.scrollWidth > seen.innerWidth + 1;
    const shouldOverflow = name === "canary";
    if (overflows !== shouldOverflow) {
      failures.push({ fixture: name, width, ...seen, expected: shouldOverflow ? "overflow" : "no overflow" });
    }
  }
}

await browser.close();
server.close();

if (failures.length) {
  console.error("Layout check FAILED:");
  for (const f of failures) console.error(" ", JSON.stringify(f));
  console.error("\nA page wider than the window is a page that scrolls sideways on a phone.");
  process.exit(1);
}
console.log(`Layout check passed: ${checked} renders at ${WIDTHS.join("/")}px.`);
console.log("(The 'canary' fixture is asserted to overflow, so the check is known to be able to fail.)");
process.exit(0);
