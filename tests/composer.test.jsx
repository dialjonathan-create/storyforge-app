/**
 * The composer was a single-line box Jonathan could not see his own typing in.
 *
 * Both call sites — `TalkBar` in the reader and the compose row in
 * `StoryChatSheet` — were an `<input>` beside a `.gold-button`. `.gold-button`
 * is `width: 100%`, and `.story-talk` declared THREE grid columns
 * (`auto 1fr auto`) for TWO children: the field landed in the `auto` column and
 * sized to its own content, the button took the `1fr`. That is the small square
 * and the sheet-wide Send in the screenshot — a template with one column too
 * many, not a matter of taste.
 *
 * WHAT THIS FILE CAN AND CANNOT ASSERT. The growth that matters has two halves.
 * Newlines are exact and are asserted here. Soft-wrap — a long unbroken
 * sentence wrapping to a second line — needs a real layout engine; jsdom reports
 * `scrollHeight` as 0, so the `useEffect` that handles it is inert under test
 * and is a device check. That is why `composerRows` is computed from the text
 * rather than measured: a measured version would be untestable, and an
 * untestable auto-grow is how this shipped as a one-line box in the first place.
 *
 * The keyboard behaviour — whether the compose row stays above the keyboard on
 * an iPhone — is not assertable here at all. jsdom has no `visualViewport`, no
 * keyboard and no `dvh`. It is listed as a device check in the PR.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React, { useState } from "react";

// Plain DOM assertions throughout: vitest.config.js registers no setup file, so
// @testing-library/jest-dom matchers (toHaveAttribute, toBeDisabled) are not
// available. Adding one would mean editing build config for a test file.

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { Composer, composerRows, COMPOSER_MAX_ROWS } = await import("../src/main.jsx");

afterEach(cleanup);

/** A host that owns the text, the way both real call sites do. */
function Harness({ onSubmit = () => {}, busy = false, initial = "" }) {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={(text) => {
        setValue("");
        onSubmit(text);
      }}
      busy={busy}
      placeholder="Say more..."
      label="Say more"
    />
  );
}

const field = () => screen.getByLabelText("Say more");

// ---------------------------------------------------------------------------
// grow, cap, reset
// ---------------------------------------------------------------------------

describe("composerRows", () => {
  it("starts at one line", () => {
    expect(composerRows("")).toBe(1);
    expect(composerRows("a single line")).toBe(1);
  });

  it("grows a row per newline", () => {
    expect(composerRows("one\ntwo")).toBe(2);
    expect(composerRows("one\ntwo\nthree")).toBe(3);
  });

  it("caps at five and does not keep growing", () => {
    expect(COMPOSER_MAX_ROWS).toBe(5);
    expect(composerRows("a\nb\nc\nd\ne")).toBe(5);
    expect(composerRows("a\nb\nc\nd\ne\nf\ng\nh")).toBe(5);
    // Past the cap the field scrolls instead — asserted by the max-height rule
    // in styles.css, which jsdom does not apply.
  });

  it("survives null and undefined rather than throwing into a blank screen", () => {
    expect(composerRows(undefined)).toBe(1);
    expect(composerRows(null)).toBe(1);
  });
});

describe("the field", () => {
  it("renders a textarea, not a single-line input", () => {
    render(<Harness />);
    expect(field().tagName).toBe("TEXTAREA");
  });

  it("grows as the person types newlines and resets after sending", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    expect(field().getAttribute("rows")).toBe("1");

    fireEvent.change(field(), { target: { value: "first\nsecond\nthird" } });
    expect(field().getAttribute("rows")).toBe("3");

    fireEvent.submit(field().closest("form"));
    expect(onSubmit).toHaveBeenCalledWith("first\nsecond\nthird");
    expect(field().getAttribute("rows")).toBe("1");
    expect(field().value).toBe("");
  });

  it("tells iOS to label the return key Send", () => {
    render(<Harness />);
    expect(field().getAttribute("enterkeyhint")).toBe("send");
  });
});

// ---------------------------------------------------------------------------
// the send control
// ---------------------------------------------------------------------------

describe("the send control", () => {
  it("is absent until there is something to send", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.change(field(), { target: { value: "hello" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("stays absent for whitespace alone", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "   \n  " } });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("becomes a spinner while the story is thinking", () => {
    render(<Harness busy initial="already typed" />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.getByRole("status", { name: "Sending" })).toBeTruthy();
  });

  it("leaves the field editable while busy so the next message can be typed", () => {
    render(<Harness busy initial="x" />);
    expect(field().disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

describe("the keyboard", () => {
  it("sends on Enter", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(field(), { target: { value: "send me" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("send me");
  });

  it("does not send on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(field(), { target: { value: "keep typing" } });
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send on the Enter that commits an IME candidate", () => {
    // Japanese, Chinese and the iOS emoji picker all commit with Enter.
    // Intercepting that keystroke eats the word being composed.
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(field(), { target: { value: "にほんご" } });
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends nothing when the field is empty or only whitespace", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.change(field(), { target: { value: "   " } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trims what it sends but keeps interior newlines", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(field(), { target: { value: "  a\nb  " } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("a\nb");
  });

  it("does not send twice while busy", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} busy initial="x" />);
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.submit(field().closest("form"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// the shape that was wrong
// ---------------------------------------------------------------------------

describe("the old shape is gone", () => {
  it("has no full-width gold-button in the compose row", () => {
    render(<Harness initial="typed" />);
    const form = field().closest("form");
    expect(form.querySelector(".gold-button")).toBeNull();
    expect(form.querySelector(".composer-send")).toBeTruthy();
  });

  it("puts the send control inside the same row as the field", () => {
    render(<Harness initial="typed" />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.closest("form")).toBe(field().closest("form"));
  });
});
