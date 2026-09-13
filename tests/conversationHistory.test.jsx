/**
 * The sheet had no memory of a conversation the server had been keeping all along.
 *
 * `storyforge.converse.v1` persists both halves of every turn. The client threw
 * them away on close, because until `storyforge.conversation.list.v1` existed
 * nothing could read them back. Ten minutes of talking about chapter 2, gone the
 * moment you tapped the shade.
 *
 * Two things are worth testing here and they are both about *not* lying to the
 * reader:
 *
 *   - **Nothing is said twice.** The sheet opens and fetches at the same moment
 *     the first message is sent, so the two can land in either order. A
 *     transcript that repeats what you just typed reads as a bug.
 *   - **The break between then and now is visible.** An hour-old exchange and
 *     the thing you just typed must not read as one continuous conversation.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { mergeConversationHistory, historyDividerLabel } = await import("../src/main.jsx");

afterEach(cleanup);

const t = (role, content, createdAt) => ({ role, content, createdAt });

// ---------------------------------------------------------------------------
// nothing is said twice
// ---------------------------------------------------------------------------

describe("merging a restored thread in front of the live one", () => {
  it("puts the older turns first, in order", () => {
    const merged = mergeConversationHistory(
      [t("user", "Is chapter 2 too quiet?"), t("assistant", "On purpose.")],
      [{ role: "user", content: "Lean into the apprenticeship." }]
    );
    expect(merged.map((m) => m.content)).toEqual([
      "Is chapter 2 too quiet?",
      "On purpose.",
      "Lean into the apprenticeship.",
    ]);
  });

  it("marks restored turns so the sheet can draw the break", () => {
    const merged = mergeConversationHistory([t("user", "Earlier")], [{ role: "user", content: "Now" }]);
    expect(merged[0].history).toBe(true);
    expect(merged[1].history).toBeUndefined();
  });

  it("keeps when each restored turn was said", () => {
    const merged = mergeConversationHistory([t("user", "Earlier", "2026-09-10T01:00:00Z")], []);
    expect(merged[0].createdAt).toBe("2026-09-10T01:00:00Z");
  });

  it("renders a restored assistant turn as prose, not as a chapter", () => {
    // kind decides whether the sheet renders markdown or wraps it in <em>.
    const merged = mergeConversationHistory([t("assistant", "It is quiet on purpose.")], []);
    expect(merged[0].kind).toBe("conversation");
  });

  it("does not repeat the message that was just sent", () => {
    // The race: converse.v1 saved the turn before the history fetch answered.
    const merged = mergeConversationHistory(
      [t("user", "Older"), t("user", "Lean into the apprenticeship.")],
      [{ role: "user", content: "Lean into the apprenticeship." }]
    );
    expect(merged.map((m) => m.content)).toEqual(["Older", "Lean into the apprenticeship."]);
    expect(merged.filter((m) => m.content === "Lean into the apprenticeship.")).toHaveLength(1);
  });

  it("does not repeat a whole round trip that landed first", () => {
    const merged = mergeConversationHistory(
      [t("user", "Older"), t("user", "Say more"), t("assistant", "About what?")],
      [
        { role: "user", content: "Say more" },
        { role: "assistant", content: "About what?" },
      ]
    );
    expect(merged.map((m) => m.content)).toEqual(["Older", "Say more", "About what?"]);
  });

  it("keeps a phrase the reader genuinely said twice", () => {
    // Only a tail-to-head run counts as the same turn. "Keep going" in the
    // middle of an old conversation is a real thing that was said.
    const merged = mergeConversationHistory(
      [t("user", "Keep going"), t("assistant", "Alright."), t("user", "Something else")],
      [{ role: "user", content: "Keep going" }]
    );
    expect(merged.map((m) => m.content)).toEqual([
      "Keep going",
      "Alright.",
      "Something else",
      "Keep going",
    ]);
  });

  it("does not treat a matching role with different words as the same turn", () => {
    const merged = mergeConversationHistory(
      [t("user", "Older")],
      [{ role: "user", content: "Newer" }]
    );
    expect(merged).toHaveLength(2);
  });
});

describe("when there is nothing to restore", () => {
  it("leaves the live thread exactly as it was", () => {
    const local = [{ role: "user", content: "Only thing said" }];
    expect(mergeConversationHistory([], local)).toEqual(local);
  });

  it("survives a server that sends no turns field at all", () => {
    // A deploy that predates the capability lands here.
    expect(mergeConversationHistory(undefined, [{ role: "user", content: "x" }])).toHaveLength(1);
    expect(mergeConversationHistory(null, [])).toEqual([]);
  });

  it("opens with just the history when nothing has been said yet this sitting", () => {
    const merged = mergeConversationHistory([t("user", "Earlier")], []);
    expect(merged.map((m) => m.content)).toEqual(["Earlier"]);
  });
});

// ---------------------------------------------------------------------------
// the break between then and now
// ---------------------------------------------------------------------------

describe("the divider label", () => {
  const now = new Date("2026-09-13T20:00:00Z");

  it("says Earlier today for the same day", () => {
    expect(historyDividerLabel("2026-09-13T02:00:00Z", now)).toBe("Earlier today");
  });

  it("says Yesterday for the day before", () => {
    expect(historyDividerLabel("2026-09-12T23:00:00Z", now)).toBe("Yesterday");
  });

  it("gives a date for anything older", () => {
    const label = historyDividerLabel("2026-09-04T10:00:00Z", now);
    expect(label).not.toBe("Yesterday");
    expect(label).not.toBe("Earlier today");
    expect(label).toMatch(/4/);
  });

  it("never renders Invalid Date into a child's screen", () => {
    expect(historyDividerLabel("not a date", now)).toBe("Earlier");
    expect(historyDividerLabel(undefined, now)).toBe("Earlier");
    expect(historyDividerLabel(null, now)).toBe("Earlier");
  });

  it("treats a clock-skewed future timestamp as today rather than a negative day count", () => {
    expect(historyDividerLabel("2026-09-14T02:00:00Z", now)).toBe("Earlier today");
  });
});
