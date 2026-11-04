// The binder: universe -> story -> chapters, with what is published and what has draft changes.
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { call } from "./api.js";

let cache = null;

export default function Binder({ current }) {
  const nav = useNavigate();
  const [lib, setLib] = useState(cache);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(() => new Set(current ? [`${current.universeId}/${current.storyId}`] : []));

  useEffect(() => {
    call("storyforge.studio.library.v1", {}).then((res) => { cache = res.universes || []; setLib(cache); }).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="st-error" role="alert">{error}</p>;
  if (!lib) return <p className="muted binder-pad" role="status">Loading your stories…</p>;
  if (!lib.length) return <p className="muted binder-pad">No stories are open to you in the studio yet.</p>;

  const toggle = (key) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  return (
    <nav className="binder" aria-label="Stories and chapters">
      {lib.map((u) => (
        <div key={u.universeId} className="binder-universe">
          <h2>{u.title}{u.kind === "manuscript" && <span className="tag">Manuscript</span>}</h2>
          {u.stories.map((st) => {
            const key = `${u.universeId}/${st.storyId}`;
            const isOpen = open.has(key);
            const next = (st.chapters.at(-1)?.chapterNumber || 0) + 1;
            return (
              <div key={st.storyId} className="binder-story">
                <button type="button" className="binder-story-btn" aria-expanded={isOpen} onClick={() => toggle(key)}>
                  <span className="caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>{st.title}
                </button>
                {isOpen && (
                  <ol className="binder-chapters">
                    {st.chapters.map((c) => {
                      const here = current && current.universeId === u.universeId && current.storyId === st.storyId && Number(current.chapterNumber) === Number(c.chapterNumber);
                      return (
                        <li key={c.chapterNumber}>
                          <Link to={`/studio/${u.universeId}/${st.storyId}/${c.chapterNumber}`} aria-current={here ? "page" : undefined} className={here ? "here" : ""}>
                            <span className="num">{c.chapterNumber}</span>
                            <span className="ttl">{c.chapterTitle || `Chapter ${c.chapterNumber}`}</span>
                            {c.status === "draft" && <span className="chip draft" title="Draft changes not yet published">Draft</span>}
                            {c.pending > 0 && <span className="chip" title="Suggestions waiting">{c.pending}</span>}
                          </Link>
                        </li>
                      );
                    })}
                    {["owner", "edit"].includes(st.level) && (
                      <li><button type="button" className="binder-new" onClick={() => nav(`/studio/${u.universeId}/${st.storyId}/${next}`)}>New chapter {next}</button></li>
                    )}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
