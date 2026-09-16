/**
 * Three generated choices rendered "1. / 1. / 1.".
 *
 * The turn below is VERBATIM from the Field Notes conversation store
 * (2026-09-16T05:47:13Z). The editor puts a blank line between numbered items;
 * the parser closed the list on every blank line, so each item became its own
 * <ol> and each one started at 1. A seven-year-old reads these.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import fs from "node:fs";
import path from "node:path";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
const { renderMarkdown } = await import("../src/main.jsx");
afterEach(cleanup);

const STORED_TURN = fs.readFileSync(path.join(__dirname, "fixtures", "field-notes-options-turn-2026-09-16.txt"), "utf8");

function draw(source) {
  const { container } = render(<div className="chat-markdown">{renderMarkdown(source)}</div>);
  return container.firstChild;
}

/** What a reader sees: each item's rendered number, per the browser's own rules. */
function renderedNumbers(root) {
  const numbers = [];
  root.querySelectorAll("ol").forEach((ol) => {
    const start = ol.hasAttribute("start") ? Number(ol.getAttribute("start")) : 1;
    ol.querySelectorAll(":scope > li").forEach((_, i) => numbers.push(start + i));
  });
  return numbers;
}

describe("ordered lists", () => {
  it("renders the stored three-choice turn as 1, 2, 3 in one list", () => {
    const out = draw(STORED_TURN);
    expect(out.querySelectorAll("ol").length).toBe(1);
    expect(renderedNumbers(out)).toEqual([1, 2, 3]);
    const items = [...out.querySelectorAll("ol > li")].map((li) => li.textContent);
    expect(items[0]).toContain("Forget the speed limits");
    expect(items[1]).toContain("telegraph logs");
    expect(items[2]).toContain("extraction from above");
    // The prose after the list is still a paragraph, not swallowed into item 3.
    expect(items[2]).not.toContain("Which path should we take");
    expect(out.textContent).toContain("Which path should we take for Chapter 2?");
  });

  it("keeps an indented continuation line inside its item", () => {
    const out = draw("1. **Go now.**\n   (Drive fast.)\n\n2. **Wait.**\n   (Read the logs.)");
    const items = out.querySelectorAll("ol > li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("(Drive fast.)");
    expect(renderedNumbers(out)).toEqual([1, 2]);
  });

  it("honours the number the source starts at", () => {
    expect(renderedNumbers(draw("3. third\n4. fourth"))).toEqual([3, 4]);
  });

  it("still ends a list at a paragraph", () => {
    const out = draw("1. one\n2. two\n\nAfterwards.\n\n1. again");
    expect(out.querySelectorAll("ol").length).toBe(2);
    expect(out.querySelector("p").textContent).toBe("Afterwards.");
  });

  it("does not merge a bullet list into a numbered one", () => {
    const out = draw("1. one\n\n- bullet");
    expect(out.querySelectorAll("ol").length).toBe(1);
    expect(out.querySelectorAll("ul").length).toBe(1);
  });
});
