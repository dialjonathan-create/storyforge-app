// The studio must not grow the reader (spec §12.1): the editor lives in its own lazy chunk
// (<= 350 KB gzipped) and the entry chunk the kids' iPad loads carries none of it.
//   npm run build && npm run budget
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIST = path.resolve(process.argv[2] || "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, ".vite", "manifest.json"), "utf8"));
const entry = Object.values(manifest).find((m) => m.isEntry);
const studio = Object.values(manifest).find((m) => m.src && m.src.includes("studio/StudioApp"));
const gz = (file) => zlib.gzipSync(fs.readFileSync(path.join(DIST, file))).length;
const problems = [];
if (!studio || !studio.isDynamicEntry) problems.push("the studio is not a lazy chunk");
const studioKb = studio ? gz(studio.file) / 1024 : 0;
if (studioKb > 350) problems.push(`studio chunk ${studioKb.toFixed(0)} KB gzipped > 350 KB`);
const entryCode = fs.readFileSync(path.join(DIST, entry.file), "utf8");
for (const marker of ["@tiptap", "y-prosemirror", "prosemirror-view", "ySyncPlugin", "IndexeddbPersistence"]) {
  if (entryCode.includes(marker)) problems.push(`the reader's entry chunk contains ${marker}`);
}
console.log(JSON.stringify({ entryKb: +(gz(entry.file) / 1024).toFixed(1), studioKb: +studioKb.toFixed(1), problems }));
process.exit(problems.length ? 1 : 0);
