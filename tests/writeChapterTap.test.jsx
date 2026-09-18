/**
 * Recording a choice and writing a chapter are two taps, and they look it.
 *
 * Supervisor #1627 split them: `storyforge.choice.record.v1` now holds at
 * `awaiting_request` with `autoGenerates: false` and names
 * `storyforge.chapter.request.v1` as the call that writes. Before this, the PWA
 * had no second call at all -- a recorded choice waited forever behind a
 * spinner that said "The story is being written...".
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
const {
  WriteNextChapterCard,
  ChoicePanel,
  heldForRequest,
  writeChapterMessage,
  AbilityCommandChapterRequest,
} = await import("../src/main.jsx");
afterEach(cleanup);

const PENDING = { chapterNumber: 4, choiceText: "Follow the light down the stairs.", madeBy: "keen" };

describe("the write tap", () => {
  it("is the capability the split named, not the one that used to generate", () => {
    expect(AbilityCommandChapterRequest).toBe("storyforge.chapter.request.v1");
  });

  it("names the chapter it will write and quotes the choice that is waiting", () => {
    render(<WriteNextChapterCard pending={PENDING} busy={false} onWrite={() => {}} />);
    expect(screen.getByText("Chapter 4 is not written yet")).toBeTruthy();
    expect(screen.getByText(/Follow the light down the stairs\./)).toBeTruthy();
    expect(screen.getByText(/Tap the button to make chapter 4\. Nothing happens until you do\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write chapter 4" })).toBeTruthy();
  });

  it("writes nothing until tapped, and asks for that chapter number when it is", () => {
    const onWrite = vi.fn();
    render(<WriteNextChapterCard pending={PENDING} busy={false} onWrite={onWrite} />);
    expect(onWrite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Write chapter 4" }));
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("cannot be tapped twice while it is running, and says what it is doing", () => {
    const onWrite = vi.fn();
    render(<WriteNextChapterCard pending={PENDING} busy onWrite={onWrite} />);
    const button = screen.getByRole("button", { name: "Writing chapter 4…" });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("renders nothing when no choice is waiting", () => {
    const { container } = render(<WriteNextChapterCard pending={null} busy={false} onWrite={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("offers no write button to a reader who is not allowed to start one", () => {
    render(<WriteNextChapterCard pending={{ ...PENDING, narratorOnly: true }} busy={false} onWrite={() => {}} />);
    expect(screen.queryByRole("button", { name: /Write chapter/ })).toBeNull();
    expect(screen.getByText(/A grown-up has to ask for chapter 4\./)).toBeTruthy();
  });
});

describe("the choice tap is a different act", () => {
  const chapter = {
    chapterNumber: 3,
    choices: [{ id: "1", text: "Follow the light down the stairs." }, { id: "2", text: "Stay where it is warm." }],
  };

  it("does not ask for a chapter -- it hands back the choice and nothing else", () => {
    const onChoose = vi.fn();
    // Queried by text, not by role: the panel animates in, and framer-motion's
    // opening frame leaves it visibility:hidden until it does.
    const { container } = render(<ChoicePanel visible chapter={chapter} readers={["keen"]} onChoose={onChoose} />);
    const first = [...container.querySelectorAll("button")].find((b) => b.textContent === "Follow the light down the stairs.");
    expect(first).toBeTruthy();
    fireEvent.click(first);
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0]).toEqual(chapter.choices[0]);
    expect([...container.querySelectorAll("button")].some((b) => /Write chapter/.test(b.textContent))).toBe(false);
  });

  it("is not the same control: different container, different class, different words", () => {
    const { container: choices } = render(<ChoicePanel visible chapter={chapter} readers={["keen"]} onChoose={() => {}} />);
    const { container: card } = render(<WriteNextChapterCard pending={PENDING} busy={false} onWrite={() => {}} />);
    expect(choices.querySelector(".choice-panel")).toBeTruthy();
    expect(choices.querySelector(".write-chapter-card")).toBeNull();
    expect(choices.querySelector(".write-chapter-button")).toBeNull();
    expect(card.querySelector(".write-chapter-card")).toBeTruthy();
    expect(card.querySelector(".choice-panel")).toBeNull();
    // The choice that is quoted on the card is text, not a button.
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Write chapter 4"]);
  });
});

describe("a server that cannot write a chapter this way yet says so", () => {
  it("turns the dispatcher's refusal into something a child can read, keeping the server's words", () => {
    const message = writeChapterMessage(
      new Error("Command is not declared in this service: storyforge.chapter.request.v1"),
      4,
    );
    expect(message.text).toBe(
      "Not yet. The app asked for chapter 4, but the story server does not know how to write one this way yet. Your pick is saved. Try again later.",
    );
    expect(message.detail).toContain("storyforge.chapter.request.v1");
  });

  it("renders that message, and the pick, and leaves the button there to try again", () => {
    const message = writeChapterMessage(new Error("COMMAND_NOT_DECLARED_IN_CODE"), 4);
    render(
      <WriteNextChapterCard pending={PENDING} busy={false} error={message.text} detail={message.detail} onWrite={() => {}} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("does not know how to write one this way yet");
    expect(alert.textContent).toContain("Your pick is saved");
    expect(screen.getByText(/Follow the light down the stairs\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write chapter 4" }).disabled).toBe(false);
  });

  it("has a plain sentence for every refusal the request capability can give", () => {
    expect(writeChapterMessage(new Error("chapter_exists"), 4).text).toBe("Chapter 4 is already written. Turn the page to read it.");
    expect(writeChapterMessage(new Error("no_recorded_choice"), 4).text).toBe("The story did not keep your pick. Tap what happens next again.");
    expect(writeChapterMessage(new Error("already_generating"), 4).text).toBe("Chapter 4 is already being written. It will be here soon.");
    expect(writeChapterMessage(new Error("awaiting_narrator"), 4).text).toBe("A grown-up has to ask for chapter 4.");
    expect(writeChapterMessage(new Error("boom"), 4).text).toContain("your pick is saved");
    expect(writeChapterMessage(new Error("boom"), 4).detail).toBe("boom");
  });
});

describe("reading the server's answer to a recorded choice", () => {
  it("holds for a request when the server says it is not generating on its own", () => {
    expect(heldForRequest({
      ok: true, status: "awaiting_request", awaitingRequest: true, awaitingDirection: false,
      directionTimeoutSeconds: 0, autoGenerates: false,
      requestWith: "storyforge.chapter.request.v1", chapterNumber: 4,
    })).toBe(true);
    expect(heldForRequest({ ok: true, status: "awaiting_narrator", awaitingNarrator: true, requestWith: null })).toBe(true);
  });

  it("keeps the waiting screen for a server that really is writing", () => {
    expect(heldForRequest({ ok: true, status: "generating", chapterNumber: 4 })).toBe(false);
    // Pre-#1627: a 30-second timer that generates whether or not anybody asks.
    // On that server the waiting screen is the truth, so it stays.
    expect(heldForRequest({ ok: true, awaitingDirection: true, directionTimeoutSeconds: 30, chapterNumber: 4 })).toBe(false);
    expect(heldForRequest(null)).toBe(false);
  });
});
