/**
 * Otherwise round-3 UI audit, 2026-10-06 -- the web reader.
 *
 * UI-01 (P1)  a child read a grown-up's private chapter from the device cache on a
 *             shared iPad: the cache was keyed by story alone, read BEFORE the
 *             server, never cleared on a sign-out, and a refused story.list fell
 *             back to a stand-in story that went on to the cached chapter.
 * UI-02       tapping a choice swapped the page for a waiting screen; the reader
 *             came back at the top of the chapter.
 * UI-03       a long word / long cover string widened the page.
 * UI-05       a revoked or expired session said nothing; a 401 said "(no token). Ask Jonathan."
 * UI-06       reloading a deep link offline showed the browser's "No internet" page.
 * UI-07       reader cards had no pressed state (and four ticks); the chat sheet
 *             left focus behind it.
 * UI-08       snake_case_name rendered "case" in italics.
 * UI-09       /storyforge/tts/voices was fetched on every mount.
 * UI-10       no CSP, framing allowed, no HSTS or referrer policy.
 * #2015       storyforge.story.questions.v1 must carry universeId.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
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
const { securityHeaders, contentSecurityPolicy } = await import("../build/securityHeaders.js");

const SECRET = "ADULTSECRET The letter arrived on a Tuesday.";

function signIn(userId) {
  localStorage.setItem("otherwise_session", JSON.stringify({
    accessToken: `access-${userId}`, userId, sessionId: `sid-${userId}`, refreshToken: `refresh-${userId}`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
  }));
  localStorage.setItem("storyforge_default_reader", userId);
  localStorage.setItem("storyforge_reading_group", JSON.stringify([userId]));
  main.setCurrentReaderId(userId);
}

function cacheFor(userId, storyId, chapter) {
  localStorage.setItem(auth.readerKey(userId, "chapter_cache", storyId),
    JSON.stringify([{ chapterNumber: chapter.chapterNumber, chapter, cachedAt: Date.now() }]));
}

function readerAt(storyId = "s1", universeId = "u1") {
  return render(
    <MemoryRouter initialEntries={[`/universes/${universeId}/stories/${storyId}`]}>
      <main.AppProvider>
        <Routes><Route path="/universes/:id/stories/:storyId" element={<main.ChapterReader />} /></Routes>
      </main.AppProvider>
    </MemoryRouter>,
  );
}

function refused() {
  return new Response(JSON.stringify({ ok: false, error: "forbidden", message: "That story isn't open to this reader." }), { status: 403 });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// UI-01: what the device keeps belongs to the reader who is signed in
// ---------------------------------------------------------------------------

describe("UI-01: a grown-up's chapter never reaches a child from the device", () => {
  it("story keys are scoped to the reader", () => {
    expect(auth.readerKey("Jonathan", "chapter_cache", "s1")).toBe("sf_u_jonathan__chapter_cache_s1");
    signIn("keen");
    expect(main.storyDataKey("chapter_cache", "s1")).toBe("sf_u_keen__chapter_cache_s1");
    expect(auth.readerKey("", "chapter_cache", "s1")).toBe("");
  });

  it("a refused story list shows the refusal -- no stand-in story, no chapter fetch, no cached words", async () => {
    signIn("keen");
    cacheFor("keen", "s1", chapterDoc(1, { chapterTitle: "Private", prose: SECRET }));
    localStorage.setItem(auth.readerKey("keen", "bookmark", "s1"), JSON.stringify({ chapterNumber: 1, snippet: SECRET.slice(0, 40) }));
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => refused(),
      "storyforge.chapter.get.v1": () => chapterDoc(1, { prose: SECRET }),
    });
    readerAt();
    expect(await screen.findByText("Couldn't open this story.")).toBeTruthy();
    expect(screen.getByText("That story isn't open to this reader.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("ADULTSECRET");
    expect(server.commands("storyforge.chapter.get.v1")).toHaveLength(0);
    expect(localStorage.getItem("sf_u_keen__chapter_cache_s1")).toBeNull();
    expect(localStorage.getItem("sf_u_keen__bookmark_s1")).toBeNull();
  });

  it("a refused chapter is never served from the cache, and the story is forgotten on the device", async () => {
    signIn("keen");
    cacheFor("keen", "s1", chapterDoc(1, { chapterTitle: "Private", prose: SECRET }));
    localStorage.setItem(auth.readerKey("keen", "pending_write", "s1"), JSON.stringify({ chapterNumber: 2, choiceText: "secret pick" }));
    fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 1, currentChapter: 1 }] }),
      "storyforge.chapter.get.v1": () => refused(),
    });
    readerAt();
    expect(await screen.findByText("Couldn't open chapter 1.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("ADULTSECRET");
    expect(screen.queryByRole("heading", { name: "Private" })).toBeNull();
    expect(localStorage.getItem("sf_u_keen__chapter_cache_s1")).toBeNull();
    expect(localStorage.getItem("sf_u_keen__pending_write_s1")).toBeNull();
  });

  it("the server is asked first: a stale device copy never stands in front of it", async () => {
    signIn("jonathan");
    cacheFor("jonathan", "s1", chapterDoc(1, { chapterTitle: "Old Words" }));
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 1, currentChapter: 1 }] }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber),
    });
    readerAt();
    expect(await screen.findByRole("heading", { name: "The Deck 1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Old Words" })).toBeNull();
    expect(server.commands("storyforge.chapter.get.v1")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("sf_u_jonathan__chapter_cache_s1"))[0].chapter.chapterTitle).toBe("The Deck 1");
  });

  it("offline, this reader's own copy is still read (O-18 kept)", async () => {
    signIn("keen");
    cacheFor("keen", "s1", chapterDoc(1, { chapterTitle: "Kept For The Plane" }));
    const server = fakeStoryServer({});
    server.offline = true;
    readerAt();
    expect(await screen.findByRole("heading", { name: "Kept For The Plane" })).toBeTruthy();
  });

  it("offline, another reader's copy is not this reader's", async () => {
    signIn("keen");
    cacheFor("jonathan", "s1", chapterDoc(1, { chapterTitle: "Private", prose: SECRET }));
    const server = fakeStoryServer({});
    server.offline = true;
    readerAt();
    expect(await screen.findByText("Couldn't reach the story server.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("ADULTSECRET");
  });

  it("getChapter on a 403 purges, on a network failure keeps", async () => {
    signIn("keen");
    cacheFor("keen", "s1", chapterDoc(1));
    const net = Object.assign(new Error("Couldn't reach the story server."), { network: true });
    await expect(main.getChapter("u1", "s1", 1, { run: async () => { throw net; } })).rejects.toBe(net);
    expect(localStorage.getItem("sf_u_keen__chapter_cache_s1")).not.toBeNull();
    const no = new main.StoryRequestError("forbidden", { status: 403, code: "forbidden" });
    await expect(main.getChapter("u1", "s1", 1, { run: async () => { throw no; } })).rejects.toBe(no);
    expect(localStorage.getItem("sf_u_keen__chapter_cache_s1")).toBeNull();
  });
});

describe("UI-01: the device forgets a reader when the reader changes", () => {
  const BASE = "https://story.example";
  function json(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }
  function sessionBody(userId, extra = {}) {
    return {
      ok: true, accessToken: `access-${userId}`, refreshToken: `refresh-${userId}`, sessionId: `sid-${userId}`, userId,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
      child: userId === "keen", ...extra,
    };
  }
  let routes;
  beforeEach(() => {
    auth.__resetAuthForTests();
    auth.configureAuth({ abilityUrl: BASE });
    routes = {
      "/v1/auth/storyforge/device": () => json(200, { ...sessionBody("jonathan"), deviceId: "d1", deviceSecret: "s" }),
      "/v1/auth/storyforge/profile": (body) => json(200, sessionBody(body.userId)),
      "/v1/auth/storyforge/signout": () => json(200, { ok: true }),
    };
    global.fetch = vi.fn(async (url, init = {}) => {
      const route = String(url).replace(BASE, "");
      const body = init.body ? JSON.parse(init.body) : {};
      return routes[route] ? routes[route](body) : json(200, { ok: true });
    });
  });

  it("switching from Jonathan to Keen wipes Jonathan's stories; text size stays", async () => {
    await auth.enrollDevice({ userId: "jonathan", pin: "482913" });
    localStorage.setItem("sf_u_jonathan__chapter_cache_s1", "[1]");
    localStorage.setItem("sf_u_jonathan__bookmark_s1", "{}");
    localStorage.setItem("sf_text_jonathan", "1.2");
    await auth.signInProfile({ userId: "keen" });
    expect(localStorage.getItem("sf_u_jonathan__chapter_cache_s1")).toBeNull();
    expect(localStorage.getItem("sf_u_jonathan__bookmark_s1")).toBeNull();
    expect(localStorage.getItem("sf_text_jonathan")).toBe("1.2");
  });

  it("the same reader signing in again keeps their own copy", async () => {
    await auth.enrollDevice({ userId: "jonathan", pin: "482913" });
    localStorage.setItem("sf_u_jonathan__chapter_cache_s1", "[1]");
    await auth.signInProfile({ userId: "jonathan", pin: "482913" });
    expect(localStorage.getItem("sf_u_jonathan__chapter_cache_s1")).toBe("[1]");
  });

  it("signing out wipes, and so does a session that ends", async () => {
    await auth.enrollDevice({ userId: "jonathan", pin: "482913" });
    localStorage.setItem("sf_u_jonathan__chapter_cache_s1", "[1]");
    await auth.signOut();
    expect(localStorage.getItem("sf_u_jonathan__chapter_cache_s1")).toBeNull();

    await auth.signInProfile({ userId: "keen" });
    localStorage.setItem("sf_u_keen__chapter_cache_s2", "[1]");
    routes["/v1/auth/storyforge/refresh"] = () => json(401, { ok: false, error: "SESSION_REVOKED" });
    await expect(auth.refreshSession()).rejects.toBeTruthy();
    expect(localStorage.getItem("sf_u_keen__chapter_cache_s2")).toBeNull();
    expect(auth.takeSignedOutReason()).toBe("SESSION_REVOKED");
  });

  it("the pre-UI-01 unscoped keys are removed when the app loads", async () => {
    localStorage.setItem("sf_chapter_cache_probe-secret", "[1]");
    localStorage.setItem("sf_pending_write_s1", "{}");
    localStorage.setItem("sf_bookmark_s1", "{}");
    localStorage.setItem("sf_pos_jonathan_s1", "{}");
    vi.resetModules();
    await import("../src/auth.js");
    for (const key of ["sf_chapter_cache_probe-secret", "sf_pending_write_s1", "sf_bookmark_s1", "sf_pos_jonathan_s1"]) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("a device left holding data for someone, with nobody signed in, is cleaned on load", async () => {
    localStorage.setItem("otherwise_reader_data_owner", "jonathan");
    localStorage.setItem("sf_u_jonathan__chapter_cache_s1", "[1]");
    vi.resetModules();
    await import("../src/auth.js");
    expect(localStorage.getItem("sf_u_jonathan__chapter_cache_s1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UI-02: a pick is saved in place
// ---------------------------------------------------------------------------

describe("UI-02: tapping a choice keeps the chapter on the page", () => {
  it("says 'saving' in the panel, then brings the Write card into view and focuses it", async () => {
    signIn("jonathan");
    let answer;
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 1, currentChapter: 1, primaryReaders: ["jonathan"] }] }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber),
      "storyforge.choice.record.v1": () => new Promise((resolve) => { answer = resolve; }),
    });
    readerAt();
    await screen.findByRole("heading", { name: "The Deck 1" });
    fireEvent.scroll(window);
    const pick = await screen.findByRole("button", { name: "Go left" }, { timeout: 3000 });
    fireEvent.click(pick);
    await waitFor(() => expect(server.commands("storyforge.choice.record.v1")).toHaveLength(1));
    // The chapter is still here; the panel says what is happening.
    expect(screen.getByRole("heading", { name: "The Deck 1" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Saving what you picked…");
    expect(screen.getByRole("button", { name: "Go right" }).disabled).toBe(true);
    window.scrollTo.mockClear();
    await act(async () => { answer({ ok: true, status: "awaiting_request", autoGenerates: false, chapterNumber: 2 }); });
    const card = await screen.findByRole("region", { name: "Write chapter 2" });
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 0);
  });

  it("a pick that did not save says so in the panel, and the choices stay tappable", () => {
    const chapter = chapterDoc(1);
    const onChoose = vi.fn();
    const { container } = render(<main.ChoicePanel visible chapter={chapter} readers={["keen"]} onChoose={onChoose} error="Your pick was not saved. Try tapping it again." />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert.textContent).toBe("Your pick was not saved. Try tapping it again.");
    const left = [...container.querySelectorAll("button")].find((b) => b.textContent === "Go left");
    expect(left.disabled).toBe(false);
    fireEvent.click(left);
    expect(onChoose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UI-03, UI-08
// ---------------------------------------------------------------------------

describe("UI-03: a cover icon is one glyph", () => {
  it("keeps the first grapheme -- emoji with modifiers, flags and letters intact", () => {
    expect(main.coverGlyph("🧭🧭🧭 a very long cover string")).toBe("🧭");
    expect(main.coverGlyph("👨‍👩‍👧 family")).toBe("👨‍👩‍👧");
    expect(main.coverGlyph("🇺🇸🇯🇵")).toBe("🇺🇸");
    expect(main.coverGlyph("Supercalifragilistic")).toBe("S");
    expect(main.coverGlyph("")).toBe("✦");
    expect(main.coverGlyph(null)).toBe("✦");
  });

  it("the stylesheet lets a long word break in titles and clips the icon", () => {
    const css = readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");
    for (const selector of [".universe-hero h1 {", ".reading-column h1 {", ".reader-title {"]) {
      const block = css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
      expect(block).toMatch(/overflow-wrap:\s*anywhere/);
    }
    const icon = css.slice(css.indexOf(".hero-icon {"), css.indexOf("}", css.indexOf(".hero-icon {")));
    expect(icon).toMatch(/overflow:\s*hidden/);
  });
});

describe("UI-08: an underscore inside a word is part of the word", () => {
  it("in the conversation's markdown", () => {
    const { container } = render(<div>{main.renderMarkdown("Open snake_case_name and file_v2_final.txt, but _this_ is emphasis.")}</div>);
    expect(container.textContent).toContain("snake_case_name");
    expect(container.textContent).toContain("file_v2_final.txt");
    const ems = [...container.querySelectorAll("em")].map((e) => e.textContent);
    expect(ems).toEqual(["this"]);
  });

  it("in the chapter's prose", () => {
    const tokens = main.proseTokens("The ship_log_entry said _hush_ twice.", []);
    expect(tokens.map((t) => t.text).join("")).toBe("The ship_log_entry said hush twice.");
    expect(tokens.filter((t) => t.kind === "em").map((t) => t.text)).toEqual(["hush"]);
  });

  it("double underscores inside a word stay too", () => {
    const { container } = render(<div>{main.renderMarkdown("call __init__ and my__var__name")}</div>);
    expect(container.textContent).toContain("my__var__name");
  });
});

// ---------------------------------------------------------------------------
// UI-05, UI-07: the picker
// ---------------------------------------------------------------------------

function picker() {
  return render(<MemoryRouter><main.AppProvider><main.ReaderPicker /></main.AppProvider></MemoryRouter>);
}

describe("UI-05: a session that ended says why, in plain words", () => {
  it("a revoked session", () => {
    sessionStorage.setItem("otherwise_signed_out_reason", "SESSION_REVOKED");
    picker();
    expect(screen.getByRole("status").textContent).toBe("You were signed out on this device. Tap who's reading to sign in again.");
  });

  it("an expired one", () => {
    sessionStorage.setItem("otherwise_signed_out_reason", "SESSION_IDLE");
    picker();
    expect(screen.getByRole("status").textContent).toMatch(/sign-in ran out/);
  });

  it("said once, while the picker is already open too", () => {
    picker();
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { window.dispatchEvent(new CustomEvent(auth.SIGNED_OUT_EVENT, { detail: { reason: "DEVICE_REVOKED" } })); });
    expect(screen.getByRole("status").textContent).toMatch(/grown-up needs to set it up again/);
  });

  it("a 401 from the server never says 'token' or 'Ask Jonathan'", async () => {
    fakeStoryServer({ "storyforge.chapter.get.v1": () => new Response("{}", { status: 401 }) });
    signIn("keen");
    const error = await main.getChapter("u1", "s1", 1).catch((e) => e);
    expect(error.message).toBe(main.SIGNED_OUT_TEXT);
    expect(error.message).not.toMatch(/token|Ask Jonathan/i);
    expect(main.friendlyError(error).text).toBe(main.SIGNED_OUT_TEXT);
  });
});

describe("UI-07: reader cards say whether they are chosen", () => {
  it("aria-pressed, and only a chosen reader has the tick", () => {
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["keen"]));
    picker();
    const card = (name) => [...document.querySelectorAll(".reader-card")].find((b) => b.textContent.includes(name));
    const keen = card("Keen");
    const adele = card("Adele");
    expect(keen.getAttribute("aria-pressed")).toBe("true");
    expect(adele.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelectorAll(".reader-check")).toHaveLength(1);
    fireEvent.click(adele);
    expect(adele.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll(".reader-check")).toHaveLength(2);
  });
});

describe("UI-07: the chat sheet holds the keyboard while it is open", () => {
  function Harness() {
    const [thread, setThread] = React.useState(null);
    return (
      <div>
        <button type="button" onClick={() => setThread([])}>💬</button>
        <main.StoryChatSheet thread={thread} busy={false} onSend={() => {}} onClose={() => setThread(null)} onApprove={() => {}} onDismiss={() => {}} />
      </div>
    );
  }

  it("moves focus inside on open, wraps Tab, and gives focus back on close", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "💬" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Talk to the story" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const focusables = [...dialog.querySelectorAll("button:not([disabled]), textarea:not([disabled])")];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document.activeElement, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
    fireEvent.keyDown(document.activeElement, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

// ---------------------------------------------------------------------------
// #2015: story.questions carries the universe
// ---------------------------------------------------------------------------

describe("supervisor #2015: storyforge.story.questions.v1 names its universe", () => {
  it("sends universeId", async () => {
    signIn("jonathan");
    const server = fakeStoryServer({ "storyforge.story.questions.v1": () => ({ ok: true, questions: "1. Why?" }) });
    render(
      <MemoryRouter initialEntries={["/universes/u-77/new-story"]}>
        <main.AppProvider>
          <Routes><Route path="/universes/:id/new-story" element={<main.NewStory />} /></Routes>
        </main.AppProvider>
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByPlaceholderText("Describe the story you want..."), { target: { value: "A lighthouse" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await waitFor(() => expect(server.commands("storyforge.story.questions.v1")).toHaveLength(1));
    expect(server.commands("storyforge.story.questions.v1")[0].args.universeId).toBe("u-77");
  });
});

// ---------------------------------------------------------------------------
// UI-06: the service worker
// ---------------------------------------------------------------------------

describe("UI-06: a deep link reloaded offline opens the app", () => {
  function loadWorker({ online }) {
    const listeners = {};
    const store = new Map();
    const cache = {
      put: async (key, res) => { store.set(typeof key === "string" ? key : new URL(key.url).pathname, res); },
      match: async (key) => store.get(typeof key === "string" ? key : new URL(key.url).pathname),
      addAll: async () => {},
    };
    const self = {
      location: { origin: "https://app.example" },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    };
    const fetchImpl = vi.fn(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return new Response("<html>fresh</html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    const context = { self, caches: { open: async () => cache, keys: async () => [] }, fetch: fetchImpl, URL, Response };
    vm.runInNewContext(readFileSync(path.resolve(__dirname, "../public/sw.js"), "utf8"), context);
    return { listeners, store, fetchImpl };
  }

  async function navigate(worker, url) {
    let responded;
    worker.listeners.fetch({ request: { url, method: "GET", mode: "navigate" }, respondWith: (p) => { responded = p; } });
    return responded;
  }

  it("any same-origin navigation falls back to the cached shell", async () => {
    const worker = loadWorker({ online: false });
    worker.store.set("/", new Response("<html>shell</html>"));
    const response = await navigate(worker, "https://app.example/universes/u1/stories/s1");
    expect(await response.text()).toBe("<html>shell</html>");
  });

  it("online, a navigation is fetched and refreshes the shell", async () => {
    const worker = loadWorker({ online: true });
    const response = await navigate(worker, "https://app.example/universes/u1");
    expect(await response.text()).toBe("<html>fresh</html>");
    expect(worker.store.has("/")).toBe(true);
  });

  it("other origins and POSTs are left alone; the per-URL chapter cache is gone", async () => {
    const worker = loadWorker({ online: true });
    let responded = false;
    worker.listeners.fetch({ request: { url: "https://api.example/v1/execute", method: "POST", mode: "cors" }, respondWith: () => { responded = true; } });
    worker.listeners.fetch({ request: { url: "https://api.example/x", method: "GET", mode: "cors" }, respondWith: () => { responded = true; } });
    expect(responded).toBe(false);
    expect(readFileSync(path.resolve(__dirname, "../public/sw.js"), "utf8")).not.toMatch(/CHAPTER_CACHE/);
  });
});

// ---------------------------------------------------------------------------
// UI-09, UI-10
// ---------------------------------------------------------------------------

describe("UI-09: the voice list is fetched once", () => {
  it("shares one request between callers and remembers a good answer", async () => {
    const real = await vi.importActual("../src/kokoro.js");
    real.__resetVoicesForTests();
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ["af_heart", "bm_george"] }));
    const [a, b] = await Promise.all([real.fetchVoices(), real.fetchVoices()]);
    expect(await real.fetchVoices()).toEqual(["af_heart", "bm_george"]);
    expect(a).toEqual(b);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("a failed answer is asked again later (signed out, offline)", async () => {
    const real = await vi.importActual("../src/kokoro.js");
    real.__resetVoicesForTests();
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce({ ok: true, json: async () => ["v1"] });
    expect(await real.fetchVoices()).toEqual(real.FALLBACK_VOICES);
    expect(await real.fetchVoices()).toEqual(["v1"]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("UI-10: the deployed app sends security headers", () => {
  const headers = securityHeaders("https://api.example/");
  it("a CSP that allows only this app, its story server and what it really loads", () => {
    const csp = headers["Content-Security-Policy"];
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/script-src 'self';/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/api\.example https:\/\/kokoro\.abilityai\.systems/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/worker-src 'self' blob:/);
    expect(csp).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  });

  it("no framing, HSTS, a referrer policy", () => {
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("defaults to the supervisor and is wired into `vite preview`, which is what Cloud Run serves", () => {
    expect(contentSecurityPolicy(undefined)).toContain("https://ability-supervisor-service-818269465014.us-central1.run.app");
    const config = readFileSync(path.resolve(__dirname, "../vite.config.js"), "utf8");
    expect(config).toMatch(/preview:\s*\{[\s\S]*headers:\s*securityHeaders\(\)/);
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    expect(pkg.scripts.start).toMatch(/vite preview/);
  });
});
