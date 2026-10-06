/**
 * Otherwise QA, 2026-10-06 -- reshape, errors, resume, narration, long waits.
 *
 * O-05  "Reshape the story" reported done and showed the unchanged chapter:
 *       the server holds the reshape as a DRAFT, and nothing showed it.
 * O-23  a revision card printed "[object Object]" for its preview.
 * P2    raw codes reached a child's screen; a stale bookmark beat later
 *       reading; narration kept going after Back and its stop button read
 *       "■"; a chapter that took longer than 120 s never appeared;
 *       "Talk to the story" held a request open for up to a minute.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import React from "react";
import { fakeStoryServer, chapterDoc } from "./helpers/fakeStoryServer";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const synth = vi.fn(async () => new ArrayBuffer(8));
vi.mock("../src/kokoro", () => ({ fetchVoices: async () => [], synthesize: (...a) => synth(...a) }));

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  synth.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const main = await import("../src/main.jsx");

describe("O-05: a held reshape is shown, not swallowed", () => {
  const { chapterPollStep, ReshapeResultCard, previewText, ProposalCard } = main;
  const HELD = { ok: true, status: "held", reshapeId: "r1", draftId: "u:s:3:abc",
    proposal: { draftId: "u:s:3:abc", chapterNumber: 3, prose: "Keen walked with a penguin.",
      preview: { kind: "revision", before: "Keen walked.", after: "Keen walked with a penguin." }, interventionText: "add a penguin" } };

  it("ends the wait on THIS reshape's held draft, even if 'reshaping' was never seen", () => {
    expect(chapterPollStep("reshape", HELD, false, "r1").action).toBe("held");
  });

  it("does not take another reshape's held draft for this one", () => {
    expect(chapterPollStep("reshape", { ...HELD, reshapeId: "older" }, false, "r1").action).toBe("wait");
  });

  it("reports this reshape's failure without waiting for 'reshaping' first", () => {
    expect(chapterPollStep("reshape", { status: "failed", reshapeId: "r1", error: "x" }, false, "r1").action).toBe("failed");
  });

  it("never treats the old chapter's 'complete' as the reshape", () => {
    expect(chapterPollStep("reshape", { status: "complete", chapter: { prose: "old" } }, false, "r1").action).toBe("wait");
  });

  it("puts the change on the page with Use this and Not this", () => {
    const onApprove = vi.fn();
    render(<ReshapeResultCard proposal={HELD.proposal} onApprove={onApprove} onDismiss={() => {}} />);
    expect(screen.getByText("Your change is ready")).toBeTruthy();
    expect(screen.getByText("Keen walked with a penguin.")).toBeTruthy();
    expect(screen.getByText(/Keen walked\.$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ draftId: "u:s:3:abc" }));
    expect(screen.queryByRole("button", { name: "Change it" })).toBeNull();
  });

  it("O-23: a preview object is words, not [object Object]", () => {
    expect(previewText({ kind: "revision", before: "a", after: "b" })).toBe("b");
    const { container } = render(<ProposalCard proposal={{ draftId: "d", chapterNumber: 1, preview: { kind: "revision", before: "a", after: "The new words." } }}
      onApprove={() => {}} onDismiss={() => {}} onRevise={() => {}} />);
    expect(container.textContent).not.toContain("[object Object]");
    expect(container.textContent).toContain("The new words.");
  });

  it("the reader approves the held change and shows the chapter as it now is", async () => {
    let approved = false;
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 3, currentChapter: 3 }] }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber, approved ? { prose: "Keen walked with a penguin. The end." } : {}),
      "storyforge.chapter.reshape.v1": () => ({ ok: true, status: "reshaping", reshapeId: "r1", chapterNumber: 3 }),
      "storyforge.draft.approve.v1": () => { approved = true; return { ok: true, revised: true, chapterNumber: 3 }; },
      status: () => HELD,
    });
    localStorage.setItem("storyforge_default_reader", "jonathan");
    vi.resetModules();
    const fresh = await import("../src/main.jsx");
    render(
      <MemoryRouter initialEntries={["/universes/u1/stories/s1"]}>
        <fresh.AppProvider>
          <Routes><Route path="/universes/:id/stories/:storyId" element={<fresh.ChapterReader />} /></Routes>
        </fresh.AppProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "The Deck 3" }, { timeout: 3000 });
    // Long-press a paragraph -> confirm -> describe the change.
    const paragraph = document.querySelector("[data-paragraph-index]");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.pointerDown(paragraph, { clientX: 10, clientY: 10 });
    await act(async () => { vi.advanceTimersByTime(1200); });
    vi.useRealTimers();
    fireEvent.click(await screen.findByRole("button", { name: "Yes, reshape from here" }, { timeout: 2000 }));
    const box = await screen.findByRole("textbox", {}, { timeout: 2000 });
    fireEvent.change(box, { target: { value: "add a penguin" } });
    fireEvent.click(screen.getByRole("button", { name: "Reshape the story →" }));
    await screen.findByText("Your change is ready", {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(server.commands("storyforge.draft.approve.v1").length).toBe(1));
    await waitFor(() => expect(document.body.textContent).toContain("Keen walked with a penguin. The end."));
    expect(screen.queryByText("Your change is ready")).toBeNull();
  });
});

describe("P2: a child sees a sentence and an error id, never a raw code", () => {
  const { friendlyError, friendlyErrorText, StoryRequestError } = main;

  it("the O-04 validator text becomes a sentence with the invocation id", () => {
    const raw = "Invalid type for protagonistGroup: expected str, got NoneType. Call form: storyforge.choice.record.v1 requires tenantId (str); invocationId=inv_31b17c04-0957-4013-a7f0-88abdad1024f; receiptId=rcpt_8a3a";
    const out = friendlyError(new StoryRequestError(raw), "Your pick was not saved. Try tapping it again.");
    expect(out.text).toBe("Your pick was not saved. Try tapping it again.");
    expect(out.errorId).toBe("inv_31b17c04-0957-4013-a7f0-88abdad1024f");
    expect(friendlyErrorText(new StoryRequestError(raw), "Try again.")).toMatch(/^Try again\. \(Error inv_31b17c04\)$/);
  });

  it("bare codes and exceptions are never shown", () => {
    for (const raw of ["FORBIDDEN_FOR_SCOPE", "choice_already_recorded", "Execution failed for capability storyforge.interact.v1 invocationId=inv_1234567890ab"]) {
      expect(friendlyError(new StoryRequestError(raw)).text).not.toContain(raw);
    }
  });

  it("a server sentence meant for people is kept", () => {
    expect(friendlyError(new StoryRequestError("The story partner is busy right now — try again in a minute.")).text)
      .toBe("The story partner is busy right now — try again in a minute.");
  });

  it("an unreachable server is said as one", () => {
    expect(friendlyError(new StoryRequestError("x", { network: true })).text).toMatch(/Couldn't reach the story server/);
  });
});

describe("P2 / O-16: reopening a story resumes at the most recent place", () => {
  const { resumePlace, resumeChapter, restoreReadingPosition } = main;
  const bookmark = { chapterNumber: 1, paragraphIndex: 12, savedAt: 1000 };

  it("reading on past a bookmark wins over the bookmark", () => {
    expect(resumeChapter(bookmark, { chapter: 3, scrollPercent: 0.4, lastRead: 5000 })).toBe(3);
  });

  it("a bookmark set after the last scroll still wins", () => {
    expect(resumeChapter({ ...bookmark, savedAt: 9000 }, { chapter: 3, lastRead: 5000 })).toBe(1);
  });

  it("old saves without timestamps keep the old order (bookmark first)", () => {
    expect(resumeChapter({ chapterNumber: 1, paragraphIndex: 3 }, { chapter: 3, scrollPercent: 0.2 })).toBe(1);
    expect(resumePlace(null, { chapter: 2, lastRead: 1 }).chapter).toBe(2);
  });

  it("inside one chapter, a newer scroll position beats an older bookmark", () => {
    const scrolls = [];
    const kind = restoreReadingPosition({
      bookmark: { chapterNumber: 2, paragraphIndex: 0, savedAt: 1000 },
      saved: { chapter: 2, scrollPercent: 0.5, lastRead: 5000 },
      chapterNumber: 2,
      doc: { documentElement: { scrollHeight: 4000 }, querySelector: () => ({ scrollIntoView: () => scrolls.push("bookmark") }) },
      win: { innerHeight: 800, scrollTo: (x, y) => scrolls.push(y) },
    });
    expect(kind).toBe("position");
    expect(scrolls).toEqual([1600]);
  });
});

describe("P2 / O-15 / O-27: narration", () => {
  it("the stop button shows a square, not the escape sequence", async () => {
    const NarrationPanel = (await import("../src/NarrationPanel")).default;
    const plays = [];
    global.Audio = class { constructor() { this.paused = true; plays.push(this); } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
    global.URL.createObjectURL = () => "blob:x";
    global.URL.revokeObjectURL = () => {};
    const { container } = render(<NarrationPanel chapter={{ chapterTitle: "T", prose: "One.\n\nTwo.\n\nThree." }} voiceId="af_heart" />);
    fireEvent.click(screen.getByRole("button", { name: "Play narration" }));
    await screen.findByRole("button", { name: "Stop narration" });
    expect(container.textContent).not.toContain("\\u25A0");
    expect(screen.getByRole("button", { name: "Stop narration" }).textContent).toBe("■");
  });

  it("leaving the reader stops the voice and asks Kokoro for nothing more", async () => {
    const NarrationPanel = (await import("../src/NarrationPanel")).default;
    const plays = [];
    global.Audio = class { constructor() { this.paused = true; plays.push(this); } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
    global.URL.createObjectURL = () => "blob:x";
    global.URL.revokeObjectURL = () => {};
    const { unmount } = render(<NarrationPanel chapter={{ chapterTitle: "T", prose: "One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive." }} voiceId="af_heart" />);
    fireEvent.click(screen.getByRole("button", { name: "Play narration" }));
    await waitFor(() => expect(plays.length).toBeGreaterThan(0));
    const playing = plays[plays.length - 1];
    expect(playing.paused).toBe(false);
    unmount();
    expect(playing.paused).toBe(true);
    const asked = synth.mock.calls.length;
    playing.onended && playing.onended();
    await new Promise((r) => setTimeout(r, 50));
    expect(synth.mock.calls.length).toBe(asked);
    expect(plays.length).toBe(plays.indexOf(playing) + 1);
  });
});

describe("P2: long operations do not lose their answer to a client timeout", () => {
  const { converseTurn, StoryRequestError } = main;

  it("Talk to the story runs as a job and reads it until it is done", async () => {
    const seen = [];
    const answers = [{ ok: true, status: "pending", jobId: "cvj_1" }, { ok: true, status: "pending", jobId: "cvj_1" },
      { ok: true, message: "Because the harbor is far.", responseType: "conversation", jobStatus: "complete" }];
    const run = vi.fn(async (command, args) => { seen.push(args); return answers.shift(); });
    const res = await converseTurn({ tenantId: "core", message: "Why?", requestedBy: "keen" }, { run, sleep: async () => {} });
    expect(seen[0].async).toBe(true);
    expect(seen[1]).toMatchObject({ tenantId: "core", jobId: "cvj_1", requestedBy: "keen" });
    expect(seen[1]).not.toHaveProperty("message");
    expect(res.message).toBe("Because the harbor is far.");
  });

  it("a dropped poll is retried, not reported as a lost answer", async () => {
    const answers = [{ ok: true, status: "pending", jobId: "cvj_1" }, new StoryRequestError("x", { network: true }), { ok: true, message: "Here." }];
    const run = vi.fn(async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; });
    expect((await converseTurn({ tenantId: "core" }, { run, sleep: async () => {} })).message).toBe("Here.");
  });

  it("a server without jobs answers directly, and that answer is used", async () => {
    const run = vi.fn(async () => ({ ok: true, message: "Direct." }));
    expect((await converseTurn({ tenantId: "core" }, { run, sleep: async () => {} })).message).toBe("Direct.");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a chapter that takes longer than the wait still appears when it lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    let done = false;
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 3, currentChapter: 3, primaryReaders: ["jonathan"] }] }),
      "storyforge.chapter.get.v1": (a) => (a.chapterNumber === 4 && !done ? { ok: false, error: "chapter_not_found" } : chapterDoc(a.chapterNumber)),
      "storyforge.chapter.request.v1": () => ({ ok: true, status: "generating", chapterNumber: 4 }),
      status: (p) => (p.chapterNumber === "4"
        ? (done ? { ok: true, status: "complete", chapter: chapterDoc(4, { chapterTitle: "The Late Chapter" }) } : { ok: true, status: "generating" })
        : { ok: true, status: "complete" }),
    });
    localStorage.setItem("storyforge_default_reader", "jonathan");
    localStorage.setItem("sf_pending_write_s1", JSON.stringify({ chapterNumber: 4, choiceText: "Wait" }));
    vi.resetModules();
    const fresh = await import("../src/main.jsx");
    render(
      <MemoryRouter initialEntries={["/universes/u1/stories/s1"]}>
        <fresh.AppProvider>
          <Routes><Route path="/universes/:id/stories/:storyId" element={<fresh.ChapterReader />} /></Routes>
        </fresh.AppProvider>
      </MemoryRouter>,
    );
    for (let i = 0; i < 20 && !screen.queryByRole("button", { name: "Write chapter 4" }); i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    fireEvent.click(screen.getByRole("button", { name: "Write chapter 4" }));
    // 150 s of "generating": past the 120 s the web used to give up at.
    for (let t = 0; t < 150; t += 3) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    }
    expect(screen.getByText("This is taking longer than expected.")).toBeTruthy();
    done = true;
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    }
    expect(screen.getByRole("heading", { name: "The Late Chapter" })).toBeTruthy();
    expect(server.statusCalls.filter((c) => c.chapterNumber === "4").length).toBeGreaterThan(45);
  });
});
