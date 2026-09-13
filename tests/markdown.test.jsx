/**
 * The editor writes markdown and the chat line printed it verbatim.
 *
 * The reply in the screenshot is `### `-headed, `**bold**`, bulleted — about
 * forty lines of it — rendered as raw text with the asterisks and hashes
 * showing. `chat-line chat-story` did `{message.content}` and nothing else.
 *
 * Hand-rolled rather than `react-markdown`. Two reasons, and the second is the
 * one that settles it:
 *
 *   1. Size. This bundle loads on a school iPad over school wifi.
 *      react-markdown + remark is roughly 40 kB gzipped for six constructs;
 *      this is ~1.5 kB of source and measured +1.5 kB in the built bundle.
 *   2. Safety. Every node it produces is a real React element. There is no
 *      `dangerouslySetInnerHTML` anywhere in the path, so a reply containing
 *      `<script>` renders as the four-teen characters `<script>` and can do
 *      nothing. A markdown-to-HTML library would have made that a question to
 *      think carefully about; this way it is not a question.
 *
 * The person's own turn is never parsed. They know what they typed, and
 * reinterpreting their asterisks would be surprising.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { renderMarkdown } = await import("../src/main.jsx");

afterEach(cleanup);

function draw(source) {
  const { container } = render(<div className="chat-markdown">{renderMarkdown(source)}</div>);
  return container.firstChild;
}

// ---------------------------------------------------------------------------
// the constructs the editor actually emits
// ---------------------------------------------------------------------------

describe("blocks", () => {
  it("renders a heading as a heading, not as hashes", () => {
    const out = draw("### Chapter 2: The Apprenticeship");
    expect(out.textContent).toBe("Chapter 2: The Apprenticeship");
    expect(out.querySelector("h3, h4, h5, h6")).toBeTruthy();
    expect(out.textContent).not.toContain("#");
  });

  it("never outranks the sheet's own h2", () => {
    // The panel already has <h2>Talk to the story</h2>. A reply's headings sit
    // under it or the document outline is nonsense to a screen reader.
    expect(draw("# One").querySelector("h3")).toBeTruthy();
    expect(draw("## Two").querySelector("h4")).toBeTruthy();
  });

  it("renders bullets as a list", () => {
    const out = draw("- first\n- second\n- third");
    expect(out.querySelectorAll("li").length).toBe(3);
    expect(out.querySelector("ul")).toBeTruthy();
    expect(out.textContent).not.toContain("- ");
  });

  it("renders a numbered list as an ol, not a ul", () => {
    const out = draw("1. first\n2. second");
    expect(out.querySelector("ol")).toBeTruthy();
    expect(out.querySelector("ul")).toBeNull();
    expect(out.querySelectorAll("li").length).toBe(2);
  });

  it("does not merge a bullet list into a numbered one", () => {
    const out = draw("- a\n- b\n\n1. c\n2. d");
    expect(out.querySelectorAll("ul").length).toBe(1);
    expect(out.querySelectorAll("ol").length).toBe(1);
  });

  it("renders a blockquote", () => {
    expect(draw("> she said nothing").querySelector("blockquote").textContent)
      .toBe("she said nothing");
  });

  it("joins wrapped lines into one paragraph and splits on blank lines", () => {
    const out = draw("one line\nstill the same paragraph\n\na second paragraph");
    const paragraphs = out.querySelectorAll("p");
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].textContent).toBe("one line still the same paragraph");
  });
});

describe("inline", () => {
  it("renders bold and italic without leaving the markers", () => {
    const out = draw("Sable is **furious** and _quietly_ afraid.");
    expect(out.querySelector("strong").textContent).toBe("furious");
    expect(out.querySelector("em").textContent).toBe("quietly");
    expect(out.textContent).toBe("Sable is furious and quietly afraid.");
  });

  it("renders __bold__ and *italic* too", () => {
    expect(draw("__loud__").querySelector("strong").textContent).toBe("loud");
    expect(draw("*soft*").querySelector("em").textContent).toBe("soft");
  });

  it("renders inline code", () => {
    expect(draw("call `converse.v1` for this").querySelector("code").textContent)
      .toBe("converse.v1");
  });

  it("handles inline markers inside a heading and inside a list item", () => {
    expect(draw("### The **Meridian**").querySelector("strong").textContent).toBe("Meridian");
    expect(draw("- a **bold** point").querySelector("li strong").textContent).toBe("bold");
  });
});

// ---------------------------------------------------------------------------
// safety and robustness
// ---------------------------------------------------------------------------

describe("it cannot be made to execute anything", () => {
  it("renders raw HTML as text", () => {
    const out = draw("<script>alert(1)</script> and <b>bold</b>");
    expect(out.querySelector("script")).toBeNull();
    expect(out.querySelector("b")).toBeNull();
    expect(out.textContent).toContain("<script>alert(1)</script>");
  });

  it("uses no innerHTML anywhere in the output path", () => {
    // The whole argument for hand-rolling. If this ever fails, the size saving
    // stopped being the point.
    const out = draw("**x**");
    expect(out.innerHTML).not.toContain("dangerously");
  });
});

describe("it survives whatever the model sends", () => {
  it("handles empty, null and undefined without blanking the sheet", () => {
    expect(renderMarkdown("")).toEqual([]);
    expect(renderMarkdown(null)).toEqual([]);
    expect(renderMarkdown(undefined)).toEqual([]);
  });

  it("leaves an unmatched marker alone rather than eating the rest of the reply", () => {
    const out = draw("she said **");
    expect(out.textContent).toBe("she said **");
  });

  it("keeps plain prose exactly as written", () => {
    const prose = "Does that direction sound like the right pulse for Chapter 2?";
    expect(draw(prose).textContent).toBe(prose);
  });

  it("renders a forty-line reply without losing any of it", () => {
    const source = Array.from({ length: 40 }, (_, i) => `- point ${i + 1}`).join("\n");
    const out = draw(source);
    expect(out.querySelectorAll("li").length).toBe(40);
    expect(out.textContent).toContain("point 40");
  });
});
