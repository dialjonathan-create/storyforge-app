// Print options (Jonathan, 2026-11-03: "I'd like to have print options for Otherwise too").
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export const PRINT_DRAFT_KEY = "otherwise_studio_print_draft";

export default function PrintDialog({ universeId, storyId, chapterNumber, getDraft, onClose }) {
  const nav = useNavigate();
  const [scope, setScope] = useState("chapter");
  const [range, setRange] = useState(String(chapterNumber));
  const [source, setSource] = useState("published");
  const [view, setView] = useState("base");
  const [titlePage, setTitlePage] = useState(true);
  const [comments, setComments] = useState(false);

  function go() {
    if (source === "draft") {
      try { sessionStorage.setItem(PRINT_DRAFT_KEY, JSON.stringify({ chapterNumber, ...getDraft() })); } catch { /* too large: published only */ }
    }
    const chapters = scope === "chapter" ? String(chapterNumber) : scope === "all" ? "all" : range.replace(/\s+/g, "");
    const q = new URLSearchParams({ u: universeId, s: storyId, chapters, source, view, title: titlePage ? "1" : "0", comments: comments ? "1" : "0" });
    nav(`/studio/print?${q.toString()}`);
  }

  return (
    <div className="st-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-modal" role="dialog" aria-modal="true" aria-labelledby="print-title">
        <div className="st-drawer-head">
          <h2 id="print-title">Print</h2>
          <button type="button" className="st-icon" aria-label="Close print options" onClick={onClose}>×</button>
        </div>
        <fieldset>
          <legend>What to print</legend>
          <label className="check"><input type="radio" name="scope" checked={scope === "chapter"} onChange={() => setScope("chapter")} /> This chapter</label>
          <label className="check"><input type="radio" name="scope" checked={scope === "some"} onChange={() => setScope("some")} /> Chapters
            <input aria-label="Chapters to print, e.g. 1-3, 5" className="inline" value={range} onFocus={() => setScope("some")} onChange={(e) => setRange(e.target.value)} />
          </label>
          <label className="check"><input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} /> The whole story</label>
        </fieldset>
        <fieldset>
          <legend>Which text</legend>
          <label className="check"><input type="radio" name="source" checked={source === "published"} onChange={() => setSource("published")} /> Published (what readers see)</label>
          <label className="check"><input type="radio" name="source" checked={source === "draft"} onChange={() => setSource("draft")} /> This chapter's current draft</label>
          {source === "draft" && (
            <label className="check sub"><input type="checkbox" checked={view === "accepted"} onChange={(e) => setView(e.target.checked ? "accepted" : "base")} /> Print waiting suggestions as if accepted</label>
          )}
        </fieldset>
        <fieldset>
          <legend>Layout</legend>
          <label className="check"><input type="checkbox" checked={titlePage} onChange={(e) => setTitlePage(e.target.checked)} /> Title page</label>
          <label className="check"><input type="checkbox" checked={comments} disabled={source !== "draft"} onChange={(e) => setComments(e.target.checked)} /> Include comments as notes at the end</label>
        </fieldset>
        <p className="muted small">Suggestion marks and narration cues are never printed. Use your browser's print dialog to print or save as PDF.</p>
        <div className="st-modal-actions">
          <button type="button" className="st-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="st-btn primary" onClick={go}>Preview</button>
        </div>
      </div>
    </div>
  );
}
