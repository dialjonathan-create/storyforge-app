/**
 * The reader always reopened at the top, and 🔖 looked like it did nothing.
 *
 * Both restores existed. Both were dead. The effect that ran them fired one
 * animation frame after `chapterNumber` changed — which is *before* the chapter
 * has been fetched, while the reader is still showing "Turning the page...".
 * So:
 *
 *   - `document.querySelector('[data-paragraph-index="12"]')` found nothing,
 *     because the prose was not on the page yet, and the bookmark branch fell
 *     through;
 *   - `documentElement.scrollHeight - innerHeight` on a loading screen is zero
 *     or near it, so `percent * scrollable` scrolled to roughly the top.
 *
 * A restore that lands at the top is indistinguishable from no memory at all,
 * which is why this looked like a missing feature rather than a broken one.
 *
 * `restoreReadingPosition` now says which of the three happened, and refuses to
 * "restore" against a page that has not laid out. The effect waits for the
 * chapter and for the prose to be rendered before calling it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { restoreReadingPosition } = await import("../src/main.jsx");

// A stand-in page. `scrollHeight` is settable, which jsdom's real one is not.
function page({ scrollHeight = 4000, innerHeight = 800, paragraphs = [] } = {}) {
  const scrolledInto = [];
  const nodes = new Map(
    paragraphs.map((i) => [String(i), { scrollIntoView: (opts) => scrolledInto.push({ index: i, opts }) }])
  );
  const scrolls = [];
  return {
    scrolledInto,
    scrolls,
    doc: {
      documentElement: { scrollHeight },
      querySelector: (sel) => {
        const match = /\[data-paragraph-index="(\d+)"\]/.exec(sel);
        return (match && nodes.get(match[1])) || null;
      },
    },
    win: { innerHeight, scrollTo: (x, y) => scrolls.push(y) },
  };
}

let p;
beforeEach(() => {
  p = page({ paragraphs: [0, 12, 40] });
});

// ---------------------------------------------------------------------------
// the bookmark wins, because an anchor survives what a percentage does not
// ---------------------------------------------------------------------------

describe("an explicit bookmark", () => {
  it("scrolls to the paragraph that was bookmarked", () => {
    const kind = restoreReadingPosition({
      bookmark: { chapterNumber: 2, paragraphIndex: 12 },
      saved: { chapter: 2, scrollPercent: 0.9 },
      chapterNumber: 2,
      ...p,
    });
    expect(kind).toBe("bookmark");
    expect(p.scrolledInto).toHaveLength(1);
    expect(p.scrolledInto[0].index).toBe(12);
    // and it did NOT also jump to 90%
    expect(p.scrolls).toEqual([]);
  });

  it("lands at the top of the paragraph, not its middle", () => {
    // Middle would hide the sentence you stopped on above the fold.
    restoreReadingPosition({ bookmark: { chapterNumber: 2, paragraphIndex: 12 }, chapterNumber: 2, ...p });
    expect(p.scrolledInto[0].opts.block).toBe("start");
  });

  it("is ignored when it belongs to a different chapter", () => {
    const kind = restoreReadingPosition({
      bookmark: { chapterNumber: 7, paragraphIndex: 12 },
      saved: { chapter: 2, scrollPercent: 0.5 },
      chapterNumber: 2,
      ...p,
    });
    expect(kind).toBe("position");
    expect(p.scrolledInto).toEqual([]);
  });

  it("falls back to the percentage when the bookmarked paragraph is gone", () => {
    // A chapter can be reshaped underneath a bookmark.
    const kind = restoreReadingPosition({
      bookmark: { chapterNumber: 2, paragraphIndex: 999 },
      saved: { chapter: 2, scrollPercent: 0.5 },
      chapterNumber: 2,
      ...p,
    });
    expect(kind).toBe("position");
    expect(p.scrolls).toEqual([0.5 * (4000 - 800)]);
  });

  it("does not treat paragraph 0 as an absent bookmark", () => {
    // The top of a chapter is a real place to have stopped, and 0 is falsy.
    const kind = restoreReadingPosition({ bookmark: { chapterNumber: 2, paragraphIndex: 0 }, chapterNumber: 2, ...p });
    expect(kind).toBe("bookmark");
    expect(p.scrolledInto[0].index).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// the scroll percentage
// ---------------------------------------------------------------------------

describe("the automatic position", () => {
  it("scrolls to the same fraction of the chapter", () => {
    const kind = restoreReadingPosition({ saved: { chapter: 2, scrollPercent: 0.25 }, chapterNumber: 2, ...p });
    expect(kind).toBe("position");
    expect(p.scrolls).toEqual([0.25 * 3200]);
  });

  it("is ignored when it belongs to a different chapter", () => {
    expect(restoreReadingPosition({ saved: { chapter: 5, scrollPercent: 0.25 }, chapterNumber: 2, ...p })).toBe("none");
    expect(p.scrolls).toEqual([]);
  });

  it("does nothing when there is nothing saved", () => {
    expect(restoreReadingPosition({ chapterNumber: 2, ...p })).toBe("none");
    expect(restoreReadingPosition({ saved: {}, chapterNumber: 2, ...p })).toBe("none");
    expect(p.scrolls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the bug itself: restoring against a page that is not there yet
// ---------------------------------------------------------------------------

describe("a page that has not laid out", () => {
  it("refuses rather than scrolling to the top and calling it a restore", () => {
    const loading = page({ scrollHeight: 800, innerHeight: 800 });
    const kind = restoreReadingPosition({ saved: { chapter: 2, scrollPercent: 0.9 }, chapterNumber: 2, ...loading });
    expect(kind).toBe("not-laid-out");
    expect(loading.scrolls).toEqual([]);
  });

  it("refuses for a document shorter than the viewport too", () => {
    const loading = page({ scrollHeight: 400, innerHeight: 800 });
    expect(restoreReadingPosition({ saved: { chapter: 2, scrollPercent: 0.9 }, chapterNumber: 2, ...loading })).toBe(
      "not-laid-out"
    );
    expect(loading.scrolls).toEqual([]);
  });

  it("says the bookmark was not found rather than pretending, when the prose is absent", () => {
    const loading = page({ scrollHeight: 800, innerHeight: 800, paragraphs: [] });
    const kind = restoreReadingPosition({
      bookmark: { chapterNumber: 2, paragraphIndex: 12 },
      saved: { chapter: 2, scrollPercent: 0.9 },
      chapterNumber: 2,
      ...loading,
    });
    expect(kind).toBe("not-laid-out");
    expect(loading.scrolledInto).toEqual([]);
    expect(loading.scrolls).toEqual([]);
  });
});
