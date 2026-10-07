/**
 * Otherwise re-audit (r2), 2026-10-06 -- the web reader.
 *
 * O2-02 / O-22  Keen alone on "Jonathan & Keen" (the Meridian) saw both pre-selected
 *               and "What do you two decide?"; his pick failed until he unticked Jonathan.
 * O-06          the server held a "revise chapter N" draft and the web never showed it.
 * O-12 (web)    after "Use this" in the conversation, closing it re-read the chapter
 *               from the DEVICE cache -- the old words.
 * O-21          "Checking for consistency..." then "taking longer than expected" at 120 s.
 * O2-09         Meridian ch30 showed its options twice (as prose and as buttons).
 * O2-10         every refusal read "This story isn't open to this reader."
 * O-13          Keen still saw "Delete Universe".
 * O-18          no idea the network was gone; O-24 "World A Floating Island Main";
 * O-29          a closed conversation reopened by itself; O-30 "1 chapters".
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import React from "react";
import { fakeStoryServer, chapterDoc, PROSE } from "./helpers/fakeStoryServer";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
vi.mock("../src/kokoro", () => ({ fetchVoices: async () => [], synthesize: async () => new ArrayBuffer(8) }));

function signIn(userId) {
  localStorage.setItem("otherwise_session", JSON.stringify({
    accessToken: `access-${userId}`, userId, sessionId: `sid-${userId}`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
  }));
}

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const main = await import("../src/main.jsx");

describe("O2-02 / O-22: who is reading tonight is who is here", () => {
  const { initialReadingNow, rememberReadingNow, forgetReadingNowMemory } = main;
  const meridian = { storyId: "the-meridian", primaryReaders: ["jonathan", "keen"], readingNow: ["jonathan", "keen"] };
  beforeEach(() => forgetReadingNowMemory());

  it("Keen alone on Jonathan & Keen's story is reading alone", () => {
    expect(initialReadingNow(meridian, ["keen"])).toEqual(["keen"]); // was ["jonathan", "keen"]
  });

  it("even when this device last read it together", () => {
    rememberReadingNow("the-meridian", ["jonathan", "keen"]);
    expect(initialReadingNow(meridian, ["keen"])).toEqual(["keen"]);
  });

  it("Talia alone on a story that is not hers reads as herself", () => {
    expect(initialReadingNow(meridian, ["talia"])).toEqual(["talia"]);
  });

  it("both of them here is both of them", () => {
    expect(initialReadingNow(meridian, ["jonathan", "keen"])).toEqual(["jonathan", "keen"]);
  });

  it("Keen alone sees his own prompt, and his pick names only him", async () => {
    signIn("keen");
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["keen"]));
    localStorage.setItem("storyforge_default_reader", "keen");
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ ...meridian, title: "The Meridian", totalChapters: 30, currentChapter: 30 }] }),
      "storyforge.chapter.get.v1": (a) => chapterDoc(a.chapterNumber),
      "storyforge.choice.record.v1": () => ({ ok: true, status: "awaiting_narrator", chapterNumber: 31 }),
      "storyforge.draft.list.v1": () => ({ ok: false, error: "forbidden" }),
    });
    vi.resetModules();
    const fresh = await import("../src/main.jsx");
    render(
      <MemoryRouter initialEntries={["/universes/meridian-universe/stories/the-meridian"]}>
        <fresh.AppProvider>
          <Routes><Route path="/universes/:id/stories/:storyId" element={<fresh.ChapterReader />} /></Routes>
        </fresh.AppProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "The Deck 30" });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    const prompt = await screen.findByText("Keen, what's your instinct?", {}, { timeout: 3000 });
    expect(prompt).toBeTruthy();
    expect(screen.queryByText("What do you two decide?")).toBeNull();
    fireEvent.click(screen.getByText("Go left"));
    await waitFor(() => expect(server.commands("storyforge.choice.record.v1").length).toBe(1));
    const args = server.commands("storyforge.choice.record.v1")[0].args;
    expect(args.chosenBy).toEqual(["keen"]);
    expect(args.readingNow).toEqual(["keen"]);
  });
});

describe("O-06: a change the server is holding is shown over the chapter", () => {
  function reader(server) {
    return render(
      <MemoryRouter initialEntries={["/universes/u1/stories/s1"]}>
        <main.AppProvider>
          <Routes><Route path="/universes/:id/stories/:storyId" element={<main.ChapterReader />} /></Routes>
        </main.AppProvider>
      </MemoryRouter>,
    );
  }

  it("finds the held revision of THIS chapter, and Use this puts it on the page", async () => {
    signIn("jonathan");
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["jonathan"]));
    let approved = false;
    const REVISED = "Keen walked to the deck with a penguin. The penguin told a joke.\n\nSable laughed.";
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 1, currentChapter: 1, primaryReaders: ["jonathan"] }] }),
      "storyforge.chapter.get.v1": () => chapterDoc(1, approved ? { prose: REVISED } : {}),
      "storyforge.draft.list.v1": () => ({ ok: true, drafts: [
        { draftId: "u1:s1:2:gen", chapterNumber: 2, origin: "generated" },
        { draftId: "u1:s1:1:rev", chapterNumber: 1, origin: "revision", excerpt: "Keen walked to the deck with a penguin." },
      ] }),
      "storyforge.draft.get.v1": () => ({ ok: true, draft: { chapterNumber: 1, prose: REVISED, preview: { before: "Keen walked to the deck.", after: "Keen walked to the deck with a penguin." } } }),
      "storyforge.draft.approve.v1": (a) => { approved = a.draftId === "u1:s1:1:rev"; return { ok: true, revised: true, chapterNumber: 1 }; },
    });
    reader(server);
    await screen.findByText("A change to this chapter is waiting");
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(approved).toBe(true));
    await waitFor(() => expect(document.querySelector(".prose")?.textContent || "").toContain("The penguin told a joke."));
    expect(screen.queryByText("A change to this chapter is waiting")).toBeNull();
    expect(server.commands("storyforge.draft.approve.v1")[0].args.draftId).toBe("u1:s1:1:rev");
  });

  it("a child is never offered one (and is not asked)", async () => {
    signIn("keen");
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["keen"]));
    const server = fakeStoryServer({
      "storyforge.story.list.v1": () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 1, currentChapter: 1, primaryReaders: ["keen"] }] }),
      "storyforge.chapter.get.v1": () => chapterDoc(1),
    });
    reader(server);
    await screen.findByRole("heading", { name: "The Deck 1" });
    expect(server.commands("storyforge.draft.list.v1")).toHaveLength(0);
  });

  it("findHeldChange ignores other chapters and new-chapter drafts", async () => {
    const run = async (cmd) => (cmd === "storyforge.draft.list.v1"
      ? { drafts: [{ draftId: "a", chapterNumber: 2, origin: "revision" }, { draftId: "b", chapterNumber: 3, origin: "generated" }] }
      : { draft: {} });
    expect(await main.findHeldChange("u", "s", 3, run)).toBeNull();
    expect((await main.findHeldChange("u", "s", 2, run)).draftId).toBe("a");
  });
});

describe("O-21: the waiting screen says what is happening, from the server", () => {
  it("names the stage, never 'Checking for consistency'", () => {
    expect(main.progressText({ phase: "writing" }, 4)).toBe("Writing chapter 4...");
    expect(main.progressText({ phase: "checking" }, 4)).toMatch(/Reading chapter 4 over/);
    expect(main.progressText({ phase: "rewriting" }, 4)).toMatch(/Fixing/);
    expect(main.progressText(null, 4)).toBe("");
    expect(main.waitingDetail({ startedAt: Date.now() - 65_000 })).toMatch(/1 min 5 s so far/);
  });

  it("the window is past the server's ~2-minute budget", () => {
    expect(main.CHAPTER_WAIT_TIMEOUT_MS).toBeGreaterThanOrEqual(170_000);
  });
});

describe("O2-09: options are shown once", () => {
  const { withoutRepeatedChoices, proseBlocks } = main;
  const choices = [{ id: "1", text: "Ask Sable about the harbor." }, { id: "2", text: "Climb the mast." }, { id: "3", text: "Go below." }];

  it("drops a trailing list that repeats the chapter's own choices, with its heading", () => {
    const prose = "The harbor was quiet.\n\nKeen looked up.\n\nWhat happens next?\n\n- *Ask Sable about the harbor.*\n- *Climb the mast.*\n- *Go below.*";
    const blocks = withoutRepeatedChoices(proseBlocks(prose), choices);
    expect(blocks.map((b) => b.text)).toEqual(["The harbor was quiet.", "Keen looked up."]);
  });

  it("keeps prose that only mentions a choice, and keeps lists that are not the choices", () => {
    const prose = "Keen thought about it.\n\n- Climb the mast.\n- Eat lunch.";
    expect(withoutRepeatedChoices(proseBlocks(prose), choices)).toHaveLength(3);
    expect(withoutRepeatedChoices(proseBlocks("Go below."), choices)).toHaveLength(1);
  });
});

describe("O2-10: a refusal says why, in its own sentence", () => {
  const { friendlyError, StoryRequestError } = main;
  it("uses the server's sentence", () => {
    const e = new StoryRequestError("Only the person who made this world can do that.", { status: 403, code: "forbidden", reason: "owner_only" });
    expect(friendlyError(e).text).toBe("Only the person who made this world can do that.");
  });
  it("never a code", () => {
    expect(friendlyError(new StoryRequestError("forbidden", { status: 403 })).text).toBe("That isn't open to this reader.");
    expect(friendlyError(new StoryRequestError("FORBIDDEN_FOR_SCOPE", { status: 403 })).text).toBe("That isn't open to this reader.");
  });
});

describe("O-13: the grown-up menus are a grown-up's", () => {
  it("knows who is signed in", () => {
    signIn("keen");
    expect(main.grownUpSignedIn()).toBe(false);
    signIn("jonathan");
    expect(main.grownUpSignedIn()).toBe(true);
    localStorage.removeItem("otherwise_session");
    expect(main.grownUpSignedIn()).toBe(false);
  });
});

describe("O-24 / O-30: words on the screen", () => {
  it("a young-flow title is the main character, never the labels", () => {
    expect(main.inferTitle("World: A floating island\nMain character: a penguin named Pebble\nMost exciting thing: a storm"))
      .toBe("A Penguin Named Pebble");
    expect(main.inferTitle("World: A floating island\nMain character: \nMost exciting thing: x")).toBe("A Floating Island");
    expect(main.inferTitle("a dragon who is afraid of the dark")).toBe("A Dragon Who Is Afraid Of");
  });
  it("1 chapter, 2 chapters", () => {
    expect(main.countOf(1, "chapter", "chapters")).toBe("1 chapter");
    expect(main.countOf(0, "story", "stories")).toBe("0 stories");
  });
});

describe("O-18: the app knows when the network is gone", () => {
  it("shows a banner offline, and hides it back online", () => {
    render(<main.OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByRole("status").textContent).toMatch(/offline/);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("O-31: Escape closes", () => {
  it("useEscape calls close only while open", () => {
    const close = vi.fn();
    function Probe({ open }) { main.useEscape(open, close); return null; }
    const { rerender } = render(<Probe open={false} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    rerender(<Probe open />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("the conversation sheet (O-29, and O-12 on the web)", () => {
  function reader() {
    return render(
      <MemoryRouter initialEntries={["/universes/u1/stories/s1"]}>
        <main.AppProvider>
          <Routes><Route path="/universes/:id/stories/:storyId" element={<main.ChapterReader />} /></Routes>
        </main.AppProvider>
      </MemoryRouter>,
    );
  }
  const story = () => ({ ok: true, stories: [{ storyId: "s1", title: "Sky Ship", totalChapters: 1, currentChapter: 1, primaryReaders: ["jonathan"] }] });

  it("a sheet closed while its history loads stays closed", async () => {
    signIn("jonathan");
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["jonathan"]));
    let release;
    fakeStoryServer({
      "storyforge.story.list.v1": story,
      "storyforge.chapter.get.v1": () => chapterDoc(1),
      "storyforge.draft.list.v1": () => ({ ok: true, drafts: [] }),
      "storyforge.conversation.list.v1": () => new Promise((r) => { release = () => r({ ok: true, turns: [{ role: "user", content: "earlier" }] }); }),
    });
    reader();
    await screen.findByRole("heading", { name: "The Deck 1" });
    fireEvent.click(screen.getByRole("button", { name: "Open the conversation" }));
    await screen.findByText("Talk to the story");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Talk to the story")).toBeNull());
    await waitFor(() => expect(typeof release).toBe("function"));
    await act(async () => { release(); });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Talk to the story")).toBeNull(); // reopened by itself before
  });

  it("closing it after a change re-reads the chapter from the server, not the device", async () => {
    signIn("jonathan");
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["jonathan"]));
    let edited = false;
    const server = fakeStoryServer({
      "storyforge.story.list.v1": story,
      "storyforge.chapter.get.v1": () => chapterDoc(1, edited ? { prose: "The penguin told Keen a joke about ice.\n\nEveryone laughed." } : {}),
      "storyforge.draft.list.v1": () => ({ ok: true, drafts: [] }),
      "storyforge.conversation.list.v1": () => ({ ok: true, turns: [] }),
      "storyforge.converse.v1": () => { edited = true; return { ok: true, responseType: "chapter_edit", message: "Chapter 1 now has the joke." }; },
    });
    reader();
    await screen.findByRole("heading", { name: "The Deck 1" });
    fireEvent.click(screen.getByRole("button", { name: "Open the conversation" }));
    const box = await screen.findByLabelText("Say more");
    fireEvent.change(box, { target: { value: "Add a joke to chapter 1" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByText("Chapter 1 now has the joke.");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".prose")?.textContent || "").toContain("Everyone laughed."));
    expect(server.commands("storyforge.chapter.get.v1").length).toBeGreaterThanOrEqual(2);
  });
});
