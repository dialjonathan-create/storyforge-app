/**
 * The map, and the promise it has to keep.
 *
 * "Real maps through a map library with no API key requirement and no tracking
 * — this is a children's app, and a map tile provider that fingerprints devices
 * is not acceptable."
 *
 * That is a testable claim, not a preference, so these tests assert it
 * structurally rather than trusting a comment:
 *
 *   * the style names no `glyphs` and no `sprite` — the two URLs in every stock
 *     MapLibre style that point at somebody else's font and icon server;
 *   * no layer draws text, which is *why* no glyph server is needed;
 *   * every URL in the style is same-origin;
 *   * OpenStreetMap attribution is present, because ODbL requires it and a
 *     children's app is not exempt from a licence;
 *   * MapLibre and the tiles are behind a dynamic import, so a reader who never
 *     opens a map pays nothing for it.
 *
 * The rendering itself is not tested here: jsdom has no WebGL, so MapLibre
 * cannot draw. What a real device shows is stated as unverified in the PR.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

import StoryMap, {
  MAP_REGIONS,
  basemapStyle,
  boundsOf,
  mappablePlaces,
  placeCoordinates,
  regionFor,
} from "../src/StoryMap.jsx";

const SOURCE = fs.readFileSync(path.join(process.cwd(), "src/StoryMap.jsx"), "utf8");
const MAIN = fs.readFileSync(path.join(process.cwd(), "src/main.jsx"), "utf8");
const PKG = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

afterEach(cleanup);

const WELLFLEET = { name: "Wellfleet", lat: 41.9376, lon: -70.0331 };
const BOSTON = { name: "Boston", lat: 42.3601, lon: -71.0589 };

describe("nobody is watching", () => {
  const style = basemapStyle("/maps/cape-cod.pmtiles");

  it("names no font server", () => {
    // `glyphs` is a URL to somebody else's server, present in every stock
    // style. Without a text layer it is never needed, so it is not there.
    expect(style.glyphs).toBeUndefined();
  });

  it("names no icon server", () => {
    expect(style.sprite).toBeUndefined();
  });

  it("draws no text, which is why it needs no font server", () => {
    expect(style.layers.some((l) => l.type === "symbol")).toBe(false);
  });

  it("points every URL at our own origin", () => {
    const urls = JSON.stringify(style).match(/https?:\/\/[^"']+/g) || [];
    // The one absolute URL allowed is the copyright link in the attribution,
    // which is a link a person clicks, not a request the page makes.
    const requested = urls.filter((u) => !u.startsWith("https://www.openstreetmap.org/copyright"));
    expect(requested).toEqual([]);
  });

  it("reads tiles through the pmtiles protocol rather than a tile server", () => {
    expect(style.sources["storyforge-basemap"].url).toBe("pmtiles:///maps/cape-cod.pmtiles");
  });

  it("carries no API key anywhere", () => {
    expect(SOURCE).not.toMatch(/accessToken|apiKey|api_key|[?&]key=/);
  });

  it("uses MapLibre, not Mapbox GL JS", () => {
    // Mapbox GL JS from v2 requires a token and posts telemetry of its own.
    expect(PKG.dependencies["maplibre-gl"]).toBeTruthy();
    expect(PKG.dependencies["mapbox-gl"]).toBeUndefined();
  });

  it("stays on the MapLibre major that the PMTiles reader can actually talk to", () => {
    // Verified by rendering: with maplibre-gl 6 the style never finishes
    // loading, no tile is ever requested, and NO ERROR IS RAISED -- the map is
    // simply a dark rectangle forever. pmtiles 4.5 speaks v4/v5's protocol
    // contract. A silent failure is worth a pin.
    expect(PKG.dependencies["maplibre-gl"]).toMatch(/^\^?5\./);
  });

  it("imports the library by namespace, because v5 has no default export", () => {
    expect(SOURCE).toContain("const [maplibregl, pmtiles] = await Promise.all([");
    expect(SOURCE).not.toContain("{ default: maplibregl }");
  });

  it("shows the OpenStreetMap attribution, because the licence is not optional", () => {
    expect(style.sources["storyforge-basemap"].attribution).toContain("OpenStreetMap");
  });
});

describe("the tiles ship with the app", () => {
  it("every region points at a file in our own public folder", () => {
    for (const region of MAP_REGIONS) {
      expect(region.url.startsWith("/maps/")).toBe(true);
    }
  });

  it("the archive each region names is actually there", () => {
    // A region entry with no file behind it is a grey square on a real phone
    // and a passing test everywhere else.
    for (const region of MAP_REGIONS) {
      const file = path.join(process.cwd(), "public", region.url.replace(/^\//, ""));
      expect(fs.existsSync(file), `${region.url} is missing`).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(50_000);
    }
  });

  it("the service worker does not intercept them", () => {
    // PMTiles reads by HTTP range request. A cache-first handler that returned
    // a whole file for a ranged request would break the map silently, so
    // /maps/ is deliberately left alone.
    const sw = fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
    expect(sw).not.toContain("/maps/");
  });

  it("loads the library only when a map is opened", () => {
    expect(SOURCE).toContain('import("maplibre-gl")');
    expect(SOURCE).not.toMatch(/^import maplibregl from/m);
  });
});

describe("reading a place out of the bible", () => {
  it("takes lat/lon", () => {
    expect(placeCoordinates({ lat: 41.9, lon: -70 })).toEqual({ lat: 41.9, lon: -70 });
  });

  it("takes latitude/longitude and lng, because the bible is hand-written", () => {
    expect(placeCoordinates({ latitude: 41.9, longitude: -70 })).toEqual({ lat: 41.9, lon: -70 });
    expect(placeCoordinates({ lat: 41.9, lng: -70 })).toEqual({ lat: 41.9, lon: -70 });
  });

  it("takes a GeoJSON-order pair", () => {
    expect(placeCoordinates({ coordinates: [-70, 41.9] })).toEqual({ lat: 41.9, lon: -70 });
  });

  it("refuses a place that does not say where it is", () => {
    expect(placeCoordinates({ name: "The Museum of Almost" })).toBeNull();
    expect(placeCoordinates("Wellfleet")).toBeNull();
    expect(placeCoordinates(null)).toBeNull();
  });

  it("refuses coordinates that are not on Earth", () => {
    expect(placeCoordinates({ lat: 91, lon: 0 })).toBeNull();
    expect(placeCoordinates({ lat: 0, lon: 181 })).toBeNull();
    expect(placeCoordinates({ lat: "north", lon: "west" })).toBeNull();
  });

  it("keeps only the locations that can be drawn", () => {
    const places = mappablePlaces([
      "The Museum of Almost",
      { name: "Wellfleet", lat: 41.9376, lon: -70.0331 },
      { name: "Somewhere", description: "no coordinates" },
    ]);
    expect(places.map((p) => p.name)).toEqual(["Wellfleet"]);
  });

  it("survives a bible with no locations at all", () => {
    expect(mappablePlaces(undefined)).toEqual([]);
    expect(mappablePlaces([])).toEqual([]);
  });
});

describe("picking a region", () => {
  it("finds the one that contains every place", () => {
    expect(regionFor([WELLFLEET, BOSTON])?.id).toBe("cape-cod");
  });

  it("returns nothing rather than a wrong map when a place is outside", () => {
    // Waianae is not on Cape Cod. Showing the Cape with no pin visible is
    // worse than saying so.
    expect(regionFor([{ name: "Waianae", lat: 21.4381, lon: -158.1861 }])).toBeNull();
    expect(regionFor([WELLFLEET, { name: "Waianae", lat: 21.4381, lon: -158.1861 }])).toBeNull();
  });

  it("returns nothing for no places", () => {
    expect(regionFor([])).toBeNull();
  });

  it("frames all the places with room around them", () => {
    const [[west, south], [east, north]] = boundsOf([WELLFLEET, BOSTON]);
    expect(west).toBeLessThan(-71.05);
    expect(east).toBeGreaterThan(-70.03);
    expect(south).toBeLessThan(41.94);
    expect(north).toBeGreaterThan(42.36);
  });
});

describe("the places are named under the map, not on it", () => {
  it("numbers the pins and lists the names below", () => {
    // The first version drew each name on the map. "Where the Whydah went
    // down" ran off the right edge and printed on top of "Wellfleet", four
    // miles away. Verified by screenshot, then fixed.
    render(<StoryMap places={[WELLFLEET, BOSTON]} />);
    const items = document.querySelectorAll(".story-map-legend li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("1");
    expect(items[0].textContent).toContain("Wellfleet");
    expect(items[1].textContent).toContain("Boston");
  });

  it("draws no text inside the map element", () => {
    // Which is what makes the overflow impossible rather than unlikely.
    expect(SOURCE).not.toContain("story-map-label");
    expect(SOURCE).toContain('pin.textContent = String(index + 1);');
  });

  it("keeps the map readable to a screen reader", () => {
    render(<StoryMap places={[WELLFLEET, BOSTON]} />);
    expect(document.querySelector(".story-map").getAttribute("aria-label")).toBe("Map of Wellfleet, Boston");
  });
});

describe("what a reader sees when there is no map to show", () => {
  it("renders nothing at all when no place has coordinates", () => {
    const { container } = render(<StoryMap places={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("says so, in a sentence, when the place is off our maps", () => {
    render(<StoryMap places={[{ name: "Waianae", lat: 21.4381, lon: -158.1861 }]} />);
    expect(screen.getByText(/outside the maps this story carries/)).toBeTruthy();
  });

  it("names the place rather than being cryptic about it", () => {
    render(<StoryMap places={[{ name: "Waianae", lat: 21.4381, lon: -158.1861 }]} />);
    expect(screen.getByText(/Waianae is/)).toBeTruthy();
  });
});

describe("where it appears", () => {
  it("is one map for the story, above its Locations", () => {
    // Not one map per location: that is the same 2.5 MB fetched five times and
    // five things to tap.
    expect(MAIN).toContain("<StoryMap places={mappablePlaces(bible.locations)} />");
    expect(MAIN.match(/<StoryMap/g).length).toBe(1);
  });

  it("lets a finger scroll the page through it", () => {
    // A map that swallows the scroll halfway down a lore page is how a
    // seven-year-old gets stuck.
    const css = fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
    const start = css.indexOf(".story-map {");
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf("}", start))).toContain("touch-action: pan-y");
    expect(SOURCE).toContain("scrollZoom: false");
  });
});
