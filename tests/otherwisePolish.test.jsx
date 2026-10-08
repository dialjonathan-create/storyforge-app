/**
 * Otherwise polish, 2026-10-08 -- "your chapter is ready", Continue reading, and
 * a gentle progress bar, all per reader.
 *
 * Ready      a chapter the reader asked for finishes while they are elsewhere in
 *            the app: a toast ("Chapter 5 of The Meridian is ready!" for a
 *            child), and a "New chapter" badge on the library card until they
 *            open it. Asked through the existing status route with the
 *            reader's own session; only the reader who asked is told.
 * Continue   the library opens with this reader's stories, most recent first,
 *            each with chapter and percent; never another reader's (UI-01).
 * Converse   a message past 4,000 characters is not sent.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import React from "react";
import { fakeStoryServer, chapterDoc } from "./helpers/fakeStoryServer";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
vi.mock("../src/kokoro", () => ({ fetchVoices: async () => [], synthesize: async () => new ArrayBuffer(8) }));

const auth = await import("../src/auth.js");
const progress = await import("../src/readerProgress.js");
const main = await import("../src/main.jsx");

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

function at(path, element, route) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <main.AppProvider>
        <Routes>
          <Route path={route} element={element} />
          <Route path="/universes/:id/stories/:storyId" element={<div>reader page</div>} />
        </Routes>
      </main.AppProvider>
    </MemoryRouter>,
  );
}

function withWatcher(path, element, route, getStatus) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <main.AppProvider>
        <main.ChapterReadyWatcher getStatus={getStatus} pollMs={1000} />
        <Routes>
          <Route path={route} element={element} />
          <Route path="/universes/:id/stories/:storyId" element={<div>reader page</div>} />
        </Routes>
      </main.AppProvider>
    </MemoryRouter>,
  );
}

const MERIDIAN = { universeId: "meridian-universe", storyId: "the-meridian", chapterNumber: 5, title: "The Meridian" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  main.ACTIVE_CHAPTER_WAITS.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// the words
// ---------------------------------------------------------------------------

describe("the ready line", () => {
  it("is the friendly line for a child", () => {
    expect(progress.readyLine(MERIDIAN, "keen")).toBe("Chapter 5 of The Meridian is ready!");
    expect(progress.readyLine(MERIDIAN, "talia")).toBe("Chapter 5 of The Meridian is ready!");
  });

  it("is a plain sentence for a grown-up, and never names nothing", () => {
    expect(progress.readyLine(MERIDIAN, "jonathan")).toBe("Chapter 5 of The Meridian is ready.");
    expect(progress.readyLine({ chapterNumber: 2 }, "keen")).toBe("Chapter 2 of your story is ready!");
  });
});

// ---------------------------------------------------------------------------
// watching a chapter, per reader
// ---------------------------------------------------------------------------

describe("checkWatches", () => {
  it("marks a finished chapter new, stops watching it, and reports it", async () => {
    progress.watchChapter("keen", MERIDIAN);
    const getStatus = vi.fn(async () => ({ ok: true, status: "complete" }));
    const ready = await progress.checkWatches("keen", getStatus);
    expect(ready.map((w) => w.chapterNumber)).toEqual([5]);
    expect(getStatus).toHaveBeenCalledWith("meridian-universe", "the-meridian", 5);
    expect(progress.chapterWatches("keen")).toEqual([]);
    expect(progress.newChapterFor("keen", "the-meridian").chapterNumber).toBe(5);
    expect(progress.newChaptersIn("keen", "meridian-universe")).toBe(1);
  });

  it("keeps watching while it is still being written, and through a network blip", async () => {
    progress.watchChapter("keen", MERIDIAN);
    await progress.checkWatches("keen", async () => ({ ok: true, status: "generating", queuePosition: 2 }));
    await progress.checkWatches("keen", async () => { throw Object.assign(new Error("offline"), { network: true }); });
    expect(progress.chapterWatches("keen")).toHaveLength(1);
  });

  it("drops a failed chapter and a refused one quietly", async () => {
    progress.watchChapter("keen", MERIDIAN);
    expect(await progress.checkWatches("keen", async () => ({ ok: true, status: "failed" }))).toEqual([]);
    expect(progress.chapterWatches("keen")).toEqual([]);
    progress.watchChapter("keen", MERIDIAN);
    await progress.checkWatches("keen", async () => { throw Object.assign(new Error("no"), { status: 403 }); });
    expect(progress.chapterWatches("keen")).toEqual([]);
    expect(progress.newChapterFor("keen", "the-meridian")).toBeNull();
  });

  it("never asks about another reader's chapter", async () => {
    progress.watchChapter("jonathan", { ...MERIDIAN, storyId: "grown-up-story", title: "Private" });
    const getStatus = vi.fn(async () => ({ ok: true, status: "complete" }));
    expect(await progress.checkWatches("keen", getStatus)).toEqual([]);
    expect(getStatus).not.toHaveBeenCalled();
    expect(progress.newChapterFor("keen", "grown-up-story")).toBeNull();
  });

  it("opening the chapter clears the badge", () => {
    progress.markNewChapter("keen", MERIDIAN);
    progress.clearNewChapter("keen", "the-meridian", 4);
    expect(progress.newChapterFor("keen", "the-meridian")).not.toBeNull();
    progress.clearNewChapter("keen", "the-meridian", 5);
    expect(progress.newChapterFor("keen", "the-meridian")).toBeNull();
  });

  it("is wiped with the rest of the reader's data when the person changes", () => {
    progress.watchChapter("keen", MERIDIAN);
    progress.markNewChapter("keen", MERIDIAN);
    progress.recordRecentRead("keen", { ...MERIDIAN, chapter: 4, scrollPercent: 0.5 });
    auth.wipeReaderData();
    expect(progress.chapterWatches("keen")).toEqual([]);
    expect(progress.newChapterFor("keen", "the-meridian")).toBeNull();
    expect(progress.continueReading("keen")).toEqual([]);
  });
});

describe("the toast", () => {
  it("tells a child their chapter is ready, and Read it opens the story", async () => {
    signIn("keen");
    progress.watchChapter("keen", MERIDIAN);
    const getStatus = vi.fn(async () => ({ ok: true, status: "complete" }));
    withWatcher("/somewhere", <div>library</div>, "/somewhere", getStatus);
    expect(await screen.findByText("Chapter 5 of The Meridian is ready!")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect(screen.getByText("reader page")).toBeTruthy();
    expect(screen.queryByText("Chapter 5 of The Meridian is ready!")).toBeNull();
  });

  it("says nothing for a chapter the open reader page is already waiting on", async () => {
    signIn("keen");
    progress.watchChapter("keen", MERIDIAN);
    main.ACTIVE_CHAPTER_WAITS.add(main.activeWaitKey("the-meridian", 5));
    const getStatus = vi.fn(async () => ({ ok: true, status: "complete" }));
    withWatcher("/somewhere", <div>library</div>, "/somewhere", getStatus);
    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/is ready/)).toBeNull();
  });

  it("is never shown to a different reader than the one who asked", async () => {
    signIn("keen");
    progress.watchChapter("jonathan", { ...MERIDIAN, title: "Private" });
    const getStatus = vi.fn(async () => ({ ok: true, status: "complete" }));
    withWatcher("/somewhere", <div>library</div>, "/somewhere", getStatus);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(getStatus).not.toHaveBeenCalled();
    expect(screen.queryByText(/is ready/)).toBeNull();
  });

  it("polls the existing status route with the reader's session (no new auth surface)", async () => {
    signIn("keen");
    progress.watchChapter("keen", MERIDIAN);
    const server = fakeStoryServer({ status: () => ({ ok: true, status: "complete", chapter: chapterDoc(5) }) });
    const network = global.fetch;
    auth.installSessionFetch(); // the app's own signer, over the fake network
    withWatcher("/somewhere", <div>library</div>, "/somewhere", undefined);
    expect(await screen.findByText("Chapter 5 of The Meridian is ready!")).toBeTruthy();
    expect(server.statusCalls[0]).toMatchObject({ universeId: "meridian-universe", storyId: "the-meridian", chapterNumber: "5" });
    const [, options] = network.mock.calls.find(([u]) => String(u).includes("/storyforge/chapter/status"));
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer access-keen");
  });
});

describe("the badge on the library", () => {
  it("shows New chapter on the story card and its world until the chapter is opened", async () => {
    signIn("keen");
    progress.markNewChapter("keen", MERIDIAN);
    fakeStoryServer({
      "storyforge.universe.get.v1": () => ({ ok: true, universe: { universeId: "meridian-universe", title: "Meridian" } }),
      "storyforge.story.list.v1": () => ({ ok: true, stories: [
        { storyId: "the-meridian", title: "The Meridian", totalChapters: 5, primaryReaders: ["keen"] },
        { storyId: "other", title: "Other", totalChapters: 2, primaryReaders: ["keen"] },
      ] }),
      "storyforge.universe.list.v1": () => ({ ok: true, universes: [{ universeId: "meridian-universe", title: "Meridian", storyCount: 2 }] }),
    });
    at("/universes/meridian-universe", <main.UniverseDetail />, "/universes/:id");
    await screen.findByRole("heading", { name: "The Meridian" });
    const badges = screen.getAllByText("New chapter");
    expect(badges).toHaveLength(1);
    expect(badges[0].closest("article").textContent).toContain("The Meridian");
    cleanup();
    at("/universes", <main.UniverseList />, "/universes");
    await screen.findByRole("heading", { name: "Meridian" });
    expect(screen.getByLabelText("New chapter").closest("article").textContent).toContain("Meridian");
  });
});

// ---------------------------------------------------------------------------
// Continue reading
// ---------------------------------------------------------------------------

describe("continue reading", () => {
  it("lists this reader's stories, newest first, with chapter and percent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    progress.recordRecentRead("keen", { universeId: "u1", storyId: "a", title: "Sky Ship", chapter: 2, scrollPercent: 0.4, totalChapters: 4 });
    vi.setSystemTime(2_000_000);
    progress.recordRecentRead("keen", { universeId: "u1", storyId: "b", title: "The Meridian", chapter: 7, scrollPercent: 0.123, totalChapters: 12 });
    const list = progress.continueReading("keen");
    expect(list.map((e) => e.storyId)).toEqual(["b", "a"]);
    expect(list[0]).toMatchObject({ chapter: 7, percent: 12 });
    expect(progress.continueLine(list[1])).toBe("Chapter 2 · 40%");
    expect(list[1].storyFraction).toBeCloseTo((1 + 0.4) / 4);
  });

  it("is scoped per reader: one reader's progress is never another's", () => {
    progress.recordRecentRead("jonathan", { universeId: "u1", storyId: "private", title: "Grown-up Story", chapter: 3, scrollPercent: 0.5, totalChapters: 3 });
    progress.recordRecentRead("keen", { universeId: "u1", storyId: "kids", title: "Penguins", chapter: 1, scrollPercent: 0.2, totalChapters: 2 });
    expect(progress.continueReading("keen").map((e) => e.storyId)).toEqual(["kids"]);
    expect(progress.continueReading("jonathan").map((e) => e.storyId)).toEqual(["private"]);
    expect(progress.continueReading("")).toEqual([]);
    expect(progress.recentReadFor("keen", "private")).toBeNull();
  });

  it("the library row shows the signed-in reader's stories and nobody else's", async () => {
    signIn("keen");
    // Left on the device by another reader (a build before UI-01 wiped on switch).
    localStorage.setItem(auth.readerKey("jonathan", "recent", "private"), JSON.stringify({
      universeId: "u1", storyId: "private", title: "Grown-up Story", chapter: 3, scrollPercent: 0.5, lastRead: Date.now() + 10,
    }));
    progress.recordRecentRead("keen", { universeId: "u1", storyId: "kids", title: "Penguins of the Deep", universeTitle: "Ice World", chapter: 2, scrollPercent: 0.5, totalChapters: 4 });
    fakeStoryServer({ "storyforge.universe.list.v1": () => ({ ok: true, universes: [] }) });
    at("/universes", <main.UniverseList />, "/universes");
    const row = await screen.findByRole("region", { name: "Continue reading" });
    expect(row.textContent).toContain("Penguins of the Deep");
    expect(row.textContent).toContain("Chapter 2 · 50%");
    expect(row.textContent).not.toContain("Grown-up Story");
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe(String(Math.round(((2 - 1 + 0.5) / 4) * 100)));
    fireEvent.click(screen.getByRole("button", { name: /Penguins of the Deep/ }));
    expect(screen.getByText("reader page")).toBeTruthy();
  });

  it("is not shown at all when the reader has not started anything", async () => {
    signIn("talia");
    fakeStoryServer({ "storyforge.universe.list.v1": () => ({ ok: true, universes: [{ universeId: "u1", title: "Ice World", storyCount: 1 }] }) });
    at("/universes", <main.UniverseList />, "/universes");
    await screen.findByRole("heading", { name: "Ice World" });
    expect(screen.queryByRole("region", { name: "Continue reading" })).toBeNull();
  });

  it("a story card's progress bar is this reader's, through the whole story", async () => {
    signIn("keen");
    progress.recordRecentRead("keen", { universeId: "u1", storyId: "kids", title: "Penguins", chapter: 3, scrollPercent: 0.5, totalChapters: 4 });
    localStorage.setItem(auth.readerKey("jonathan", "recent", "kids"), JSON.stringify({
      universeId: "u1", storyId: "kids", title: "Penguins", chapter: 4, scrollPercent: 1, lastRead: Date.now(),
    }));
    fakeStoryServer({
      "storyforge.universe.get.v1": () => ({ ok: true, universe: { universeId: "u1", title: "Ice World" } }),
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "kids", title: "Penguins", totalChapters: 4, primaryReaders: ["keen"] }] }),
    });
    at("/universes/u1", <main.UniverseDetail />, "/universes/:id");
    await screen.findByRole("heading", { name: "Penguins" });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("63"); // (2 + 0.5) / 4
    expect(screen.getByText(/4 chapters · Chapter 3/)).toBeTruthy();
  });
});

describe("converse length", () => {
  it("says a message is too long, with the limit, and that nothing was sent", () => {
    expect(main.CONVERSE_MESSAGE_MAX_CHARS).toBe(4000);
    const text = main.tooLongMessage("x".repeat(50000));
    expect(text).toContain("4,000");
    expect(text).toContain("50,000");
    expect(text).toContain("Nothing was sent");
  });
});

describe("the reader page", () => {
  it("watches the chapter it asked for, for the reader who asked, and records where they are", async () => {
    signIn("keen");
    fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 3, currentChapter: 3, primaryReaders: ["keen"] }] }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber),
      "storyforge.chapter.request.v1": () => ({ ok: true, status: "generating", chapterNumber: 4 }),
      status: () => ({ ok: true, status: "generating" }),
    });
    localStorage.setItem(auth.readerKey("keen", "pending_write", "s1"), JSON.stringify({ chapterNumber: 4, choiceText: "Wait" }));
    render(
      <MemoryRouter initialEntries={["/universes/u1/stories/s1"]}>
        <main.AppProvider>
          <Routes><Route path="/universes/:id/stories/:storyId" element={<main.ChapterReader />} /></Routes>
        </main.AppProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Write chapter 4" }));
    await waitFor(() => expect(progress.chapterWatches("keen")).toHaveLength(1));
    expect(progress.chapterWatches("keen")[0]).toMatchObject({ universeId: "u1", storyId: "s1", chapterNumber: 4, title: "Sky Ship" });
    expect(main.ACTIVE_CHAPTER_WAITS.has(main.activeWaitKey("s1", 4))).toBe(true);
    expect(progress.chapterWatches("jonathan")).toEqual([]);
    // Opening chapter 3 put it on Keen's Continue row.
    expect(progress.recentReadFor("keen", "s1")).toMatchObject({ chapter: 3, title: "Sky Ship", universeId: "u1" });
    cleanup();
    expect(main.ACTIVE_CHAPTER_WAITS.size).toBe(0);
  });
});
