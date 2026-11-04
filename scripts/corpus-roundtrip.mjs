// Round-trip every chapter in a LOCAL export through the studio's converter and schema
// (spec §12.3.1, the merge gate for converter changes). The export holds family prose:
// keep it outside this public repo.
//   node scripts/corpus-roundtrip.mjs /path/to/chapters.json   ([{u, s, n, prose}])
import fs from "node:fs";
import { getSchema } from "@tiptap/core";
import { docToMarkdown, markdownToDoc } from "../src/studio/manuscriptMarkdown.js";
import { MANUSCRIPT_EXTENSIONS } from "../src/studio/schema.js";

const schema = getSchema(MANUSCRIPT_EXTENSIONS);
const chapters = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let ok = 0;
let verbatim = 0;
const failures = [];
for (const c of chapters) {
  const doc = markdownToDoc(c.prose || "");
  verbatim += doc.content.filter((b) => b.attrs.verbatim).length;
  const back = docToMarkdown(schema.nodeFromJSON(doc).toJSON());
  if (back === (c.prose || "")) ok += 1;
  else failures.push(`${c.u}/${c.s}#${c.n}`);
}
console.log(JSON.stringify({ chapters: chapters.length, identical: ok, failures, verbatimBlocks: verbatim }));
process.exit(failures.length ? 1 : 0);
