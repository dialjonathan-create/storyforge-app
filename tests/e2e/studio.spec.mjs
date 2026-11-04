// The writing studio, end to end in Chromium (spec §12.3.6-7): editing, suggestions,
// Ability's edits, publish, permissions, sharing, print, session expiry with no data lost,
// no token in any URL, and axe. Against tests/e2e/fakeStudioServer.mjs: synthetic prose only.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SHOTS = process.env.STUDIO_SHOTS || "";
const CH1 = "/studio/meridian-universe/the-meridian/1";

async function as(page, user, { token } = {}) {
  await page.addInitScript(([who, tok]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("otherwise_session", JSON.stringify({ accessToken: tok || `tok-${who}`, expiresAt: new Date(Date.now() + 36e5).toISOString(), refreshToken: "r", refreshExpiresAt: new Date(Date.now() + 864e5).toISOString(), sessionId: "s1", userId: who, child: who === "keen" || who === "talia" }));
    localStorage.setItem("otherwise_device", JSON.stringify({ deviceId: "d1", deviceSecret: "secret" }));
    localStorage.setItem("storyforge_active_readers", JSON.stringify([who]));
  }, [user, token]);
}

const body = (page) => page.locator(".ms-page-body");
async function openChapter(page, user = "jonathan", opts) {
  await as(page, user, opts);
  await page.goto(CH1);
  await expect(body(page)).toContainText("Sable stood at the rail");
  await page.waitForTimeout(500);
}
async function selectText(page, text) {
  await page.evaluate((needle) => {
    const root = document.querySelector(".ms-page-body");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf(needle);
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    throw new Error(`not found: ${needle}`);
  }, text);
  await page.waitForTimeout(150);
}
async function state(page) {
  return (await page.request.get("/__state")).json();
}

test.beforeEach(async ({ request }) => { await request.post("/__reset"); });

test("edits, saves to the Dell in local mode, counts words", async ({ page }) => {
  await openChapter(page);
  await expect(page.locator(".st-footer")).toContainText("words");
  await page.locator(".ms-page-body p", { hasText: "Nobody answered" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Then the bell rang.");
  await expect(body(page)).toContainText("Then the bell rang.");
  await expect(page.locator(".st-status")).toHaveText(/Unsaved changes|Saving|Saved/);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => (await state(page)).checkpoints["1"] || 0).toBeGreaterThan(0);
  await expect(page.locator(".st-footer")).toContainText("4 this session");
});

test("suggesting mode: typing becomes a suggestion, accept and reject work", async ({ page }) => {
  await openChapter(page);
  await page.getByRole("radio", { name: "Suggesting" }).click();
  await page.locator(".ms-page-body p", { hasText: "Nobody answered" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Still nothing.");
  await expect(page.locator("ins.sg-ins")).toContainText("Still nothing.");
  await page.getByRole("tab", { name: /Review/ }).click();
  await expect(page.locator(".sg-card")).toHaveCount(1);
  await expect(page.locator(".sg-card .sg-who")).toHaveText("Jonathan");
  await page.getByRole("button", { name: /Reject suggestion/ }).click();
  await expect(page.locator("ins.sg-ins")).toHaveCount(0);
  await expect(body(page)).not.toContainText("Still nothing.");
  // deletion as a suggestion, then accepted
  await selectText(page, "a little");
  await page.keyboard.press("Backspace");
  await expect(page.locator("del.sg-del")).toContainText("a little");
  await page.getByRole("button", { name: /Accept suggestion/ }).click();
  await expect(body(page)).not.toContainText("a little");
});

test("Ability: Tighten lands as Ability's suggestion; accept, publish, version kept, pending ones left out", async ({ page }) => {
  await openChapter(page);
  await selectText(page, "Sable stood at the rail for a very long time, watching the clouds fold over themselves.");
  await page.locator(".st-bubble").getByRole("button", { name: "Tighten" }).click();
  await expect(page.locator("ins.sg-ins.sg-ability")).toContainText("Sable watched the clouds fold over themselves.");
  await expect(page.locator("del.sg-del.sg-ability")).toContainText("very long time");
  await page.getByRole("tab", { name: /Review/ }).click();
  await expect(page.locator(".sg-card .sg-who")).toHaveText("Ability, asked by Jonathan");
  await page.getByRole("button", { name: /Accept suggestion/ }).click();
  // a pending suggestion that must NOT be published
  await page.getByRole("radio", { name: "Suggesting" }).click();
  await page.locator(".ms-page-body p", { hasText: "Keen climbed" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" PENDING");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.locator(".st-banner")).toContainText("Published. 1 suggestion is still waiting");
  const s = await state(page);
  expect(s.published["1"].prose).toContain("Sable watched the clouds fold over themselves.");
  expect(s.published["1"].prose).not.toContain("PENDING");
  expect(s.published["1"].prose).toContain("<!-- pause -->");
  const pub = s.calls.find((c) => c.command === "storyforge.studio.publish.v1");
  expect(pub.args.choices.length).toBe(3);
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("dialog", { name: "Version history" })).toContainText("Published");
});

test("chat answers with chapter citations and shows what it read", async ({ page }) => {
  await openChapter(page);
  await page.getByLabel("Message to Ability").fill("Does Sable know what Verath looks like yet?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".chat-turn.assistant").last()).toContainText("Not yet");
  await expect(page.locator(".chip.cite")).toHaveText("Ch 2");
  await expect(page.locator(".chips.context")).toContainText("Ch 1 draft");
});

test("check against the lore leaves Ability's comment in Review", async ({ page }) => {
  await openChapter(page);
  await page.locator(".ms-page-body p", { hasText: "Sable stood" }).click();
  await page.getByRole("button", { name: "Check this against the lore" }).click();
  await expect(page.locator(".chat-turn.assistant").last()).toContainText("1 note");
  await page.getByRole("tab", { name: /Review/ }).click();
  await expect(page.locator(".cm-card")).toContainText("[Lore: Sable]");
  await expect(page.locator(".ms-comment")).toHaveCount(1);
});

test("comment & suggest: no Editing, no Publish, typing is a suggestion", async ({ page }) => {
  await openChapter(page, "adele");
  await expect(page.getByRole("radio", { name: "Editing" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Suggesting" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await page.locator(".ms-page-body p", { hasText: "Nobody answered" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Hers.");
  await expect(page.locator("ins.sg-ins")).toContainText("Hers.");
  await expect(page.locator(".st-level")).toHaveText("Your changes are suggestions");
});

test("read only: watching, cannot type", async ({ page }) => {
  await openChapter(page, "keen");
  await expect(page.getByRole("radio", { name: "Viewing" })).toBeChecked();
  await expect(body(page)).toHaveAttribute("contenteditable", "false");
  await page.locator(".ms-page-body p", { hasText: "Nobody answered" }).click();
  await page.keyboard.type("XYZ");
  await expect(body(page)).not.toContainText("XYZ");
  await expect(page.locator(".st-level")).toHaveText("Read only");
});

test("Direct mode is off by default: the box is unticked and Ability's edits arrive as suggestions", async ({ page }) => {
  await openChapter(page);
  await page.getByRole("button", { name: "Share" }).click();
  const box = page.getByRole("dialog", { name: "Share this story" }).getByLabel(/apply Ability's changes directly/);
  await expect(box).not.toBeChecked();
  await page.getByRole("button", { name: "Close sharing" }).click();
  await selectText(page, "Sable stood at the rail for a very long time, watching the clouds fold over themselves.");
  await page.locator(".st-bubble").getByRole("button", { name: "Tighten" }).click();
  await expect(page.locator("ins.sg-ins.sg-ability")).toBeVisible();
  const run = (await state(page)).calls.find((c) => c.command === "storyforge.studio.ai.run.v1");
  expect(run.args.mode).toBe("suggest");
});

test("review: per-suggestion buttons, and Accept all / Reject all only for two or more", async ({ page }) => {
  await openChapter(page);
  await page.getByRole("radio", { name: "Suggesting" }).click();
  await page.locator(".ms-page-body p", { hasText: "Nobody answered" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" One.");
  await page.getByRole("tab", { name: /Review/ }).click();
  await expect(page.locator(".sg-card")).toHaveCount(1);
  await expect(page.locator(".review-bulk")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Accept (it|all)/ })).toHaveCount(0);
  await page.locator(".ms-page-body p", { hasText: "Keen climbed" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Two.");
  await expect(page.locator(".sg-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Accept all 2" })).toBeVisible();
  await page.getByRole("button", { name: "Reject all" }).click();
  await expect(page.locator(".sg-card")).toHaveCount(0);
  await expect(body(page)).not.toContainText("One.");
});

test("sharing: the owner changes levels, others cannot", async ({ page, browser }) => {
  await openChapter(page);
  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share this story" });
  await dialog.getByLabel("Access for Talia").selectOption("none");
  await dialog.getByLabel("Access for Adele").selectOption("edit");
  await dialog.getByRole("button", { name: "Save sharing" }).click();
  await expect(dialog).toContainText("Talia lost access at once");
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await openChapter(other, "adele");
  await expect(other.getByRole("radio", { name: "Editing" })).toBeEnabled();
  await other.getByRole("button", { name: "Share" }).click();
  await expect(other.getByRole("dialog", { name: "Share this story" })).toContainText("Only Jonathan, who made this story");
  await expect(other.getByLabel("Access for Talia")).toBeDisabled();
  await ctx.close();
});

test("print: title page, chapter breaks, no suggestion marks or narration cues", async ({ page }) => {
  await openChapter(page);
  await page.getByRole("radio", { name: "Suggesting" }).click();
  await page.locator(".ms-page-body p", { hasText: "Nobody answered" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" DRAFTONLY");
  await page.getByRole("button", { name: "Print" }).click();
  const dialog = page.getByRole("dialog", { name: "Print" });
  await dialog.getByLabel("The whole story").check();
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator(".pr-title-page h1")).toHaveText("The Meridian");
  await expect(page.locator(".pr-chapter")).toHaveCount(2);
  await expect(page.locator(".print-book")).not.toContainText("pause");
  await expect(page.locator(".print-book")).not.toContainText("DRAFTONLY");
  await expect(page.locator(".print-book em", { hasText: "Meridian" })).toHaveCount(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-bar")).toBeHidden();
  const breaks = await page.locator(".pr-chapter").last().evaluate((el) => getComputedStyle(el).breakBefore);
  expect(breaks).toBe("page");
  const pdf = await page.pdf({ format: "Letter" });
  expect(pdf.length).toBeGreaterThan(5000);
  if (SHOTS) {
    await page.emulateMedia({ media: "screen" });
    await page.screenshot({ path: path.join(SHOTS, "print-preview.png") });
    fs.writeFileSync(path.join(SHOTS, "print.pdf"), pdf);
  }
  // the draft, with suggestions accepted
  await page.goBack();
  await expect(body(page)).toContainText("DRAFTONLY");
  await page.getByRole("button", { name: "Print" }).click();
  await page.getByRole("dialog", { name: "Print" }).getByLabel("This chapter's current draft").check();
  await page.getByRole("dialog", { name: "Print" }).getByLabel("Print waiting suggestions as if accepted").check();
  await page.getByRole("dialog", { name: "Print" }).getByRole("button", { name: "Preview" }).click();
  await expect(page.locator(".print-book")).toContainText("DRAFTONLY");
  await expect(page.locator(".print-book ins, .print-book del")).toHaveCount(0);
});

test("an expired session keeps the text and resumes with the PIN", async ({ page }) => {
  await openChapter(page, "jonathan", { token: "tok-jonathan-old" });
  await page.locator(".ms-page-body p", { hasText: "Nobody answered" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Written before the timeout.");
  await page.request.post("/__expire", { data: { token: "tok-jonathan-old" } });
  await page.getByRole("button", { name: "History" }).click();   // any call now meets the lapsed session
  const pin = page.getByRole("dialog", { name: /Welcome back/ });
  await expect(pin).toBeVisible();
  await expect(body(page)).toHaveAttribute("contenteditable", "false");
  await expect(body(page)).toContainText("Written before the timeout.");
  await expect(page.locator(".st-status")).toContainText("kept on this device");
  await pin.getByLabel("PIN").fill("2468");
  await expect(pin.getByLabel(/my own computer/)).toBeChecked();
  await pin.getByRole("button", { name: "Keep writing" }).click();
  await expect(pin).toBeHidden();
  await expect(body(page)).toHaveAttribute("contenteditable", "true");
  await expect(body(page)).toContainText("Written before the timeout.");
  await expect.poll(async () => (await state(page)).calls.some((c) => c.command === "storyforge.studio.checkpoint.v1" && String(c.args.markdown).includes("Written before the timeout."))).toBe(true);
  const signin = await page.evaluate(() => JSON.parse(localStorage.getItem("otherwise_session")));
  expect(signin.accessToken).not.toBe("tok-jonathan-old");
});

test("no token in any URL or Referer", async ({ page }) => {
  const seen = [];
  page.on("request", (r) => seen.push({ url: r.url(), referer: r.headers().referer || "" }));
  await openChapter(page);
  await page.getByLabel("Message to Ability").fill("Who is Sable?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".chat-turn.assistant").last()).toBeVisible();
  for (const r of seen) {
    expect(r.url).not.toMatch(/tok-|token=|ticket=|v1\.[A-Za-z0-9_-]{20,}/);
    expect(r.referer).not.toMatch(/tok-|token=|ticket=/);
  }
});

test("axe: no serious or critical issues, light and dark", async ({ page }) => {
  await openChapter(page);
  const axe = fs.readFileSync(path.resolve("node_modules/axe-core/axe.min.js"), "utf8");
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Theme").selectOption(theme);
    await page.waitForTimeout(200);
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(async () => window.axe.run(document.querySelector(".studio"), { resultTypes: ["violations"] }));
    const bad = result.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});

test("screenshots of the studio (light, dark, sepia)", async ({ page }) => {
  test.skip(!SHOTS, "set STUDIO_SHOTS to a folder to keep screenshots");
  await openChapter(page);
  await selectText(page, "Sable stood at the rail for a very long time, watching the clouds fold over themselves.");
  await page.locator(".st-bubble").getByRole("button", { name: "Tighten" }).click();
  await expect(page.locator("ins.sg-ins.sg-ability")).toBeVisible();
  await page.getByLabel("Message to Ability").fill("Does Sable know what Verath looks like yet?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".chip.cite")).toBeVisible();
  await page.mouse.click(5, 450);
  for (const theme of ["light", "dark", "sepia"]) {
    await page.getByLabel("Theme").selectOption(theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `studio-${theme}.png`) });
  }
  await page.getByLabel("Theme").selectOption("light");
  await page.getByRole("tab", { name: /Review/ }).click();
  await page.screenshot({ path: path.join(SHOTS, "studio-review.png") });
  await page.getByRole("button", { name: "Share" }).click();
  await page.screenshot({ path: path.join(SHOTS, "studio-share.png") });
});
