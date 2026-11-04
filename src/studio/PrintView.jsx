// Book-like print layout: title page, a page break before every chapter, page numbers
// (CSS @page), no suggestion marks, no narration cues. The browser prints it or saves a PDF.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { call } from "./api.js";
import { docToMarkdown, markdownToDoc } from "./manuscriptMarkdown.js";
import { PRINT_DRAFT_KEY } from "./PrintDialog.jsx";

export function parseRange(spec, available) {
  if (!spec || spec === "all") return available;
  const want = new Set();
  for (const part of String(spec).split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] || m[1]);
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 500; n += 1) want.add(n);
  }
  return available.filter((n) => want.has(n));
}

/** Render one chapter's prose as print blocks (React), from markdown. */
export function PrintProse({ markdown, title = "" }) {
  const doc = useMemo(() => markdownToDoc(markdown || ""), [markdown]);
  // A chapter that opens with its own title as a heading would print it twice.
  const blocks = doc.content.filter((b, i) => !(i === 0 && b.type === "heading" && title
    && (b.content || []).map((n) => n.text || "").join("").trim().toLowerCase() === String(title).trim().toLowerCase()));
  return blocks.map((block, i) => {
    const kids = inline(block.content || []);
    switch (block.type) {
      case "heading": return React.createElement(`h${Math.min(4, (block.attrs.level || 1) + 2)}`, { key: i, className: "pr-h" }, kids);
      case "sceneBreak": return <p key={i} className="pr-scene" aria-label="Scene break">⁂</p>;
      case "blockquote": return <blockquote key={i}>{kids}</blockquote>;
      case "listItem": return <p key={i} className="pr-li"><span className="pr-marker">{block.attrs.marker}</span>{kids}</p>;
      default: return kids.length ? <p key={i}>{kids}</p> : null;
    }
  });
}

function inline(nodes) {
  return nodes.map((n, i) => {
    if (n.type === "hardBreak") return <br key={i} />;
    if (n.type !== "text") return null; // narration cues are for the narrator, not the page
    let el = n.text;
    for (const m of n.marks || []) {
      if (m.type === "italic") el = <em>{el}</em>;
      else if (m.type === "bold") el = <strong>{el}</strong>;
      else if (m.type === "underline") el = <u>{el}</u>;
      else if (m.type === "strike") el = <s>{el}</s>;
    }
    return <React.Fragment key={i}>{el}</React.Fragment>;
  });
}

export default function PrintView() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const universeId = params.get("u");
  const storyId = params.get("s");
  const source = params.get("source") || "published";
  const view = params.get("view") === "accepted" ? "accepted" : "base";
  const showTitle = params.get("title") !== "0";
  const showComments = params.get("comments") === "1";
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const listed = await call("storyforge.chapter.list.v1", { universeId, storyId });
        const numbers = parseRange(params.get("chapters"), (listed.chapterNumbers || []).map(Number));
        let draft = null;
        try { draft = source === "draft" ? JSON.parse(sessionStorage.getItem(PRINT_DRAFT_KEY) || "null") : null; } catch { draft = null; }
        const chapters = [];
        for (const n of numbers) {
          if (draft && Number(draft.chapterNumber) === n && draft.doc) {
            chapters.push({ n, title: draft.title || "", markdown: docToMarkdown(draft.doc, { view }), comments: Object.values(draft.comments || {}).filter((c) => !c.resolved && c.body) });
          } else {
            const got = await call("storyforge.chapter.get.v1", { universeId, storyId, chapterNumber: n });
            const c = got.chapter || got;
            chapters.push({ n, title: c.chapterTitle || "", markdown: c.prose || c.chapterText || "", comments: [] });
          }
        }
        if (draft && !numbers.includes(Number(draft.chapterNumber)) && numbers.length === 0 && draft.doc) {
          chapters.push({ n: Number(draft.chapterNumber), title: draft.title || "", markdown: docToMarkdown(draft.doc, { view }), comments: [] });
        }
        let storyTitle = storyId;
        try { storyTitle = (await call("storyforge.story.get.v1", { universeId, storyId })).story?.title || storyId; } catch { /* keep the id */ }
        if (!cancelled) setState({ loading: false, chapters, storyTitle });
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error.message });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universeId, storyId, params.toString()]);

  const notes = (state.chapters || []).flatMap((c) => (showComments ? c.comments.map((cm) => ({ ...cm, n: c.n })) : []));

  return (
    <div className="print-root">
      <div className="print-bar no-print" role="toolbar" aria-label="Print">
        <button type="button" className="st-btn ghost" onClick={() => nav(-1)}>Back to the studio</button>
        <span className="muted">{state.loading ? "Preparing pages…" : state.error ? "" : `${(state.chapters || []).length} chapter${(state.chapters || []).length === 1 ? "" : "s"}`}</span>
        <button type="button" className="st-btn primary" disabled={state.loading || Boolean(state.error)} onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      {state.error && <p className="st-error" role="alert">{state.error}</p>}
      {!state.loading && !state.error && (
        <div className="print-book">
          {showTitle && (
            <section className="pr-title-page">
              <h1>{state.storyTitle}</h1>
              {(state.chapters || []).length === 1 && <p className="pr-sub">Chapter {state.chapters[0].n}{state.chapters[0].title ? `: ${state.chapters[0].title}` : ""}</p>}
              {source === "draft" && <p className="pr-draft">Draft, {new Date().toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</p>}
            </section>
          )}
          {(state.chapters || []).map((c) => (
            <section key={c.n} className="pr-chapter">
              <h2 className="pr-chapter-title"><span className="pr-num">Chapter {c.n}</span>{c.title && <span className="pr-name">{c.title}</span>}</h2>
              <div className="pr-prose"><PrintProse markdown={c.markdown} title={c.title} /></div>
            </section>
          ))}
          {notes.length > 0 && (
            <section className="pr-chapter pr-notes">
              <h2 className="pr-chapter-title"><span className="pr-name">Notes</span></h2>
              <ol>{notes.map((c) => <li key={c.id}><em>Chapter {c.n}{c.quote ? `, “${c.quote}”` : ""}:</em> {c.body}</li>)}</ol>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
