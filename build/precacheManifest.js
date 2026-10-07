// Otherwise r4 R4-08 (2026-10-07): the service worker cached the app SHELL on
// install, but the JS/CSS bundle only when a later request happened to pass
// through it. The page that registers the worker has already loaded its bundle
// by then -- uncontrolled -- so a first visit followed by going offline reloaded
// into index.html pointing at /assets/index-<hash>.js the cache never saw: a
// blank screen. The bundle is now named at BUILD time, from Vite's own manifest
// (build.manifest), and written into dist/sw.js so install caches it.
//
// Its own module, not vite.config.js: the tests import it under jsdom.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PRECACHE_MARKER = "/*__PRECACHE__*/[]";
export const BUILD_MARKER = "/*__BUILD__*/\"dev\"";

/** The files index.html needs to start: the entry chunk, every chunk it
 *  imports statically, and their CSS. (Lazy chunks load on demand, online.) */
export function precacheList(manifest) {
  const out = new Set();
  const seen = new Set();
  const visit = (key) => {
    const entry = manifest[key];
    if (!entry || seen.has(key)) return;
    seen.add(key);
    if (entry.file) out.add(`/${entry.file}`);
    for (const css of entry.css || []) out.add(`/${css}`);
    for (const imported of entry.imports || []) visit(imported);
  };
  for (const [key, entry] of Object.entries(manifest || {})) {
    if (entry && entry.isEntry) visit(key);
  }
  return [...out].sort();
}

/** `sw` with the precache list and a build id written in. */
export function injectPrecache(sw, files, buildId) {
  if (!sw.includes(PRECACHE_MARKER) || !sw.includes(BUILD_MARKER)) {
    throw new Error("sw.js is missing the __PRECACHE__ / __BUILD__ markers");
  }
  return sw.replace(PRECACHE_MARKER, JSON.stringify(files)).replace(BUILD_MARKER, JSON.stringify(buildId));
}

export function precacheManifest() {
  let outDir = "dist";
  return {
    name: "storyforge-precache-manifest",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const manifestPath = [path.join(outDir, ".vite", "manifest.json"), path.join(outDir, "manifest.json")]
        .find((candidate) => existsSync(candidate));
      if (!manifestPath) throw new Error("precache: Vite manifest not found -- build.manifest must be on");
      const files = precacheList(JSON.parse(readFileSync(manifestPath, "utf8")));
      if (!files.some((file) => file.endsWith(".js"))) throw new Error("precache: no entry bundle in the manifest");
      const swPath = path.join(outDir, "sw.js");
      const buildId = files.map((file) => path.basename(file)).join("|").replace(/[^A-Za-z0-9|._-]/g, "").slice(0, 200);
      writeFileSync(swPath, injectPrecache(readFileSync(swPath, "utf8"), files, buildId));
    },
  };
}
