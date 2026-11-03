// The round-trip guarantee (spec §3.1, §12.3.1): markdown -> doc -> markdown is
// byte-identical. Synthetic fixtures only: this repo is public, so real chapters are
// checked by scripts/corpus-roundtrip.mjs against a local export, never committed.
// (2026-11-03: all 61 production chapters, 603,922 characters, round-tripped
// byte-identical through the editor schema, with 0 verbatim fallbacks.)
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { MANUSCRIPT_EXTENSIONS } from "../../src/studio/schema.js";
import { countWords, docToMarkdown, markdownToDoc, pendingSuggestions, textHash } from "../../src/studio/manuscriptMarkdown.js";

const schema = getSchema(MANUSCRIPT_EXTENSIONS);
const roundTrip = (src) => docToMarkdown(schema.nodeFromJSON(markdownToDoc(src)).toJSON());

const FIXTURES = [
  "", "Hello", "Hello\n", "\n\nHello\n\n\n", "one\ntwo\n\nthree", "A\n\n\n\nB", "\t\n A", "Trailing   \nspaces",
  "A *b* c **d** e ***f*** g _h_ __i__", "**bold *with italic* inside**", "*a **b** c*", "~~strike~~ and <u>u</u> and [link](https://x.y)",
  "<!-- pause -->The sea.<!-- character: maren --> \"Hi,\" she said.", "<!-- pause -->\n\nNew scene.",
  "# Chapter 1\n\nText.", "## Talk about it\n1. First.\n2. Second.", "* * *", "***", "> quote line\n> two", "- a\n- b\n- c",
  "*What Keen chose next:*\n- *Go left.*\n- *Go right.*", "Stray * star and snake_case and 3*4", "*unclosed", "#hash", "\\*escaped\\*",
  "line\r\nwindows", "Ellipsis… “quotes” — dashes", "<b>html</b> stays", "**surveyor** — someone who measures · **heir** — inherits",
];

describe("markdown round trip", () => {
  it.each(FIXTURES)("is byte-identical: %j", (src) => {
    expect(roundTrip(src)).toBe(src);
  });

  it("survives a fuzz of random prose", () => {
    const pieces = ["The ", "sea", " *grey*", " **loud**", "\n", "\n\n", "<!-- pause -->", "“Hi,”", " _she_", " said.", "* * *", "\n# Title", "\n- item", "\n> q", " 3*4 ", "__x__", "  ", "—", "~~no~~", "\\*"];
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 400; n += 1) {
      let src = "";
      const len = 1 + Math.floor(rand() * 30);
      for (let i = 0; i < len; i += 1) src += pieces[Math.floor(rand() * pieces.length)];
      expect(roundTrip(src)).toBe(src);
    }
  });

  it("lifts audio cues into chips and keeps them out of plain text", () => {
    const doc = markdownToDoc("Hello <!-- pause -->world");
    const kinds = doc.content[0].content.map((n) => n.type);
    expect(kinds).toEqual(["text", "audioCue", "text"]);
  });

  it("views: base leaves suggestions out, accepted takes them", () => {
    const doc = markdownToDoc("A calm sea.");
    const ins = { type: "insertion", attrs: { id: "s1", authorKind: "ability" } };
    const del = { type: "deletion", attrs: { id: "s1", authorKind: "ability" } };
    doc.content[0].content = [
      { type: "text", text: "A " },
      { type: "text", text: "calm", marks: [del] },
      { type: "text", text: "still", marks: [ins] },
      { type: "text", text: " sea." },
    ];
    expect(docToMarkdown(doc, { view: "base" })).toBe("A calm sea.");
    expect(docToMarkdown(doc, { view: "accepted" })).toBe("A still sea.");
    expect(pendingSuggestions(doc)).toMatchObject({ total: 1, ability: 1 });
  });

  it("counts words and hashes text", () => {
    expect(countWords("It's a grey-blue sea, isn't it?")).toBe(6);
    expect(textHash("a")).not.toBe(textHash("b"));
    expect(textHash("same")).toBe(textHash("same"));
  });
});
