/**
 * The client half of "a confirmation is assembled from the write".
 *
 * The conversation store for `field-notes-from-the-long-tomorrow` holds this as
 * its second turn ever:
 *
 *     [2026-09-12T06:55:32] assistant  "Chapter 1 is saved."
 *
 * The server half of that is fixed in the supervisor. This is the other half,
 * and it was one `??`:
 *
 *     `Saved as chapter ${res.chapterNumber ?? proposal.chapterNumber}.`
 *
 * `storyforge.chapter.save.v1` resolves its own chapter target and can land
 * somewhere other than the draft's slot. When it did, the client fell back to
 * the number it had ASKED for and told the reader that — which is stating a
 * fact nobody had. If the server does not say which chapter it wrote, the
 * confirmation does not name one.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const MAIN = fs.readFileSync(path.join(process.cwd(), "src/main.jsx"), "utf8");

/** The confirmation builder, lifted out of the source it lives in. */
function confirmation(res) {
  return typeof res?.chapterNumber === "number" && Number.isFinite(res.chapterNumber)
    ? `Saved as chapter ${res.chapterNumber}.`
    : "Saved.";
}

/** The app's code with comments stripped, so a defect quoted in a comment is
 *  not mistaken for the defect. */
const CODE = MAIN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the confirmation names only what the server reported", () => {
  it("uses the number the server says it wrote", () => {
    expect(confirmation({ chapterNumber: 4 })).toBe("Saved as chapter 4.");
  });

  it("names no chapter when the server named none", () => {
    expect(confirmation({})).toBe("Saved.");
    expect(confirmation({ chapterNumber: null })).toBe("Saved.");
    expect(confirmation(undefined)).toBe("Saved.");
  });

  it("does not treat a non-number as a chapter", () => {
    // `Number(null)` and `Number("")` are both 0, which is finite -- the first
    // version of this guard rendered "Saved as chapter null."
    expect(confirmation({ chapterNumber: "" })).toBe("Saved.");
    expect(confirmation({ chapterNumber: "soon" })).toBe("Saved.");
    expect(confirmation({ chapterNumber: "4" })).toBe("Saved.");
    expect(confirmation({ chapterNumber: NaN })).toBe("Saved.");
  });

  it("is the same expression the app ships", () => {
    // A test over a copy of the logic is worth nothing if the copy drifts.
    expect(CODE).toContain('typeof res?.chapterNumber === "number" && Number.isFinite(res.chapterNumber)');
    expect(CODE).toContain("`Saved as chapter ${res.chapterNumber}.`");
  });

  it("has no fallback to the number that was requested", () => {
    // This is the defect, spelled exactly as it was.
    expect(CODE).not.toContain("res.chapterNumber ?? proposal.chapterNumber");
    expect(CODE).not.toMatch(/Saved as chapter \$\{[^}]*proposal\.chapterNumber/);
  });
});

describe("a refusal keeps the server's words", () => {
  it("shows what the server said rather than a generic sentence", () => {
    // `chapter_landed_elsewhere` explains that the save resolved to a different
    // chapter and the proposal is still held. Nothing generic can say that.
    expect(CODE).toContain('content: error.message || "That did not go through. The draft is still held."');
  });

  it("still says the draft is held when the server said nothing", () => {
    expect(CODE).toContain("The draft is still held.");
  });
});

describe("dismissing says what it did", () => {
  it("claims no save", () => {
    expect(CODE).toContain('"Dismissed. Nothing was saved."');
  });
});
