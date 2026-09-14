/**
 * The reader prints the story, and only the story.
 *
 * TWO failures are pinned here, and the second one is why this file was
 * rewritten from scratch on 2026-09-14.
 *
 * 1. The chapter reader printed the generator's TTS cues (`<!-- pause -->`,
 *    `<!-- character: maren -->`) and raw markdown asterisks to the page. The
 *    cues are data for the audio renderer and must stay in the stored prose
 *    exactly as written; they simply have no business on a screen.
 *
 * 2. #22 fixed that and made the reader UNUSABLE. On the family's phones, a
 *    paragraph containing both a character name and an italic phrase rendered
 *    as
 *
 *        said,withthesatisfactionboywhohadlearnedthatimpossibilities
 *
 *    with spans repeating down the page. It was not a string-offset bug. It
 *    was duplicate React keys: `renderInteractiveText` seeded `let key = 10000`
 *    per call, #22 called it once per markdown segment, and all the segments
 *    were flattened into one parent. React reconciles by key, so it duplicated
 *    some children and dropped others; whitespace and words under three letters
 *    were bare unkeyed strings, so those were what vanished.
 *
 * **The first render was correct.** Every test #22 shipped passed, because they
 * all rendered once and asserted the absence of markers — `not.toContain("*")`
 * cannot see a duplicated span, and nothing re-rendered.
 *
 * So the assertions here are equality, not absence, and they are made TWICE:
 * once on mount and once after a re-render. A test that only mounts cannot
 * catch a reconciliation bug, which is the entire class this file exists for.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

import { Prose, stripProseDirectives, proseDirectives, proseBlocks, proseTokens } from "../src/main.jsx";

afterEach(cleanup);

/** The paragraph from the phone. field-notes chapter 1, verbatim. */
const THE_PARAGRAPH =
  '"That\'s why I found it," Keen said, with the satisfaction of a boy who had learned that ' +
  "impossibilities were often just invitations to look closer. Now, three days later, the Meridian " +
  "descended toward a bay that appeared on no contemporary chart. The original Spanish survey had " +
  "called it *Ensenada de los Naufragios*—Bay of Shipwrecks—a name cartographers had quietly dropped " +
  "in the nineteenth century when the wrecks proved difficult to locate and easier to forget.";

/** The live entity list for that universe: no characters of its own, so the
 *  family readers plus three bible locations. */
const ENTITIES = [
  { name: "The Museum of Almost", type: "setting", description: "" },
  { name: "The 47th Floor", type: "setting", description: "" },
  { name: "Driftwood Key", type: "setting", description: "" },
  { name: "Jonathan", type: "character", description: "" },
  { name: "Adele", type: "character", description: "" },
  { name: "Talia", type: "character", description: "" },
  { name: "Keen", type: "character", description: "" },
];

/** What a reader should see: the source, minus cues, minus markdown punctuation. */
function readable(source) {
  return stripProseDirectives(source)
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(\*|_)(?=\S)([^*_\n]*?\S)\1/g, "$2")
    .replace(/`([^`\n]+)`/g, "$1");
}

function view(prose, { pulseFrom = null, tier = 3, words = true } = {}) {
  return (
    <Prose
      chapter={{ prose }}
      tier={tier}
      entities={ENTITIES}
      onLongPress={() => {}}
      onEntityTap={() => {}}
      onWordTap={words ? () => {} : null}
      pulseFrom={pulseFrom}
    />
  );
}

// ---------------------------------------------------------------------------
// character for character, on mount AND after a re-render
// ---------------------------------------------------------------------------

describe("the rendered text is the source text", () => {
  it("equals it exactly on the paragraph that broke the app", () => {
    const { container } = render(view(THE_PARAGRAPH));
    expect(container.textContent).toBe(readable(THE_PARAGRAPH));
  });

  it("STILL equals it after a re-render — this is the one #22 failed", () => {
    const { container, rerender } = render(view(THE_PARAGRAPH));
    rerender(view(THE_PARAGRAPH, { pulseFrom: 0 }));
    expect(container.textContent).toBe(readable(THE_PARAGRAPH));
  });

  it("survives ten re-renders without growing by one character", () => {
    // The report was "repeating down the page forever". Length is the direct
    // measurement of that, so it is asserted directly.
    const { container, rerender } = render(view(THE_PARAGRAPH));
    const expected = readable(THE_PARAGRAPH);
    for (let i = 0; i < 10; i += 1) {
      rerender(view(THE_PARAGRAPH, { pulseFrom: i % 2 ? 0 : null }));
      expect(container.textContent.length).toBe(expected.length);
    }
    expect(container.textContent).toBe(expected);
  });

  it("keeps every space", () => {
    // "said,withthesatisfaction" — the spaces were the first thing to go.
    const { container, rerender } = render(view(THE_PARAGRAPH));
    rerender(view(THE_PARAGRAPH, { pulseFrom: 0 }));
    expect(container.textContent).toContain("Keen said, with the satisfaction of a boy");
  });

  it("keeps the words shorter than three letters", () => {
    // They were returned as bare unkeyed strings, so they were what React
    // dropped: "of a boy" became "boy".
    const { container, rerender } = render(view(THE_PARAGRAPH));
    rerender(view(THE_PARAGRAPH, { pulseFrom: 0 }));
    const text = container.textContent;
    for (const word of [" of ", " a ", " on ", " to ", " in "]) {
      expect(text, `lost ${JSON.stringify(word)}`).toContain(word);
    }
  });

  it("renders each entity exactly once", () => {
    const { container, rerender } = render(view(THE_PARAGRAPH));
    rerender(view(THE_PARAGRAPH, { pulseFrom: 0 }));
    const links = [...container.querySelectorAll(".entity-link")].map((n) => n.textContent);
    expect(links).toEqual(["Keen"]);
  });

  it("renders each of two entity names exactly once", () => {
    const two = "Keen looked at Adele. Adele did not look back at Keen.";
    const { container, rerender } = render(view(two));
    rerender(view(two, { pulseFrom: 0 }));
    const links = [...container.querySelectorAll(".entity-link")].map((n) => n.textContent);
    expect(links).toEqual(["Keen", "Adele", "Adele", "Keen"]);
    expect(container.textContent).toBe(two);
  });

  it("holds for the youngest tier, which has no word taps", () => {
    const { container, rerender } = render(view(THE_PARAGRAPH, { tier: 1, words: false }));
    rerender(view(THE_PARAGRAPH, { tier: 1, words: false, pulseFrom: 0 }));
    expect(container.textContent).toBe(readable(THE_PARAGRAPH));
  });
});

// ---------------------------------------------------------------------------
// the token list, which is where the guarantee actually lives
// ---------------------------------------------------------------------------

describe("the token list reproduces its input", () => {
  const join = (tokens) => tokens.map((t) => t.text).join("");

  it("joins back to the readable source", () => {
    expect(join(proseTokens(THE_PARAGRAPH, ENTITIES, { words: true }))).toBe(readable(THE_PARAGRAPH));
  });

  it("joins back with entities off, words off, both off", () => {
    expect(join(proseTokens(THE_PARAGRAPH, [], { words: false }))).toBe(readable(THE_PARAGRAPH));
    expect(join(proseTokens(THE_PARAGRAPH, ENTITIES, { words: false }))).toBe(readable(THE_PARAGRAPH));
    expect(join(proseTokens(THE_PARAGRAPH, [], { words: true }))).toBe(readable(THE_PARAGRAPH));
  });

  it("terminates, and its output is bounded by its input", () => {
    // Not a style point: the previous renderer's loop advanced only if every
    // match had non-zero length.
    const tokens = proseTokens(THE_PARAGRAPH, ENTITIES, { words: true });
    expect(tokens.length).toBeLessThan(THE_PARAGRAPH.length);
    expect(join(tokens).length).toBe(readable(THE_PARAGRAPH).length);
  });

  it("is not fooled by an entity with a blank name", () => {
    // An empty name matched at every position with zero width, which is the
    // shape of an infinite loop.
    const tokens = proseTokens("Keen and Adele", [{ name: "" }, { name: "   " }, { name: "Keen" }], { words: true });
    expect(join(tokens)).toBe("Keen and Adele");
    expect(tokens.filter((t) => t.kind === "entity").map((t) => t.text)).toEqual(["Keen"]);
  });

  it("does not link a character name inside backticks", () => {
    const tokens = proseTokens("The file is `Keen.txt` on the desk", ENTITIES, { words: true });
    expect(join(tokens)).toBe("The file is Keen.txt on the desk");
    expect(tokens.filter((t) => t.kind === "entity")).toEqual([]);
  });

  it("keeps an entity inside an italic phrase both italic and linked", () => {
    const tokens = proseTokens("She read *the log of Keen Dial* twice", ENTITIES, { words: false });
    const entity = tokens.find((t) => t.kind === "entity");
    expect(entity.text).toBe("Keen");
    expect(entity.emphasis).toBe("em");
    expect(join(tokens)).toBe("She read the log of Keen Dial twice");
  });
});

// ---------------------------------------------------------------------------
// the cues stay in the stored prose and stay off the page
// ---------------------------------------------------------------------------

describe("the audio cues", () => {
  const withCues = "The door opened. <!-- pause --> Keen went in. <!-- character: keen -->";

  it("never reach the reader", () => {
    const { container, rerender } = render(view(withCues));
    rerender(view(withCues, { pulseFrom: 0 }));
    expect(container.textContent).not.toContain("<!--");
    expect(container.textContent).not.toContain("pause");
  });

  it("are still readable by the narrator, in order, with their values", () => {
    expect(proseDirectives(withCues)).toEqual([
      { directive: "pause", value: null, raw: "<!-- pause -->" },
      { directive: "character", value: "keen", raw: "<!-- character: keen -->" },
    ]);
  });

  it("leave no empty paragraph behind when a cue is a line of its own", () => {
    const { container } = render(view("One.\n<!-- pause -->\nTwo."));
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["One.", "Two."]);
  });
});

// ---------------------------------------------------------------------------
// scene breaks
// ---------------------------------------------------------------------------

describe("a scene break is a rule, not a paragraph of asterisks", () => {
  it("becomes an hr", () => {
    const { container } = render(view("Before.\n***\nAfter."));
    expect(container.querySelectorAll("hr.scene-break").length).toBe(1);
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Before.", "After."]);
  });

  it("emits exactly one rule after a re-render, not one per pass", () => {
    // The phone showed a rule per iteration of the loop.
    const source = "Before.\n***\nAfter.";
    const { container, rerender } = render(view(source));
    rerender(view(source, { pulseFrom: 0 }));
    expect(container.querySelectorAll("hr").length).toBe(1);
  });

  it("does not renumber the paragraphs it sits between", () => {
    // The bookmark and the reshape anchor both address a paragraph index.
    const { container } = render(view("One.\n***\nTwo."));
    expect([...container.querySelectorAll("[data-paragraph-index]")].map((n) => n.dataset.paragraphIndex))
      .toEqual(["0", "1"]);
  });

  it("recognises both spellings", () => {
    expect(proseBlocks("a\n***\nb").map((b) => b.type)).toEqual(["paragraph", "break", "paragraph"]);
    expect(proseBlocks("a\n---\nb").map((b) => b.type)).toEqual(["paragraph", "break", "paragraph"]);
  });
});
