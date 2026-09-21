/**
 * Two defects found while porting the reader and the narrator to iOS
 * (storyforge-ios #1 and #4), mirrored back here.
 *
 * 1. Narration handed Kokoro the raw prose line: a "***" scene break became a
 *    segment, and "**brass**" reached the voice model with its asterisks.
 * 2. The editor-reply renderer's inline pattern accepted a delimiter next to a
 *    space, so "2 * 3 * 4" rendered as "2 <em> 3 </em> 4".
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { segmentProse, speakable, stripHtmlComments } from "../src/NarrationPanel";

// main.jsx mounts the app on import; the other suites stub the root the same way.
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
const { renderMarkdown } = await import("../src/main.jsx");

afterEach(cleanup);

const CHAPTER = `Maren set the **brass compass** down. <!-- pause -->

***

It pointed 11.25 degrees off north.
<!-- character: maren -->
"Again," she said.`;

describe("what the narrator says", () => {
  it("never speaks a scene break, a cue, or an emphasis marker", () => {
    const spoken = segmentProse(CHAPTER);
    expect(spoken).toEqual([
      "Maren set the brass compass down.",
      "It pointed 11.25 degrees off north.",
      '"Again," she said.',
    ]);
    expect(spoken.join(" ")).not.toMatch(/\*|<!--/);
  });

  it("drops a paragraph that is nothing but markup", () => {
    expect(segmentProse("<!-- pause -->\n\n---\n\n◈")).toEqual([]);
  });

  it("keeps arithmetic as arithmetic", () => {
    expect(speakable("It took 2 * 3 * 4 steps.")).toBe("It took 2 * 3 * 4 steps.");
  });

  it("resolves every emphasis spelling the reader resolves", () => {
    expect(speakable("**bold**, *em*, __bold__, _em_ and `code`")).toBe("bold, em, bold, em and code");
  });

  it("still strips comments the way it always did", () => {
    expect(stripHtmlComments("Hello <!-- pause -->world")).toBe("Hello world");
  });
});

describe("editor replies render emphasis only where CommonMark would", () => {
  const html = (md) => render(<div>{renderMarkdown(md)}</div>).container.innerHTML;

  it("does not italicise the middle of an arithmetic expression", () => {
    const out = html("It took 2 * 3 * 4 steps.");
    expect(out).not.toContain("<em>");
    expect(out).toContain("2 * 3 * 4");
  });

  it("still renders real emphasis", () => {
    const out = html("The **brass** compass was *warm*.");
    expect(out).toContain("<strong>brass</strong>");
    expect(out).toContain("<em>warm</em>");
  });

  it("renders a one-letter emphasis", () => {
    expect(html("Plan *B*.")).toContain("<em>B</em>");
  });
});
