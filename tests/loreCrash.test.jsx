/**
 * The Lore tab took the whole app down, and the crash was the smaller half.
 *
 * `Lore` called `.map` on `bible.worldRules`. On `the-embodied-age` — read live,
 * 2026-09-13 — that field is a **1,243-character string**, and so are `lore`
 * (2,560), `openMysteries` (579) and `locations` (519). `.map` is not a string
 * method. It threw during render.
 *
 * There was no error boundary anywhere in the app: no `componentDidCatch`, no
 * `getDerivedStateFromError`. React does the only thing it can with an
 * unhandled render error and **unmounts the entire tree**, so the screen went to
 * the background gradient and the only way out was force-quitting. A
 * seven-year-old lost the app because one panel was unhappy.
 *
 * Two properties, and the first one is the one that matters:
 *
 *   - **A component that throws costs its own panel and nothing else.** Not the
 *     screen, not the app.
 *   - **Never `.map` a value that has not been checked with `Array.isArray`.**
 *     These fields are written by two different paths — a structured update that
 *     produces arrays and a prose update that produces strings — so the same key
 *     is a list on one universe and a paragraph on another. `the-embodied-age`
 *     has `establishedFacts` as a 5-item array and `worldRules` as a string,
 *     side by side in one document.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { ErrorBoundary, Lore, loreParagraphs, loreText, loreCharacters } = await import("../src/main.jsx");

afterEach(cleanup);

// React logs every caught render error. That is correct behaviour and it is
// deafening; silence it for the tests that deliberately throw.
let consoleError;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError?.mockRestore());

function Boom() {
  throw new Error("worldRules.map is not a function");
}

// The live shape, trimmed. Every one of these strings is a string on the real
// universe, and establishedFacts really is an array in the same document.
const EMBODIED_AGE = {
  bible: {
    worldRules: "Abilities are bonded from childhood.\n\nSeparation is fatal by design.",
    lore: "The Consortium keeps the registry.",
    locations: "Ashgrove Hold, North Slope.",
    openMysteries: "the excavation on Hadren IV",
    factions: "Purists hold the North Slope.",
    worldState: "The bond is changing.",
    establishedFacts: ["Death-on-separation is architectural.", "Hold is a Purist planet."],
  },
  characters: [],
  lore: {
    characters: [
      { name: "Maren Voss", role: "Protagonist. Purist healer of Ashgrove Hold.", universeId: "the-embodied-age" },
      { name: "Halvard", role: "Trade contact.", universeId: "the-embodied-age" },
    ],
  },
};

// ---------------------------------------------------------------------------
// the boundary — the part that was actually missing
// ---------------------------------------------------------------------------

describe("a component that throws", () => {
  it("does not take the rest of the page with it", () => {
    render(
      <div>
        <p>the story is still here</p>
        <ErrorBoundary name="the lore"><Boom /></ErrorBoundary>
      </div>
    );
    expect(screen.getByText("the story is still here")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("says which part failed, in words, not a stack trace", () => {
    render(<ErrorBoundary name="the lore"><Boom /></ErrorBoundary>);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("the lore");
    expect(alert.textContent).not.toContain("is not a function");
  });

  it("tells the reader nothing was lost, because nothing was", () => {
    // A blank screen reads as "the app ate my story". It did not.
    render(<ErrorBoundary name="the lore"><Boom /></ErrorBoundary>);
    expect(screen.getByRole("alert").textContent).toMatch(/Nothing was lost/i);
  });

  it("offers a way out rather than a dead panel", () => {
    render(<ErrorBoundary name="the lore"><Boom /></ErrorBoundary>);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("renders a custom fallback when one is given", () => {
    render(<ErrorBoundary name="x" fallback={() => <p>a way back</p>}><Boom /></ErrorBoundary>);
    expect(screen.getByText("a way back")).toBeTruthy();
  });

  it("clears itself when the reader navigates somewhere else", () => {
    // A boundary that latches forever turns one bad render into a permanently
    // dead app: every screen after it would show the same apology.
    function Maybe({ explode }) {
      if (explode) throw new Error("boom");
      return <p>fine now</p>;
    }
    const { rerender } = render(
      <ErrorBoundary name="x" resetKey="/a"><Maybe explode /></ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(<ErrorBoundary name="x" resetKey="/b"><Maybe explode={false} /></ErrorBoundary>);
    expect(screen.getByText("fine now")).toBeTruthy();
  });

  it("stays out of the way entirely when nothing throws", () => {
    const { container } = render(<ErrorBoundary name="x"><p>ordinary</p></ErrorBoundary>);
    expect(container.textContent).toBe("ordinary");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("logs the failure rather than swallowing it", () => {
    // No telemetry to send it to yet; a tethered console is at least reachable,
    // and silence is how the next one takes as long to find as this one did.
    render(<ErrorBoundary name="the lore"><Boom /></ErrorBoundary>);
    expect(consoleError).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// the bible, as it actually is
// ---------------------------------------------------------------------------

describe("a bible whose fields are strings", () => {
  it("renders instead of throwing — the live the-embodied-age shape", () => {
    render(<Lore data={EMBODIED_AGE} />);
    expect(screen.getByText("World Rules")).toBeTruthy();
    expect(screen.getByText("Abilities are bonded from childhood.")).toBeTruthy();
  });

  it("splits prose into paragraphs on blank lines", () => {
    render(<Lore data={EMBODIED_AGE} />);
    expect(screen.getByText("Separation is fatal by design.")).toBeTruthy();
  });

  it("shows the fields that used to be dropped entirely", () => {
    // factions, worldState and establishedFacts were never rendered at all.
    render(<Lore data={EMBODIED_AGE} />);
    expect(screen.getByText("Factions")).toBeTruthy();
    expect(screen.getByText("Where Things Stand")).toBeTruthy();
    expect(screen.getByText("Established Facts")).toBeTruthy();
  });

  it("renders an array field as a list in the same bible", () => {
    render(<Lore data={EMBODIED_AGE} />);
    expect(screen.getByText("Death-on-separation is architectural.")).toBeTruthy();
  });
});

describe("a bible whose fields are arrays", () => {
  const arrays = {
    bible: {
      worldRules: ["One rule.", "Another rule."],
      locations: [{ name: "Ashgrove", description: "A hold." }],
      openMysteries: ["the north"],
      lore: ["An entry."],
      establishedFacts: [],
    },
    characters: [{ characterId: "c1", name: "Maren", description: "A healer.", role: "Protagonist", currentStatus: "alive" }],
  };

  it("still renders cards", () => {
    render(<Lore data={arrays} />);
    expect(screen.getByText("One rule.")).toBeTruthy();
    expect(screen.getByText("Ashgrove")).toBeTruthy();
  });

  it("keeps the Open Mysteries voice for the shape it was written for", () => {
    render(<Lore data={arrays} />);
    expect(screen.getByText(/Something stirs in/)).toBeTruthy();
  });

  it("drops an empty array rather than rendering an empty heading", () => {
    render(<Lore data={arrays} />);
    expect(screen.queryByText("Established Facts")).toBeNull();
  });

  it("prefers the structured character record when there is one", () => {
    render(<Lore data={arrays} />);
    expect(screen.getByText("A healer.")).toBeTruthy();
    expect(screen.getByText("Protagonist")).toBeTruthy();
  });
});

describe("an empty or absent bible", () => {
  it("renders nothing rather than a page of empty headings", () => {
    const { container } = render(<Lore data={{}} />);
    expect(container.querySelectorAll("h2")).toHaveLength(0);
  });

  it("survives no data at all", () => {
    expect(() => render(<Lore data={null} />)).not.toThrow();
  });

  it("survives a field that is neither a string nor an array", () => {
    expect(() => render(<Lore data={{ bible: { worldRules: 42, lore: { a: 1 } } }} />)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// the characters, which were blank even before the crash
// ---------------------------------------------------------------------------

describe("characters", () => {
  it("falls back to lore.characters, where all eleven actually live", () => {
    // storyforge.universe.get.v1 returns `characters: []` at the top level for
    // the-embodied-age while lore.characters holds every one of them.
    expect(loreCharacters(EMBODIED_AGE).map((c) => c.name)).toEqual(["Maren Voss", "Halvard"]);
  });

  it("uses role as the body when there is no description", () => {
    // Lore entries carry name/role/universeId — no description, which is what
    // the card was reading, so every card was blank.
    render(<Lore data={EMBODIED_AGE} />);
    expect(screen.getByText("Maren Voss")).toBeTruthy();
    expect(screen.getByText(/Purist healer of Ashgrove Hold/)).toBeTruthy();
  });

  it("does not print the role twice when it is standing in for the description", () => {
    const { container } = render(<Lore data={EMBODIED_AGE} />);
    const occurrences = container.textContent.split("Trade contact.").length - 1;
    expect(occurrences).toBe(1);
  });

  it("gives two unnamed characters distinct keys rather than colliding on undefined", () => {
    // Every card used to be keyed on `characterId`, which these entries do not
    // have, so React saw a list of `undefined` keys.
    const data = { lore: { characters: [{ role: "a" }, { role: "b" }] } };
    expect(() => render(<Lore data={data} />)).not.toThrow();
    expect(screen.getAllByText("Unnamed")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// the helpers
// ---------------------------------------------------------------------------

describe("loreParagraphs", () => {
  it("splits on blank lines", () => {
    expect(loreParagraphs("one\n\ntwo")).toEqual(["one", "two"]);
  });

  it("keeps a single wrapped block as one paragraph when there are no blank lines", () => {
    expect(loreParagraphs("one line\nsecond line")).toEqual(["one line", "second line"]);
  });

  it("returns nothing for a non-string or a blank string", () => {
    expect(loreParagraphs(["a"])).toEqual([]);
    expect(loreParagraphs("   ")).toEqual([]);
    expect(loreParagraphs(undefined)).toEqual([]);
  });
});

describe("loreText", () => {
  it("never renders [object Object]", () => {
    expect(loreText({ name: "Maren" })).toBe("Maren");
    expect(loreText({ text: "a fact" })).toBe("a fact");
    expect(loreText({ unknown: 1 })).toBe("");
    expect(loreText("plain")).toBe("plain");
    expect(loreText(null)).toBe("");
  });
});
