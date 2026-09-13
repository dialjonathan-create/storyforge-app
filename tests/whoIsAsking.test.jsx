/**
 * The app asked every question as Jonathan, from every device in the house.
 *
 * `userId: "jonathan"` appears in twenty of this file's capability calls, and
 * `requestedBy` appeared in exactly one. The server's permission checks read
 * `requestedBy` and fall back to `userId` — so on Adele's phone, with Adele
 * picked in the reader switcher, `_can_read_universe` was being asked *"can
 * Jonathan read this?"* and answering yes.
 *
 * That is the half of the 2026-09-13 privacy fix that lives here. The other
 * half is server-side: thirteen read capabilities had no check at all, so even
 * a correct identity would have been ignored by most of them. Both were needed;
 * neither is sufficient.
 *
 * The fix is one stamp in `execute` rather than a correction at twenty-four call
 * sites, because the twenty-fifth call site is the one that forgets.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const main = await import("../src/main.jsx");
const { AppProvider, UniverseEditor, setCurrentReaderId, getCurrentReaderId, readStoredReaders } = main;
const { MemoryRouter, Routes, Route } = await import("react-router-dom");

afterEach(cleanup);

let sent;
beforeEach(() => {
  sent = [];
  localStorage.clear();
  setCurrentReaderId("jonathan");
  global.fetch = vi.fn(async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ ok: true, users: [], universes: [] }) };
  });
});

// `execute` is module-private, so it is exercised through a screen that calls
// it — which is also closer to the thing that was broken. The universe editor
// fetches `storyforge.universe.get.v1` on mount, which is exactly the kind of
// read that was being asked as the wrong person.
function mountProvider() {
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

// ---------------------------------------------------------------------------
// the identity itself
// ---------------------------------------------------------------------------

describe("who the app thinks is asking", () => {
  it("starts as whoever is stored, not as Jonathan by default", () => {
    // A phone with Adele picked must be Adele on the very first call, before
    // any effect has run.
    localStorage.setItem("storyforge_default_reader", "adele");
    expect(readStoredReaders()).toEqual(["adele"]);
  });

  it("falls back to Jonathan when nothing is stored", () => {
    setCurrentReaderId("");
    expect(getCurrentReaderId()).toBe("jonathan");
  });

  it("normalises what it is given", () => {
    setCurrentReaderId("  Adele ");
    expect(getCurrentReaderId()).toBe("adele");
  });

  it("survives storage being unavailable", () => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(readStoredReaders()).toEqual([]);
    } finally {
      Storage.prototype.getItem = get;
    }
  });

  it("reads a saved reading group as well as a default reader", () => {
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["keen", "talia"]));
    expect(readStoredReaders()).toEqual(["keen", "talia"]);
  });

  it("does not trust a garbled reading group", () => {
    localStorage.setItem("storyforge_reading_group", "{not json");
    expect(readStoredReaders()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the stamp
// ---------------------------------------------------------------------------

describe("every call carries it", () => {
  it("stamps requestedBy onto a call that did not set one", async () => {
    setCurrentReaderId("adele");
    mountProvider();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent[0].args.requestedBy).toBe("adele");
  });

  it("still sends userId, because that is what decides ownership on writes", async () => {
    // Deliberately untouched by this fix: changing who owns a created universe
    // is not something a privacy fix should do quietly.
    mountProvider();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent[0].args.userId).toBe("jonathan");
  });

  it("lets an explicit requestedBy from the caller win", async () => {
    // storyforge.universe.list.v1 was already passing its own, and the stamp
    // must not overwrite a call site that is being careful. Asserted on the
    // spread order rather than on that one call, since the editor does not make
    // it: `{ requestedBy: currentReaderId, ...args }` — args last, args wins.
    const source = readFileSync(path.join(process.cwd(), "src/main.jsx"), "utf8");
    expect(source).toMatch(/args:\s*\{\s*requestedBy:\s*currentReaderId,\s*\.\.\.args\s*\}/);
  });
});

describe("switching readers switches identity", () => {
  it("is not just a change of avatars", async () => {
    // The reader picker used to change the faces at the top of the screen and
    // nothing at all about what the server was asked.
    setCurrentReaderId("jonathan");
    expect(getCurrentReaderId()).toBe("jonathan");
    setCurrentReaderId("keen");
    expect(getCurrentReaderId()).toBe("keen");
  });

  it("the provider pushes the active reader into the identity on mount", async () => {
    localStorage.setItem("storyforge_default_reader", "keen");
    setCurrentReaderId("jonathan");
    mountProvider();
    await waitFor(() => expect(getCurrentReaderId()).toBe("keen"));
  });
});

// ---------------------------------------------------------------------------
// the shape of the bug, stated as a test
// ---------------------------------------------------------------------------

describe("the bug this closes", () => {
  it("no longer asks the server a question about Jonathan when Adele is reading", async () => {
    localStorage.setItem("storyforge_default_reader", "adele");
    setCurrentReaderId("adele");
    mountProvider();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    for (const call of sent) {
      // `userId` is still jonathan by design; the permission question is not.
      expect(call.args.requestedBy).not.toBe("jonathan");
    }
  });
});
