/**
 * The player was the only thing on the page that wasn't the app.
 *
 * `NarrationPanel` rendered `background: "#f0f0f0"` as an **inline style**, with
 * zero narration rules in `styles.css` — a light grey box, default-styled
 * buttons, and a bare `<select>` of raw voice ids (`af_heart`, `af_alloy`),
 * sitting in the middle of a navy-and-gold reading view. It is why the page
 * looked unfinished.
 *
 * This is the current player restyled, **not** the rebuilt one. The
 * whole-chapter render, the offsets table, the scrubber and `MediaSession` are
 * a separate track that has not started — there is no server-side audio
 * capability at all yet, which is the finding, not an excuse. What this does is
 * stop the reading view looking broken while that gets built.
 *
 * The assertion the brief asked for — "no element carries a computed
 * background-color outside the palette" — cannot be made in jsdom, which
 * computes no styles and loads no stylesheet. So it is made against the source
 * instead: **no literal colour anywhere in the player, in markup or in CSS.**
 * Weak in general; correct when the defect lives in a file the test environment
 * does not load.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PANEL = readFileSync(path.join(process.cwd(), "src/NarrationPanel.jsx"), "utf8");
const CSS = readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");

/**
 * Every rule in the stylesheet whose selector mentions narration, and nothing
 * else.
 *
 * This used to be `CSS.slice(CSS.indexOf(".narration-bar {"))` — everything
 * from the narration bar to the END OF THE FILE. That was only ever correct
 * because the narration rules happened to be last; the first block appended
 * after them (the story map, 2026-09-13) turned "the player names no colour"
 * into "nothing below this point in the stylesheet names a colour", which is
 * not a claim about the player at all.
 */
function narrationCss() {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = clean.match(/[^{}]+\{[^{}]*\}/g) || [];
  const mine = rules.filter((rule) => /narration/.test(rule.slice(0, rule.indexOf("{"))));
  expect(mine.length).toBeGreaterThan(0);
  return mine.join("\n");
}

/** JSX with comments stripped, so a hex quoted in a comment is not a finding. */
function panelCode() {
  return PANEL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

describe("nothing in the player names a colour", () => {
  it("not in the markup", () => {
    // The grey box was `background: "#f0f0f0"` in an inline style object.
    expect(panelCode()).not.toMatch(LITERAL_COLOUR);
  });

  it("not in the stylesheet either", () => {
    expect(narrationCss()).not.toMatch(LITERAL_COLOUR);
  });

  it("and the old grey is gone from the markup entirely", () => {
    expect(panelCode()).not.toContain("f0f0f0");
  });
});

describe("it uses the app's tokens", () => {
  const css = narrationCss();

  it("takes its surface and its rule from the palette", () => {
    expect(css).toMatch(/background:\s*var\(--bg-elevated\)/);
    expect(css).toMatch(/border:\s*1px solid var\(--line\)/);
  });

  it("uses the gold gradient for the play control, like every other primary button", () => {
    expect(css).toMatch(/var\(--gold-light\)/);
  });

  it("sets the chapter name in the display serif", () => {
    expect(css).toMatch(/\.narration-title\s*\{[^}]*Cinzel/);
  });
});

describe("no system vocabulary reaches the reader", () => {
  const code = panelCode();

  it("has no raw voice ids in anything it renders", () => {
    // `af_heart` and `af_alloy` were the visible options in a bare <select>,
    // because GET /voices 404s and the client falls back to the ids. The id
    // still exists as the default sent to the synth API -- that is a value, not
    // a label -- so this asserts on the returned markup, not the whole file.
    const markup = code.slice(code.indexOf("return ("));
    expect(markup).not.toMatch(/af_[a-z]+/);
    expect(markup).not.toContain("DEFAULT_VOICE_ID");
  });

  it("has no bare select of voices any more — that moves to settings", () => {
    expect(code).not.toContain("<select");
  });

  it("says what it is doing in words while the chapter is not ready", () => {
    expect(code).toContain("Preparing narration");
  });

  it("counts paragraphs rather than inventing a timecode", () => {
    // This player has no duration to report until the chapter renders as one
    // file. "Paragraph 1 of 42" is true; a fake 00:00 / 12:30 would not be.
    expect(code).toContain("Paragraph");
    expect(code).not.toMatch(/\d\d:\d\d/);
  });
});

describe("the controls are reachable without sight", () => {
  const code = panelCode();

  it("labels play, stop and the group", () => {
    expect(code).toContain('aria-label="Narration"');
    expect(code).toMatch(/aria-label=\{isPlaying \? "Pause narration" : "Play narration"\}/);
    expect(code).toContain('aria-label="Stop narration"');
  });

  it("hides the glyphs from the screen reader, since the labels carry them", () => {
    expect(code).toMatch(/aria-hidden="true"/);
  });

  it("disables play until there is something to play", () => {
    expect(code).toMatch(/disabled=\{!ready\}/);
  });
});
