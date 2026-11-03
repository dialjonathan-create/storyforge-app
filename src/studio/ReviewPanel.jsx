// Suggestions (accept / reject, one or all, by author) and comments (spec §8).
import React, { useState } from "react";
import { TextSelection } from "@tiptap/pm/state";
import { authorLabel } from "./schema.js";

export default function ReviewPanel({ suggestions, ydoc, canEdit, onResolve, editor, me }) {
  const [filter, setFilter] = useState("all");
  const comments = Object.values(ydoc?.getMap("comments").toJSON() || {}).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const shown = suggestions.filter((s) => filter === "all" || (filter === "ability" ? s.attrs.authorKind === "ability" : filter === "outside" ? s.attrs.authorKind === "outside" : s.attrs.authorKind === "person"));
  const openComments = comments.filter((c) => !c.resolved);

  const jump = (pos) => {
    if (!editor) return;
    const p = Math.max(0, Math.min(pos + 1, editor.state.doc.content.size));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(p))).scrollIntoView());
    editor.view.focus();
  };
  const jumpToComment = (id) => {
    let at = null;
    editor?.state.doc.descendants((node, pos) => {
      if (at === null && node.marks?.some((m) => m.type.name === "comment" && m.attrs.id === id)) at = pos;
    });
    if (at !== null) jump(at - 1);
  };
  const setComment = (id, patch) => {
    const map = ydoc.getMap("comments");
    map.set(id, { ...map.get(id), ...patch });
  };

  return (
    <div className="review">
      <section aria-label="Suggestions">
        <div className="review-head">
          <h3>Suggestions</h3>
          <select aria-label="Show suggestions from" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="ability">Ability</option>
            <option value="person">People</option>
            <option value="outside">Changed outside</option>
          </select>
        </div>
        {shown.length === 0 ? <p className="muted">No suggestions waiting.</p> : (
          <>
            {canEdit && shown.length >= 2 && (
              <div className="review-bulk">
                <button type="button" className="st-btn" onClick={() => onResolve(shown.map((s) => s.id), "accept")}>Accept all {shown.length}</button>
                <button type="button" className="st-btn ghost" onClick={() => onResolve(shown.map((s) => s.id), "reject")}>Reject all</button>
              </div>
            )}
            <ul className="review-list">
              {shown.map((s) => (
                <li key={s.id} className={`sg-card kind-${s.attrs.authorKind}`}>
                  <button type="button" className="sg-jump" onClick={() => jump(s.firstPos)}>
                    <span className="sg-who">{authorLabel(s.attrs)}</span>
                    {s.removed && <del>{clip(s.removed)}</del>}
                    {s.inserted && <ins>{clip(s.inserted)}</ins>}
                    {!s.removed && !s.inserted && <span className="muted">{s.blocks.some((b) => b.key === "joinBy") ? "Join paragraphs" : s.blocks.some((b) => b.key === "removeBy") ? "Remove scene break" : "New paragraph"}</span>}
                  </button>
                  {canEdit && (
                    <span className="sg-actions">
                      <button type="button" aria-label={`Accept suggestion by ${authorLabel(s.attrs)}`} onClick={() => onResolve([s.id], "accept")}>Accept</button>
                      <button type="button" aria-label={`Reject suggestion by ${authorLabel(s.attrs)}`} onClick={() => onResolve([s.id], "reject")}>Reject</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section aria-label="Comments">
        <div className="review-head"><h3>Comments</h3><span className="muted">{openComments.length} open</span></div>
        {comments.length === 0 && <p className="muted">Select text and choose Comment to start a note.</p>}
        <ul className="review-list">
          {comments.map((c) => (
            <li key={c.id} className={`cm-card ${c.resolved ? "resolved" : ""} kind-${c.authorKind}`}>
              <button type="button" className="sg-jump" onClick={() => jumpToComment(c.id)}>
                <span className="sg-who">{authorLabel({ author: c.author, authorKind: c.authorKind, requestedBy: c.requestedBy })}{c.stale ? " · text changed" : ""}</span>
                {c.quote && <q>{clip(c.quote, 90)}</q>}
              </button>
              {c.draft && c.author === me ? (
                <form onSubmit={(e) => { e.preventDefault(); const body = new FormData(e.currentTarget).get("body"); if (String(body).trim()) setComment(c.id, { body: String(body).trim(), draft: false }); }}>
                  <textarea name="body" rows={2} aria-label="Comment" autoFocus placeholder="Add a comment" />
                  <button type="submit" className="st-btn">Comment</button>
                </form>
              ) : <p>{c.body}</p>}
              {!c.draft && (
                <button type="button" className="st-link" onClick={() => setComment(c.id, { resolved: !c.resolved })}>{c.resolved ? "Reopen" : "Resolve"}</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function clip(text, n = 140) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
