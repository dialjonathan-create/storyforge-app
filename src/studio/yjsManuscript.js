// Otherwise Studio: the manuscript inside a Y.Doc, without ProseMirror.
//
// Shared by the browser and the sync worker (cloudflare/otherwise-studio keeps a
// byte-identical copy; `npm run check-vendor` there compares). Depends only on yjs.
//
// It reads and writes the SAME encoding y-prosemirror uses (spec §6.2, spike 1):
//   * the document is the Y.XmlFragment "prosemirror";
//   * a block is a Y.XmlElement named after its node type, its attributes set
//     (null attributes are simply absent);
//   * a block's inline content is a sequence of Y.XmlText (runs of text, each mark a
//     formatting attribute `{markName: markAttrs}`) and Y.XmlElement (hardBreak, audioCue).
// Because of that, Ability's edits can be applied HEADLESSLY in the worker, as plain Yjs
// transactions, and every connected editor shows them as ordinary suggestions.
import * as Y from "yjs";
import { newPid, parseInline } from "./manuscriptMarkdown.js";

export const FRAGMENT = "prosemirror";
export const COMMENTS = "comments";
export const META = "meta";

const INLINE_ELEMENTS = new Set(["hardBreak", "audioCue"]);

function markName(key) {
  const i = key.indexOf("--");
  return i >= 0 ? key.slice(0, i) : key;
}

function attrsToMarks(attributes) {
  if (!attributes) return undefined;
  const marks = Object.keys(attributes).map((key) => {
    const attrs = attributes[key];
    const mark = { type: markName(key) };
    if (attrs && typeof attrs === "object" && Object.keys(attrs).length) mark.attrs = { ...attrs };
    return mark;
  });
  return marks.length ? marks : undefined;
}

function marksToAttrs(marks) {
  const out = {};
  for (const m of marks || []) out[m.type] = m.attrs ? { ...m.attrs } : {};
  return out;
}

/** Y.XmlFragment -> ProseMirror JSON (the shape manuscriptMarkdown.js reads). */
export function yFragmentToDoc(fragment) {
  const content = [];
  fragment.toArray().forEach((el) => {
    if (!(el instanceof Y.XmlElement)) return;
    const attrs = el.getAttributes();
    const node = { type: el.nodeName, attrs: { ...attrs } };
    const inline = [];
    el.toArray().forEach((child) => {
      if (child instanceof Y.XmlText) {
        for (const d of child.toDelta()) {
          if (typeof d.insert !== "string" || !d.insert) continue;
          const t = { type: "text", text: d.insert };
          const marks = attrsToMarks(d.attributes);
          if (marks) t.marks = marks;
          inline.push(t);
        }
      } else if (child instanceof Y.XmlElement) {
        const n = { type: child.nodeName };
        const a = child.getAttributes();
        if (Object.keys(a).length) n.attrs = { ...a };
        inline.push(n);
      }
    });
    if (inline.length) node.content = inline;
    content.push(node);
  });
  if (!content.length) content.push({ type: "paragraph", attrs: { pid: newPid() } });
  return { type: "doc", content };
}

function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value !== null && value !== undefined) el.setAttribute(key, value);
  }
}

function inlineToY(nodes) {
  const out = [];
  let text = null;
  for (const n of nodes || []) {
    if (n.type === "text") {
      if (!text) { text = new Y.XmlText(); out.push({ text, delta: [] }); }
      out[out.length - 1].delta.push({ insert: n.text, attributes: marksToAttrs(n.marks) });
    } else {
      text = null;
      const el = new Y.XmlElement(n.type);
      out.push({ el, attrs: n.attrs || {} });
    }
  }
  return out;
}

function blockToY(node) {
  const el = new Y.XmlElement(node.type);
  setAttrs(el, node.attrs);
  const parts = inlineToY(node.content);
  el.insert(0, parts.map((p) => p.text || p.el));
  parts.forEach((p) => {
    if (p.text) p.text.applyDelta(p.delta);
    else setAttrs(p.el, p.attrs);
  });
  return el;
}

/** Replace the fragment's content with a ProseMirror JSON doc (seeding a new draft). */
export function writeDocToFragment(fragment, doc) {
  const ydoc = fragment.doc;
  const run = () => {
    if (fragment.length) fragment.delete(0, fragment.length);
    fragment.insert(0, (doc?.content || []).map(blockToY));
  };
  if (ydoc) ydoc.transact(run, "seed");
  else run();
}

// --- Ability's operations, headless ----------------------------------------------------

function findBlock(fragment, pid) {
  const items = fragment.toArray();
  for (let i = 0; i < items.length; i += 1) {
    const el = items[i];
    if (el instanceof Y.XmlElement && el.getAttribute("pid") === pid) return { el, index: i };
  }
  return null;
}

/** The block's text as it reads now (pending deletions left out), mapped to (XmlText, index). */
function readable(el) {
  let text = "";
  const map = [];
  el.toArray().forEach((child) => {
    if (child instanceof Y.XmlText) {
      let index = 0;
      for (const d of child.toDelta()) {
        const s = typeof d.insert === "string" ? d.insert : "";
        const deleted = d.attributes && Object.keys(d.attributes).some((k) => markName(k) === "deletion");
        if (!deleted) {
          for (let i = 0; i < s.length; i += 1) map.push({ ytext: child, index: index + i, attrs: d.attributes || {} });
          text += s;
        }
        index += s.length;
      }
    } else if (child instanceof Y.XmlElement) {
      map.push({ ytext: null });
      text += child.nodeName === "hardBreak" ? "\n" : "￼";
    }
  });
  return { text, map };
}

function locate(el, quote) {
  const q = String(quote || "");
  if (!q) return null;
  const { text, map } = readable(el);
  const at = text.indexOf(q);
  if (at < 0) return null;
  const first = map[at];
  const last = map[at + q.length - 1];
  if (!first?.ytext || first.ytext !== last?.ytext) return null; // spans a cue or line break: not applied blind
  return { ytext: first.ytext, from: first.index, to: last.index + 1, attrs: first.attrs };
}

function formatOnly(attrs) {
  const out = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    const n = markName(k);
    if (n !== "insertion" && n !== "deletion" && n !== "comment") out[k] = v;
  }
  return out;
}

function runsOf(ytext, from, to) {
  const runs = [];
  let index = 0;
  for (const d of ytext.toDelta()) {
    const len = typeof d.insert === "string" ? d.insert.length : 1;
    const a = Math.max(from, index);
    const b = Math.min(to, index + len);
    if (b > a) runs.push({ from: a, to: b, attrs: d.attributes || {} });
    index += len;
  }
  return runs;
}

function has(attrs, name) {
  return Object.keys(attrs || {}).some((k) => markName(k) === name);
}

/** Mark [from, to) of ytext removed (suggest) -- a pending insertion inside is deleted for real. */
function suggestDelete(ytext, from, to, sattrs) {
  const runs = runsOf(ytext, from, to).reverse();
  let removed = 0;
  for (const r of runs) {
    if (has(r.attrs, "insertion")) { ytext.delete(r.from, r.to - r.from); removed += r.to - r.from; }
    else if (!has(r.attrs, "deletion")) ytext.format(r.from, r.to - r.from, { deletion: sattrs });
  }
  return to - removed;
}

function insertRuns(ytext, at, text, extraAttrs, inherit) {
  let pos = at;
  for (const n of parseInline(String(text || ""))) {
    if (n.type !== "text") continue; // a cue or line break inside a suggestion is not inserted headlessly
    const attrs = { ...inherit, ...marksToAttrs(n.marks), ...extraAttrs };
    ytext.insert(pos, n.text, attrs);
    pos += n.text.length;
  }
  return pos;
}

/**
 * Apply Ability's operations to the Y.Doc in ONE transaction (origin "ability").
 * ops: [{op: "replace"|"insert_after"|"comment", pid, quote, text, body}]
 * Returns {applied, comments: [{id, pid, quote, body, stale}], batchId}.
 */
export function applyOpsToYDoc(ydoc, ops, { mode = "suggest", requestedBy = null, batchId = null, now = new Date().toISOString(), idFor } = {}) {
  const fragment = ydoc.getXmlFragment(FRAGMENT);
  const comments = ydoc.getMap(COMMENTS);
  const batch = batchId || `b_${Math.random().toString(36).slice(2, 10)}`;
  const sattrs = { id: (idFor ? idFor("s") : `s_${Math.random().toString(36).slice(2, 14)}`), author: "ability", authorKind: "ability", requestedBy, createdAt: now, batchId: batch };
  const applied = [];
  const notes = [];
  const commentId = () => (idFor ? idFor("c") : `c_${Math.random().toString(36).slice(2, 14)}`);
  const stale = (op) => {
    const what = op.op === "insert_after" ? "adding a passage here" : `changing "${String(op.quote || "").slice(0, 80)}"`;
    const to = op.text ? ` to "${String(op.text).slice(0, 200)}"` : "";
    return { id: commentId(), pid: op.pid, quote: op.quote || "", body: `I suggested ${what}${to}, but the text changed before it arrived. Apply it yourself if it still fits.`, stale: true };
  };
  ydoc.transact(() => {
    for (const op of ops || []) {
      const hit = findBlock(fragment, op.pid);
      if (!hit) { notes.push(stale(op)); continue; }
      if (op.op === "comment") {
        const id = commentId();
        const loc = locate(hit.el, op.quote);
        if (loc) loc.ytext.format(loc.from, loc.to - loc.from, { comment: { id } });
        notes.push({ id, pid: op.pid, quote: op.quote || "", body: String(op.body || op.text || ""), stale: Boolean(op.quote) && !loc });
        applied.push(op);
        continue;
      }
      if (op.op === "replace") {
        const loc = locate(hit.el, op.quote);
        if (!loc) { notes.push(stale(op)); continue; }
        const inherit = formatOnly(loc.attrs);
        if (mode === "direct") {
          loc.ytext.delete(loc.from, loc.to - loc.from);
          insertRuns(loc.ytext, loc.from, op.text, {}, inherit);
        } else {
          const end = suggestDelete(loc.ytext, loc.from, loc.to, sattrs);
          insertRuns(loc.ytext, end, op.text, { insertion: sattrs }, inherit);
        }
        applied.push(op);
        continue;
      }
      if (op.op === "insert_after") {
        const paragraphs = String(op.text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        if (!paragraphs.length) continue;
        const els = paragraphs.map(() => {
          const el = new Y.XmlElement("paragraph");
          el.setAttribute("pid", newPid());
          if (mode !== "direct") el.setAttribute("splitBy", sattrs);
          return el;
        });
        fragment.insert(hit.index + 1, els);
        els.forEach((el, i) => {
          const t = new Y.XmlText();
          el.insert(0, [t]);
          insertRuns(t, 0, paragraphs[i], mode === "direct" ? {} : { insertion: sattrs }, {});
        });
        applied.push(op);
      }
    }
    for (const c of notes) {
      comments.set(c.id, { ...c, author: "ability", authorKind: "ability", requestedBy, createdAt: now, resolved: false, replies: [] });
    }
  }, "ability");
  return { applied, comments: notes, batchId: batch, suggestionId: sattrs.id };
}

// --- outside changes (reader reshape, iOS, chat's chapter save, a restore) -----------

function words(text) {
  return String(text || "").match(/\s+|[^\s]+/g) || [];
}

/** Word-level LCS diff: [{op: "eq"|"del"|"ins", text}]. */
export function wordDiff(a, b) {
  const x = words(a);
  const y = words(b);
  const n = x.length;
  const m = y.length;
  if (n * m > 4_000_000) return [{ op: "del", text: a }, { op: "ins", text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  const push = (op, text) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push("eq", x[i]); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", x[i]); i += 1; }
    else { push("ins", y[j]); j += 1; }
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("ins", y[j++]);
  return out;
}

/**
 * Bring an outside change to the published chapter into the draft AS SUGGESTIONS
 * authored by its source (spec §3.5): a three-way merge of old published (`oldDoc`),
 * new published (`newDoc`) and the live draft. A block the draft still holds exactly as
 * it was published gets the outside edits as word-level suggestions; a block the draft
 * has changed meanwhile gets a comment instead -- nothing is overwritten either way.
 * Docs are ProseMirror JSON; `plain(block)` is a block's plain text.
 */
export function applyOutsideChange(ydoc, oldDoc, newDoc, { source = "Changed outside the studio", now = new Date().toISOString(), plain, idFor } = {}) {
  const fragment = ydoc.getXmlFragment(FRAGMENT);
  const comments = ydoc.getMap(COMMENTS);
  const sattrs = { id: idFor ? idFor("s") : `s_${Math.random().toString(36).slice(2, 14)}`, author: source, authorKind: "outside", requestedBy: null, createdAt: now, batchId: `out_${Date.now().toString(36)}` };
  const oldBlocks = (oldDoc?.content || []).map(plain);
  const newBlocks = (newDoc?.content || []).map(plain);
  const ops = blockDiff(oldBlocks, newBlocks);
  let suggested = 0;
  let commented = 0;
  ydoc.transact(() => {
    const draft = () => fragment.toArray().filter((el) => el instanceof Y.XmlElement);
    const draftBase = (el) => plain(yBlockToJson(el), "base");
    const findDraft = (text) => draft().find((el) => draftBase(el) === text) || null;
    let anchor = null; // the draft block the next insertion goes after
    for (const op of ops) {
      if (op.op === "eq") { anchor = findDraft(op.old) || anchor; continue; }
      if (op.op === "change") {
        const el = findDraft(op.old);
        if (!el) {
          const id = idFor ? idFor("c") : `c_${Math.random().toString(36).slice(2, 14)}`;
          comments.set(id, { id, pid: anchor?.getAttribute("pid") || null, quote: op.old.slice(0, 120), body: `${source}: this paragraph now reads "${op.new.slice(0, 400)}". Your draft had changed it too, so nothing was replaced.`, author: source, authorKind: "outside", createdAt: now, resolved: false, replies: [] });
          commented += 1;
          continue;
        }
        const kids = el.toArray();
        const ytext = kids.length === 1 && kids[0] instanceof Y.XmlText ? kids[0] : null;
        if (!ytext) {
          // A cue or a line break inside: word offsets would not line up. Said, not applied.
          const id = idFor ? idFor("c") : `c_${Math.random().toString(36).slice(2, 14)}`;
          comments.set(id, { id, pid: el.getAttribute("pid"), quote: op.old.slice(0, 120), body: `${source}: this paragraph now reads "${op.new.slice(0, 400)}".`, author: source, authorKind: "outside", createdAt: now, resolved: false, replies: [] });
          commented += 1;
        } else {
          // Walk the diff from the end so indexes before stay valid.
          const diff = wordDiff(op.old, op.new);
          const pieces = [];
          let at = 0;
          for (const d of diff) { pieces.push({ ...d, at }); if (d.op !== "ins") at += d.text.length; }
          const toY = baseIndexMap(ytext);
          for (const d of pieces.reverse()) {
            if (d.op === "del") { ytext.format(toY(d.at), d.text.length, { deletion: sattrs }); suggested += 1; }
            if (d.op === "ins") { ytext.insert(toY(d.at), d.text, { insertion: sattrs }); suggested += 1; }
          }
        }
        anchor = el;
        continue;
      }
      if (op.op === "del") {
        const el = findDraft(op.old);
        if (el) {
          el.toArray().forEach((c) => { if (c instanceof Y.XmlText && c.length) c.format(0, c.length, { deletion: sattrs }); });
          suggested += 1;
          anchor = el;
        }
        continue;
      }
      if (op.op === "ins") {
        const items = fragment.toArray();
        const index = anchor ? items.indexOf(anchor) + 1 : 0;
        const el = new Y.XmlElement("paragraph");
        el.setAttribute("pid", newPid());
        el.setAttribute("splitBy", sattrs);
        fragment.insert(index, [el]);
        const t = new Y.XmlText();
        el.insert(0, [t]);
        t.insert(0, op.new, { insertion: sattrs });
        anchor = el;
        suggested += 1;
      }
    }
  }, "outside");
  return { suggested, commented, suggestionId: sattrs.id };
}

/** Index in the block's BASE text (pending insertions excluded) -> index in ytext. */
function baseIndexMap(ytext) {
  const map = [];
  let index = 0;
  for (const d of ytext.toDelta()) {
    const s = typeof d.insert === "string" ? d.insert : "";
    const inserted = d.attributes && Object.keys(d.attributes).some((k) => markName(k) === "insertion");
    for (let i = 0; i < s.length; i += 1) if (!inserted) map.push(index + i);
    index += s.length;
  }
  return (baseIndex) => (baseIndex < map.length ? map[baseIndex] : index);
}

function yBlockToJson(el) {
  const frag = { toArray: () => [el] };
  return yFragmentToDoc(frag).content[0];
}

/** Block-level LCS diff over plain texts, with changed runs paired positionally. */
export function blockDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const raw = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { raw.push({ op: "eq", old: a[i], new: b[j] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { raw.push({ op: "del", old: a[i] }); i += 1; }
    else { raw.push({ op: "ins", new: b[j] }); j += 1; }
  }
  while (i < n) raw.push({ op: "del", old: a[i++] });
  while (j < m) raw.push({ op: "ins", new: b[j++] });
  // Pair a run of deletions with the insertions that follow it: edited paragraphs.
  const out = [];
  for (let k = 0; k < raw.length; k += 1) {
    if (raw[k].op !== "del") { out.push(raw[k]); continue; }
    const dels = [];
    while (k < raw.length && raw[k].op === "del") dels.push(raw[k++]);
    const ins = [];
    while (k < raw.length && raw[k].op === "ins") ins.push(raw[k++]);
    k -= 1;
    const pairs = Math.min(dels.length, ins.length);
    for (let p = 0; p < pairs; p += 1) out.push({ op: "change", old: dels[p].old, new: ins[p].new });
    for (let p = pairs; p < dels.length; p += 1) out.push(dels[p]);
    for (let p = pairs; p < ins.length; p += 1) out.push(ins[p]);
  }
  return out;
}

/** Encode/decode helpers (base64) for checkpoints. */
export function encodeState(ydoc) {
  return bytesToBase64(Y.encodeStateAsUpdate(ydoc));
}
export function bytesToBase64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
}
export function base64ToBytes(b64) {
  const s = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}
