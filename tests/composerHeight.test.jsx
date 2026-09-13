/**
 * The empty composer rendered about five lines tall — roughly forty percent of
 * the screen, with nothing in it.
 *
 * **It was not the resize logic.** `composerRows("")` has always returned 1, and
 * the grow effect has always reset `height` to `auto` before measuring
 * `scrollHeight`. Both were right. The cause is a stylesheet rule written for
 * the full-page draft boxes:
 *
 *     textarea { min-height: 190px; }
 *
 * `.composer-field` is a `<textarea>`, so it inherited that. And `min-height`
 * beats both the `rows` attribute and the inline `height` the effect sets, so
 * nothing downstream could shrink it. Two lines of CSS — `min-height: 0` and
 * `height: auto` — are the whole fix.
 *
 * Which creates a testing problem worth naming: **jsdom applies no stylesheets**,
 * so a DOM assertion here would have passed happily the entire time the bug was
 * on screen. The height tests below assert on `rows` (which was always correct,
 * and is what keeps the first paint honest before the effect runs), and the
 * stylesheet is asserted by reading it. A source assertion is a weak test in
 * general; it is the right one when the defect lives in a file the test
 * environment does not load.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { Composer, composerRows, COMPOSER_MAX_ROWS } = await import("../src/main.jsx");

afterEach(cleanup);

// Comments are stripped first. The `.composer-field` rule now carries a comment
// that itself contains `textarea { min-height: 190px }`, and a naive scan for
// the closing brace stops inside it — which is a fun way to write a test that
// passes on the wrong text.
const CSS = readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function composerFieldRule() {
  const start = CSS.indexOf(".composer-field {");
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("}", start));
}

// ---------------------------------------------------------------------------
// the row count, which was never the problem but is what holds the first paint
// ---------------------------------------------------------------------------

describe("how many rows the field asks for", () => {
  it("is one when it is empty", () => {
    expect(composerRows("")).toBe(1);
    expect(composerRows(undefined)).toBe(1);
    expect(composerRows(null)).toBe(1);
  });

  it("is one for a single line of text", () => {
    expect(composerRows("Lean into the apprenticeship")).toBe(1);
  });

  it("grows a row per newline", () => {
    expect(composerRows("a\nb")).toBe(2);
    expect(composerRows("a\nb\nc\nd\ne")).toBe(5);
  });

  it("stops at five", () => {
    expect(composerRows("a\nb\nc\nd\ne\nf\ng")).toBe(COMPOSER_MAX_ROWS);
    expect(COMPOSER_MAX_ROWS).toBe(5);
  });
});

describe("the rendered field", () => {
  it("renders one row with nothing in it", () => {
    render(<Composer value="" onChange={() => {}} onSubmit={() => {}} label="Say more" />);
    expect(screen.getByLabelText("Say more").getAttribute("rows")).toBe("1");
  });

  it("still renders one row after the reader types and deletes", () => {
    // The state that produced the complaint: a composer nobody has used yet,
    // and a composer someone has just cleared, must look the same.
    const { rerender } = render(
      <Composer value="something" onChange={() => {}} onSubmit={() => {}} label="Say more" />
    );
    rerender(<Composer value="" onChange={() => {}} onSubmit={() => {}} label="Say more" />);
    expect(screen.getByLabelText("Say more").getAttribute("rows")).toBe("1");
  });

  it("asks for five rows at six lines, not six", () => {
    render(
      <Composer value={"a\nb\nc\nd\ne\nf"} onChange={() => {}} onSubmit={() => {}} label="Say more" />
    );
    expect(screen.getByLabelText("Say more").getAttribute("rows")).toBe("5");
  });
});

// ---------------------------------------------------------------------------
// the stylesheet, which is where the bug actually was
// ---------------------------------------------------------------------------

describe("the stylesheet rule that caused it", () => {
  it("still has the global textarea min-height this has to defeat", () => {
    // If this ever goes away the guard below is dead weight and should go with
    // it — but while it exists, `.composer-field` inherits it.
    expect(CSS).toMatch(/^textarea\s*\{[^}]*min-height:\s*190px/m);
  });

  it("neutralises it on the composer field", () => {
    const rule = composerFieldRule();
    expect(rule).toMatch(/min-height:\s*0\s*;/);
  });

  it("lets the grow effect set the height rather than fighting a fixed one", () => {
    const rule = composerFieldRule();
    expect(rule).toMatch(/height:\s*auto\s*;/);
  });

  it("keeps the five-line cap, which is a maximum and not a starting point", () => {
    const rule = composerFieldRule();
    expect(rule).toMatch(/max-height:/);
  });
});

// ---------------------------------------------------------------------------
// nothing about the fix changed what the composer does
// ---------------------------------------------------------------------------

describe("it still behaves", () => {
  it("shows no send button until there is something to send", () => {
    const { rerender } = render(
      <Composer value="" onChange={() => {}} onSubmit={() => {}} label="Say more" />
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    rerender(<Composer value="hi" onChange={() => {}} onSubmit={() => {}} label="Say more" />);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("sends on Enter and not on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(<Composer value="hi" onChange={() => {}} onSubmit={onSubmit} label="Say more" />);
    const field = screen.getByLabelText("Say more");
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("hi");
  });
});
