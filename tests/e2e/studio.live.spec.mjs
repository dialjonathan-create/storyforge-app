// LIVE mode against a local otherwise-studio worker (wrangler dev): two people in one chapter,
// a read-only watcher sees the draft as it is typed and cannot change it. Runs only when
// STUDIO_SYNC_URL is set (see tests/e2e/run-live.sh); skipped in the default suite.
import { test, expect } from "@playwright/test";

test.skip(!process.env.STUDIO_SYNC_URL, "needs a local otherwise-studio worker (tests/e2e/run-live.sh)");

async function as(context, who) {
  await context.addInitScript((user) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("otherwise_session", JSON.stringify({ accessToken: `tok-${user}`, expiresAt: new Date(Date.now() + 36e5).toISOString(), refreshToken: "r", refreshExpiresAt: new Date(Date.now() + 864e5).toISOString(), sessionId: `s-${user}`, userId: user }));
    localStorage.setItem("otherwise_device", JSON.stringify({ deviceId: "d1", deviceSecret: "x" }));
  }, who);
}

test("a writer types, a reader watches live and cannot type", async ({ browser, request }) => {
  await request.post("/__reset");
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const b = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await as(a, "jonathan");
  await as(b, "keen");
  const writer = await a.newPage();
  const reader = await b.newPage();
  const url = `/studio/meridian-universe/the-meridian/1?run=${Date.now()}`;
  await writer.goto(url);
  await reader.goto(url);
  await expect(writer.locator(".ms-page-body")).toContainText("Sable stood at the rail");
  await expect(reader.locator(".ms-page-body")).toContainText("Sable stood at the rail");
  await expect(writer.locator(".st-status")).toContainText(/synced|Saved/);
  await writer.locator(".ms-page-body p", { hasText: "Nobody answered" }).click();
  await writer.keyboard.press("End");
  await writer.keyboard.type(" Live words.");
  await expect(reader.locator(".ms-page-body")).toContainText("Live words.");
  await reader.locator(".ms-page-body p", { hasText: "Keen climbed" }).click();
  await reader.keyboard.type("ZZZ");
  await expect(writer.locator(".ms-page-body")).not.toContainText("ZZZ");
  await expect(writer.locator(".ms-page-body")).toHaveCount(1);
  // the text appears exactly once for both (no doubled seed)
  const count = await writer.locator(".ms-page-body").innerText();
  expect(count.split("Sable stood at the rail").length - 1).toBe(1);
  await a.close();
  await b.close();
});
