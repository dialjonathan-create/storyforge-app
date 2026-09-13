/**
 * Two entry points to the same sheet, one of them permanently occupying a third
 * of the reading view.
 *
 * The 💬 in the reader header opens `StoryChatSheet`. `TalkBar` — a compose row
 * pinned to the bottom of the chapter — opened the *same* sheet, by the same
 * `sendChatMessage`, and sat there whether or not anyone wanted it. Two doors
 * into one room, and one of them was load-bearing furniture.
 *
 * `TalkBar` is gone. The reading view is prose edge to edge; the bubble is the
 * way in; everything from #11–#15 lives in the sheet where it always did.
 *
 * These tests are mostly absence assertions, which are weak on their own — so
 * they check the things that would actually break if the removal were done
 * carelessly: that the component and its styles are really gone rather than
 * orphaned, that nothing still references its dead state, and that the sheet it
 * fed still has every capability it had.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const main = await import("../src/main.jsx");
const { StoryChatSheet, Composer } = main;

afterEach(cleanup);

const SOURCE = readFileSync(path.join(process.cwd(), "src/main.jsx"), "utf8");
const CSS = readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");

describe("the talk bar is gone, not hidden", () => {
  it("exports no TalkBar", () => {
    expect(main.TalkBar).toBeUndefined();
  });

  it("declares no TalkBar", () => {
    expect(SOURCE).not.toMatch(/function TalkBar/);
    expect(SOURCE).not.toMatch(/<TalkBar/);
  });

  it("leaves no orphaned state behind it", () => {
    // `talkText` existed only to feed the talk bar. A removal that left it
    // would be a re-render on every keystroke into a field nobody can see.
    expect(SOURCE).not.toMatch(/talkText/);
    expect(SOURCE).not.toMatch(/setTalkText/);
  });

  it("leaves no orphaned styles behind it", () => {
    // Including the media-query override, which is the half that gets missed.
    expect(CSS).not.toMatch(/^\.story-talk\s*\{/m);
    expect(CSS).not.toMatch(/^\s+\.story-talk\s*\{/m);
  });
});

describe("the sheet still does everything it did", () => {
  const thread = [
    { role: "user", content: "Is chapter 2 too quiet?" },
    {
      role: "assistant",
      content: "### It is quiet on purpose\n\nAnd **deliberately** so.",
      kind: "conversation",
      suggestedReplies: ["Lean into the apprenticeship"],
      proposal: {
        path: "chapter_save",
        draftId: "the-embodied-age:threshold:3:64c8e066c6",
        chapterNumber: 3,
        chapterTitle: "Where She Is Holding Tension",
        proseChars: 9368,
      },
    },
  ];

  function sheet(props = {}) {
    return render(
      <StoryChatSheet
        thread={thread}
        busy={false}
        onSend={() => {}}
        onClose={() => {}}
        onApprove={() => {}}
        onDismiss={() => {}}
        {...props}
      />
    );
  }

  it("still has a composer", () => {
    sheet();
    expect(screen.getByLabelText("Say more")).toBeTruthy();
  });

  it("still renders the editor's markdown", () => {
    sheet();
    expect(screen.getByText("It is quiet on purpose")).toBeTruthy();
  });

  it("still offers tappable answers", () => {
    sheet();
    expect(screen.getByRole("button", { name: "Lean into the apprenticeship" })).toBeTruthy();
  });

  it("still shows the proposal card", () => {
    sheet();
    expect(screen.getByText("Where She Is Holding Tension")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use this" })).toBeTruthy();
  });

  it("still restores a conversation, with the break before today", () => {
    render(
      <StoryChatSheet
        thread={[
          { role: "user", content: "Older", history: true, createdAt: "2020-01-01T00:00:00Z" },
          { role: "user", content: "Now" },
        ]}
        busy={false}
        onSend={() => {}}
        onClose={() => {}}
        onApprove={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText("Older")).toBeTruthy();
    expect(screen.getByText("Now")).toBeTruthy();
  });

  it("says so plainly when there is nothing in it yet", () => {
    sheet({ thread: [] });
    expect(screen.getByText("Nothing said about this story yet.")).toBeTruthy();
  });
});

describe("the one compose row", () => {
  it("is still shared rather than duplicated", () => {
    // The point of extracting Composer in #11 was one field, not two. With the
    // talk bar gone it has a single call site, and that is the shape to keep.
    expect(typeof Composer).toBe("function");
    expect((SOURCE.match(/<Composer\b/g) || []).length).toBe(1);
  });
});
