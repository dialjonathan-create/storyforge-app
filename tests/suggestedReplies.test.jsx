/**
 * The editor asks a two-option question; you tap the answer instead of typing it.
 *
 * From a real reply: *"Does that direction sound like the right pulse for
 * Chapter 2? Or do you want to lean harder into her apprenticeship with
 * Tamsin?"* Two enumerable answers, delivered as prose. On a phone, saying "the
 * second one" was a paragraph of thumb work, and the person doing it is often
 * seven.
 *
 * `storyforge.converse.v1` now returns `suggestedReplies`; this renders whatever
 * it gets. Two properties the tests exist to hold:
 *
 *   - **An absent or empty list is exactly today.** Nothing renders, nothing
 *     shifts. A server that predates the field behaves identically, which is
 *     what makes the client half safe to ship before the engine half lands.
 *   - **Chips appear only under the LAST assistant turn.** Chips halfway up a
 *     transcript answer a question that has already been answered.
 *
 * Free text never goes away. The composer sits directly below; a chip is a
 * shortcut, not a menu.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { SuggestedReplies } = await import("../src/main.jsx");

afterEach(cleanup);

const chips = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("the chip row", () => {
  it("renders one tappable chip per suggestion", () => {
    render(<SuggestedReplies replies={["Yes, that pulse works", "Lean into the apprenticeship"]} onPick={() => {}} />);
    expect(chips()).toEqual(["Yes, that pulse works", "Lean into the apprenticeship"]);
  });

  it("sends the chip's exact text when tapped", () => {
    const onPick = vi.fn();
    render(<SuggestedReplies replies={["Lean into the apprenticeship"]} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Lean into the apprenticeship" }));
    expect(onPick).toHaveBeenCalledWith("Lean into the apprenticeship");
  });

  it("is announced as a group so a screen reader does not read four loose buttons", () => {
    render(<SuggestedReplies replies={["a", "b"]} onPick={() => {}} />);
    expect(screen.getByRole("group", { name: "Suggested replies" })).toBeTruthy();
  });
});

describe("an absent list is exactly today", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<SuggestedReplies replies={[]} onPick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the field is missing entirely", () => {
    // A server that predates suggestedReplies sends no such key.
    const { container } = render(<SuggestedReplies onPick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for null rather than throwing into a blank sheet", () => {
    const { container } = render(<SuggestedReplies replies={null} onPick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("while the story is thinking", () => {
  it("disables the chips instead of hiding them", () => {
    // Hiding them would make the row appear and vanish under the reader's
    // thumb; disabled keeps the layout still and the answer visible.
    const onPick = vi.fn();
    render(<SuggestedReplies replies={["Keep going"]} onPick={onPick} disabled />);
    const chip = screen.getByRole("button", { name: "Keep going" });
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(onPick).not.toHaveBeenCalled();
  });
});
