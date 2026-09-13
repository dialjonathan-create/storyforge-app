/**
 * The reader bar was carrying a title it could not fit.
 *
 * On the device: back, then "THE FAMILY FOL…" — truncated on every story with a
 * real name — then a bookmark, a speech bubble, ≡ and the avatars. The title
 * was doing nothing that the chapter heading directly beneath it was not doing
 * properly, and it was doing it badly on every screen.
 *
 * Three changes, and the interesting one is the third:
 *
 *   1. **The title is gone.** An element cut off on every screen is not
 *      carrying information.
 *   2. **The bookmark moved into the chapter menu.** It is the icon that reads
 *      as an anchor, and it was a once-in-a-while action occupying one of the
 *      four places a thumb reaches most. `saveBookmarkHere` is unchanged — it
 *      still saves the paragraph nearest the scroll position — it just lives
 *      behind ≡ now.
 *   3. **Every icon has a label.** Back and ≡ had none at all; VoiceOver read
 *      them as "button". A book app that cannot be used with a screen reader is
 *      a contradiction.
 *
 * The map slot the brief describes is deliberately not here: maps are not
 * built, and a button that opens nothing is worse than a gap.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(path.join(process.cwd(), "src/main.jsx"), "utf8");
const CSS = readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");

/** The reader's <header> block, which is the only thing under test here. */
function readerHeader() {
  const start = SOURCE.indexOf('<header className={`reader-header');
  expect(start).toBeGreaterThan(-1);
  return SOURCE.slice(start, SOURCE.indexOf("</header>", start));
}

describe("the bar", () => {
  const bar = readerHeader();

  it("no longer renders the story title", () => {
    expect(bar).not.toContain("reader-title");
    expect(bar).not.toContain("story?.title");
  });

  it("has back and the actions group, and nothing between them", () => {
    expect(bar).toContain('aria-label="Back to the story list"');
    expect(bar).toContain("reader-header-actions");
  });

  it("keeps at most three controls plus the readers", () => {
    // back, 💬, ≡ — and the avatars, which stay because they are how you know
    // WHICH reader the app is asking the server about, and that became
    // load-bearing the moment identity did.
    const buttons = bar.match(/<button/g) || [];
    expect(buttons.length).toBeLessThanOrEqual(3);
    expect(bar).toContain("<Avatars");
  });

  it("does not carry the bookmark any more", () => {
    expect(bar).not.toContain("saveBookmarkHere");
    expect(bar).not.toContain("🔖");
  });
});

describe("every icon says what it is", () => {
  const bar = readerHeader();

  it("labels back, which had nothing", () => {
    expect(bar).toMatch(/aria-label="Back to the story list"/);
  });

  it("labels the menu, which had nothing", () => {
    expect(bar).toMatch(/aria-label="Chapters and settings"/);
  });

  it("labels talk", () => {
    expect(bar).toMatch(/aria-label="Talk to the story"/);
  });

  it("leaves no unlabelled button in the bar at all", () => {
    // The assertion that actually holds the property, rather than three that
    // enumerate today's buttons.
    //
    // Split rather than regex the tag: an arrow function in an onClick contains
    // a `>`, so `<button[^>]*>` stops in the middle of the attributes and finds
    // no label on a button that has one.
    const buttons = bar.split("<button").slice(1).map((chunk) => chunk.split("</button>")[0]);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toMatch(/aria-label=/);
  });
});

describe("it gets out of the way", () => {
  it("dims rather than hides", () => {
    // A control a reader cannot find is worse than one they can see through.
    expect(CSS).toMatch(/\.reader-header-dim\s*\{[^}]*opacity:\s*0\.\d+/);
    expect(CSS).not.toMatch(/\.reader-header-dim\s*\{[^}]*display:\s*none/);
  });

  it("comes back for the keyboard as well as for a tap", () => {
    expect(CSS).toMatch(/\.reader-header-dim:focus-within\s*\{[^}]*opacity:\s*1/);
    expect(readerHeader()).toContain("onPointerDown={() => setBarDim(false)}");
  });

  it("only dims once the reader is past the top of the chapter", () => {
    // Dimming at scrollY 3 would make the bar flicker on every small nudge.
    expect(SOURCE).toContain("y > lastY + 4 && y > 80");
  });
});

describe("the bookmark is still reachable", () => {
  it("is offered in the chapter menu", () => {
    expect(SOURCE).toContain("Save my spot here");
    expect(SOURCE).toContain("onSaveSpot");
  });

  it("still calls the same unchanged function", () => {
    expect(SOURCE).toMatch(/onSaveSpot=\{\(\) => \{ setMenuOpen\(false\); saveBookmarkHere\(\); \}\}/);
  });
});
