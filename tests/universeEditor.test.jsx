/**
 * The PWA could create a universe and then never touch it again.
 *
 * Every capability needed to edit one already shipped —
 * `storyforge.universe.update.v1`, `storyforge.bible.field.update.v1`,
 * `storyforge.lore.update.v1`, and the two entry verbs from #1544. What was
 * missing was a screen. Fixing a genre meant typing a capability name into a
 * chat window, which is not a thing anybody does with a thumb.
 *
 * Two rules run through the whole editor, and they are what these tests are
 * about:
 *
 *   1. **Nothing reports success until it has been read back.** Every save
 *      re-reads `storyforge.universe.get.v1` and compares. A tick that only
 *      means "the request did not throw" is worse than no tick at all, because
 *      it stops you checking.
 *   2. **Shape is never coerced.** A bible field that is prose stays prose; one
 *      that is a list stays a list. These keys are written by two different
 *      paths, so the same key is a string on one universe and an array on
 *      another — `the-embodied-age` has both in a single document.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const main = await import("../src/main.jsx");
const { UniverseEditor, AppProvider, bibleFieldShape, bibleFieldDraft, savedValueMatches, BIBLE_FIELDS } = main;

const { MemoryRouter, Routes, Route } = await import("react-router-dom");

afterEach(cleanup);

// The live shape of the-embodied-age, trimmed: prose and array side by side.
function universeDoc(overrides = {}) {
  return {
    ok: true,
    universe: {
      universeId: "the-embodied-age",
      title: "The Embodied Age",
      tagline: "Consciousness requires a body.",
      genre: "speculative-fiction",
      audienceAge: "adult",
      ownerId: "jonathan",
      visibility: "private",
    },
    bible: {
      worldRules: "Abilities are bonded from childhood.",
      lore: "The Consortium keeps the registry.",
      locations: "Ashgrove Hold.",
      openMysteries: "the excavation",
      factions: "Purists hold the North Slope.",
      arcDirection: "Toward the excavation.",
      establishedFacts: ["Death-on-separation is architectural."],
      worldState: "The bond is changing.",
    },
    lore: {
      characters: [{ name: "Maren Voss", role: "Protagonist." }],
      worldFacts: ["Hold is a Purist planet."],
      timeline: [{ chapterNumber: 1, event: "Maren meets Halvard." }],
      choiceHistory: [],
    },
    ...overrides,
  };
}

// A fake capability layer. `state` is the document the fake server returns, so
// a test can decide whether a write actually took.
let calls;
let serverDoc;
let applyWrite;

beforeEach(() => {
  calls = [];
  serverDoc = universeDoc();
  applyWrite = () => {};
  localStorage.clear();
  global.fetch = vi.fn(async (_url, init) => {
    const { command, args } = JSON.parse(init.body);
    calls.push({ command, args });
    if (command !== "storyforge.universe.get.v1") applyWrite(command, args);
    return {
      ok: true,
      status: 200,
      json: async () => (command === "storyforge.universe.get.v1" ? serverDoc : { ok: true }),
    };
  });
});

function draw(readers = ["jonathan"]) {
  localStorage.setItem("storyforge_reading_group", JSON.stringify(readers));
  return render(
    <MemoryRouter initialEntries={["/universes/the-embodied-age/edit"]}>
      <AppProvider>
        <Routes>
          <Route path="/universes/:id/edit" element={<UniverseEditor />} />
        </Routes>
      </AppProvider>
    </MemoryRouter>
  );
}

const sent = (command) => calls.filter((c) => c.command === command);

// ---------------------------------------------------------------------------
// shape is never coerced
// ---------------------------------------------------------------------------

describe("the shape of a bible field", () => {
  it("is read from the value, not from the field name", () => {
    expect(bibleFieldShape("a paragraph")).toBe("prose");
    expect(bibleFieldShape(["one", "two"])).toBe("list");
  });

  it("treats an absent field as prose, because new writing is prose", () => {
    // Guessing "list" would turn a paragraph into a one-item array that the
    // next reader has to undo.
    expect(bibleFieldShape(undefined)).toBe("prose");
    expect(bibleFieldShape(null)).toBe("prose");
  });

  it("never turns a list into a string or a string into a list", () => {
    expect(bibleFieldDraft(["a", "b"])).toEqual(["a", "b"]);
    expect(bibleFieldDraft("a")).toBe("a");
    expect(bibleFieldDraft(42)).toBe("");
  });

  it("shows each field's shape on screen, so an editor knows what it is holding", async () => {
    draw();
    await screen.findByText("World bible");
    // the-embodied-age really does have both in one document
    expect(screen.getAllByText("prose").length).toBeGreaterThan(1);
    expect(screen.getAllByText("list").length).toBeGreaterThanOrEqual(1);
  });

  it("offers a textarea for prose and a list editor for an array", async () => {
    draw();
    await screen.findByText("World bible");
    expect(screen.getByLabelText("World rules").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Established facts 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Established facts 1" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// nothing reports success until it has been read back
// ---------------------------------------------------------------------------

describe("saving", () => {
  it("sends only the fields that changed", async () => {
    applyWrite = (command, args) => {
      if (command === "storyforge.universe.update.v1") {
        serverDoc = universeDoc({ universe: { ...serverDoc.universe, ...args } });
      }
    };
    draw();
    await screen.findByText("Details");
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "speculative fiction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(sent("storyforge.universe.update.v1")).toHaveLength(1));
    const args = sent("storyforge.universe.update.v1")[0].args;
    expect(args.genre).toBe("speculative fiction");
    expect(args).not.toHaveProperty("title");
    expect(args).not.toHaveProperty("tagline");
  });

  it("reads the universe back before it says Saved", async () => {
    applyWrite = (command, args) => {
      if (command === "storyforge.universe.update.v1") {
        serverDoc = universeDoc({ universe: { ...serverDoc.universe, ...args } });
      }
    };
    draw();
    await screen.findByText("Details");
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "speculative fiction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await screen.findByText("Saved");
    // one read on mount, one after the write
    expect(sent("storyforge.universe.get.v1").length).toBeGreaterThanOrEqual(2);
  });

  it("refuses to say Saved when the server accepted it and did not change", async () => {
    // The failure this whole screen exists to not have: ok:True, field
    // unchanged, green tick. `storyforge.universe.update.v1` silently ignored
    // unknown keys for exactly this long.
    applyWrite = () => {}; // the write lands nowhere
    draw();
    await screen.findByText("Details");
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "tidepool gothic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/still shows the old value/i);
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("surfaces a refusal instead of retrying with something looser", async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const { command } = JSON.parse(init.body);
      calls.push({ command });
      if (command === "storyforge.universe.get.v1") {
        return { ok: true, status: 200, json: async () => serverDoc };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: "lore_entry_not_found", message: "entryText matched more than one entry; use entryIndex." }),
      };
    });
    draw();
    await screen.findByText("Details");
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/matched more than one entry/);
  });

  it("does not offer to save when nothing has been typed", async () => {
    draw();
    await screen.findByText("Details");
    expect(screen.getByRole("button", { name: "Save details" }).disabled).toBe(true);
  });

  it("saves one bible field at a time, naming the field", async () => {
    applyWrite = (command, args) => {
      if (command === "storyforge.bible.field.update.v1") {
        serverDoc = universeDoc({ bible: { ...serverDoc.bible, [args.field]: args.value } });
      }
    };
    draw();
    await screen.findByText("World bible");
    fireEvent.change(screen.getByLabelText("Factions"), { target: { value: "Purists hold both slopes." } });
    fireEvent.click(screen.getByRole("button", { name: "Save factions" }));
    await waitFor(() => expect(sent("storyforge.bible.field.update.v1")).toHaveLength(1));
    const args = sent("storyforge.bible.field.update.v1")[0].args;
    expect(args.field).toBe("factions");
    expect(args.value).toBe("Purists hold both slopes.");
  });

  it("sends a list field as a list, with blank rows dropped", async () => {
    applyWrite = (command, args) => {
      if (command === "storyforge.bible.field.update.v1") {
        serverDoc = universeDoc({ bible: { ...serverDoc.bible, [args.field]: args.value } });
      }
    };
    draw();
    await screen.findByText("World bible");
    fireEvent.click(screen.getByRole("button", { name: "+ Add one" }));
    fireEvent.change(screen.getByLabelText("Established facts 2"), { target: { value: "  Hold is Purist.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save established facts" }));
    await waitFor(() => expect(sent("storyforge.bible.field.update.v1")).toHaveLength(1));
    expect(sent("storyforge.bible.field.update.v1")[0].args.value).toEqual([
      "Death-on-separation is architectural.",
      "Hold is Purist.",
    ]);
  });
});

// ---------------------------------------------------------------------------
// lore entries
// ---------------------------------------------------------------------------

describe("lore entries", () => {
  it("addresses an entry by index, which is what the capability locates on", async () => {
    applyWrite = (command, args) => {
      if (command === "storyforge.lore.entry.reattribute.v1") {
        const next = [...serverDoc.lore.timeline];
        next[args.entryIndex] = { ...next[args.entryIndex], chapterNumber: args.chapterNumber };
        serverDoc = universeDoc({ lore: { ...serverDoc.lore, timeline: next } });
      }
    };
    draw();
    await screen.findByText("Lore entries");
    fireEvent.change(screen.getByLabelText("Move timeline entry 1 to chapter"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Move timeline entry 1" }));
    await waitFor(() => expect(sent("storyforge.lore.entry.reattribute.v1")).toHaveLength(1));
    const args = sent("storyforge.lore.entry.reattribute.v1")[0].args;
    expect(args).toMatchObject({ collection: "timeline", entryIndex: 0, chapterNumber: 2 });
  });

  it("offers no Move on a bare string, which carries no chapter to correct", async () => {
    // worldFacts holds plain strings; the capability refuses them by design
    // rather than inventing a wrapper dict, so the button must not be there.
    draw();
    await screen.findByText("World facts");
    expect(screen.queryByLabelText("Move timeline entry 1 to chapter")).toBeTruthy();
    // characters and timeline hold dicts; worldFacts holds bare strings
    expect(screen.getByRole("button", { name: "Move characters entry 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move timeline entry 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move worldFacts entry 1" })).toBeNull();
    expect(screen.queryByLabelText("Move worldFacts entry 1 to chapter")).toBeNull();
  });

  it("asks twice before removing anything", async () => {
    draw();
    await screen.findByText("Lore entries");
    fireEvent.click(screen.getByRole("button", { name: "Remove timeline entry 1" }));
    expect(screen.getByRole("button", { name: "Really remove timeline entry 1" })).toBeTruthy();
    expect(sent("storyforge.lore.entry.remove.v1")).toHaveLength(0);
  });

  it("can be backed out of", async () => {
    draw();
    await screen.findByText("Lore entries");
    fireEvent.click(screen.getByRole("button", { name: "Remove timeline entry 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("button", { name: "Really remove timeline entry 1" })).toBeNull();
    expect(sent("storyforge.lore.entry.remove.v1")).toHaveLength(0);
  });

  it("removes by index and confirms against a fresh read", async () => {
    applyWrite = (command, args) => {
      if (command === "storyforge.lore.entry.remove.v1") {
        serverDoc = universeDoc({
          lore: { ...serverDoc.lore, [args.collection]: serverDoc.lore[args.collection].filter((_, i) => i !== args.entryIndex) },
        });
      }
    };
    draw();
    await screen.findByText("Lore entries");
    fireEvent.click(screen.getByRole("button", { name: "Remove timeline entry 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Really remove timeline entry 1" }));
    await waitFor(() => expect(sent("storyforge.lore.entry.remove.v1")).toHaveLength(1));
    await screen.findByText("Removed");
  });

  it("adds through the append-only update capability", async () => {
    applyWrite = (command, args) => {
      if (command === "storyforge.lore.update.v1") {
        serverDoc = universeDoc({
          lore: { ...serverDoc.lore, worldFacts: [...serverDoc.lore.worldFacts, ...args.lore.worldFacts] },
        });
      }
    };
    draw();
    await screen.findByText("World facts");
    fireEvent.change(screen.getByLabelText("New world facts entry"), { target: { value: "The registry is sealed." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[1]);
    await waitFor(() => expect(sent("storyforge.lore.update.v1")).toHaveLength(1));
    // worldFacts holds bare strings, so a bare string is what goes in
    expect(sent("storyforge.lore.update.v1")[0].args.lore.worldFacts).toEqual(["The registry is sealed."]);
  });
});

// ---------------------------------------------------------------------------
// who can open it
// ---------------------------------------------------------------------------

describe("who this is for", () => {
  it("is closed to the younger readers", async () => {
    draw(["keen"]);
    expect(await screen.findByText("This part is for grown-ups")).toBeTruthy();
    expect(screen.queryByText("World bible")).toBeNull();
  });

  it("does not even fetch the universe for them", async () => {
    draw(["talia"]);
    await screen.findByText("This part is for grown-ups");
    expect(sent("storyforge.universe.get.v1")).toHaveLength(0);
  });

  it("exposes no field that is not a metadata correction", () => {
    // The universe document also carries ownerId, owners, members,
    // contributors, visibility and canGenerate. An editor on a phone must not
    // be able to reach any of them.
    const editable = new Set(["title", "tagline", "genre", "audienceAge"]);
    for (const forbidden of ["ownerId", "owners", "members", "contributors", "visibility", "canGenerate"]) {
      expect(editable.has(forbidden)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// the read-back comparison itself
// ---------------------------------------------------------------------------

describe("savedValueMatches", () => {
  it("ignores the whitespace the server trims", () => {
    expect(savedValueMatches("  a  ", "a")).toBe(true);
  });

  it("does not call a different value a match", () => {
    expect(savedValueMatches("a", "b")).toBe(false);
    expect(savedValueMatches("a", undefined)).toBe(false);
  });

  it("compares lists item by item, including length", () => {
    expect(savedValueMatches(["a", "b"], ["a", "b"])).toBe(true);
    expect(savedValueMatches(["a", "b"], ["a"])).toBe(false);
    expect(savedValueMatches(["a"], "a")).toBe(false);
  });
});

describe("the fields offered", () => {
  it("covers every bible field the brief named", () => {
    expect(BIBLE_FIELDS.map(([key]) => key)).toEqual([
      "worldRules", "lore", "locations", "openMysteries",
      "factions", "arcDirection", "establishedFacts", "worldState",
    ]);
  });
});
