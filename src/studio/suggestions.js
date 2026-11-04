// Tracked changes ("Suggesting" mode) on the manuscript schema -- our own code, MIT
// (TipTap's track-changes is a paid Pro extension; spec §3.1).
//
// A suggestion is plain document content, so it converges for everyone like any other
// CRDT edit:
//   * inserted text carries an `insertion` mark, removed text a `deletion` mark, both
//     with {id, author, authorKind (person | ability | outside), requestedBy, createdAt, batchId};
//   * a suggested paragraph split puts `splitBy` on the new (second) block, a suggested
//     join puts `joinBy` on the block that would merge into the one before it, and a
//     suggested removal of a scene break puts `removeBy` on it.
// Accepting an insertion removes its mark; rejecting deletes the text. Accepting a
// deletion deletes the text; rejecting removes the mark. Same for splits and joins.
//
// `convertToSuggestion` turns ANY editing transaction (typing, paste, cut, Enter,
// Backspace, IME) into its suggestion form, so the editor needs one hook (see
// SuggestMode in Editor.jsx), not a handler per key.
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { AddMarkStep, Mapping, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import { newPid, parseInline } from "./manuscriptMarkdown.js";

const COALESCE_MS = 90_000;

export function suggestionId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return `s_${crypto.randomUUID().slice(0, 12)}`;
  } catch { /* fall through */ }
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Fresh attributes for one suggestion. */
export function suggestionAttrs({ author, authorKind = "person", requestedBy = null, batchId = null, id = null, createdAt = null } = {}) {
  return {
    id: id || suggestionId(),
    author: author || null,
    authorKind,
    requestedBy,
    createdAt: createdAt || new Date().toISOString(),
    batchId,
  };
}

function sameAuthor(a, b) {
  return a && b && a.author === b.author && a.authorKind === b.authorKind && (a.batchId || null) === (b.batchId || null);
}

function recent(attrs, now = Date.now()) {
  const t = Date.parse(attrs?.createdAt || "");
  return Number.isFinite(t) && now - t < COALESCE_MS;
}

/** Continue the author's neighbouring suggestion (typing a word is ONE suggestion). */
function coalesced(doc, pos, base) {
  if (base.authorKind === "ability") return base;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (const node of [$pos.nodeBefore, $pos.nodeAfter]) {
    if (!node) continue;
    for (const mark of node.marks || []) {
      if ((mark.type.name === "insertion" || mark.type.name === "deletion") && sameAuthor(mark.attrs, base) && recent(mark.attrs)) {
        return { ...base, id: mark.attrs.id, createdAt: mark.attrs.createdAt };
      }
    }
  }
  return base;
}

function stripSuggestionMarks(marks, schema) {
  return marks.filter((m) => m.type !== schema.marks.insertion && m.type !== schema.marks.deletion);
}

/** The slice with every inline node marked inserted, and blocks marked as new splits. */
function markSlice(fragment, insMark, schema, splitAttrs, depth = 0) {
  const nodes = [];
  fragment.forEach((node) => {
    if (node.isInline) {
      nodes.push(node.mark(insMark.addToSet(stripSuggestionMarks(node.marks, schema))));
    } else if (node.isBlock) {
      nodes.push(node.copy(markSlice(node.content, insMark, schema, splitAttrs, depth + 1)));
    } else {
      nodes.push(node);
    }
  });
  return Fragment.from(nodes);
}

/**
 * Replace [from, to] with `slice` as a suggestion, on `tr` (positions in tr.doc).
 * Returns {insFrom, insTo} of what was inserted (in tr.doc after the change).
 */
export function suggestReplace(tr, from, to, slice, attrs) {
  const schema = tr.doc.type.schema;
  const delAttrs = coalesced(tr.doc, from, attrs);
  const delMark = schema.marks.deletion.create(delAttrs);
  const start = tr.mapping.maps.length;
  const positional = [];
  if (to > from) {
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === "doc") return true;
      if (node.isBlock) {
        // A block whose opening AND the previous block's closing token are both in
        // range: the two would merge.
        if (pos - 1 >= from && pos + 1 <= to) {
          if (node.attrs.splitBy) positional.push({ at: pos, kind: "join" });
          else if (node.type.name !== "sceneBreak") tr.setNodeMarkup(pos, undefined, { ...node.attrs, joinBy: delAttrs });
        }
        if (node.type.name === "sceneBreak" && pos >= from && pos + node.nodeSize <= to) {
          if (node.attrs.splitBy) positional.push({ at: pos, kind: "delete", from: pos, to: pos + node.nodeSize });
          else tr.setNodeMarkup(pos, undefined, { ...node.attrs, removeBy: delAttrs });
        }
        return true;
      }
      if (!node.isInline) return false;
      const a = Math.max(from, pos);
      const b = Math.min(to, pos + node.nodeSize);
      if (b <= a) return false;
      if (node.marks.some((m) => m.type === schema.marks.insertion)) positional.push({ at: a, kind: "delete", from: a, to: b });
      else if (!node.marks.some((m) => m.type === schema.marks.deletion)) tr.addMark(a, b, delMark);
      return false;
    });
  }
  positional.sort((x, y) => y.at - x.at);
  for (const op of positional) {
    if (op.kind === "delete") tr.delete(op.from, op.to);
    else if (op.kind === "join") {
      try { tr.join(op.at); } catch { /* not joinable: leave the boundary */ }
    }
  }
  const map = tr.mapping.slice(start);
  const insPos = map.map(to, -1);
  if (!slice || slice.size === 0) return { insFrom: insPos, insTo: insPos, delFrom: map.map(from, -1) };
  const insAttrs = coalesced(tr.doc, insPos, attrs);
  const insMark = schema.marks.insertion.create(insAttrs);
  const marked = new Slice(markSlice(slice.content, insMark, schema, insAttrs), slice.openStart, slice.openEnd);
  const before = tr.doc.content.size;
  tr.replace(insPos, insPos, marked);
  const insTo = insPos + (tr.doc.content.size - before);
  // Blocks created by the insertion are suggested splits.
  tr.doc.forEach((node, offset) => {
    if (offset > insPos && offset < insTo && !node.attrs.splitBy) {
      tr.setNodeMarkup(offset, undefined, { ...node.attrs, splitBy: insAttrs, pid: newPid(), gap: null, trail: "" });
    }
  });
  return { insFrom: insPos, insTo };
}

/**
 * The suggestion form of `tr` (built on `state`), or null when it has nothing to
 * change. Formatting steps pass through; nothing may strip a suggestion mark.
 */
export function convertToSuggestion(state, tr, attrsBase) {
  if (!tr.docChanged) return tr;
  const out = state.tr;
  let map = new Mapping();
  let selectionPos = null;
  tr.steps.forEach((step, index) => {
    const before = out.mapping.maps.length;
    const docBefore = tr.docs[index];
    if (step instanceof ReplaceStep) {
      const from = map.map(step.from, -1);
      const to = map.map(step.to, 1);
      const old = state.selection;
      const { insFrom, insTo, delFrom } = suggestReplace(out, from, Math.max(from, to), step.slice, attrsBase);
      if (step.slice.size) selectionPos = insTo;
      else if (old.empty && old.from === step.from && index === 0) selectionPos = out.mapping.slice(before).map(to, 1); // Delete key: past what was struck
      else selectionPos = delFrom ?? insFrom;
    } else if ((step instanceof AddMarkStep || step instanceof RemoveMarkStep)
               && ["insertion", "deletion"].includes(step.mark.type.name)) {
      // never strip or forge a tracked change through a formatting command
    } else if (step instanceof ReplaceAroundStep || step instanceof AddMarkStep || step instanceof RemoveMarkStep || step.constructor?.name === "AttrStep") {
      const mapped = step.map(map);
      if (mapped) out.maybeStep(mapped);
    } else {
      const mapped = step.map(map);
      if (mapped) out.maybeStep(mapped);
    }
    const next = new Mapping();
    next.appendMap(step.getMap().invert());
    next.appendMapping(map);
    next.appendMapping(out.mapping.slice(before));
    map = next;
    void docBefore;
  });
  if (!out.docChanged) return null;
  if (selectionPos != null) {
    const pos = Math.max(0, Math.min(selectionPos, out.doc.content.size));
    try { out.setSelection(TextSelection.near(out.doc.resolve(pos))); } catch { /* keep mapped selection */ }
  }
  for (const key of ["uiEvent", "paste"]) {
    const v = tr.getMeta(key);
    if (v !== undefined) out.setMeta(key, v);
  }
  out.setMeta("suggestConverted", true);
  out.scrollIntoView();
  return out;
}

// --- reading suggestions ----------------------------------------------------------

/** Every pending suggestion in the doc: id -> {id, attrs, ins:[ranges], del:[ranges], blocks:[...], text}. */
export function collectSuggestions(doc) {
  const out = new Map();
  const entry = (attrs) => {
    if (!out.has(attrs.id)) out.set(attrs.id, { id: attrs.id, attrs, ins: [], del: [], blocks: [], inserted: "", removed: "", firstPos: Infinity });
    return out.get(attrs.id);
  };
  doc.descendants((node, pos) => {
    if (node.isBlock && node.attrs) {
      for (const key of ["splitBy", "joinBy", "removeBy"]) {
        const a = node.attrs[key];
        if (a && a.id) {
          const e = entry(a);
          e.blocks.push({ pos, key, size: node.nodeSize });
          e.firstPos = Math.min(e.firstPos, pos);
        }
      }
      return true;
    }
    if (!node.isInline) return false;
    for (const mark of node.marks) {
      const kind = mark.type.name === "insertion" ? "ins" : mark.type.name === "deletion" ? "del" : null;
      if (!kind || !mark.attrs.id) continue;
      const e = entry(mark.attrs);
      const list = e[kind];
      const last = list[list.length - 1];
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else list.push({ from: pos, to: pos + node.nodeSize });
      const text = node.isText ? node.text : node.type.name === "hardBreak" ? "\n" : "";
      if (kind === "ins") e.inserted += text;
      else e.removed += text;
      e.firstPos = Math.min(e.firstPos, pos);
    }
    return false;
  });
  return out;
}

/** Suggestions in document order, for the side list and next/previous navigation. */
export function listSuggestions(doc) {
  return [...collectSuggestions(doc).values()].sort((a, b) => a.firstPos - b.firstPos);
}

/**
 * Accept or reject suggestions. `ids`: an array, or a predicate over attrs.
 * Returns the transaction (unchanged doc when nothing matched).
 */
export function resolveSuggestions(state, ids, action) {
  const schema = state.schema;
  const all = collectSuggestions(state.doc);
  const want = typeof ids === "function" ? [...all.values()].filter((e) => ids(e.attrs)).map((e) => e.id) : ids;
  const tr = state.tr;
  const positional = [];
  for (const id of want) {
    const e = all.get(id);
    if (!e) continue;
    for (const r of e.ins) {
      if (action === "accept") tr.removeMark(r.from, r.to, schema.marks.insertion);
      else positional.push({ at: r.from, kind: "delete", from: r.from, to: r.to });
    }
    for (const r of e.del) {
      if (action === "accept") positional.push({ at: r.from, kind: "delete", from: r.from, to: r.to });
      else tr.removeMark(r.from, r.to, schema.marks.deletion);
    }
    for (const b of e.blocks) {
      const node = tr.doc.nodeAt(b.pos);
      if (!node) continue;
      const clear = () => tr.setNodeMarkup(b.pos, undefined, { ...node.attrs, [b.key]: null });
      if (b.key === "splitBy") {
        if (action === "accept") clear();
        else positional.push({ at: b.pos, kind: "join", clearKey: b.key });
      } else if (b.key === "joinBy") {
        if (action === "accept") positional.push({ at: b.pos, kind: "join", clearKey: b.key });
        else clear();
      } else if (b.key === "removeBy") {
        if (action === "accept") positional.push({ at: b.pos, kind: "delete", from: b.pos, to: b.pos + b.size });
        else clear();
      }
    }
  }
  positional.sort((x, y) => y.at - x.at || (x.kind === "join" ? 1 : -1));
  for (const op of positional) {
    if (op.kind === "delete") {
      tr.delete(op.from, op.to);
    } else if (op.kind === "join") {
      const $pos = tr.doc.resolve(op.at);
      const before = $pos.nodeBefore;
      const node = tr.doc.nodeAt(op.at);
      if (before && node && before.isTextblock && node.isTextblock) {
        tr.join(op.at);
      } else if (node) {
        tr.setNodeMarkup(op.at, undefined, { ...node.attrs, [op.clearKey]: null });
      }
    }
  }
  tr.setMeta("suggestResolved", action);
  return tr;
}

// --- Ability's edits, applied on the client (fallback path, spec §6.2) --------------

/** Where block `pid` is: {pos, node} or null. */
export function findBlock(doc, pid) {
  let found = null;
  doc.forEach((node, offset) => {
    if (!found && node.attrs?.pid === pid) found = { pos: offset, node };
  });
  return found;
}

/** The block's text as it reads now (deletions left out), with a map back to doc positions. */
export function readableText(node, pos) {
  let text = "";
  const map = []; // map[i] = doc position of text[i]
  node.forEach((child, offset) => {
    const start = pos + 1 + offset;
    if (child.marks.some((m) => m.type.name === "deletion")) return;
    if (child.isText) {
      for (let i = 0; i < child.text.length; i += 1) { map.push(start + i); }
      text += child.text;
    } else if (child.type.name === "hardBreak") {
      map.push(start);
      text += "\n";
    } else {
      map.push(start);
      text += "￼";
    }
  });
  return { text, map };
}

function inlineNodes(schema, text) {
  return parseInline(String(text || "")).map((n) => schema.nodeFromJSON(n));
}

/**
 * Apply Ability's operations. ops: [{op: "replace"|"insert_after"|"comment", pid, quote, text, body}].
 * mode "suggest" -> tracked changes by Ability (requestedBy = the person), "direct" -> plain edits.
 * Returns {tr, applied: [op], comments: [{id, pid, quote, body, stale}]}.
 */
export function applyAbilityOps(state, ops, { mode = "suggest", requestedBy = null, batchId = null } = {}) {
  const schema = state.schema;
  const tr = state.tr;
  const applied = [];
  const comments = [];
  const attrs = suggestionAttrs({ author: "ability", authorKind: "ability", requestedBy, batchId: batchId || suggestionId() });
  for (const op of ops || []) {
    const hit = findBlock(tr.doc, op.pid);
    if (!hit) {
      comments.push({ id: suggestionId().replace("s_", "c_"), pid: op.pid, quote: op.quote || "", body: staleNote(op), stale: true });
      continue;
    }
    if (op.op === "comment") {
      const located = locate(hit, op.quote);
      const id = suggestionId().replace("s_", "c_");
      if (located) tr.addMark(located.from, located.to, schema.marks.comment.create({ id }));
      comments.push({ id, pid: op.pid, quote: op.quote || "", body: String(op.body || op.text || ""), stale: !located && Boolean(op.quote) });
      applied.push(op);
      continue;
    }
    if (op.op === "replace") {
      const located = locate(hit, op.quote);
      if (!located) {
        comments.push({ id: suggestionId().replace("s_", "c_"), pid: op.pid, quote: op.quote || "", body: staleNote(op), stale: true });
        continue;
      }
      const slice = new Slice(Fragment.from(inlineNodes(schema, op.text)), 0, 0);
      if (mode === "direct") tr.replace(located.from, located.to, slice);
      else suggestReplace(tr, located.from, located.to, slice, attrs);
      applied.push(op);
      continue;
    }
    if (op.op === "insert_after") {
      const paragraphs = String(op.text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      if (!paragraphs.length) continue;
      const at = hit.pos + hit.node.nodeSize;
      const blocks = paragraphs.map((p) => schema.nodes.paragraph.create({ pid: newPid(), splitBy: mode === "direct" ? null : attrs }, inlineNodes(schema, p)));
      if (mode === "direct") {
        tr.insert(at, blocks);
      } else {
        const insMark = schema.marks.insertion.create(attrs);
        tr.insert(at, blocks.map((b) => b.copy(Fragment.from(mapInline(b.content, (n) => n.mark(insMark.addToSet(n.marks)))))));
      }
      applied.push(op);
    }
  }
  if (tr.docChanged) tr.setMeta("abilityBatch", attrs.batchId);
  return { tr, applied, comments, batchId: attrs.batchId };
}

function mapInline(fragment, fn) {
  const out = [];
  fragment.forEach((n) => out.push(n.isInline ? fn(n) : n));
  return out;
}

function locate(hit, quote) {
  const q = String(quote || "");
  if (!q) return null;
  const { text, map } = readableText(hit.node, hit.pos);
  const at = text.indexOf(q);
  if (at < 0 || text.indexOf(q, at + 1) >= 0 && text.indexOf(q, at + 1) !== at) {
    if (at < 0) return null;
  }
  const from = map[at];
  const to = map[at + q.length - 1] + 1;
  return from != null && to != null ? { from, to } : null;
}

function staleNote(op) {
  const what = op.op === "insert_after" ? "adding a passage here" : `changing "${String(op.quote || "").slice(0, 80)}"`;
  const to = op.text ? ` to "${String(op.text).slice(0, 200)}"` : "";
  return `I suggested ${what}${to}, but the text changed before it arrived. Apply it yourself if it still fits.`;
}
