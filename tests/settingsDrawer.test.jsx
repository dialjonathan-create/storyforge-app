/**
 * Settings, under the ≡, where the person already looks.
 *
 * Two things were sitting in the app with no way to reach them:
 *
 *   1. The narrator voice. `NarrationPanel` has carried the comment "the
 *      human-readable name and the picker belong in the settings sheet; until
 *      that exists this is a default nobody sees" since it was written. Every
 *      chapter has been read by `af_heart` because nothing could choose
 *      otherwise.
 *   2. Switching readers. It was a tap on the avatar in the header, with no
 *      label, no affordance, and nothing saying that it changes who the server
 *      thinks is asking.
 *
 * And one defect the drawer already had: no scroll. Once it holds settings as
 * well as every chapter in the story, a long book runs off the bottom of a
 * fixed panel.
 *
 * jsdom applies no stylesheets, so the scroll fix is asserted against the
 * source of `styles.css` rather than a computed style — the same approach the
 * composer-height tests use.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

import { voiceLabel, VoiceChoice, NARRATOR_VOICE_KEY, readNarratorVoice } from "../src/main.jsx";

const CSS = fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
const MAIN = fs.readFileSync(path.join(process.cwd(), "src/main.jsx"), "utf8");
const PANEL = fs.readFileSync(path.join(process.cwd(), "src/NarrationPanel.jsx"), "utf8");

afterEach(cleanup);

function block(selector) {
  const start = CSS.indexOf(selector);
  expect(start, `${selector} is missing`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", start);
  return CSS.slice(open, CSS.indexOf("}", open));
}

describe("a voice id becomes a name", () => {
  it("reads the accent and the register out of the id", () => {
    expect(voiceLabel("af_heart")).toBe("Heart — American, warm");
    expect(voiceLabel("bm_george")).toBe("George — British, low");
  });

  it("never shows the raw id to a reader", () => {
    for (const id of ["af_heart", "am_adam", "bf_emma", "bm_george"]) {
      expect(voiceLabel(id)).not.toContain("_");
    }
  });

  it("keeps a voice the server adds tomorrow rather than dropping it", () => {
    // A list that silently omits unknown ids is a list that gets shorter every
    // time the synth is upgraded.
    expect(voiceLabel("storyteller_two")).toBe("Storyteller Two");
    expect(voiceLabel("zf_xiaobei")).toBe("Xiaobei — Chinese, warm");
  });

  it("survives nothing at all", () => {
    expect(voiceLabel("")).toBe("");
    expect(voiceLabel(null)).toBe("");
    expect(voiceLabel(undefined)).toBe("");
  });
});

describe("the picker", () => {
  it("shows one option per voice, by name", () => {
    render(<VoiceChoice voices={["af_heart", "bm_george"]} value="af_heart" onChange={() => {}} />);
    expect(screen.getByText("Heart — American, warm")).toBeTruthy();
    expect(screen.getByText("George — British, low")).toBeTruthy();
  });

  it("marks the one in use, so a reader can see which it is", () => {
    render(<VoiceChoice voices={["af_heart", "bm_george"]} value="bm_george" onChange={() => {}} />);
    const chosen = screen.getByText("George — British, low");
    expect(chosen.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Heart — American, warm").getAttribute("aria-checked")).toBe("false");
  });

  it("reports the id, not the label, when one is tapped", () => {
    let picked = null;
    render(<VoiceChoice voices={["af_heart", "bm_george"]} value="af_heart" onChange={(v) => { picked = v; }} />);
    fireEvent.click(screen.getByText("George — British, low"));
    expect(picked).toBe("bm_george");
  });

  it("takes objects as well as strings, because the server has returned both", () => {
    render(<VoiceChoice voices={[{ id: "af_heart" }, { name: "bm_george" }]} value="af_heart" onChange={() => {}} />);
    expect(screen.getByText("Heart — American, warm")).toBeTruthy();
    expect(screen.getByText("George — British, low")).toBeTruthy();
  });

  it("says something rather than nothing when no voices came back", () => {
    const { container } = render(<VoiceChoice voices={[]} value="af_heart" onChange={() => {}} />);
    expect(container.textContent.trim().length).toBeGreaterThan(0);
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("is not a native select", () => {
    // A <select> on iOS opens a full-screen wheel over the chapter, which is
    // the exact thing that kept narration controls off the reading page.
    const { container } = render(<VoiceChoice voices={["af_heart"]} value="af_heart" onChange={() => {}} />);
    expect(container.querySelector("select")).toBeNull();
  });
});

describe("the chosen voice is remembered and used", () => {
  it("reads back what was stored", () => {
    localStorage.setItem(NARRATOR_VOICE_KEY, "bm_george");
    expect(readNarratorVoice()).toBe("bm_george");
  });

  it("falls back rather than throwing when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    try {
      expect(readNarratorVoice("af_heart")).toBe("af_heart");
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });

  it("hands the choice down to the narration panel", () => {
    // Without this the panel keeps whatever it read at mount, so changing the
    // voice mid-chapter does nothing until a remount that never comes.
    expect(MAIN).toContain("<NarrationPanel chapter={chapter} voiceId={voice} />");
    expect(PANEL).toContain("function NarrationPanel({ chapter, voiceId })");
    expect(PANEL).toContain("const selectedVoice = voiceId || storedVoice;");
  });

  it("does not let a blocked storage write stop narration", () => {
    expect(PANEL).toMatch(/try \{\s*localStorage\.setItem\("storyforge_narrator_voice"/);
  });
});

describe("the drawer", () => {
  it("offers switching readers with a label on it", () => {
    expect(MAIN).toContain("Who's reading");
    expect(MAIN).toMatch(/Reading as \$\{readerName\} — switch/);
  });

  it("clears the remembered reader when switching, so the picker actually opens", () => {
    expect(MAIN).toMatch(/localStorage\.removeItem\("storyforge_default_reader"\)[\s\S]{0,80}nav\("\/"\)/);
  });

  it("closes itself on the way out", () => {
    expect(MAIN).toContain("onSwitchReader={() => { setMenuOpen(false); switchReaders(); }}");
  });

  it("scrolls, which it did not before", () => {
    // Twenty chapters plus three settings sections do not fit a fixed panel,
    // and a jump list you cannot reach past chapter 9 is a broken jump list.
    expect(block(".drawer-panel {")).toContain("overflow-y: auto");
  });

  it("keeps its last row clear of the home indicator", () => {
    expect(block(".drawer-panel {")).toContain("env(safe-area-inset-bottom)");
  });

  it("gives a voice label room to wrap instead of clipping it", () => {
    const rule = block(".drawer-panel .voice-option {");
    expect(rule).toContain("white-space: normal");
    expect(rule).toMatch(/min-height:\s*44px/);
  });
});
