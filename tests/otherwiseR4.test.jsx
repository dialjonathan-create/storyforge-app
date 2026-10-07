/**
 * Otherwise round-4 audit, 2026-10-07 -- the web reader.
 *
 * R4-02  two tabs of one reader refreshed at once; the second presented the token
 *        the first had just rotated away and the server signed BOTH out. The
 *        single-flight was per tab; now it is per device (Web Lock, or a
 *        localStorage lease), and the stored session is re-read inside the lock.
 * R4-07  a deep link to a deleted story drew a stand-in "Story", then "Couldn't
 *        open chapter 1. Error inv_..." -- on a child's screen; a world's page said
 *        "That story isn't in your library."
 * R4-08  an offline reload of a chapter opened but not scrolled landed on chapter
 *        1 (blank); a first visit then offline was blank because the bundle was
 *        never in the service worker's cache.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fakeStoryServer, chapterDoc } from "./helpers/fakeStoryServer";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
vi.mock("../src/kokoro", () => ({ fetchVoices: async () => [], synthesize: async () => new ArrayBuffer(8) }));

const auth = await import("../src/auth.js");
const main = await import("../src/main.jsx");
const { precacheList, injectPrecache, PRECACHE_MARKER, BUILD_MARKER } = await import("../build/precacheManifest.js");

function sessionFor(userId, extra = {}) {
  return {
    accessToken: `access-${userId}`, userId, sessionId: `sid-${userId}`, refreshToken: `refresh-${userId}-0`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
    ...extra,
  };
}

function signIn(userId, extra = {}) {
  localStorage.setItem("otherwise_session", JSON.stringify(sessionFor(userId, extra)));
  localStorage.setItem("storyforge_default_reader", userId);
  localStorage.setItem("storyforge_reading_group", JSON.stringify([userId]));
  main.setCurrentReaderId(userId);
}

function readerAt(storyId = "s1", universeId = "u1") {
  return render(
    <MemoryRouter initialEntries={[`/universes/${universeId}/stories/${storyId}`]}>
      <main.AppProvider>
        <Routes>
          <Route path="/universes/:id/stories/:storyId" element={<main.ChapterReader />} />
          <Route path="/universes/:id" element={<p>WORLD PAGE</p>} />
        </Routes>
      </main.AppProvider>
    </MemoryRouter>,
  );
}

const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
  else delete navigator.locks;
});

// ---------------------------------------------------------------------------
// R4-02: one refresh per device
// ---------------------------------------------------------------------------

/** A server that rotates like the real one: the current token gets a new pair,
 *  anything else is a replay and revokes. */
function rotatingServer() {
  const state = { current: "refresh-keen-0", n: 0, refreshCalls: 0, revoked: false };
  global.fetch = vi.fn(async (url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    if (String(url).endsWith("/v1/auth/storyforge/refresh")) {
      state.refreshCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      if (state.revoked || body.refreshToken !== state.current) {
        state.revoked = true;
        return new Response(JSON.stringify({ ok: false, error: "REFRESH_REPLAYED" }), { status: 401 });
      }
      state.n += 1;
      state.current = `refresh-keen-${state.n}`;
      return new Response(JSON.stringify({
        ok: true, accessToken: `access-keen-${state.n}`, refreshToken: state.current,
        expiresAt: new Date(Date.now() + 900_000).toISOString(), sessionId: "sid-keen", userId: "keen",
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return state;
}

async function twoTabs() {
  vi.resetModules();
  const tabA = await import("../src/auth.js");
  vi.resetModules();
  const tabB = await import("../src/auth.js");
  return [tabA, tabB];
}

describe("R4-02: two tabs never sign each other out", () => {
  it("two tabs refreshing at once send ONE refresh and both keep the session (storage lease)", async () => {
    delete navigator.locks;
    signIn("keen", { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const server = rotatingServer();
    const [tabA, tabB] = await twoTabs();
    const [a, b] = await Promise.all([tabA.refreshSession(), tabB.refreshSession()]);
    expect(server.refreshCalls).toBe(1);
    expect(server.revoked).toBe(false);
    expect(a.accessToken).toBe("access-keen-1");
    expect(b.accessToken).toBe("access-keen-1");
    expect(JSON.parse(localStorage.getItem("otherwise_session")).refreshToken).toBe("refresh-keen-1");
  });

  it("uses the Web Lock when the browser has one", async () => {
    const requested = [];
    let chain = Promise.resolve();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (name, options, fn) => {
          requested.push(name);
          const run = chain.then(() => fn());
          chain = run.catch(() => {});
          return run;
        },
      },
    });
    signIn("keen", { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const server = rotatingServer();
    const [tabA, tabB] = await twoTabs();
    await Promise.all([tabA.refreshSession(), tabB.refreshSession()]);
    expect(requested).toEqual(["otherwise-session-refresh", "otherwise-session-refresh"]);
    expect(server.refreshCalls).toBe(1);
    expect(server.revoked).toBe(false);
  });

  it("a session another tab already refreshed is used as it is -- nothing is sent", async () => {
    delete navigator.locks;
    const stale = sessionFor("keen", { expiresAt: new Date(Date.now() - 1000).toISOString() });
    signIn("keen", { accessToken: "access-keen-9", refreshToken: "refresh-keen-9" });
    const server = rotatingServer();
    const out = await auth.refreshSession(stale);
    expect(out.accessToken).toBe("access-keen-9");
    expect(server.refreshCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R4-07: a story or world that is not there
// ---------------------------------------------------------------------------

describe("R4-07: a deep link to something deleted", () => {
  it("a story missing from its world says so, offers Back, and draws no stand-in", async () => {
    signIn("keen");
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "other", title: "Other" }] }),
      "storyforge.chapter.get.v1": () => chapterDoc(1),
    });
    readerAt("gone");
    expect(await screen.findByText("This story isn't here any more.")).toBeTruthy();
    expect(server.commands("storyforge.chapter.get.v1")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/Couldn't open chapter|inv_/);
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Back" }));
    expect(await screen.findByText("WORLD PAGE")).toBeTruthy();
  });

  it("a child never sees an inv_ reference; a grown-up still can", async () => {
    const failing = () => new Response(JSON.stringify({
      ok: false, error: "storyforge_failed", message: "Something went wrong with the story just now.",
      invocationId: "inv_f431470d-aaaa-bbbb",
    }), { status: 500 });
    signIn("keen");
    fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky", totalChapters: 1, currentChapter: 1 }] }),
      "storyforge.chapter.get.v1": failing,
    });
    readerAt();
    expect(await screen.findByText("Couldn't open chapter 1.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("inv_");
    cleanup();
    signIn("jonathan");
    fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky", totalChapters: 1, currentChapter: 1 }] }),
      "storyforge.chapter.get.v1": failing,
    });
    readerAt();
    expect(await screen.findByText("Couldn't open chapter 1.")).toBeTruthy();
    expect(document.body.textContent).toContain("inv_f431470d");
  });

  it("friendlyErrorText drops the reference for a child", () => {
    const err = new main.StoryRequestError("x", { errorId: "inv_31b17c04-0957" });
    signIn("talia");
    expect(main.friendlyErrorText(err, "Try again.")).not.toContain("inv_");
    signIn("adele");
    expect(main.friendlyErrorText(err, "Try again.")).toContain("inv_31b17c04");
  });

  it("a world's page speaks of a world", async () => {
    signIn("keen");
    render(
      <MemoryRouter>
        <main.LoadFailed what="this world" error={new main.StoryRequestError("That story isn't in your library.",
          { status: 403, code: "forbidden", reason: "not_yours" })} />
      </MemoryRouter>,
    );
    expect(screen.getByText("That world isn't in your library.")).toBeTruthy();
    cleanup();
    render(
      <MemoryRouter>
        <main.LoadFailed what="this world" gone={{ what: "world", backTo: "/universes" }}
          error={new main.StoryRequestError("universe_not_found", { code: "universe_not_found", status: 200 })} />
      </MemoryRouter>,
    );
    expect(screen.getByText("This world isn't here any more.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// R4-08: offline
// ---------------------------------------------------------------------------

describe("R4-08: offline reload lands on the chapter this device opened", () => {
  function cache(userId, storyId, entries) {
    localStorage.setItem(auth.readerKey(userId, "chapter_cache", storyId), JSON.stringify(entries));
  }

  it("an opened, unscrolled chapter is where an offline reload lands", async () => {
    signIn("keen");
    cache("keen", "s1", [
      { chapterNumber: 5, chapter: chapterDoc(5, { chapterTitle: "Chapter Five Opened" }), cachedAt: Date.now() },
      { chapterNumber: 1, chapter: chapterDoc(1, { chapterTitle: "Chapter One Old" }), cachedAt: Date.now() - 60_000 },
    ]);
    const server = fakeStoryServer({});
    server.offline = true;
    readerAt();
    expect(await screen.findByRole("heading", { name: "Chapter Five Opened" })).toBeTruthy();
  });

  it("chooses the newer of the saved place and the last chapter opened", () => {
    signIn("keen");
    const now = Date.now();
    cache("keen", "s1", [
      { chapterNumber: 5, cachedAt: now },
      { chapterNumber: 2, cachedAt: now - 120_000 },
    ]);
    expect(main.offlineLandingChapter("s1", null, { chapter: 2, lastRead: now - 60_000 })).toBe(5);
    expect(main.offlineLandingChapter("s1", null, { chapter: 2, lastRead: now + 1 })).toBe(2);
    expect(main.offlineLandingChapter("s1", null, { chapter: 9, lastRead: now + 1 })).toBe(5); // 9 not on the device
    localStorage.clear();
    signIn("keen");
    expect(main.offlineLandingChapter("s1", null, {})).toBe(1);
  });
});

describe("R4-08: the service worker precaches the built bundle", () => {
  const MANIFEST = {
    "index.html": { file: "assets/index-abc.js", isEntry: true, css: ["assets/index-def.css"], imports: ["_vendor.js"],
      dynamicImports: ["src/StoryMap.jsx"] },
    "_vendor.js": { file: "assets/vendor-123.js", css: ["assets/vendor-456.css"] },
    "src/StoryMap.jsx": { file: "assets/maplibre-zzz.js", isDynamicEntry: true },
  };

  it("names the entry, its static imports and their CSS -- not the lazy chunks", () => {
    expect(precacheList(MANIFEST)).toEqual([
      "/assets/index-abc.js", "/assets/index-def.css", "/assets/vendor-123.js", "/assets/vendor-456.css"]);
  });

  it("the worker installs with the bundle in its cache", async () => {
    const source = readFileSync(path.resolve(__dirname, "../public/sw.js"), "utf8");
    expect(source).toContain(PRECACHE_MARKER);
    expect(source).toContain(BUILD_MARKER);
    const built = injectPrecache(source, precacheList(MANIFEST), "b1");
    const added = [];
    const listeners = {};
    const cache = { addAll: async (list) => { added.push(...list); }, add: async (file) => { added.push(file); } };
    const opened = [];
    const context = {
      self: { location: { origin: "https://app.example" }, addEventListener: (t, fn) => { listeners[t] = fn; },
        skipWaiting: () => {}, clients: { claim: () => {} } },
      caches: { open: async (name) => { opened.push(name); return cache; }, keys: async () => [] },
      fetch: async () => new Response(""), URL, Response, Promise,
    };
    vm.runInNewContext(built, context);
    let done;
    listeners.install({ waitUntil: (p) => { done = p; } });
    await done;
    expect(added).toEqual(expect.arrayContaining(["/", "/assets/index-abc.js", "/assets/index-def.css"]));
    expect(opened[0]).toBe("storyforge-v4-b1");
  });
});
