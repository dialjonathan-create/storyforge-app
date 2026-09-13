/**
 * Real places, on a real map, with nobody watching.
 *
 * Field Notes is a story about a family following a three-hundred-year-old
 * wreck around a real coastline. "Wellfleet" in the bible is a word; the point
 * of a map is that a seven-year-old can see it is a real place, forty miles
 * from a fort that was never built.
 *
 * WHY THIS STACK
 *
 * Every commercial map SDK is disqualified by the same sentence: this is a
 * children's app. Google, Apple and Mapbox all require a key tied to a billing
 * account, and Mapbox GL JS from v2 also posts telemetry events on its own.
 * A key is an identifier, and an identifier plus a tile request is a record of
 * which child looked at which place, held by somebody else.
 *
 *   * **Library: MapLibre GL JS.** The BSD-licensed fork of Mapbox GL JS from
 *     before the license change, with the telemetry taken out. No token, no
 *     home to phone.
 *   * **Tiles: Protomaps PMTiles, served by this app.** One static file in
 *     `public/maps/`, read by HTTP range requests straight off Firebase
 *     Hosting, which already serves every other byte of Storyforge. No tile
 *     server, no third-party host, no request that leaves our own origin.
 *
 * OpenFreeMap was the close second and says, truthfully, "no registration, no
 * user database, no API keys, and no cookies." It is still a third party that
 * would see every reader's IP address on every tile, and it is funded by
 * donations. A map in a children's book should not stop working because
 * somebody else's hosting bill lapsed. Self-hosting makes "nobody is watching"
 * a property of the architecture rather than a promise in a README.
 *
 * NO TEXT IN THE TILES
 *
 * The style below draws no labels at all, which is not a limitation — it is the
 * reason there are no font files to fetch. MapLibre only needs `glyphs` (a
 * third-party font server, in every stock style) if a layer draws text. The
 * place names on this map are the story's own, rendered as ordinary HTML
 * markers in the app's typeface. So: zero external requests, and the labels say
 * "Where the Whydah went down" instead of a road classification.
 *
 * Data © OpenStreetMap contributors, ODbL. The attribution is shown on the map
 * and is not optional.
 */

import React, { useEffect, useRef, useState } from "react";

// Protomaps basemap v4 layer names, read out of the archive's own metadata
// rather than guessed: earth, water, landcover, landuse, roads, boundaries,
// buildings, places, pois.
const SOURCE = "storyforge-basemap";

/**
 * The regions we carry tiles for.
 *
 * A place outside every region gets an honest sentence instead of an empty
 * grey square. Adding a region is one extract and one entry here.
 */
export const MAP_REGIONS = [
  {
    id: "cape-cod",
    label: "Cape Cod and Massachusetts Bay",
    url: "/maps/cape-cod.pmtiles",
    // west, south, east, north — the bbox the archive was extracted with.
    // Boston is inside it on purpose: the Whydah's survivors were tried there,
    // so the story needs both ends of the same coastline on one map.
    bounds: [-71.25, 41.5, -69.9, 42.5],
  },
];

export function placeCoordinates(place) {
  if (!place || typeof place !== "object") return null;
  const pair = Array.isArray(place.coordinates) ? place.coordinates : null;
  const lon = Number(place.lon ?? place.lng ?? place.longitude ?? (pair ? pair[0] : NaN));
  const lat = Number(place.lat ?? place.latitude ?? (pair ? pair[1] : NaN));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Every bible location that actually says where it is.
 *
 * `bible.locations` is a STRING in some live universes -- the-embodied-age is
 * one -- which is the shape that took the whole app down before #1552. Anything
 * that is not a list of objects has no coordinates in it by definition, so it
 * maps to no pins rather than to a crash.
 */
export function mappablePlaces(locations) {
  if (!Array.isArray(locations)) return [];
  return (locations || [])
    .map((entry) => {
      const place = typeof entry === "string" ? null : entry;
      const at = placeCoordinates(place);
      if (!at) return null;
      return { name: place.name || "Here", description: place.description || "", ...at };
    })
    .filter(Boolean);
}

export function regionFor(places, regions = MAP_REGIONS) {
  if (!places || !places.length) return null;
  return regions.find((region) => {
    const [west, south, east, north] = region.bounds;
    return places.every((p) => p.lon >= west && p.lon <= east && p.lat >= south && p.lat <= north);
  }) || null;
}

export function boundsOf(places, padding = 0.04) {
  const lons = places.map((p) => p.lon);
  const lats = places.map((p) => p.lat);
  return [
    [Math.min(...lons) - padding, Math.min(...lats) - padding],
    [Math.max(...lons) + padding, Math.max(...lats) + padding],
  ];
}

/**
 * A label-free basemap in the app's own colours.
 *
 * Deliberately no `glyphs` and no `sprite` key: both are URLs to somebody
 * else's server, and without a text or icon layer neither is ever needed.
 */
export function basemapStyle(url) {
  return {
    version: 8,
    sources: {
      [SOURCE]: {
        type: "vector",
        url: `pmtiles://${url}`,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": "#0b1a24" } },
      { id: "land", type: "fill", source: SOURCE, "source-layer": "earth", paint: { "fill-color": "#16262f" } },
      { id: "green", type: "fill", source: SOURCE, "source-layer": "landcover", paint: { "fill-color": "#1a2e30", "fill-opacity": 0.75 } },
      { id: "built", type: "fill", source: SOURCE, "source-layer": "landuse", paint: { "fill-color": "#1d2c36", "fill-opacity": 0.6 } },
      { id: "water", type: "fill", source: SOURCE, "source-layer": "water", paint: { "fill-color": "#0b1a24" } },
      {
        id: "road",
        type: "line",
        source: SOURCE,
        "source-layer": "roads",
        paint: {
          "line-color": "#2c4150",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 12, 1.4, 16, 3],
        },
      },
      {
        id: "border",
        type: "line",
        source: SOURCE,
        "source-layer": "boundaries",
        paint: { "line-color": "#38505f", "line-width": 0.6, "line-dasharray": [3, 2] },
      },
    ],
  };
}

/**
 * The map itself.
 *
 * MapLibre and the PMTiles reader are ~250 kB of JavaScript between them, so
 * they are imported only when a map is actually opened. A reader who never taps
 * a place never downloads them, and never downloads the 2.5 MB of tiles either.
 */
export default function StoryMap({ places, height = 260 }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const [failed, setFailed] = useState(null);
  const usable = (places || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  const region = regionFor(usable);

  useEffect(() => {
    if (!usable.length || !region || !container.current) return undefined;
    let cancelled = false;
    let map = null;

    (async () => {
      try {
        // The stylesheet is loaded with the library, not with the app: it is
        // ~40 kB that a reader who never opens a map should never fetch.
        //
        // A namespace import, not a default one: maplibre-gl v6 is ESM with
        // named exports and NO default. `import maplibregl from "maplibre-gl"`
        // -- which is what every tutorial written against v4 says -- yields
        // undefined and fails at the first property access.
        const [maplibregl, pmtiles] = await Promise.all([
          import("maplibre-gl"),
          import("pmtiles"),
          import("maplibre-gl/dist/maplibre-gl.css"),
        ]);
        if (cancelled) return;
        // Registering twice is harmless, and a second map on another screen
        // must not race the first one's registration.
        if (!StoryMap._protocolRegistered) {
          const protocol = new pmtiles.Protocol();
          maplibregl.addProtocol("pmtiles", protocol.tile);
          StoryMap._protocolRegistered = true;
        }
        map = new maplibregl.Map({
          container: container.current,
          style: basemapStyle(region.url),
          bounds: boundsOf(usable),
          fitBoundsOptions: { padding: 28, maxZoom: 12 },
          attributionControl: { compact: true },
          // A map inside a scrolling chapter must not eat the scroll.
          scrollZoom: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.on("error", (event) => {
          // A missing tile is not worth a blank panel, but a missing archive is
          // worth saying out loud.
          if (String(event?.error?.message || "").includes("404")) setFailed("The map for this place has not been added yet.");
        });
        // Numbered pins, names underneath.
        //
        // The first version drew each name on the map. "Where the Whydah went
        // down" is a place name in this story, and it ran off the edge of the
        // map and printed on top of "Wellfleet", which is four miles away. A
        // number on the pin and the name in a list below cannot collide,
        // cannot be clipped, and is how a real map does it.
        usable.forEach((place, index) => {
          const pin = document.createElement("div");
          pin.className = "story-map-pin";
          pin.textContent = String(index + 1);
          pin.setAttribute("aria-hidden", "true");
          new maplibregl.Marker({ element: pin, anchor: "center" })
            .setLngLat([place.lon, place.lat])
            .addTo(map);
        });
        mapRef.current = map;
      } catch (error) {
        if (!cancelled) setFailed("The map could not load on this device.");
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      } else if (map) {
        map.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(usable), region?.id]);

  if (!usable.length) return null;
  if (!region) {
    // Honest beats empty. An unmapped place is a missing extract, not a bug in
    // the reader's phone.
    return (
      <p className="story-map-note">
        {usable.length === 1 ? `${usable[0].name} is` : "These places are"} outside the maps this story
        carries.
      </p>
    );
  }
  return (
    <figure className="story-map-figure">
      <div className="story-map" style={{ height }} ref={container} role="img" aria-label={`Map of ${usable.map((p) => p.name).join(", ")}`} />
      <figcaption>
        <ol className="story-map-legend">
          {usable.map((place, index) => (
            <li key={`${place.name}-${index}`}>
              <span className="story-map-index" aria-hidden="true">{index + 1}</span>
              <span className="story-map-place">{place.name}</span>
            </li>
          ))}
        </ol>
        {failed && <span className="story-map-note">{failed}</span>}
      </figcaption>
    </figure>
  );
}
