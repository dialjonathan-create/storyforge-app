/**
 * Multiple, specific readers (supervisor: `readingNow`, `chosenBy`).
 *
 * The family reads stories together as much as alone. A story has readers --
 * any subset of the four -- and each chapter is written for whoever is reading
 * it that night. It is used at bedtime with a seven-year-old: the default has
 * to be right, and "together" to "just Keen" is one tap.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
const {
  orderedReaders,
  readersSentence,
  initialReadingNow,
  rememberReadingNow,
  forgetReadingNowMemory,
  toggleReader,
  ReaderChips,
  WhosReading,
  WrittenFor,
  WriteNextChapterCard,
  recordChoiceWithReaders,
} = await import("../src/main.jsx");

afterEach(cleanup);
beforeEach(() => forgetReadingNowMemory());

describe("reader ids", () => {
  it("are family ids in family order, from a list or a joined string", () => {
    expect(orderedReaders(["keen", "Jonathan", "keen", "sable"])).toEqual(["jonathan", "keen"]);
    expect(orderedReaders("talia&adele")).toEqual(["adele", "talia"]);
    expect(readersSentence(["keen", "jonathan"])).toBe("Jonathan & Keen");
    expect(readersSentence(["talia", "keen", "adele"])).toBe("Adele, Keen & Talia");
  });
});

describe("who the next chapter is for, before anyone taps", () => {
  const story = { storyId: "s1", primaryReaders: ["jonathan", "keen"] };

  it("is every reader of the story by default", () => {
    expect(initialReadingNow(story)).toEqual(["jonathan", "keen"]);
  });

  it("is what the server remembers, then what was picked on this device", () => {
    expect(initialReadingNow({ ...story, readingNow: ["keen"] })).toEqual(["keen"]);
    rememberReadingNow("s1", ["jonathan"]);
    expect(initialReadingNow({ ...story, readingNow: ["keen"] })).toEqual(["jonathan"]);
  });

  it("never names someone who is not a reader of the story", () => {
    expect(initialReadingNow({ ...story, readingNow: ["talia"] })).toEqual(["jonathan", "keen"]);
  });

  it("falls back to whoever is signed in for a story with no readers on file", () => {
    expect(initialReadingNow({ storyId: "old" }, ["adele"])).toEqual(["adele"]);
  });

  it("cannot be tapped down to nobody", () => {
    expect(toggleReader(["keen"], "keen")).toEqual(["keen"]);
    expect(toggleReader(["jonathan", "keen"], "jonathan")).toEqual(["keen"]);
    expect(toggleReader(["keen"], "talia")).toEqual(["keen", "talia"]);
  });
});

describe("Who's reading?", () => {
  it("is not shown for a story with one reader -- there is nobody to leave out", () => {
    const { container } = render(<WhosReading readers={["keen"]} selected={["keen"]} onChange={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the story's readers, all selected, and one tap makes it just Keen", () => {
    const onChange = vi.fn();
    render(<WhosReading readers={["jonathan", "keen"]} selected={["jonathan", "keen"]} onChange={onChange} />);
    const jonathan = screen.getByRole("button", { name: /Jonathan/ });
    expect(jonathan.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Keen/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(jonathan);
    expect(onChange).toHaveBeenCalledWith(["keen"]);
  });

  it("with the whole family, 'Just Keen' is one tap, and 'Everyone' brings them back", () => {
    const onChange = vi.fn();
    const all = ["jonathan", "adele", "keen", "talia"];
    const { rerender } = render(<WhosReading readers={all} selected={all} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Everyone" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Just Keen" }));
    expect(onChange).toHaveBeenLastCalledWith(["keen"]);
    rerender(<WhosReading readers={all} selected={["keen"]} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Just Keen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Everyone" }));
    expect(onChange).toHaveBeenLastCalledWith(all);
  });

  it("a long press (or right click) on a chip means only that reader", () => {
    const onChange = vi.fn();
    render(<ReaderChips options={["jonathan", "adele", "keen"]} selected={["jonathan", "adele", "keen"]} onChange={onChange} onOnly={(id) => onChange([id])} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Adele/ }));
    expect(onChange).toHaveBeenCalledWith(["adele"]);
  });

  it("sits on the write card, above the button, so it can be changed before the chapter is written", () => {
    render(
      <WriteNextChapterCard pending={{ chapterNumber: 6, choiceText: "Go north." }} busy={false} onWrite={() => {}}>
        <WhosReading readers={["jonathan", "keen"]} selected={["keen"]} onChange={() => {}} />
      </WriteNextChapterCard>,
    );
    expect(screen.getByRole("region", { name: "Who's reading?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write chapter 6" })).toBeTruthy();
  });
});

describe("Written for", () => {
  it("names who the chapter was written for, from the chapter's own record", () => {
    render(<WrittenFor chapter={{ readingNow: ["keen", "jonathan"] }} />);
    expect(screen.getByText("Written for Jonathan & Keen")).toBeTruthy();
  });

  it("says nothing for a chapter from before it was recorded", () => {
    const { container } = render(<WrittenFor chapter={{ chapterTitle: "Old" }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("recording a choice made together", () => {
  const base = { tenantId: "core", universeId: "u", storyId: "s", chapterNumber: 5, choiceText: "Go north." };

  it("sends who chose and who is reading", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    await recordChoiceWithReaders(base, ["jonathan", "keen"], "jonathan", run);
    expect(run).toHaveBeenCalledWith("storyforge.choice.record.v1", { ...base, chosenBy: ["jonathan", "keen"], readingNow: ["jonathan", "keen"] });
    expect(run.mock.calls[0][1].madeBy).toBeUndefined();
  });

  it("still saves the pick on a server that does not know readingNow yet", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("storyforge.choice.record.v1 does not take readingNow. Nothing was recorded."))
      .mockResolvedValueOnce({ ok: true });
    await recordChoiceWithReaders(base, ["keen"], "jonathan", run);
    expect(run).toHaveBeenLastCalledWith("storyforge.choice.record.v1", { ...base, madeBy: "keen" });
  });

  it("does not retry any other failure", async () => {
    const run = vi.fn().mockRejectedValue(new Error("choice_not_in_chapter"));
    await expect(recordChoiceWithReaders(base, ["keen"], "jonathan", run)).rejects.toThrow("choice_not_in_chapter");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
