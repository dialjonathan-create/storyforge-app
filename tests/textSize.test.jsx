/**
 * Twenty pixels is one guess for a seven-year-old, a three-year-old and an
 * adult, on a phone and on an iPad held at arm's length.
 *
 * `.prose` was a flat `font-size: 20px` — three times, in fact: the base rule
 * and two media queries that both set it back to 20px. There was no way to
 * change it.
 *
 * Five steps, not a slider. A slider on a phone is a drag that lands on a value
 * you cannot name, and a child changing the text size by accident mid-chapter
 * is a worse outcome than a coarse control with a word on it.
 *
 * The scale is per reading GROUP, not per device: it belongs to whoever is
 * reading, and it follows them to the iPad.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { TEXT_SCALES, TEXT_SCALE_LABELS, textScaleIndex, stepTextScale, readTextScale, writeTextScale, TextSizeControl } =
  await import("../src/main.jsx");

afterEach(cleanup);
beforeEach(() => localStorage.clear());

// ---------------------------------------------------------------------------
// the steps
// ---------------------------------------------------------------------------

describe("the scale", () => {
  it("has a name for every step", () => {
    expect(TEXT_SCALE_LABELS).toHaveLength(TEXT_SCALES.length);
    expect(TEXT_SCALE_LABELS[textScaleIndex(1)]).toBe("Normal");
  });

  it("defaults to exactly the size the app has always rendered", () => {
    // 20px * 1. A default of anything else would silently resize every reader
    // who has never touched the control.
    expect(TEXT_SCALES).toContain(1);
    expect(readTextScale("keen")).toBe(1);
  });

  it("steps up and down", () => {
    expect(stepTextScale(1, 1)).toBe(TEXT_SCALES[textScaleIndex(1) + 1]);
    expect(stepTextScale(1, -1)).toBe(TEXT_SCALES[textScaleIndex(1) - 1]);
  });

  it("stops at both ends rather than wrapping round", () => {
    const smallest = TEXT_SCALES[0];
    const biggest = TEXT_SCALES[TEXT_SCALES.length - 1];
    expect(stepTextScale(smallest, -1)).toBe(smallest);
    expect(stepTextScale(biggest, 1)).toBe(biggest);
  });

  it("resolves an unrecognised value to the nearest step instead of resetting", () => {
    // An older build or a hand-edited key should not throw a reader who was
    // comfortable at 1.2 all the way back to Normal.
    expect(TEXT_SCALES[textScaleIndex(1.2)]).toBe(1.15);
    expect(TEXT_SCALES[textScaleIndex(9)]).toBe(TEXT_SCALES[TEXT_SCALES.length - 1]);
  });
});

// ---------------------------------------------------------------------------
// it belongs to the reader, not the device
// ---------------------------------------------------------------------------

describe("where it is kept", () => {
  it("is saved and read back per reading group", () => {
    writeTextScale("keen", 1.3);
    expect(readTextScale("keen")).toBe(1.3);
    expect(readTextScale("talia")).toBe(1);
  });

  it("survives a value that is not one of the steps", () => {
    localStorage.setItem("sf_text_keen", "1.21");
    expect(readTextScale("keen")).toBe(1.15);
  });

  it("falls back to Normal on nonsense rather than rendering NaN pixels", () => {
    localStorage.setItem("sf_text_keen", "banana");
    expect(readTextScale("keen")).toBe(1);
    localStorage.setItem("sf_text_keen", "");
    expect(readTextScale("keen")).toBe(1);
  });

  it("does not throw when storage is unavailable", () => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(readTextScale("keen")).toBe(1);
      expect(() => writeTextScale("keen", 1.3)).not.toThrow();
    } finally {
      Storage.prototype.getItem = get;
      Storage.prototype.setItem = set;
    }
  });
});

// ---------------------------------------------------------------------------
// the control
// ---------------------------------------------------------------------------

describe("the control", () => {
  it("names the current step out loud", () => {
    render(<TextSizeControl scale={1.3} onChange={() => {}} />);
    expect(screen.getByText("Much larger")).toBeTruthy();
  });

  it("asks for a direction, not a value", () => {
    const onChange = vi.fn();
    render(<TextSizeControl scale={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Bigger text" }));
    expect(onChange).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Smaller text" }));
    expect(onChange).toHaveBeenCalledWith(-1);
  });

  it("disables the end it cannot go past instead of doing nothing on a tap", () => {
    render(<TextSizeControl scale={TEXT_SCALES[0]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Smaller text" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Bigger text" }).disabled).toBe(false);
    cleanup();
    render(<TextSizeControl scale={TEXT_SCALES[TEXT_SCALES.length - 1]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Bigger text" }).disabled).toBe(true);
  });

  it("is announced as one group rather than two loose letters", () => {
    render(<TextSizeControl scale={1} onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Text size" })).toBeTruthy();
  });
});
