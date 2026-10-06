/**
 * Otherwise QA, 2026-10-06 -- the reader, end to end against a fake server.
 *
 * O-04  a reader alone could not record a pick: the app sent
 *       `protagonistGroup: null` and the server's validator refused it.
 * O-07  after a pick on one device, every other device dead-ended at the end
 *       of that chapter: the pick lived only in the first device's storage.
 * O-09  a new story opened on a blank page that never filled.
 * O-10  a network failure rendered as a blank chapter / an empty library.
 * O-17  no "next chapter" affordance except a swipe or the drawer.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import React from "react";
import { fakeStoryServer, chapterDoc } from "./helpers/fakeStoryServer";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.useRealTimers();
});

async function openReader(reader, { universeId = "u1", storyId = "s1" } = {}) {
  localStorage.setItem("storyforge_default_reader", reader);
  const mod = await import("../src/main.jsx");
  const { ChapterReader, AppProvider } = mod;
  render(
    <MemoryRouter initialEntries={[`/universes/${universeId}/stories/${storyId}`]}>
      <AppProvider>
        <Routes>
          <Route path="/universes/:id/stories/:storyId" element={<ChapterReader />} />
          <Route path="/universes/:id" element={<div>universe page</div>} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );
  return mod;
}

function storyList(story) {
  return () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", primaryReaders: ["jonathan", "keen"], ...story }] });
}

async function revealChoices() {
  // The choices come up when the reader reaches the bottom of the page.
  await act(async () => { window.dispatchEvent(new Event("scroll")); });
  await waitFor(() => expect(screen.getByText("Wait")).toBeTruthy(), { timeout: 3000 });
}

describe("O-04: Keen alone can record a pick", () => {
  it("sends no null protagonistGroup, and the server's answer puts the card up", async () => {
    const server = fakeStoryServer({
      "storyforge.story.list.v1": storyList({ totalChapters: 3, currentChapter: 3 }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber),
      "storyforge.choice.record.v1": (args) => (args.protagonistGroup === null
        ? { __status: 400, ok: false, error: "Invalid type for protagonistGroup: expected str, got NoneType. Call form: ...; invocationId=inv_31b17c04-0957-4013-a7f0-88abdad1024f" }
        : { ok: true, status: "awaiting_narrator", awaitingNarrator: true, chapterNumber: 4, madeBy: "keen" }),
    });
    await openReader("keen");
    await revealChoices();
    fireEvent.click(screen.getByText("Wait"));
    await waitFor(() => expect(server.commands("storyforge.choice.record.v1").length).toBe(1));
    const sent = server.commands("storyforge.choice.record.v1")[0].args;
    expect(sent).not.toHaveProperty("protagonistGroup");
    await waitFor(() => expect(screen.getByText(/A grown-up has to ask for chapter 4/)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/NoneType|invocationId/);
  });
});

describe("O-07: a pick made on another device", () => {
  it("puts the same Write card up on a device that never saw the tap", async () => {
    fakeStoryServer({
      "storyforge.story.list.v1": storyList({ totalChapters: 3, currentChapter: 3 }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber, { choiceMade: { id: "c", text: "Wait", madeBy: "keen" } }),
      status: (p) => (p.chapterNumber === "4"
        ? { ok: true, status: "awaiting_request", awaitingRequest: true, chapterNumber: 4, choiceText: "Wait", madeBy: "keen" }
        : { ok: true, status: "complete" }),
    });
    await openReader("jonathan");
    await waitFor(() => expect(screen.getByText("Chapter 4 is not written yet")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText(/You picked: “Wait”/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write chapter 4" })).toBeTruthy();
  });

  it("tells a child on the other device that a grown-up has to ask", async () => {
    fakeStoryServer({
      "storyforge.story.list.v1": storyList({ totalChapters: 3, currentChapter: 3 }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber, { choiceMade: { id: "c", text: "Wait", madeBy: "keen" } }),
      status: () => ({ ok: true, status: "awaiting_narrator", awaitingNarrator: true, chapterNumber: 4, choiceText: "Wait" }),
    });
    await openReader("keen");
    await waitFor(() => expect(screen.getByText(/A grown-up has to ask for chapter 4/)).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByRole("button", { name: "Write chapter 4" })).toBeNull();
  });
});

describe("O-17: a way to the next chapter", () => {
  it("offers the next chapter when it exists", async () => {
    fakeStoryServer({
      "storyforge.story.list.v1": storyList({ totalChapters: 3, currentChapter: 1 }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber, { choiceMade: { id: "a", text: "Go left" } }),
    });
    await openReader("jonathan");
    const next = await screen.findByRole("button", { name: "Chapter 2 →" }, { timeout: 3000 });
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByRole("heading", { name: "The Deck 2" })).toBeTruthy());
  });
});

describe("O-09: a new story's chapter 1", () => {
  it("says it is being written, then fills in when it lands", async () => {
    let written = false;
    fakeStoryServer({
      "storyforge.story.list.v1": storyList({ totalChapters: 0, currentChapter: 0, creationStatus: "creating" }),
      "storyforge.chapter.get.v1": (a) => (written ? chapterDoc(1, { chapterTitle: "The First Morning" })
        : { ok: false, error: "chapter_not_found" }),
      "storyforge.story.status.v1": () => { written = true; return { ok: true, status: "complete" }; },
    });
    await openReader("keen");
    await waitFor(() => expect(screen.getByRole("heading", { name: "The First Morning" })).toBeTruthy(), { timeout: 3000 });
  });

  it("shows the wait, not a blank page, while chapter 1 is still being written", async () => {
    fakeStoryServer({
      "storyforge.story.list.v1": storyList({ totalChapters: 0, currentChapter: 0, creationStatus: "creating" }),
      "storyforge.chapter.get.v1": () => ({ ok: false, error: "chapter_not_found" }),
      "storyforge.story.status.v1": () => ({ ok: true, status: "creating" }),
    });
    await openReader("keen");
    await waitFor(() => expect(screen.getByText(/Writing chapter 1 of Sky Ship/)).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("fails honestly and retries when the writer was down", async () => {
    let retried = false;
    const server = fakeStoryServer({
      "storyforge.story.list.v1": storyList({ totalChapters: 0, currentChapter: 0, creationStatus: "failed" }),
      "storyforge.chapter.get.v1": () => ({ ok: false, error: "chapter_not_found" }),
      "storyforge.story.status.v1": (a) => {
        if (a.retry) retried = true;
        return retried ? { ok: true, status: "creating", retried: true }
          : { ok: true, status: "failed", retryable: true, message: "Chapter 1 could not be written just now. Nothing was saved. Tap Try again in a minute." };
      },
    });
    await openReader("jonathan");
    await waitFor(() => expect(screen.getByText("Chapter 1 isn't written yet.")).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(server.commands("storyforge.story.status.v1").some((c) => c.args.retry === true)).toBe(true));
    await waitFor(() => expect(screen.getByText(/Writing chapter 1/)).toBeTruthy());
  });
});

describe("O-10: a failure is not an empty page", () => {
  it("a chapter that cannot be fetched says so, with a retry that works", async () => {
    const server = fakeStoryServer({
      "storyforge.story.list.v1": storyList({ totalChapters: 3, currentChapter: 2 }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber),
    });
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url, options) => {
      const body = JSON.parse(options?.body || "{}");
      if (body.command === "storyforge.chapter.get.v1") throw new TypeError("Failed to fetch");
      return realFetch(url, options);
    });
    await openReader("jonathan");
    await waitFor(() => expect(screen.getByText("Couldn't reach the story server.")).toBeTruthy(), { timeout: 3000 });
    global.fetch = realFetch;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "The Deck 2" })).toBeTruthy());
    expect(server.commands("storyforge.chapter.get.v1").length).toBeGreaterThan(0);
  });

  it("the library on bad wifi does not say 'No universes yet'", async () => {
    localStorage.setItem("storyforge_default_reader", "keen");
    const { UniverseList, AppProvider } = await import("../src/main.jsx");
    const server = fakeStoryServer({
      "storyforge.universe.list.v1": () => ({ ok: true, universes: [{ universeId: "u1", title: "The Meridian Universe" }] }),
    });
    server.offline = true;
    render(<MemoryRouter><AppProvider><UniverseList /></AppProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Couldn't reach the story server.")).toBeTruthy());
    expect(screen.queryByText("No universes yet.")).toBeNull();
    server.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("The Meridian Universe")).toBeTruthy());
  });

  it("an empty library is still empty", async () => {
    localStorage.setItem("storyforge_default_reader", "jonathan");
    const { UniverseList, AppProvider } = await import("../src/main.jsx");
    fakeStoryServer({ "storyforge.universe.list.v1": () => ({ ok: true, universes: [] }) });
    render(<MemoryRouter><AppProvider><UniverseList /></AppProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("No universes yet.")).toBeTruthy());
  });
});
