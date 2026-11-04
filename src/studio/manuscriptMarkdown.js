// Otherwise Studio: Storyforge prose <-> manuscript document (ProseMirror JSON).
//
// ONE converter, used by the studio editor (storyforge-app src/studio/) and by the
// sync worker (ability-supervisor-service cloudflare/otherwise-studio/), which keeps
// a byte-identical copy (see its header there; `npm run check-vendor` compares them).
// No dependencies: plain ESM that runs in a browser, in Node and in a Worker.
//
// THE GUARANTEE (spec §3.1): markdown -> doc -> markdown is byte-identical for every
// chapter. Each chunk of the source (lines between blank-line runs) is parsed, then
// serialized again; if that does not reproduce the chunk exactly, the chunk is kept
// VERBATIM (its text stays editable, with no markup interpretation) instead of being
// "fixed". Audio cues (`<!-- ... -->`) are always lifted into cue chips, verbatim or not.
//
// The schema is flat on purpose (a manuscript, not a page layout):
//   blocks  paragraph, heading{level}, blockquote{prefix}, listItem{marker}, sceneBreak{marker}
//           every block: pid (stable id), gap (the exact whitespace BEFORE it; null = auto),
//           trail (whitespace after the LAST block only), verbatim, splitBy / joinBy (tracked
//           paragraph splits and joins, see suggestions.js)
//   inline  text, hardBreak, audioCue{raw}
//   marks   bold{d}, italic{d}, strike, underline, link{href}; insertion / deletion (tracked
//           changes, attrs {id, author, authorKind, requestedBy, createdAt, batchId}); comment{id}
//
// Serializing has three VIEWS:
//   "base"      what is published: pending insertions are left out, pending deletions kept,
//               suggested splits not made, suggested joins not made.
//   "accepted"  as if every suggestion were accepted (print preview of a draft).
//   "raw"       everything, marks ignored (word counts of what is on screen).

export const FORMAT_MARKS = ["link", "underline", "strike", "bold", "italic"];
export const SUGGESTION_MARKS = ["insertion", "deletion"];
export const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "listItem", "sceneBreak"];

const DEFAULT_GAP = "\n\n";
const SCENE_BREAK_RE = /^(\* \* \*|\*\*\*|-{3,}|_{3,}|#|⁂|~~~|\* \* \* \* \*)$/;
const HEADING_RE = /^(#{1,3}) (.*)$/;
const QUOTE_RE = /^(> ?)(.*)$/;
const LIST_RE = /^([-*+] |\d{1,3}[.)] )(.*)$/;
const ESCAPABLE = "\\*_~<[]#>-+.`";

let pidCounter = 0;
/** A stable block id. Random when crypto is there, else time + counter. */
export function newPid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().slice(0, 13).replace(/-/g, "");
  } catch { /* fall through */ }
  pidCounter += 1;
  return `p${Date.now().toString(36)}${pidCounter.toString(36)}`;
}

// --- inline: parse ---------------------------------------------------------------

function isSpace(ch) {
  return ch === undefined || ch === " " || ch === "\t" || ch === "\n";
}
function isWordChar(ch) {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** Find the closer for delimiter `d` opened at `start` (index of the opener). */
function findCloser(s, start, d) {
  const n = d.length;
  if (isSpace(s[start + n])) return -1;
  for (let k = start + n + 1; k <= s.length - n; k += 1) {
    const ch = s[k];
    if (ch === "\\") { k += 1; continue; }
    if (s.startsWith("<!--", k)) {
      const end = s.indexOf("-->", k + 4);
      if (end < 0) return -1;
      k = end + 2;
      continue;
    }
    if (!s.startsWith(d, k)) continue;
    if (isSpace(s[k - 1])) continue;
    if (n === 1) {
      // A single delimiter does not close inside a double one ("*a **b** c*").
      if (s[k + 1] === d[0]) { k += 1; continue; }
      if (s[k - 1] === d[0] && k - 1 > start) continue;
    }
    if (d[0] === "_" && isWordChar(s[k + n])) continue;
    return k;
  }
  return -1;
}

function markKey(mark) {
  return mark.type + (mark.attrs ? JSON.stringify(mark.attrs) : "");
}

function pushText(out, text, marks) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === "text" && sameMarks(last.marks, marks)) {
    last.text += text;
    return;
  }
  const node = { type: "text", text };
  if (marks.length) node.marks = marks.map((m) => ({ ...m }));
  out.push(node);
}

function sameMarks(a = [], b = []) {
  if (a.length !== b.length) return false;
  const ka = a.map(markKey).sort();
  const kb = b.map(markKey).sort();
  return ka.every((k, i) => k === kb[i]);
}

function withMark(marks, mark) {
  return [...marks.filter((m) => m.type !== mark.type), mark];
}

/** Inline markdown -> ProseMirror inline nodes. `verbatim` keeps everything literal
 *  except audio cues. */
export function parseInline(s, { verbatim = false, marks = [] } = {}) {
  const out = [];
  let buf = "";
  const flush = () => { pushText(out, buf, marks); buf = ""; };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\n") { flush(); out.push({ type: "hardBreak" }); i += 1; continue; }
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end >= 0) {
        flush();
        out.push({ type: "audioCue", attrs: { raw: s.slice(i + 4, end) } });
        i = end + 3;
        continue;
      }
    }
    if (verbatim) { buf += ch; i += 1; continue; }
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (s.startsWith("<u>", i)) {
      const end = s.indexOf("</u>", i + 3);
      if (end > i + 3) {
        flush();
        out.push(...parseInline(s.slice(i + 3, end), { marks: withMark(marks, { type: "underline" }) }));
        i = end + 4;
        continue;
      }
    }
    if (ch === "[") {
      const close = s.indexOf("](", i + 1);
      const end = close >= 0 ? s.indexOf(")", close + 2) : -1;
      if (close > i + 1 && end > close + 2 && !s.slice(i + 1, close).includes("[") && !/\s/.test(s.slice(close + 2, end))) {
        flush();
        out.push(...parseInline(s.slice(i + 1, close), { marks: withMark(marks, { type: "link", attrs: { href: s.slice(close + 2, end) } }) }));
        i = end + 1;
        continue;
      }
    }
    if (s.startsWith("~~", i)) {
      const end = findCloser(s, i, "~~");
      if (end > i + 2) {
        flush();
        out.push(...parseInline(s.slice(i + 2, end), { marks: withMark(marks, { type: "strike" }) }));
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const leftOk = ch === "*" || !isWordChar(s[i - 1]);
      if (leftOk && s.startsWith(ch.repeat(3), i)) {
        const end = findCloser(s, i, ch.repeat(3));
        if (end > i + 3) {
          flush();
          const inner = withMark(withMark(marks, { type: "bold", attrs: { d: ch + ch } }), { type: "italic", attrs: { d: ch } });
          out.push(...parseInline(s.slice(i + 3, end), { marks: inner }));
          i = end + 3;
          continue;
        }
      }
      if (leftOk && s.startsWith(ch + ch, i)) {
        const end = findCloser(s, i, ch + ch);
        if (end > i + 2) {
          flush();
          out.push(...parseInline(s.slice(i + 2, end), { marks: withMark(marks, { type: "bold", attrs: { d: ch + ch } }) }));
          i = end + 2;
          continue;
        }
      }
      if (leftOk) {
        const end = findCloser(s, i, ch);
        if (end > i + 1) {
          flush();
          out.push(...parseInline(s.slice(i + 1, end), { marks: withMark(marks, { type: "italic", attrs: { d: ch } }) }));
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

// --- inline: serialize -------------------------------------------------------------

function openMark(mark) {
  switch (mark.type) {
    case "bold": return mark.attrs?.d || "**";
    case "italic": return mark.attrs?.d || "*";
    case "strike": return "~~";
    case "underline": return "<u>";
    case "link": return "[";
    default: return "";
  }
}
function closeMark(mark) {
  switch (mark.type) {
    case "bold": return mark.attrs?.d || "**";
    case "italic": return mark.attrs?.d || "*";
    case "strike": return "~~";
    case "underline": return "</u>";
    case "link": return `](${mark.attrs?.href || ""})`;
    default: return "";
  }
}

function escapeText(text, atLineStart) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const lineStart = i === 0 ? atLineStart : false;
    if (ch === "\\" || ch === "*" || ch === "_") { out += "\\" + ch; continue; }
    if (ch === "~" && text[i + 1] === "~") { out += "\\~"; continue; }
    if (ch === "<" && (text.startsWith("<!--", i) || text.startsWith("<u>", i))) { out += "\\<"; continue; }
    if (lineStart && (ch === "#" || ch === ">")) { out += "\\" + ch; continue; }
    if (lineStart && (ch === "-" || ch === "+") && text[i + 1] === " ") { out += "\\" + ch; continue; }
    out += ch;
  }
  return out;
}

/** Which marks a node shows in `view`, or null when the node is not shown at all. */
function visibleMarks(node, view) {
  const marks = node.marks || [];
  const ins = marks.some((m) => m.type === "insertion");
  const del = marks.some((m) => m.type === "deletion");
  if (view === "base" && ins) return null;
  if (view === "accepted" && del) return null;
  const order = (m) => FORMAT_MARKS.indexOf(m.type);
  return marks.filter((m) => FORMAT_MARKS.includes(m.type)).sort((a, b) => order(a) - order(b));
}

/** Inline nodes -> markdown. */
export function serializeInline(nodes = [], { verbatim = false, view = "base", lineStart = true } = {}) {
  let out = "";
  let stack = [];
  let atLineStart = lineStart;
  const closeTo = (depth) => {
    while (stack.length > depth) out += closeMark(stack.pop());
  };
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      const marks = visibleMarks(node, view);
      if (marks === null) continue;
      closeTo(0);
      out += "\n";
      atLineStart = true;
      continue;
    }
    if (node.type === "audioCue") {
      if (visibleMarks(node, view) === null) continue;
      closeTo(0);
      out += `<!--${node.attrs?.raw ?? ""}-->`;
      atLineStart = false;
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const marks = verbatim ? [] : visibleMarks(node, view);
    if (marks === null) continue;
    let keep = 0;
    while (keep < stack.length && keep < marks.length && markKey(stack[keep]) === markKey(marks[keep])) keep += 1;
    closeTo(keep);
    for (let k = keep; k < marks.length; k += 1) {
      out += openMark(marks[k]);
      stack.push(marks[k]);
    }
    out += verbatim ? node.text : escapeText(node.text, atLineStart && stack.length === 0);
    atLineStart = false;
  }
  closeTo(0);
  return out;
}

// --- blocks --------------------------------------------------------------------------

function block(type, attrs, content) {
  const node = { type, attrs: { pid: newPid(), gap: null, ...attrs } };
  if (content && content.length) node.content = content;
  return node;
}

/** One chunk (lines with no blank line between them) -> blocks. A heading line, a run
 *  of list lines and a run of quote lines each start their own block; the rest of the
 *  lines are paragraphs (line breaks inside are hard breaks). Blocks inside one chunk
 *  are separated by a single newline (their `gap`). */
function chunkBlocks(chunk) {
  const lines = chunk.split("\n");
  if (lines.length === 1 && SCENE_BREAK_RE.test(lines[0])) return [block("sceneBreak", { marker: lines[0] })];
  const out = [];
  let para = [];
  let quote = null;
  const flushPara = () => {
    if (para.length) out.push(block("paragraph", {}, parseInline(para.join("\n"))));
    para = [];
  };
  const flushQuote = () => {
    if (quote) out.push(block("blockquote", { prefix: quote.prefix }, parseInline(quote.lines.join("\n"))));
    quote = null;
  };
  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    const item = LIST_RE.exec(line);
    const q = QUOTE_RE.exec(line);
    if (heading) {
      flushPara(); flushQuote();
      out.push(block("heading", { level: heading[1].length }, parseInline(heading[2])));
    } else if (item) {
      flushPara(); flushQuote();
      out.push(block("listItem", { marker: item[1] }, parseInline(item[2])));
    } else if (q) {
      flushPara();
      if (quote && quote.prefix !== q[1]) flushQuote();
      if (!quote) quote = { prefix: q[1], lines: [] };
      quote.lines.push(q[2]);
    } else {
      flushQuote();
      para.push(line);
    }
  }
  flushPara(); flushQuote();
  out.forEach((b, i) => { if (i > 0) b.attrs.gap = "\n"; });
  return out;
}

function serializeBlockBody(node, view) {
  const verbatim = Boolean(node.attrs?.verbatim);
  const inline = (lineStart = true) => serializeInline(node.content || [], { verbatim, view, lineStart });
  switch (node.type) {
    case "heading": return `${"#".repeat(Math.min(3, Math.max(1, Number(node.attrs?.level) || 1)))} ${inline(false)}`;
    case "sceneBreak": return node.attrs?.marker || "* * *";
    case "blockquote": {
      const prefix = node.attrs?.prefix ?? "> ";
      return inline(false).split("\n").map((line) => prefix + line).join("\n");
    }
    case "listItem": return `${node.attrs?.marker || "- "}${inline(false)}`;
    default: return inline(true);
  }
}

/** Split source into chunks (runs of non-blank lines) and the exact text between them. */
export function splitChunks(text) {
  const chunks = [];
  const lineRe = /[^\n]*(\n|$)/g;
  let m;
  let cur = null;
  while ((m = lineRe.exec(text)) && m[0] !== "") {
    const start = m.index;
    const line = m[0].endsWith("\n") ? m[0].slice(0, -1) : m[0];
    const blank = /^[ \t]*$/.test(line);
    if (!blank) {
      if (cur && cur.end === start - 1) cur.end = start + line.length;
      else { cur = { start, end: start + line.length }; chunks.push(cur); }
    }
    if (!m[0].endsWith("\n")) break;
  }
  return chunks;
}

/** Storyforge prose (markdown) -> ProseMirror JSON doc. */
export function markdownToDoc(source) {
  const text = String(source ?? "");
  const chunks = splitChunks(text);
  if (!chunks.length) {
    return { type: "doc", content: [block("paragraph", { gap: "", trail: text })] };
  }
  const blocks = [];
  chunks.forEach((c, idx) => {
    const chunk = text.slice(c.start, c.end);
    let parsed = chunkBlocks(chunk);
    const again = parsed.map((b, i) => (i === 0 ? "" : (b.attrs.gap ?? "\n")) + serializeBlockBody(b, "base")).join("");
    if (again !== chunk) parsed = [block("paragraph", { verbatim: true }, parseInline(chunk, { verbatim: true }))];
    parsed[0].attrs.gap = idx === 0 ? text.slice(0, c.start) : text.slice(chunks[idx - 1].end, c.start);
    blocks.push(...parsed);
  });
  blocks[blocks.length - 1].attrs.trail = text.slice(chunks[chunks.length - 1].end);
  return { type: "doc", content: blocks };
}

function autoGap(prev, node) {
  if (prev && prev.type === "listItem" && node.type === "listItem") return "\n";
  return DEFAULT_GAP;
}

/** ProseMirror JSON doc -> Storyforge prose (markdown), in a view (see header). */
export function docToMarkdown(doc, { view = "base" } = {}) {
  const blocks = (doc?.content || []).filter((b) => BLOCK_TYPES.includes(b.type));
  let out = "";
  let prev = null;
  let started = false;
  for (const node of blocks) {
    const attrs = node.attrs || {};
    const body = serializeBlockBody(node, view);
    if (node.type !== "sceneBreak" && body === "") continue; // empty, or wholly hidden in this view
    let gap;
    if (!started) {
      gap = blocks[0]?.attrs?.gap ?? "";
    } else {
      gap = attrs.gap ?? autoGap(prev, node);
      if (view === "base" && attrs.splitBy) gap = "";
      if (view === "accepted" && attrs.joinBy) gap = "";
    }
    out += gap + body;
    started = true;
    prev = node;
  }
  out += blocks[blocks.length - 1]?.attrs?.trail || "";
  return out;
}

// --- helpers used by the studio and the worker ----------------------------------------

/** The plain text of one block, as the reader sees it in `view` (no markup, cues out). */
export function blockPlainText(node, view = "raw") {
  let out = "";
  for (const child of node.content || []) {
    if (child.type === "hardBreak") { out += "\n"; continue; }
    if (child.type !== "text") continue;
    if (view !== "raw" && visibleMarks(child, view) === null) continue;
    out += child.text;
  }
  return out;
}

/** Plain text of the whole doc in `view`, blocks separated by a blank line. */
export function docPlainText(doc, view = "raw") {
  return (doc?.content || []).map((b) => blockPlainText(b, view)).filter(Boolean).join("\n\n");
}

export function countWords(text) {
  const m = String(text || "").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

/** A short stable hash (FNV-1a, hex) -- for "did this text change", never security. */
export function textHash(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Count of pending suggestions (distinct ids) in a doc, by kind of author. */
export function pendingSuggestions(doc) {
  const ids = new Map();
  const visit = (node) => {
    for (const m of node.marks || []) {
      if (SUGGESTION_MARKS.includes(m.type) && m.attrs?.id) ids.set(m.attrs.id, m.attrs);
    }
    for (const key of ["splitBy", "joinBy"]) {
      const s = node.attrs?.[key];
      if (s && s.id) ids.set(s.id, s);
    }
    (node.content || []).forEach(visit);
  };
  visit(doc || {});
  let ability = 0;
  let people = 0;
  let outside = 0;
  for (const attrs of ids.values()) {
    if (attrs.authorKind === "ability") ability += 1;
    else if (attrs.authorKind === "outside") outside += 1;
    else people += 1;
  }
  return { total: ids.size, ability, people, outside };
}
