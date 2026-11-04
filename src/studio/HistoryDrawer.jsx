// Draft history and published versions in one timeline (spec §3.4). A restore is a NEW
// change that makes the text match the old version -- never a rewind -- and a published
// version comes back as suggestions to accept.
import React, { useEffect, useState } from "react";
import * as Y from "yjs";
import { call } from "./api.js";
import { blockPlainText, docToMarkdown, markdownToDoc } from "./manuscriptMarkdown.js";
import { applyOutsideChange, base64ToBytes, FRAGMENT, yFragmentToDoc } from "./yjsManuscript.js";

const REASONS = { auto: "Autosave", idle: "Saved on leaving", named: "Named version", before_ability: "Before Ability's change", publish: "Published", restore: "Restored", close: "Saved on closing" };

export default function HistoryDrawer({ docId, editor, ydoc, canEdit, onCheckpoint, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(null);
  const load = () => call("storyforge.studio.versions.list.v1", { docId }).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [docId]);

  async function restoreDraft(id) {
    setBusy(id);
    try {
      const res = await call("storyforge.studio.versions.restore.v1", { docId, checkpointId: id });
      let doc;
      if (res.state) {
        const tmp = new Y.Doc();
        Y.applyUpdate(tmp, base64ToBytes(res.state));
        doc = yFragmentToDoc(tmp.getXmlFragment(FRAGMENT));
      } else {
        doc = markdownToDoc(res.markdown || "");
      }
      const node = editor.schema.nodeFromJSON(doc);
      const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, node.content).setMeta("restore", true);
      editor.view.dispatch(tr);
      setError("");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function restorePublished(versionId, when) {
    setBusy(versionId);
    try {
      const res = await call("storyforge.studio.versions.restore.v1", { docId, versionId });
      const current = docToMarkdown(yFragmentToDoc(ydoc.getXmlFragment(FRAGMENT)), { view: "base" });
      applyOutsideChange(ydoc, markdownToDoc(current), markdownToDoc(res.markdown || ""), { source: `Published version of ${when}`, plain: blockPlainText });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="st-drawer" role="dialog" aria-modal="true" aria-label="Version history">
      <div className="st-drawer-head">
        <h2>History</h2>
        <button type="button" className="st-icon" aria-label="Close history" onClick={onClose}>×</button>
      </div>
      {canEdit && (
        <form className="hist-name" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; setBusy("name"); await onCheckpoint("named", name.trim()); setName(""); setBusy(null); load(); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name this version" placeholder="Name this version, e.g. Before Keen's rewrite" />
          <button type="submit" className="st-btn" disabled={!name.trim() || busy === "name"}>Save version</button>
        </form>
      )}
      {error && <p className="st-error" role="alert">{error}</p>}
      {!data ? <p className="muted" role="status">Loading history…</p> : (
        <>
          <h3>Draft</h3>
          {data.draft.length === 0 && <p className="muted">Nothing saved yet. Drafts save every few minutes while you write.</p>}
          <ul className="hist-list">
            {data.draft.map((v) => (
              <li key={v.checkpointId}>
                <span><strong>{v.name || REASONS[v.reason] || "Saved"}</strong><span className="muted">{when(v.createdAt)}{v.wordCount != null ? `, ${v.wordCount.toLocaleString("en-US")} words` : ""}</span></span>
                {canEdit && v.reason !== "restore" && <button type="button" className="st-btn ghost" disabled={busy === v.checkpointId} onClick={() => restoreDraft(v.checkpointId)}>Restore</button>}
              </li>
            ))}
          </ul>
          <h3>Published</h3>
          {data.published.length === 0 && <p className="muted">No earlier published versions.</p>}
          <ul className="hist-list">
            {data.published.map((v) => (
              <li key={v.versionId}>
                <span><strong>{v.chapterTitle || "Published version"}</strong><span className="muted">{when(v.capturedAt || v.createdAt)}{v.proseLength ? `, ${v.proseLength.toLocaleString("en-US")} characters` : ""}</span></span>
                {canEdit && <button type="button" className="st-btn ghost" disabled={busy === v.versionId} onClick={() => restorePublished(v.versionId, when(v.capturedAt || v.createdAt))}>Bring back as suggestions</button>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function when(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? ` ${new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
}
