// Who can see, suggest in or edit this story: the creator decides (spec §5).
import React, { useEffect, useState } from "react";
import { call } from "./api.js";

const LEVELS = [
  { value: "none", label: "No access" },
  { value: "read", label: "Read only" },
  { value: "suggest", label: "Comment & suggest" },
  { value: "edit", label: "Can edit" },
];
const NAMES = { jonathan: "Jonathan", adele: "Adele", keen: "Keen", talia: "Talia" };

export default function ShareDialog({ universeId, storyId, onClose }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [defaultLevel, setDefaultLevel] = useState("read");
  const [options, setOptions] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    call("storyforge.studio.sharing.get.v1", { universeId, storyId }).then((res) => {
      setData(res);
      setDefaultLevel(res.sharing.familyDefault);
      setOptions(res.options || {});
      setDraft(Object.fromEntries(res.sharing.people.filter((p) => p.explicit).map((p) => [p.userId, p.level])));
    }).catch((e) => setMessage(e.message));
  }, [universeId, storyId]);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const res = await call("storyforge.studio.sharing.set.v1", { universeId, storyId, people: draft, familyDefault: defaultLevel, options });
      setData((d) => ({ ...d, sharing: res.sharing, options: res.options }));
      setMessage(res.lowered?.length ? `Saved. ${res.lowered.map((p) => NAMES[p] || p).join(" and ")} lost access at once.` : "Saved.");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  }

  const s = data?.sharing;
  const can = Boolean(s?.canChange);
  return (
    <div className="st-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="st-drawer-head">
          <h2 id="share-title">Share this story</h2>
          <button type="button" className="st-icon" aria-label="Close sharing" onClick={onClose}>×</button>
        </div>
        {!s ? <p className="muted" role="status">{message || "Loading…"}</p> : (
          <>
            <p className="muted">{can ? "You decide who can read, suggest or edit. Changes take effect right away." : `Only ${NAMES[s.ownerId] || s.ownerId}, who made this story, changes who can see it.`}{s.locked ? " A parent has locked sharing." : ""}</p>
            <table className="share-table">
              <tbody>
                {s.people.map((p) => (
                  <tr key={p.userId}>
                    <th scope="row">{NAMES[p.userId] || p.userId}{p.owner && <span className="muted"> (owner)</span>}</th>
                    <td>
                      {p.owner ? <span>Owner</span> : (
                        <select aria-label={`Access for ${NAMES[p.userId] || p.userId}`} disabled={!can} value={draft[p.userId] ?? "default"}
                          onChange={(e) => setDraft((d) => { const n = { ...d }; if (e.target.value === "default") delete n[p.userId]; else n[p.userId] = e.target.value; return n; })}>
                          <option value="default">Family default ({LEVELS.find((l) => l.value === defaultLevel)?.label})</option>
                          {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                      )}
                      {!p.owner && !p.hasUniverseAccess && <span className="muted small"> At most read: not in this universe.</span>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Everyone in the family</th>
                  <td>
                    <select aria-label="Family default" disabled={!can} value={defaultLevel} onChange={(e) => setDefaultLevel(e.target.value)}>
                      {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
            {can && (
              <fieldset className="share-options">
                <legend>What editors may do</legend>
                <label><input type="checkbox" checked={options.directAllowed !== false} onChange={(e) => setOptions({ ...options, directAllowed: e.target.checked })} /> Let editors apply Ability's changes directly (otherwise they arrive as suggestions)</label>
                <label>Whole-chapter drafts:
                  <select value={options.draftWho || "editors"} onChange={(e) => setOptions({ ...options, draftWho: e.target.value })}>
                    <option value="editors">Any editor</option>
                    <option value="owner">Only me</option>
                  </select>
                </label>
              </fieldset>
            )}
            {message && <p className="st-note" role="status">{message}</p>}
            <div className="st-modal-actions">
              <button type="button" className="st-btn ghost" onClick={onClose}>Close</button>
              {can && <button type="button" className="st-btn primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save sharing"}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
