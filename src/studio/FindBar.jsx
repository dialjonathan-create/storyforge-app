// Find and replace (spec §9): case and whole-word options; replace-all is one undoable
// step; in Suggesting mode replacements become suggestions like any other edit.
import React, { useMemo, useRef, useState, useEffect } from "react";
import { TextSelection } from "@tiptap/pm/state";

export function findMatches(doc, query, { caseSensitive = false, wholeWord = false } = {}) {
  if (!query) return [];
  const out = [];
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc, `g${caseSensitive ? "" : "i"}u`);
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText && !child.marks.some((m) => m.type.name === "deletion")) {
        for (let i = 0; i < child.text.length; i += 1) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(-1);
        text += "￼";
      }
    });
    let m;
    while ((m = re.exec(text))) {
      const from = map[m.index];
      const to = map[m.index + m[0].length - 1];
      if (from >= 0 && to >= 0 && to + 1 - from === m[0].length) out.push({ from, to: to + 1 });
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return false;
  });
  return out;
}

export default function FindBar({ editor, onClose }) {
  const [q, setQ] = useState("");
  const [r, setR] = useState("");
  const [cs, setCs] = useState(false);
  const [ww, setWw] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const matches = useMemo(() => findMatches(editor.state.doc, q, { caseSensitive: cs, wholeWord: ww }), [editor, editor.state.doc, q, cs, ww]);

  const go = (i) => {
    if (!matches.length) return;
    const n = (i + matches.length) % matches.length;
    setIndex(n);
    const m = matches[n];
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView());
  };
  const replaceOne = () => {
    const m = matches[index % Math.max(1, matches.length)];
    if (!m || !editor.isEditable) return;
    editor.view.dispatch(editor.state.tr.insertText(r, m.from, m.to));
  };
  const replaceAll = () => {
    if (!matches.length || !editor.isEditable) return;
    const tr = editor.state.tr;
    [...matches].reverse().forEach((m) => tr.insertText(r, m.from, m.to));
    editor.view.dispatch(tr);
  };

  return (
    <div className="st-find" role="search" aria-label="Find and replace">
      <input ref={input} aria-label="Find" placeholder="Find" value={q} onChange={(e) => { setQ(e.target.value); setIndex(0); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? index - 1 : index + (matches.length && editor.state.selection.from === matches[index]?.from ? 1 : 0)); } if (e.key === "Escape") onClose(); }} />
      <span className="muted" aria-live="polite">{q ? `${matches.length ? (index % matches.length) + 1 : 0} of ${matches.length}` : ""}</span>
      <button type="button" className="st-tool" aria-label="Previous match" onClick={() => go(index - 1)}>↑</button>
      <button type="button" className="st-tool" aria-label="Next match" onClick={() => go(index + 1)}>↓</button>
      <input aria-label="Replace with" placeholder="Replace with" value={r} onChange={(e) => setR(e.target.value)} />
      <button type="button" className="st-btn ghost" disabled={!matches.length || !editor.isEditable} onClick={replaceOne}>Replace</button>
      <button type="button" className="st-btn ghost" disabled={!matches.length || !editor.isEditable} onClick={replaceAll}>Replace all</button>
      <label className="check"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case</label>
      <label className="check"><input type="checkbox" checked={ww} onChange={(e) => setWw(e.target.checked)} /> Whole words</label>
      <button type="button" className="st-icon" aria-label="Close find" onClick={onClose}>×</button>
    </div>
  );
}
