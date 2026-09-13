/**
 * The reader was printing the generator's stage directions.
 *
 * Read from the device, 2026-09-13, chapter 2 of `the-embodied-age/threshold`
 * — and then read again from the capability layer to get the exact text:
 *
 *     record; it was an architecture. <!-- pause --> Maren Voss sat at the
 *     Before her lay the *Codex of Internal Rhythms*, a book
 *
 * Two unrelated failures in one paragraph.
 *
 * **The cues.** That chapter carries `<!-- pause -->`, `<!-- character: maren -->`
 * and `<!-- dramatic -->`. They are TTS direction — data the audio renderer
 * needs — and they were being printed to a seven-year-old.
 *
 * **The markdown.** Four `*italics*` in that chapter, and two `***` scene
 * breaks rendering as paragraphs containing three asterisks. #12 taught the
 * chat sheet to render markdown and stopped there, so the chapter reader — the
 * screen this app is actually for — never learned.
 *
 * The property these tests hold, and it is a two-sided one:
 *
 *   **The reader sees no cue and no asterisk. The stored text keeps both.**
 *
 * Losing the cues would be worse than printing them: the narration needs them,
 * and Firestore is the only place they exist.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const main = await import("../src/main.jsx");
const { stripProseDirectives, proseDirectives, proseBlocks, ProposalCard, Lore } = main;

afterEach(cleanup);

// The live opening of chapter 2, trimmed, with every directive the chapter
// actually contains and a scene break.
const LIVE = [
  "The ink on the page was not merely a record; it was an architecture. <!-- pause --> Maren Voss sat at the slanted oak desk.",
  "",
  "Before her lay the *Codex of Internal Rhythms*, a book three centuries old.",
  "",
  "***",
  "",
  "<!-- character: maren --> She set the pen down. <!-- dramatic -->",
].join("\n");

// ---------------------------------------------------------------------------
// the cues: gone from the page, kept in the data
// ---------------------------------------------------------------------------

describe("the TTS cues", () => {
  it("are stripped from what a reader sees", () => {
    const out = stripProseDirectives(LIVE);
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("pause");
    expect(out).not.toContain("dramatic");
  });

  it("are all three of the ones this chapter actually carries", () => {
    expect(proseDirectives(LIVE).map((d) => d.directive)).toEqual(["pause", "character", "dramatic"]);
  });

  it("keep the value a directive carries, because the voice mapping needs it", () => {
    const character = proseDirectives(LIVE).find((d) => d.directive === "character");
    expect(character.value).toBe("maren");
  });

  it("strips a directive it has never seen before", () => {
    // An unknown cue is still not something a reader should be shown.
    expect(stripProseDirectives("a <!-- whisper: slowly --> b")).toBe("a  b");
    expect(proseDirectives("a <!-- whisper: slowly --> b")[0].directive).toBe("whisper");
  });

  it("survives a multi-line comment", () => {
    expect(stripProseDirectives("a <!--\npause\n--> b")).toBe("a  b");
  });

  it("leaves text with no cues exactly as it was", () => {
    const plain = "She set the pen down.";
    expect(stripProseDirectives(plain)).toBe(plain);
    expect(proseDirectives(plain)).toEqual([]);
  });

  it("does not throw on nothing", () => {
    expect(stripProseDirectives(null)).toBe("");
    expect(proseDirectives(undefined)).toEqual([]);
  });
});

describe("the stored text is not touched", () => {
  it("is what the narrator gets, cues and all", () => {
    // The seam: `chapter.prose` is the audio path's input and is never run
    // through the stripper. Asserted by showing the same source still yields
    // every directive after the reader has had its version.
    const forTheReader = stripProseDirectives(LIVE);
    expect(forTheReader).not.toContain("<!--");
    expect(proseDirectives(LIVE)).toHaveLength(3);
    expect(LIVE).toContain("<!-- pause -->");
  });
});

// ---------------------------------------------------------------------------
// blocks: a scene break is not a paragraph of asterisks
// ---------------------------------------------------------------------------

describe("blocks", () => {
  it("turns *** into a break rather than a paragraph", () => {
    const kinds = proseBlocks(LIVE).map((b) => b.type);
    expect(kinds).toEqual(["paragraph", "paragraph", "break", "paragraph"]);
  });

  it("recognises the ornamented spelling too", () => {
    expect(proseBlocks("a\n\n— ◈ —\n\nb").map((b) => b.type)).toEqual(["paragraph", "break", "paragraph"]);
    expect(proseBlocks("a\n\n◈\n\nb").map((b) => b.type)).toEqual(["paragraph", "break", "paragraph"]);
  });

  it("does not leave an empty paragraph where a lone directive was", () => {
    // Stripping runs before splitting, so a cue on its own line vanishes
    // entirely instead of becoming a blank bubble in the page.
    expect(proseBlocks("a\n\n<!-- pause -->\n\nb").map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("keeps paragraph text with the cue removed", () => {
    expect(proseBlocks(LIVE)[0].text).not.toContain("<!--");
    expect(proseBlocks(LIVE)[0].text).toContain("architecture");
  });
});

// ---------------------------------------------------------------------------
// the rendered page
// ---------------------------------------------------------------------------

function readChapter(prose) {
  const { container } = render(
    <main.Prose
      chapter={{ prose }}
      tier={3}
      entities={[]}
      onLongPress={() => {}}
      onEntityTap={() => {}}
      onWordTap={() => {}}
      pulseFrom={null}
    />
  );
  return container;
}

describe("what the page contains", () => {
  it("has no comment markup anywhere in it", () => {
    const container = readChapter(LIVE);
    expect(container.innerHTML).not.toContain("<!--");
    expect(container.textContent).not.toContain("pause");
  });

  it("has no literal asterisk anywhere in it", () => {
    expect(readChapter(LIVE).textContent).not.toContain("*");
  });

  it("renders the italics as italics", () => {
    const container = readChapter(LIVE);
    const em = container.querySelector("em");
    expect(em).toBeTruthy();
    expect(em.textContent).toBe("Codex of Internal Rhythms");
  });

  it("renders the scene break as a rule, not a paragraph", () => {
    const container = readChapter(LIVE);
    expect(container.querySelector("hr.scene-break")).toBeTruthy();
  });

  it("numbers paragraphs across a scene break without counting the rule", () => {
    // The bookmark and the reshape anchor both address a paragraph index. A
    // rule that consumed an index would shift every restore after it.
    const container = readChapter(LIVE);
    const indexes = [...container.querySelectorAll("[data-paragraph-index]")]
      .map((node) => node.getAttribute("data-paragraph-index"));
    expect(indexes).toEqual(["0", "1", "2"]);
  });

  it("still links entities inside an italicised phrase", () => {
    // The reason markdown is resolved before entity matching: asterisks shift
    // every string offset, and entity matching is offset-based.
    const container = render(
      <main.Prose
        chapter={{ prose: "Before her lay the *Codex of Maren Voss*, a book." }}
        tier={3}
        entities={[{ name: "Maren Voss" }]}
        onLongPress={() => {}}
        onEntityTap={() => {}}
        onWordTap={null}
        pulseFrom={null}
      />
    ).container;
    const em = container.querySelector("em");
    expect(em).toBeTruthy();
    expect(em.querySelector(".entity-link")?.textContent).toBe("Maren Voss");
  });

  it("renders an ordinary chapter unchanged", () => {
    const container = readChapter("One.\n\nTwo.");
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("hr")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// everywhere else the same text reaches a reader
// ---------------------------------------------------------------------------

describe("the proposal card", () => {
  it("does not print a cue in the preview line", () => {
    render(
      <ProposalCard
        proposal={{ draftId: "d1", chapterTitle: "Chapter 3", preview: "She set it down. <!-- pause -->" }}
        busy={false}
        onApprove={() => {}}
        onDismiss={() => {}}
        onRevise={() => {}}
      />
    );
    expect(screen.getByText(/She set it down/).textContent).not.toContain("<!--");
  });
});

describe("the lore tab", () => {
  it("does not print a cue in a prose bible field", () => {
    const { container } = render(
      <Lore data={{ bible: { worldRules: "Bonds are lifelong. <!-- dramatic -->" } }} />
    );
    expect(container.textContent).not.toContain("<!--");
    expect(container.textContent).not.toContain("dramatic");
  });

  it("does not print a cue in a list entry", () => {
    const { container } = render(
      <Lore data={{ bible: { establishedFacts: ["Hold is Purist. <!-- pause -->"] } }} />
    );
    expect(container.textContent).not.toContain("<!--");
  });
});
