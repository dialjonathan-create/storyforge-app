import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import "./styles.css";

const ABILITY_URL = import.meta.env.VITE_ABILITY_URL || "https://ability-supervisor-service-818269465014.us-central1.run.app";
// Scoped product token (2026-08-22): authorizes story.* / storyforge.* only.
const STORYFORGE_TOKEN =
  (typeof localStorage !== "undefined" && localStorage.getItem("storyforge_token")) ||
  import.meta.env.VITE_STORYFORGE_TOKEN || "";
function abilityHeaders(extra = {}) {
  const headers = { ...extra };
  if (STORYFORGE_TOKEN) headers.Authorization = `Bearer ${STORYFORGE_TOKEN}`;
  return headers;
}
const FAMILY = [
  { userId: "jonathan", displayName: "Jonathan", avatar: "⚓" },
  { userId: "adele", displayName: "Adele", avatar: "🧭" },
  { userId: "keen", displayName: "Keen", avatar: "⚡" },
  { userId: "talia", displayName: "Talia", avatar: "🌟" },
];
const CHAPTER_WAIT_MESSAGES = [
  "The story is being written...",
  "Checking for consistency...",
  "The Meridian is charting the course...",
];
const RESHAPE_WAIT_MESSAGES = [
  "Rewriting the story from here...",
  "The Meridian is changing course...",
  "Something is different now...",
];
const AppContext = createContext(null);

function groupKey(ids) {
  return [...new Set((ids || []).filter(Boolean))].sort().join("&");
}

function userFor(id, users = FAMILY) {
  return users.find((u) => u.userId === id) || FAMILY.find((u) => u.userId === id) || { userId: id, displayName: id, avatar: "✦" };
}

function tierForReaders(readers) {
  if ((readers || []).includes("talia")) return 1;
  if ((readers || []).includes("keen")) return 2;
  return 3;
}

async function execute(command, args = {}) {
  const response = await fetch(`${ABILITY_URL}/v1/execute`, {
    method: "POST",
    headers: abilityHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ command, args }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("Storyforge is not signed in on this device (no token). Ask Jonathan.");
  if (!response.ok || data.ok === false || data.error) throw new Error(data.message || data.error || "Storyforge request failed");
  return data;
}

function AppProvider({ children }) {
  const [users, setUsers] = useState(FAMILY);
  const [activeReaders, setActiveReaders] = useState(() => {
    try {
      const defaultReader = localStorage.getItem("storyforge_default_reader");
      if (defaultReader) return [defaultReader];
      const saved = JSON.parse(localStorage.getItem("storyforge_reading_group") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [currentUniverse, setCurrentUniverse] = useState(null);
  const [currentStory, setCurrentStory] = useState(null);
  const value = useMemo(() => ({
    users,
    setUsers,
    activeReaders,
    setActiveReaders,
    readingGroup: groupKey(activeReaders),
    currentUniverse,
    setCurrentUniverse,
    currentStory,
    setCurrentStory,
    primaryReader: activeReaders[0] || "jonathan",
  }), [users, activeReaders, currentUniverse, currentStory]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function useApp() {
  return useContext(AppContext);
}

function Page({ children, className = "" }) {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={`page ${className}`}
      >
        {children}
      </motion.main>
    </AnimatePresence>
  );
}

function Wordmark({ small = false }) {
  return <div className={`wordmark ${small ? "wordmark-small" : ""}`}>Storyforge</div>;
}

function Avatars({ ids, className = "" }) {
  const { users } = useApp();
  return <span className={`avatars ${className}`}>{(ids || []).map((id) => <span key={id}>{userFor(id, users).avatar}</span>)}</span>;
}

function ReaderPicker() {
  const nav = useNavigate();
  const { users, setUsers, activeReaders, setActiveReaders } = useApp();
  const [pending, setPending] = useState(activeReaders);
  useEffect(() => {
    execute("storyforge.user.list.v1", { tenantId: "core", userId: "jonathan" })
      .then((res) => setUsers(res.users || FAMILY))
      .catch(() => setUsers(FAMILY));
  }, [setUsers]);
  const selectedNames = pending.map((id) => userFor(id, users).displayName);
  const label = pending.length === 0
    ? "Select at least one reader"
    : pending.length === 1
      ? `Reading as ${selectedNames[0]}`
      : `${selectedNames.join(" & ")} reading together`;

  function toggle(id) {
    setPending((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort());
  }

  function start() {
    if (!pending.length) return;
    const next = [...pending].sort();
    localStorage.setItem("storyforge_reading_group", JSON.stringify(next));
    if (next.length === 1) localStorage.setItem("storyforge_default_reader", next[0]);
    else localStorage.removeItem("storyforge_default_reader");
    setActiveReaders(next);
    nav("/universes");
  }

  return (
    <Page className="reader-screen">
      <section className="reader-shell">
        <Wordmark />
        <p className="subtitle">Who's reading?</p>
        <div className="reader-grid">
          {users.map((user) => {
            const selected = pending.includes(user.userId);
            return (
              <motion.button
                whileTap={{ scale: 0.97 }}
                key={user.userId}
                onClick={() => toggle(user.userId)}
                className={`reader-card ${selected ? "selected" : ""}`}
              >
                <span className="reader-check">✓</span>
                <span className="reader-emoji">{user.avatar}</span>
                <span className="reader-name">{user.displayName}</span>
              </motion.button>
            );
          })}
        </div>
        <AnimatePresence>
          <motion.button
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            className="gold-button"
            disabled={!pending.length}
            onClick={start}
          >
            {label}
          </motion.button>
        </AnimatePresence>
      </section>
    </Page>
  );
}

function Home() {
  const { activeReaders } = useApp();
  const defaultReader = localStorage.getItem("storyforge_default_reader");
  if (defaultReader && activeReaders.length === 1) return <Navigate to="/universes" replace />;
  return <ReaderPicker />;
}

function AppHeader({ backTo, title, right }) {
  const nav = useNavigate();
  const { activeReaders, users } = useApp();
  const primary = userFor(activeReaders[0] || "jonathan", users);
  return (
    <header className="app-header">
      <button className="icon-button" onClick={() => nav(backTo || -1)} aria-label="Back">←</button>
      <div className="header-title">{title || <Wordmark small />}</div>
      <button className="avatar-cluster reader-indicator" onClick={() => { localStorage.removeItem("storyforge_default_reader"); nav("/"); }} aria-label="Switch readers">
        <span>{primary.avatar}</span><span className="reader-indicator-name">{primary.displayName}</span>
      </button>
      {right}
    </header>
  );
}

function SkeletonCards() {
  return <div className="card-list">{[0, 1, 2].map((i) => <div className="skeleton-card" key={i} />)}</div>;
}

function UniverseList() {
  const nav = useNavigate();
  const { activeReaders, readingGroup, setCurrentUniverse } = useApp();
  const [universes, setUniverses] = useState(null);
  const [menuUniverseId, setMenuUniverseId] = useState(null);
  const [confirmUniverse, setConfirmUniverse] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    execute("storyforge.universe.list.v1", { tenantId: "core", userId: "jonathan", requestedBy: activeReaders[0] || "jonathan" })
      .then((res) => setUniverses(res.universes || []))
      .catch(() => setUniverses([]));
  }, [activeReaders]);

  async function deleteUniverse() {
    if (!confirmUniverse?.universeId) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await execute("storyforge.universe.delete.v1", {
        tenantId: "core",
        userId: "jonathan",
        universeId: confirmUniverse.universeId,
        confirm: true,
        forceWithStories: true,
      });
      setUniverses((items) => (items || []).filter((item) => item.universeId !== confirmUniverse.universeId));
      setConfirmUniverse(null);
      setMenuUniverseId(null);
    } catch (error) {
      setDeleteError(error.message || "Could not delete this universe.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Page>
      <AppHeader title={<Wordmark small />} backTo="/" />
      <section className="content">
        {universes === null && <SkeletonCards />}
        {universes?.length === 0 && (
          <div className="empty-state">
            <h1>No universes yet.</h1>
            <p>Create your first world.</p>
            <button className="gold-button" onClick={() => nav("/universes/new")}>+ New Universe</button>
          </div>
        )}
        <div className="card-list">
          <AnimatePresence>
            {universes?.map((universe) => {
              const pos = lastUniversePosition(universe, readingGroup);
              return (
                <motion.article
                  layout
                  initial={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.3 }}
                  whileTap={{ scale: 0.992 }}
                  className="universe-card"
                  key={universe.universeId}
                  onClick={() => { setCurrentUniverse(universe); nav(`/universes/${universe.universeId}`); }}
                >
                  <button
                    className="card-menu-button"
                    type="button"
                    aria-label={`Actions for ${universe.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuUniverseId((current) => current === universe.universeId ? null : universe.universeId);
                    }}
                  >
                    ⋯
                  </button>
                  {menuUniverseId === universe.universeId && (
                    <div className="card-menu" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="danger-action" onClick={() => { setDeleteError(""); setConfirmUniverse(universe); }}>
                        Delete Universe
                      </button>
                    </div>
                  )}
                  <div className="card-accent" />
                  <div className="cover-icon" style={{ color: universe.coverColor }}>{universe.coverIcon || "✦"}</div>
                  <div className="card-copy">
                    <h2>{universe.title}</h2>
                    <p>{universe.tagline || "A world waiting to be opened."}</p>
                    <div className="metadata">{universe.storyCount || 0} stories{pos ? ` · last read ${pos}` : ""}</div>
                    <button className="inline-button">{pos ? "Continue" : "Explore"}</button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      </section>
      <button className="fab" onClick={() => nav("/universes/new")} aria-label="New universe">+</button>
      <ConfirmModal
        open={Boolean(confirmUniverse)}
        title={`Delete ${confirmUniverse?.title || "this universe"}?`}
        message={`Delete ${confirmUniverse?.title || "this universe"} and all its stories? This cannot be undone.`}
        confirmLabel={deleting ? "Deleting..." : "Confirm"}
        onCancel={() => { if (!deleting) setConfirmUniverse(null); }}
        onConfirm={deleteUniverse}
        busy={deleting}
        error={deleteError}
      />
    </Page>
  );
}

function lastUniversePosition(universe, readingGroup) {
  if (!universe?.universeId) return "";
  const keys = Object.keys(localStorage).filter((key) => key.startsWith(`sf_pos_${readingGroup}_`));
  return keys.length ? "recently" : "";
}

function UniverseDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { setCurrentUniverse, setCurrentStory, activeReaders, readingGroup } = useApp();
  const [tab, setTab] = useState("stories");
  const [data, setData] = useState(null);
  const [stories, setStories] = useState(null);
  const [menuStoryId, setMenuStoryId] = useState(null);
  const [confirmStory, setConfirmStory] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exportStatus, setExportStatus] = useState({});
  useEffect(() => {
    Promise.all([
      execute("storyforge.universe.get.v1", { tenantId: "core", userId: "jonathan", universeId: id }),
      execute("storyforge.story.list.v1", { tenantId: "core", userId: "jonathan", universeId: id }),
    ]).then(([detail, list]) => {
      setData(detail);
      setStories(list.stories || []);
      setCurrentUniverse(detail.universe);
    }).catch(() => {
      setData({});
      setStories([]);
    });
  }, [id, setCurrentUniverse]);
  const universe = data?.universe || {};
  const loreLabel = tierForReaders(activeReaders) <= 2 ? "World Notes" : "Lore";

  async function deleteStory() {
    if (!confirmStory?.storyId) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await execute("storyforge.story.delete.v1", {
        tenantId: "core",
        userId: "jonathan",
        universeId: id,
        storyId: confirmStory.storyId,
        confirm: true,
      });
      setStories((items) => (items || []).filter((item) => item.storyId !== confirmStory.storyId));
      setConfirmStory(null);
      setMenuStoryId(null);
    } catch (error) {
      setDeleteError(error.message || "Could not delete this story.");
    } finally {
      setDeleting(false);
    }
  }

  function updateExportStatus(storyId, patch) {
    setExportStatus((current) => ({ ...current, [storyId]: { ...(current[storyId] || {}), ...patch } }));
  }

  async function downloadExport(url, story) {
    const safeTitle = (story.title || story.storyId || "storyforge-story").replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-") || "storyforge-story";
    const fileName = `${safeTitle}.pdf`;
    if (navigator.share) {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], fileName, { type: "application/pdf" });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ title: story.title || "Storyforge Adventure", files: [file] });
          return;
        }
      } catch {
        // Fall back to a regular browser download.
      }
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function exportStory(event, story) {
    event.stopPropagation();
    if (!story?.storyId || exportStatus[story.storyId]?.busy) return;
    updateExportStatus(story.storyId, { busy: true, message: "Generating PDF...", error: "" });
    try {
      const result = await execute("storyforge.story.export.v1", {
        tenantId: "core",
        userId: "jonathan",
        universeId: id,
        storyId: story.storyId,
        format: "pdf",
      });
      updateExportStatus(story.storyId, { busy: false, message: "PDF ready", error: "" });
      await downloadExport(result.downloadUrl, story);
      setTimeout(() => {
        setExportStatus((current) => ({ ...current, [story.storyId]: { ...(current[story.storyId] || {}), message: "" } }));
      }, 2400);
    } catch (error) {
      updateExportStatus(story.storyId, { busy: false, message: "", error: error.message || "PDF export failed." });
    }
  }

  return (
    <Page>
      <AppHeader title={universe.title || "Universe"} backTo="/universes" />
      <section className="content universe-detail">
        {!data ? <SkeletonCards /> : (
          <>
            <div className="universe-hero">
              <div className="hero-icon">{universe.coverIcon || "✦"}</div>
              <h1>{universe.title}</h1>
              <p>{universe.tagline}</p>
            </div>
            <div className="tabs">
              <button className={tab === "stories" ? "active" : ""} onClick={() => setTab("stories")}>Stories</button>
              <button className={tab === "lore" ? "active" : ""} onClick={() => setTab("lore")}>{loreLabel}</button>
            </div>
            {tab === "stories" ? (
              <div className="card-list">
                <AnimatePresence>
                  {stories?.map((story) => {
                    const pos = readPosition(readingGroup, story.storyId);
                    const exportState = exportStatus[story.storyId] || {};
                    return (
                      <motion.article
                        layout
                        initial={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
                        transition={{ duration: 0.3 }}
                        className="story-card"
                        key={story.storyId}
                        onClick={() => { setCurrentStory(story); nav(`/universes/${id}/stories/${story.storyId}`); }}
                      >
                        <div className="story-card-actions">
                          <button
                            className="card-export-button"
                            type="button"
                            aria-label={`Export ${story.title} as PDF`}
                            disabled={exportState.busy}
                            onClick={(event) => exportStory(event, story)}
                          >
                            ↓
                          </button>
                          <button
                            className="card-menu-button"
                            type="button"
                            aria-label={`Actions for ${story.title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setMenuStoryId((current) => current === story.storyId ? null : story.storyId);
                            }}
                          >
                            ⋯
                          </button>
                        </div>
                        {menuStoryId === story.storyId && (
                          <div className="card-menu" onClick={(event) => event.stopPropagation()}>
                            <button type="button" className="danger-action" onClick={() => { setDeleteError(""); setConfirmStory(story); }}>
                              Delete Story
                            </button>
                          </div>
                        )}
                        <h2>{story.title}</h2>
                        <p>{story.genre || "family adventure"}</p>
                        <div className="metadata">{story.totalChapters || 0} chapters · {pos.chapter ? `Chapter ${pos.chapter}` : "not started"}</div>
                        <Progress value={pos.chapter || 0} max={story.totalChapters || 1} />
                        {(exportState.message || exportState.error) && (
                          <div className={exportState.error ? "inline-error story-export-status" : "story-export-status"}>
                            {exportState.error || exportState.message}
                          </div>
                        )}
                        <Avatars ids={story.primaryReaders || activeReaders} />
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
                <button className="outline-button" onClick={() => nav(`/universes/${id}/new-story`)}>+ Begin a New Story</button>
              </div>
            ) : <Lore data={data} />}
          </>
        )}
      </section>
      <ConfirmModal
        open={Boolean(confirmStory)}
        title={`Delete ${confirmStory?.title || "this story"}?`}
        message={`Delete ${confirmStory?.title || "this story"}? This cannot be undone.`}
        confirmLabel={deleting ? "Deleting..." : "Confirm"}
        onCancel={() => { if (!deleting) setConfirmStory(null); }}
        onConfirm={deleteStory}
        busy={deleting}
        error={deleteError}
      />
    </Page>
  );
}

function ConfirmModal({ open, title, message, confirmLabel = "Confirm", onCancel, onConfirm, busy, error }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="modal-shade" type="button" aria-label="Cancel" onClick={onCancel} />
          <motion.section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.2 }}
          >
            <h2>{title}</h2>
            <p>{message}</p>
            {error && <div className="inline-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
              <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Progress({ value, max }) {
  return <div className="progress-track"><span style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} /></div>;
}

function Lore({ data }) {
  const bible = data?.bible || {};
  const characters = data?.characters || [];
  return (
    <div className="lore">
      <LoreSection title="World Rules">{(bible.worldRules || []).map((rule, i) => <div className="lore-card italic" key={i}>{rule}</div>)}</LoreSection>
      <LoreSection title="Characters">{characters.map((c) => <div className="lore-card" key={c.characterId}><h3>{c.name}</h3><p>{c.description}</p><span>{c.role}</span><small>{c.currentStatus}</small></div>)}</LoreSection>
      <LoreSection title="Locations">{(bible.locations || []).map((loc, i) => <div className="lore-card" key={i}><h3>{loc.name || "Unknown"}</h3><p>{loc.description || String(loc)}</p></div>)}</LoreSection>
      <LoreSection title="Open Mysteries">{(bible.openMysteries || []).map((m, i) => <div className="lore-card muted-card" key={i}>Something stirs in {String(m).replace(/^where|what|who/i, "").trim()}...</div>)}</LoreSection>
      <LoreSection title="Lore Entries">{(bible.lore || []).map((entry, i) => <p className="lore-paragraph" key={i}>{entry}</p>)}</LoreSection>
    </div>
  );
}

function LoreSection({ title, children }) {
  const list = React.Children.toArray(children).filter(Boolean);
  if (!list.length) return null;
  return <section className="lore-section"><h2>{title}</h2>{list}</section>;
}

function ChapterReader() {
  const { id, storyId } = useParams();
  const nav = useNavigate();
  const { readingGroup, activeReaders, setCurrentStory } = useApp();
  const [story, setStory] = useState(null);
  const [chapter, setChapter] = useState(null);
  const [chapterNumber, setChapterNumber] = useState(null);
  const [choicesVisible, setChoicesVisible] = useState(false);
  const [choiceRevealPending, setChoiceRevealPending] = useState(false);
  const [showChoiceTooltip, setShowChoiceTooltip] = useState(false);
  const [waiting, setWaiting] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [entities, setEntities] = useState([]);
  const [reshapePromptPoint, setReshapePromptPoint] = useState(null);
  const [reshapePoint, setReshapePoint] = useState(null);
  const [reshapeAnchor, setReshapeAnchor] = useState(null);
  const [interactTarget, setInteractTarget] = useState(null);
  const [talkMode, setTalkMode] = useState("ask");
  const [talkText, setTalkText] = useState("");
  const [proseReady, setProseReady] = useState(true);
  const [reshapedPulse, setReshapedPulse] = useState(false);
  const [bookmarkFlash, setBookmarkFlash] = useState(false);
  const [defineWord, setDefineWord] = useState(null);
  const tier = tierForReaders(activeReaders);

  function saveBookmarkHere() {
    if (!chapter) return;
    const point = paragraphAtScroll(chapter);
    writeBookmark(storyId, {
      chapterNumber,
      paragraphIndex: point.index,
      snippet: String(point.text || "").slice(0, 90),
      savedBy: activeReaders[0] || "jonathan",
      savedAt: Date.now(),
    });
    setBookmarkFlash(true);
    setTimeout(() => setBookmarkFlash(false), 1600);
  }

  useEffect(() => {
    let cancelled = false;
    setStory(null);
    setChapter(null);
    setChapterNumber(null);
    setProgress(0);
    execute("storyforge.story.list.v1", { tenantId: "core", userId: "jonathan", universeId: id })
      .then((res) => {
        const found = (res.stories || []).find((s) => s.storyId === storyId);
        if (cancelled) return;
        const loadedStory = found || { storyId, title: "Story", totalChapters: 1, currentChapter: 1 };
        const saved = readPosition(readingGroup, storyId);
        const bookmark = readBookmark(storyId);
        const total = storyChapterLimit(loadedStory);
        const target = clampChapter(
          bookmark?.chapterNumber || saved.chapter || loadedStory.currentChapter || loadedStory.totalChapters || 1,
          total
        );
        setStory(loadedStory);
        setCurrentStory(found);
        setChapterNumber(target);
      })
      .catch(() => {
        if (cancelled) return;
        const saved = readPosition(readingGroup, storyId);
        const bookmark = readBookmark(storyId);
        const landingChapter = bookmark?.chapterNumber || saved.chapter || 1;
        const fallbackStory = { storyId, title: "Story", totalChapters: landingChapter, currentChapter: landingChapter };
        setStory(fallbackStory);
        setCurrentStory(null);
        setChapterNumber(landingChapter);
      });
    return () => {
      cancelled = true;
    };
  }, [id, storyId, readingGroup, setCurrentStory]);

  useEffect(() => {
    execute("storyforge.universe.get.v1", { tenantId: "core", userId: "jonathan", universeId: id })
      .then((res) => setEntities(extractEntities(res, tier)))
      .catch(() => setEntities([]));
  }, [id, tier]);

  useEffect(() => {
    if (!chapterNumber) return undefined;
    setChoicesVisible(false);
    setChoiceRevealPending(false);
    setWaiting(null);
    setChapter(null);
    getChapter(id, storyId, chapterNumber)
      .then((res) => setChapter(res))
      .catch(() => setChapter({ ok: false, error: "chapter_not_found" }));
    const timer = setTimeout(() => queueChoiceReveal(), 240000);
    return () => clearTimeout(timer);
  }, [id, storyId, chapterNumber]);

  useEffect(() => {
    const hasHeroImage = tier === 2 && (chapter?.images || []).some((img) => img.url);
    if (!hasHeroImage) {
      setProseReady(true);
      return undefined;
    }
    setProseReady(false);
    const timer = setTimeout(() => setProseReady(true), 2000);
    return () => clearTimeout(timer);
  }, [chapter, tier]);

  useEffect(() => {
    if (!chapterNumber) return undefined;
    const handler = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const pct = scrollable > 0 ? window.scrollY / scrollable : 0;
      setProgress(Math.max(0, Math.min(1, pct)));
      writePosition(readingGroup, storyId, chapterNumber, pct);
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 150) queueChoiceReveal();
    };
    window.addEventListener("scroll", handler, { passive: true });
    requestAnimationFrame(() => {
      const bookmark = readBookmark(storyId);
      if (bookmark?.chapterNumber === chapterNumber && bookmark.paragraphIndex != null) {
        // Paragraph-anchor restore is robust to font-size/layout changes in a
        // way a scroll PERCENTAGE never is -- exactly the pattern the reshape
        // flow already uses to scroll back to its own edit point.
        const node = document.querySelector(`[data-paragraph-index="${bookmark.paragraphIndex}"]`);
        if (node) {
          node.scrollIntoView({ behavior: "auto", block: "start" });
          return;
        }
      }
      const saved = readPosition(readingGroup, storyId);
      if (saved.chapter === chapterNumber && saved.scrollPercent) window.scrollTo(0, saved.scrollPercent * (document.documentElement.scrollHeight - window.innerHeight));
    });
    return () => window.removeEventListener("scroll", handler);
  }, [readingGroup, storyId, chapterNumber]);

  function queueChoiceReveal() {
    if (choicesVisible || choiceRevealPending) return;
    setChoiceRevealPending(true);
    setTimeout(() => {
      setChoicesVisible(true);
      setChoiceRevealPending(false);
      if (activeReaders.length === 1) {
        const key = `storyforge_seen_choice_tooltip_${activeReaders[0]}`;
        if (!localStorage.getItem(key)) {
          setShowChoiceTooltip(true);
          localStorage.setItem(key, "1");
        }
      }
    }, 800);
  }

  useEffect(() => {
    if (!waiting?.chapterNumber) return undefined;
    let cancelled = false;
    const targetChapter = waiting.chapterNumber;
    const startedAt = waiting.startedAt || Date.now();
    async function poll() {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > 120000) {
        setWaiting((current) => current?.chapterNumber === targetChapter ? { ...current, timedOut: true } : current);
        return;
      }
      setWaiting((current) => current?.chapterNumber === targetChapter
        ? { ...current, messageIndex: ((current.messageIndex || 0) + 1) % CHAPTER_WAIT_MESSAGES.length }
        : current);
      try {
        const status = await getChapterStatus(id, storyId, targetChapter);
        if (cancelled) return;
        if (status.status === "complete" && status.chapter) {
          cacheChapter(`sf_chapter_cache_${storyId}`, status.chapter);
          setChapter(status.chapter);
          setChapterNumber(targetChapter);
          setWaiting(null);
          setReshapedPulse(waiting.kind === "reshape");
          requestAnimationFrame(() => {
            if (waiting.kind === "reshape" && reshapeAnchor?.index != null) {
              document.querySelector(`[data-paragraph-index="${reshapeAnchor.index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            } else {
              window.scrollTo(0, 0);
            }
          });
          setTimeout(() => setReshapedPulse(false), 1800);
        } else if (status.status === "failed") {
          setWaiting((current) => current?.chapterNumber === targetChapter
            ? { ...current, failed: true, error: status.error || "Chapter generation failed." }
            : current);
        }
      } catch (error) {
        if (!cancelled) {
          setWaiting((current) => current?.chapterNumber === targetChapter
            ? { ...current, error: error.message || "Could not check chapter status." }
            : current);
        }
      }
    }
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, storyId, waiting?.chapterNumber, waiting?.startedAt]);

  useSwipe((dir) => {
    if (!chapterNumber) return;
    const total = storyChapterLimit(story, chapterNumber);
    if (dir === "left" && chapterNumber < total) {
      setChapterNumber(chapterNumber + 1);
      window.scrollTo(0, 0);
    }
    if (dir === "right" && chapterNumber > 1) {
      setChapterNumber(chapterNumber - 1);
      window.scrollTo(0, 0);
    }
  });

  async function choose(choice) {
    const nextChapter = chapterNumber + 1;
    setWaiting({ chapterNumber: nextChapter, startedAt: Date.now(), messageIndex: 0 });
    try {
      await execute("storyforge.choice.record.v1", {
        tenantId: "core",
        userId: "jonathan",
        universeId: id,
        storyId,
        chapterNumber,
        choiceId: String(choice.id || ""),
        choiceText: choice.text || String(choice),
        madeBy: activeReaders[0] || "jonathan",
        protagonistId: readingGroup,
        protagonistGroup: activeReaders.length > 1 ? readingGroup : null,
      });
    } catch (error) {
      setWaiting({ chapterNumber: nextChapter, startedAt: Date.now(), failed: true, error: error.message || "Choice could not be recorded." });
    }
  }

  async function submitReshape(text, point = reshapePoint) {
    if (!text.trim() || !point) return;
    setWaiting({ kind: "reshape", chapterNumber, startedAt: Date.now(), messageIndex: 0 });
    setReshapeAnchor(point);
    setReshapePoint(null);
    setReshapePromptPoint(null);
    await execute("storyforge.chapter.reshape.v1", {
      tenantId: "core",
      userId: activeReaders[0] || "jonathan",
      universeId: id,
      storyId,
      chapterNumber,
      interventionText: text,
      interventionPoint: point.text,
    }).catch((error) => setWaiting({ kind: "reshape", chapterNumber, startedAt: Date.now(), failed: true, error: error.message || "Could not reshape the story." }));
  }

  async function submitTalk(event) {
    event.preventDefault();
    const text = talkText.trim();
    if (!text) return;
    setTalkText("");
    if (talkMode === "change") {
      const point = paragraphAtScroll(chapter);
      setReshapePoint(point);
      await submitReshape(text, point);
      return;
    }
    const target = inferEntityTarget(text, entities) || entities[0] || { name: story?.title || "the story", type: "setting", context: "" };
    setInteractTarget({ ...target, pendingQuestion: text });
  }

  if (!chapter || !chapterNumber) return <ReadingLoading text="Turning the page..." />;
  const waitMessages = waiting?.kind === "reshape" ? RESHAPE_WAIT_MESSAGES : CHAPTER_WAIT_MESSAGES;
  if (waiting) {
    return (
      <WaitingState
        text={waitMessages[waiting.messageIndex || 0]}
        timedOut={waiting.timedOut}
        error={waiting.error}
        onRetry={() => setWaiting((current) => current ? { ...current, startedAt: Date.now(), timedOut: false, failed: false, error: "" } : current)}
      />
    );
  }

  return (
    <Page className="reader-page">
      <div className="scroll-progress" style={{ transform: `scaleX(${progress})` }} />
      <header className="reader-header">
        <button className="icon-button" onClick={() => nav(`/universes/${id}`)}>←</button>
        <div className="reader-title">{story?.title || "Story"}</div>
        <button className="icon-button" onClick={saveBookmarkHere} aria-label="Save your spot here">🔖</button>
        <button className="icon-button" onClick={() => setMenuOpen(true)}>≡</button>
        <Avatars ids={activeReaders} />
      </header>
      <AnimatePresence>
        {bookmarkFlash && (
          <motion.div
            className="bookmark-toast"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            Spot saved — come back here next time
          </motion.div>
        )}
      </AnimatePresence>
      <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="reading-column">
        <div className="chapter-kicker">Chapter {chapter.chapterNumber}</div>
        <h1>{chapter.chapterTitle}</h1>
        <div className="gold-divider" />
        <ChapterImages chapter={chapter} tier={tier} onHeroLoad={() => setProseReady(true)} />
        {proseReady && <Prose chapter={chapter} tier={tier} entities={entities} onLongPress={setReshapePromptPoint} onEntityTap={setInteractTarget} onWordTap={tier !== 1 ? setDefineWord : undefined} pulseFrom={reshapedPulse ? reshapeAnchor?.index : null} />}
        {choiceRevealPending && <div className="choice-sweep" />}
        <ChoicePanel visible={choicesVisible} chapter={chapter} readers={activeReaders} onChoose={choose} showTooltip={showChoiceTooltip} onDismissTooltip={() => setShowChoiceTooltip(false)} />
        {tier !== 1 && <TalkBar mode={talkMode} setMode={setTalkMode} value={talkText} setValue={setTalkText} onSubmit={submitTalk} tier={tier} />}
      </motion.article>
      <ChapterMenu open={menuOpen} onClose={() => setMenuOpen(false)} total={storyChapterLimit(story, chapter.chapterNumber)} current={chapterNumber} onJump={(n) => { setMenuOpen(false); setChapterNumber(n); window.scrollTo(0, 0); }} />
      <ReshapeConfirm point={reshapePromptPoint} onCancel={() => setReshapePromptPoint(null)} onConfirm={() => { setReshapePoint(reshapePromptPoint); setReshapePromptPoint(null); }} />
      <ReshapeSheet point={reshapePoint} tier={tier} onCancel={() => setReshapePoint(null)} onSubmit={submitReshape} />
      <InteractionSheet target={interactTarget} tier={tier} chapter={chapter} universeId={id} storyId={storyId} userId={activeReaders[0] || "jonathan"} onClose={() => setInteractTarget(null)} />
      <WordDefinition word={defineWord} onClose={() => setDefineWord(null)} />
    </Page>
  );
}

function storyChapterLimit(story, fallback = 1) {
  return Math.max(
    1,
    Number(story?.totalChapters || 0),
    Number(story?.currentChapter || 0),
    Number(fallback || 1),
  );
}

function clampChapter(chapter, total) {
  const parsed = Number(chapter || 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(Math.trunc(parsed), Math.max(1, Number(total || 1))));
}

function extractEntities(data, tier = 3) {
  const characters = (data?.characters || []).map((c) => ({ name: c.name || c.characterId, type: "character", description: c.description || c.role || "" })).filter((x) => x.name);
  if (tier === 1) return characters;
  const locations = ((data?.bible || {}).locations || []).map((l) => ({ name: l.name || String(l), type: "setting", description: l.description || "" })).filter((x) => x.name && x.name.length > 2);
  return [...characters, ...locations].sort((a, b) => b.name.length - a.name.length).slice(0, 30);
}

function inferEntityTarget(text, entities) {
  const lower = String(text || "").toLowerCase();
  return (entities || []).find((entity) => lower.includes(String(entity.name).toLowerCase()));
}

function paragraphAtScroll(chapter) {
  const nodes = [...document.querySelectorAll("[data-paragraph-index]")];
  const target = nodes.find((node) => node.getBoundingClientRect().bottom > window.innerHeight * 0.35) || nodes[0];
  const index = Number(target?.dataset.paragraphIndex || 0);
  const paragraphs = String(chapter?.prose || "").split(/\n+/).filter(Boolean);
  return { index, text: paragraphs[index] || paragraphs[0] || "" };
}

function ChapterImages({ chapter, tier, onHeroLoad }) {
  const images = (chapter.images || []).filter((img) => img.url);
  if (!images.length) return null;
  if (tier === 1) return null;
  return <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="chapter-image hero-image" src={images[0].url} alt={images[0].sceneDescription || "Chapter illustration"} onLoad={onHeroLoad} />;
}

function Prose({ chapter, tier, entities, onLongPress, onEntityTap, onWordTap, pulseFrom }) {
  const paragraphs = String(chapter.prose || "").split(/\n+/).filter(Boolean);
  const images = (chapter.images || []).filter((img) => img.url);
  return (
    <div className={`prose ${pulseFrom != null ? "reshaped-pulse" : ""}`}>
      {paragraphs.map((p, i) => (
        <React.Fragment key={i}>
          <InteractiveParagraph text={p} index={i} entities={entities} onLongPress={onLongPress} onEntityTap={onEntityTap} onWordTap={onWordTap} pulsing={pulseFrom != null && i >= pulseFrom} />
          {tier === 1 && images[i % Math.max(1, images.length)] && i > 0 && i % 2 === 1 && (
            <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="chapter-image" src={images[i % images.length].url} alt={images[i % images.length].sceneDescription || "Chapter illustration"} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function InteractiveParagraph({ text, index, entities, onLongPress, onEntityTap, onWordTap, pulsing }) {
  const timer = useRef(null);
  // 2026-08-27: a genuine 600ms hold-and-release can still fire a native
  // click on some browsers. Set the instant the long-press callback actually
  // fires, checked (and cleared) by the very next word tap -- so a real long
  // press never also pops the dictionary sheet underneath the reshape prompt.
  const suppressNextTap = useRef(false);
  function startPress() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      suppressNextTap.current = true;
      onLongPress({ index, text });
    }, 600);
  }
  function endPress() {
    clearTimeout(timer.current);
  }
  function handleWordTap(word) {
    if (suppressNextTap.current) {
      suppressNextTap.current = false;
      return;
    }
    onWordTap(word);
  }
  return (
    <p
      data-paragraph-index={index}
      className={pulsing ? "paragraph-pulse" : ""}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onPointerLeave={endPress}
    >
      {renderInteractiveText(text, entities, onEntityTap, onWordTap ? handleWordTap : null)}
    </p>
  );
}

// 2026-08-27: layered on top of renderEntityText rather than replacing it --
// entity names (characters, places) keep their existing tap-to-interact
// behaviour untouched; this only wraps the PLAIN-text segments in between
// with individually tappable words for the short-tap dictionary. Words under
// 3 letters are left alone (tapping "a" or "is" for a definition is just
// noise), and onWordTap being falsy (tier 1 / Talia) makes this a no-op that
// falls straight back to the original entity-only rendering.
function renderInteractiveText(text, entities, onEntityTap, onWordTap) {
  const base = renderEntityText(text, entities, onEntityTap);
  if (!onWordTap) return base;
  let key = 10000;
  return base.flatMap((piece) => {
    if (typeof piece !== "string") return [piece];
    return piece.split(/(\s+)/).map((token) => {
      const clean = token.replace(/[^a-zA-Z']/g, "");
      if (!clean || clean.length < 3 || /^\s+$/.test(token)) return token;
      return (
        <span
          key={key++}
          className="tap-word"
          onClick={(event) => {
            event.stopPropagation();
            onWordTap(clean.toLowerCase());
          }}
        >
          {token}
        </span>
      );
    });
  });
}

function renderEntityText(text, entities, onEntityTap) {
  let remaining = text;
  const out = [];
  let key = 0;
  while (remaining) {
    const match = (entities || []).map((entity) => {
      const idx = remaining.toLowerCase().indexOf(String(entity.name).toLowerCase());
      return idx >= 0 ? { entity, idx } : null;
    }).filter(Boolean).sort((a, b) => a.idx - b.idx || b.entity.name.length - a.entity.name.length)[0];
    if (!match) {
      out.push(remaining);
      break;
    }
    if (match.idx > 0) out.push(remaining.slice(0, match.idx));
    const label = remaining.slice(match.idx, match.idx + match.entity.name.length);
    out.push(<button type="button" className="entity-link" key={key++} onClick={(event) => { event.stopPropagation(); onEntityTap({ ...match.entity, context: text }); }}>{label}</button>);
    remaining = remaining.slice(match.idx + match.entity.name.length);
  }
  return out;
}

function ChoicePanel({ visible, chapter, readers, onChoose, showTooltip, onDismissTooltip }) {
  if (!chapter?.choices?.length || chapter.choiceMade) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 24, visibility: "hidden", pointerEvents: "none" }}
      animate={visible ? { opacity: 1, y: 0, visibility: "visible", pointerEvents: "auto" } : { opacity: 0, y: 24, visibility: "hidden", pointerEvents: "none" }}
      transition={{ duration: 0.4 }}
      className="choice-panel"
    >
      {showTooltip && <button type="button" className="choice-tooltip" onClick={onDismissTooltip}>The story is waiting for you.<br />Tap what happens next.</button>}
      <p>{choicePrompt(readers)}</p>
      {chapter.choices.slice(0, 3).map((choice, i) => (
        <motion.button
          key={choice.id || i}
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
          transition={{ delay: i * 0.15 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => onChoose(choice)}
        >
          {choice.text || choice}
        </motion.button>
      ))}
    </motion.section>
  );
}

function choicePrompt(readers) {
  const key = groupKey(readers);
  if (key === "talia") return "What does Talia want to do?";
  if (key === "keen") return "Keen, what's your instinct?";
  if (key === "jonathan&keen") return "What do you two decide?";
  if (key === "adele&keen") return "What feels right?";
  if (key === "adele&jonathan&keen&talia") return "What does the family do?";
  return "What happens next?";
}

function TalkBar({ mode, setMode, value, setValue, onSubmit, tier }) {
  return (
    <form className="story-talk" onSubmit={onSubmit}>
      <div className="talk-toggle">
        <button type="button" className={mode === "ask" ? "active" : ""} onClick={() => setMode("ask")}>Ask</button>
        <button type="button" className={mode === "change" ? "active" : ""} onClick={() => setMode("change")}>Change</button>
      </div>
      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={tier === 2 ? "Ask a character or change the story..." : "Talk to the story..."} />
      <button type="submit" className="gold-button">Send</button>
    </form>
  );
}

function ReshapeConfirm({ point, onCancel, onConfirm }) {
  if (!point) return null;
  return (
    <motion.div className="reshape-popover" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
      <div>
        <strong>Change something here?</strong>
        <p>{point.text}</p>
      </div>
      <div className="reshape-popover-actions">
        <button type="button" className="gold-button" onClick={onConfirm}>Yes, reshape from here</button>
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      </div>
    </motion.div>
  );
}

function ReshapeSheet({ point, tier, onCancel, onSubmit }) {
  const [text, setText] = useState("");
  useEffect(() => setText(""), [point]);
  if (!point) return null;
  return (
    <motion.div className="bottom-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button className="sheet-shade" onClick={onCancel} />
      <motion.section className="sheet-panel" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}>
        <h2>{tier === 2 ? "What should happen differently?" : "What do you want to change from here?"}</h2>
        <p className="sheet-context">{point.text}</p>
        <textarea value={text} onChange={(event) => setText(event.target.value)} autoFocus />
        <button className="gold-button" onClick={() => onSubmit(text, point)} disabled={!text.trim()}>Reshape the story →</button>
        <button className="secondary-button" onClick={onCancel}>Cancel</button>
      </motion.section>
    </motion.div>
  );
}

function InteractionSheet({ target, tier, chapter, universeId, storyId, userId, onClose }) {
  const [question, setQuestion] = useState("");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setItems((chapter.interactions || []).filter((item) => item.targetName === target?.name));
    setQuestion("");
    if (target?.pendingQuestion) submit(target.pendingQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.name]);
  if (!target) return null;
  async function submit(value = question) {
    const q = String(value || "").trim();
    if (!q) return;
    setBusy(true);
    setQuestion("");
    try {
      const res = await execute("storyforge.interact.v1", {
        tenantId: "core",
        userId,
        universeId,
        storyId,
        chapterNumber: chapter.chapterNumber,
        targetType: target.type,
        targetName: target.name,
        question: q,
        context: target.context || "",
      });
      setItems((current) => [...current, { question: q, response: res.response }]);
    } catch (error) {
      setItems((current) => [...current, { question: q, response: error.message || "No answer came back." }]);
    } finally {
      setBusy(false);
    }
  }
  const presets = ["What's your favorite thing?", "Are you scared?", "What happens next?"];
  return (
    <motion.div className="bottom-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button className="sheet-shade" onClick={onClose} />
      <motion.section className="sheet-panel interaction-panel" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}>
        <h2>{tier === 2 ? `${target.type === "character" ? "Talk to" : "Explore"} ${target.name}` : target.name}</h2>
        {target.description && <p className="sheet-context">{target.description}</p>}
        <div className="interaction-log">
          {items.map((item, index) => <div className="interaction-item" key={index}><strong>{item.question}</strong><blockquote>{item.response}</blockquote></div>)}
        </div>
        {tier === 1 ? (
          <div className="preset-questions">{presets.map((p) => <button key={p} onClick={() => submit(p)} disabled={busy}>{p}</button>)}</div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="interaction-form">
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={tier === 2 ? "What do you want to ask?" : "Say something or ask a question..."} />
            <button className="gold-button" disabled={busy || !question.trim()}>{busy ? "Listening..." : "Send"}</button>
          </form>
        )}
      </motion.section>
    </motion.div>
  );
}

function WordDefinition({ word, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!word) return undefined;
    let cancelled = false;
    setData(null);
    setError("");
    execute("storyforge.word.define.v1", { tenantId: "core", userId: "jonathan", word })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not look that word up.");
      });
    return () => {
      cancelled = true;
    };
  }, [word]);

  return (
    <AnimatePresence>
      {word && (
        <motion.div className="bottom-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="sheet-shade" onClick={onClose} />
          <motion.section className="sheet-panel word-define-panel" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}>
            <h2>
              {word}
              {data?.phonetic ? <span className="word-phonetic"> {data.phonetic}</span> : null}
            </h2>
            {!data && !error && <p className="sheet-context">Looking it up...</p>}
            {error && <p className="sheet-context">{error}</p>}
            {data?.ok === false && <p className="sheet-context">No definition found for that word.</p>}
            {data?.definitions?.map((d, i) => (
              <div className="word-def-item" key={i}>
                {d.partOfSpeech && <span className="word-pos">{d.partOfSpeech}</span>}
                <p>{d.text}</p>
              </div>
            ))}
            {data?.synonyms?.length > 0 && (
              <p className="word-extra"><strong>Similar words:</strong> {data.synonyms.join(", ")}</p>
            )}
            {data?.etymology && (
              <p className="word-extra"><strong>Where it comes from:</strong> {data.etymology}</p>
            )}
            <button className="secondary-button" onClick={onClose}>Close</button>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ChapterMenu({ open, onClose, total, current, onJump }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="drawer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="drawer-shade" onClick={onClose} />
          <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.25 }} className="drawer-panel">
            <h2>Chapters</h2>
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => <button className={n === current ? "current" : ""} key={n} onClick={() => onJump(n)}>Chapter {n}</button>)}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useSwipe(onSwipe) {
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    const start = (event) => {
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };
    const end = (event) => {
      const dx = event.changedTouches[0].clientX - startX;
      const dy = Math.abs(event.changedTouches[0].clientY - startY);
      if (Math.abs(dx) > 70 && dy < 55) onSwipe(dx < 0 ? "left" : "right");
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", end);
    };
  }, [onSwipe]);
}

function readPosition(group, storyId) {
  try {
    return JSON.parse(localStorage.getItem(`sf_pos_${group}_${storyId}`) || "{}");
  } catch {
    return {};
  }
}

function writePosition(group, storyId, chapter, scrollPercent) {
  localStorage.setItem(`sf_pos_${group}_${storyId}`, JSON.stringify({ chapter, scrollPercent, lastRead: Date.now() }));
}

// 2026-08-27: the passive position above is keyed by readingGroup (whoever is
// marked active right now), which is exactly why it silently breaks across
// sessions -- Keen reading solo saves under "keen"; Jonathan opening later
// with a different active-reader selection looks under a different key and
// finds nothing, landing at the story's official latest chapter instead of
// where the family actually stopped. An explicit bookmark is keyed by
// storyId ALONE, survives any change in who's marked active, and represents
// deliberate "we stopped here" intent rather than ambient scroll tracking.
function readBookmark(storyId) {
  try {
    return JSON.parse(localStorage.getItem(`sf_bookmark_${storyId}`) || "null");
  } catch {
    return null;
  }
}

function writeBookmark(storyId, bookmark) {
  localStorage.setItem(`sf_bookmark_${storyId}`, JSON.stringify(bookmark));
}

async function getChapter(universeId, storyId, chapterNumber) {
  const cacheKey = `sf_chapter_cache_${storyId}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "[]");
    const hit = cached.find((item) => item.chapterNumber === chapterNumber);
    if (hit?.chapter) {
      execute("storyforge.chapter.get.v1", { tenantId: "core", userId: "jonathan", universeId, storyId, chapterNumber })
        .then((fresh) => cacheChapter(cacheKey, fresh))
        .catch(() => {});
      return hit.chapter;
    }
  } catch {
    // Ignore broken local cache; the network remains source of truth.
  }
  const chapter = await execute("storyforge.chapter.get.v1", { tenantId: "core", userId: "jonathan", universeId, storyId, chapterNumber });
  cacheChapter(cacheKey, chapter);
  return chapter;
}

async function getChapterStatus(universeId, storyId, chapterNumber) {
  const params = new URLSearchParams({
    tenantId: "core",
    userId: "jonathan",
    universeId,
    storyId,
    chapterNumber: String(chapterNumber),
  });
  const response = await fetch(`${ABILITY_URL}/storyforge/chapter/status?${params.toString()}`, { cache: "no-store", headers: abilityHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false || data.error) throw new Error(data.message || data.error || "Could not check chapter status");
  return data;
}

function cacheChapter(cacheKey, chapter) {
  if (!chapter?.chapterNumber) return;
  try {
    const current = JSON.parse(localStorage.getItem(cacheKey) || "[]").filter((item) => item.chapterNumber !== chapter.chapterNumber);
    const next = [{ chapterNumber: chapter.chapterNumber, chapter, cachedAt: Date.now() }, ...current].slice(0, 3);
    localStorage.setItem(cacheKey, JSON.stringify(next));
  } catch {
    // Device storage can be unavailable in private mode.
  }
}

function ReadingLoading({ text }) {
  return <Page className="waiting-page"><WaitingState text={text} /></Page>;
}

function WaitingState({ text, timedOut, error, onRetry }) {
  return (
    <div className="waiting">
      <div className="compass" />
      <h1>{timedOut ? "This is taking longer than expected." : text}</h1>
      <p>{error || "The page is turning under a different sky."}</p>
      {timedOut && <button className="gold-button waiting-retry" onClick={onRetry}>Try Again</button>}
    </div>
  );
}

function NewUniverse() {
  const nav = useNavigate();
  const { primaryReader, activeReaders } = useApp();
  const [style, setStyle] = useState("Golden age illustration");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [explained, setExplained] = useState(() => localStorage.getItem(`storyforge_seen_universe_explainer_${primaryReader}`) === "1");
  const tier = tierForReaders(activeReaders);
  function acceptExplainer() {
    localStorage.setItem(`storyforge_seen_universe_explainer_${primaryReader}`, "1");
    setExplained(true);
  }
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    setBusy(true);
    const res = await execute("storyforge.universe.create.v1", {
      tenantId: "core",
      userId: primaryReader,
      title,
      tagline: form.get("tagline"),
      genre: "family-adventure",
      coverColor: "#1a2744",
      coverIcon: "✦",
      worldSeed: form.get("worldSeed"),
    });
    nav(`/universes/${res.universeId}`);
  }
  if (tier === 2 && activeReaders.length === 1 && !explained) {
    return (
      <Page>
        <AppHeader title="New Universe" backTo="/universes" />
        <section className="creation-form explainer">
          <h1>A universe is a world with its own rules</h1>
          <p>Oceans that flow upward, cities built on clouds, or history that never happened. Every story you create lives inside a universe.</p>
          <button className="gold-button" onClick={acceptExplainer}>Got it, let's build one →</button>
        </section>
      </Page>
    );
  }
  return (
    <Page>
      <AppHeader title="New Universe" backTo="/universes" />
      <form className="creation-form" onSubmit={submit}>
        <input name="title" required placeholder="Universe name" />
        <input name="tagline" placeholder="One sentence that captures it" />
        <textarea name="worldSeed" placeholder="Describe the world in a sentence or two" />
        <div className="style-row">{["Watercolor storybook", "Ink and wash", "Golden age", "Cinematic", "Anime", "Pencil sketch", "Custom"].map((s) => <button type="button" className={style === s ? "active" : ""} key={s} onClick={() => setStyle(s)}>{s}</button>)}</div>
        {style === "Custom" && <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom image style" />}
        <button className="gold-button" disabled={busy}>{busy ? "Creating..." : "Create Universe →"}</button>
      </form>
    </Page>
  );
}

function NewStory() {
  const { id } = useParams();
  const nav = useNavigate();
  const { activeReaders, readingGroup } = useApp();
  const tier = tierForReaders(activeReaders);
  const [step, setStep] = useState(1);
  const [description, setDescription] = useState("");
  const [youngAnswers, setYoungAnswers] = useState(["", "", ""]);
  const [questions, setQuestions] = useState("");
  const [answers, setAnswers] = useState("");
  const flavors = ["Forging your story...", "Listening for the first sentence...", "Finding the true door..."];
  const [flavor, setFlavor] = useState(flavors[0]);
  useEffect(() => {
    if (step !== 3) return undefined;
    const interval = setInterval(() => setFlavor((f) => flavors[(flavors.indexOf(f) + 1) % flavors.length]), 1800);
    return () => clearInterval(interval);
  }, [step]);

  async function askQuestions() {
    if (tier === 2 && activeReaders.length === 1) {
      setDescription(`World: ${youngAnswers[0]}\nMain character: ${youngAnswers[1]}\nMost exciting thing: ${youngAnswers[2]}`);
      setQuestions("1. What feeling should this story leave behind?");
      setStep(2);
      return;
    }
    const res = await execute("storyforge.story.questions.v1", { tenantId: "core", userId: "jonathan", description, readingGroup: activeReaders });
    setQuestions(res.questions || "1. What feeling should this story leave behind?");
    setStep(2);
  }
  async function createStory() {
    setStep(3);
    const seed = `Description:\n${description}\n\nQuestions:\n${questions}\n\nAnswers:\n${answers}`;
    const res = await execute("storyforge.story.create.v1", {
      tenantId: "core",
      userId: activeReaders[0] || "jonathan",
      universeId: id,
      title: inferTitle(description),
      primaryReaders: activeReaders,
      genre: "family-adventure",
      isSpinoff: false,
      storySeed: seed,
      requestedBy: activeReaders[0] || "jonathan",
      protagonistId: readingGroup,
    });
    nav(`/universes/${id}/stories/${res.storyId}`);
  }
  if (tier === 2 && activeReaders.length === 1 && step < 3) {
    const prompts = [
      "What kind of world should this story happen in?",
      "Who is the main character?",
      "What's the most exciting thing that could happen?",
    ];
    const idx = Math.min(step - 1, 2);
    const nextDisabled = !youngAnswers[idx].trim();
    return (
      <Page>
        <AppHeader title="New Story" backTo={`/universes/${id}`} />
        <section className="story-step young-story-step">
          <AnimatePresence mode="wait">
            <motion.div key={idx} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <h1>{prompts[idx]}</h1>
              <input value={youngAnswers[idx]} onChange={(event) => setYoungAnswers((current) => current.map((item, i) => i === idx ? event.target.value : item))} autoFocus />
            </motion.div>
          </AnimatePresence>
          <button
            className="gold-button fixed-bottom"
            disabled={nextDisabled}
            onClick={() => idx < 2 ? setStep(step + 1) : askQuestions()}
          >
            {idx < 2 ? "Next →" : "Begin the Story →"}
          </button>
        </section>
      </Page>
    );
  }
  return (
    <Page>
      <AppHeader title="New Story" backTo={`/universes/${id}`} />
      {step === 1 && <section className="story-step"><textarea value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the story you want..." /><div>{description.length}/500</div><button className="gold-button fixed-bottom" onClick={askQuestions} disabled={!description.trim()}>Continue →</button></section>}
      {step === 2 && <section className="story-step"><div className="questions">{questions}</div><textarea value={answers} onChange={(e) => setAnswers(e.target.value)} placeholder="Answer anything useful. It can be rough." /><button className="gold-button fixed-bottom" onClick={createStory}>Create Story →</button></section>}
      {step === 3 && <WaitingState text={flavor} />}
    </Page>
  );
}

function inferTitle(text) {
  const words = String(text || "").replace(/[^\w\s'-]/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "Untitled Story";
}

function Root() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/universes" element={<UniverseList />} />
          <Route path="/universes/new" element={<NewUniverse />} />
          <Route path="/universes/:id" element={<UniverseDetail />} />
          <Route path="/universes/:id/new-story" element={<NewStory />} />
          <Route path="/universes/:id/stories/:storyId" element={<ChapterReader />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(<Root />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
