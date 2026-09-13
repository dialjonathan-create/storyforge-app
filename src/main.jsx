import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import "./styles.css";
import NarrationPanel from "./NarrationPanel";

const AbilityCommandDraftApprove = "storyforge.draft.approve.v1";
const AbilityCommandDraftDismiss = "storyforge.draft.dismiss.v1";
const AbilityCommandConversationList = "storyforge.conversation.list.v1";
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

// Genre is FREE TEXT, deliberately, and these are suggestions rather than
// options. `_missing_creation_metadata` in the engine checks only that the
// value is non-empty after str().strip() -- there is no enum, no allowlist and
// no validation of what a genre may be. "gothic western with cosmic horror" is
// a valid genre today and needs no schema change. A <select> here would be the
// only thing in the whole stack that narrows it, so there isn't one: these fill
// the field and can be typed straight over.
const GENRE_SUGGESTIONS = [
  "family adventure",
  "fantasy",
  "science fiction",
  "mystery",
  "historical fiction",
  "fairy tale",
  "speculative fiction",
];

// Same rule for audience: suggestions, not a closed set. The defaults come from
// who is actually reading rather than from a constant, because a creation-time
// default nobody sees is exactly what put `genre: "family-adventure"` on an
// adult space opera for three months.
const AUDIENCE_SUGGESTIONS = ["child", "middle-grade", "teen", "adult"];

const RECENT_GENRES_KEY = "storyforge_recent_genres";

function recentGenres() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_GENRES_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((g) => typeof g === "string" && g.trim()) : [];
  } catch (_e) {
    return [];
  }
}

function rememberGenre(genre) {
  const value = String(genre || "").trim();
  if (!value) return;
  try {
    const next = [value, ...recentGenres().filter((g) => g !== value)].slice(0, 6);
    localStorage.setItem(RECENT_GENRES_KEY, JSON.stringify(next));
  } catch (_e) {
    /* a full or blocked localStorage must not stop a story being created */
  }
}

function suggestedAudienceForTier(tier) {
  if (tier === 1) return "child";
  if (tier === 2) return "middle-grade";
  return "adult";
}

/** Free-text field with clickable suggestions. Never a <select>. */
function SuggestField({ label, name, value, onChange, suggestions, placeholder, required }) {
  const seen = new Set();
  const chips = (suggestions || []).filter((chip) => {
    const key = String(chip || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className="suggest-field">
      <label htmlFor={`field-${name}`}>{label}</label>
      <input
        id={`field-${name}`}
        name={name}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="suggest-chips">
        {chips.map((chip) => (
          <button
            type="button"
            key={chip}
            className={value.trim().toLowerCase() === chip.toLowerCase() ? "active" : ""}
            onClick={() => onChange(chip)}
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
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

function Page({ children, className = "", style }) {
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
        style={style}
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
  const [editMetaStory, setEditMetaStory] = useState(null);
  const [editGenre, setEditGenre] = useState("");
  const [editAudience, setEditAudience] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState("");
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

  function openMetaEditor(story) {
    setMenuStoryId(null);
    setMetaError("");
    setEditGenre(story.genre || "");
    setEditAudience(story.audienceAge || "");
    setEditMetaStory(story);
  }

  async function saveMeta() {
    if (!editMetaStory?.storyId) return;
    const genreValue = editGenre.trim();
    const audienceValue = editAudience.trim();
    // storyforge.story.metadata.update.v1 writes ONLY the keys supplied, so
    // sending just these two cannot blank a tagline or a styleDial. It also
    // refuses to clear genre or audienceAge, which is why both are required
    // here rather than being sent empty.
    if (!genreValue || !audienceValue) {
      setMetaError("Genre and audience can be changed but not emptied.");
      return;
    }
    setSavingMeta(true);
    setMetaError("");
    try {
      await execute("storyforge.story.metadata.update.v1", {
        tenantId: "core",
        userId: "jonathan",
        universeId: id,
        storyId: editMetaStory.storyId,
        genre: genreValue,
        audienceAge: audienceValue,
      });
      rememberGenre(genreValue);
      setStories((items) => (items || []).map((item) => (
        item.storyId === editMetaStory.storyId
          ? { ...item, genre: genreValue, audienceAge: audienceValue }
          : item
      )));
      setEditMetaStory(null);
    } catch (err) {
      setMetaError(err.message || "Could not save.");
    } finally {
      setSavingMeta(false);
    }
  }

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
                            <button type="button" onClick={() => openMetaEditor(story)}>
                              Edit Genre &amp; Audience
                            </button>
                            <button type="button" className="danger-action" onClick={() => { setDeleteError(""); setConfirmStory(story); }}>
                              Delete Story
                            </button>
                          </div>
                        )}
                        <h2>{story.title}</h2>
                        {/* An absent genre says so. The old fallback rendered
                            "family adventure" for a story that had no genre at
                            all, which is precisely how a wrong default hides:
                            the record said one thing and the screen said
                            another, and the screen was the one anybody read. */}
                        <p className={story.genre ? "" : "muted"}>
                          {story.genre || "genre not set"}
                          {story.audienceAge ? ` · ${story.audienceAge}` : ""}
                        </p>
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
      <AnimatePresence>
        {editMetaStory && (
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button className="modal-shade" type="button" aria-label="Cancel" onClick={() => { if (!savingMeta) setEditMetaStory(null); }} />
            <motion.section
              className="confirm-modal meta-modal"
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2 }}
            >
              <h2>{editMetaStory.title}</h2>
              <SuggestField
                label="Genre"
                name="editGenre"
                value={editGenre}
                onChange={setEditGenre}
                suggestions={[...recentGenres(), ...GENRE_SUGGESTIONS]}
                placeholder="Anything — fuse them, invent one"
              />
              <SuggestField
                label="Who is this for?"
                name="editAudience"
                value={editAudience}
                onChange={setEditAudience}
                suggestions={AUDIENCE_SUGGESTIONS}
                placeholder="child, adult, anything"
              />
              {metaError && <div className="inline-error">{metaError}</div>}
              <div className="modal-actions">
                <button type="button" className="outline-button" disabled={savingMeta} onClick={() => setEditMetaStory(null)}>Cancel</button>
                <button type="button" className="gold-button" disabled={savingMeta} onClick={saveMeta}>{savingMeta ? "Saving..." : "Save"}</button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
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
  const [chatThread, setChatThread] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatSavedChapter, setChatSavedChapter] = useState(false);
  const [talkText, setTalkText] = useState("");
  const [proseReady, setProseReady] = useState(true);
  const [reshapedPulse, setReshapedPulse] = useState(false);
  const [bookmarkFlash, setBookmarkFlash] = useState(false);
  // Per reading group, so it follows whoever is reading rather than the device.
  const [textScale, setTextScale] = useState(() => readTextScale(readingGroup));
  useEffect(() => setTextScale(readTextScale(readingGroup)), [readingGroup]);
  function changeTextScale(direction) {
    setTextScale((current) => {
      const next = stepTextScale(current, direction);
      writeTextScale(readingGroup, next);
      return next;
    });
  }
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
    return () => window.removeEventListener("scroll", handler);
  }, [readingGroup, storyId, chapterNumber]);

  // Restoring where you were, AFTER the chapter is on the page.
  //
  // This used to run one animation frame after `chapterNumber` changed — which
  // is before the chapter has been fetched, so the reader was still showing
  // "Turning the page...". There were no [data-paragraph-index] nodes to find
  // and the document was a loading screen one viewport tall, so the bookmark
  // branch missed and the percentage branch scrolled to roughly zero. Both
  // restores were dead, every time, which is why 🔖 looked like it did nothing
  // and why the reader always reopened at the top.
  //
  // Now it waits for a chapter AND for the prose to actually be rendered
  // (tier 2 holds it back behind a hero image), and runs once per chapter.
  const restoredFor = useRef(null);
  useEffect(() => {
    if (!chapter || !chapterNumber || !proseReady) return;
    const key = `${storyId}:${chapterNumber}`;
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    requestAnimationFrame(() => {
      // Someone who has already started reading during the load is not asking
      // to be sent somewhere else.
      if (window.scrollY > 40) return;
      restoreReadingPosition({
        bookmark: readBookmark(storyId),
        saved: readPosition(readingGroup, storyId),
        chapterNumber,
      });
    });
  }, [chapter, proseReady, readingGroup, storyId, chapterNumber]);

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

  // One chat entry. storyforge.converse.v1 carries the world bible, canon,
  // character history and the persisted conversation thread, and it routes
  // server-side: plain discussion stays a conversation; a chapter, edit,
  // canon mark or bible update only happens when the model deliberately
  // emits a write tag. The old Ask/Change toggle forced that routing choice
  // onto the reader at the keyboard, with Ask landing in the stateless
  // per-entity Q&A and Change firing an immediate reshape.
  // Everything said in the sheet is already persisted by converse.v1 — both
  // halves of every turn. Until storyforge.conversation.list.v1 existed nothing
  // could read it back, so the client threw the thread away on close and a
  // ten-minute conversation about chapter 2 was gone. This brings it back.
  //
  // It is deliberately best-effort: history is a nicety, and a sheet that
  // refuses to open because an old transcript would not load is worse than a
  // sheet that opens empty. A server that predates the capability lands here
  // too, and behaves exactly as it did yesterday.
  async function loadChatHistory() {
    if (!storyId) return;
    try {
      const res = await execute(AbilityCommandConversationList, {
        tenantId: "core",
        userId: activeReaders[0] || "jonathan",
        universeId: id,
        storyId,
      });
      const turns = Array.isArray(res.turns) ? res.turns : [];
      if (!turns.length) return;
      setChatThread((current) => mergeConversationHistory(turns, current || []));
    } catch {
      /* the sheet still works without it */
    }
  }

  // Opening the sheet without saying anything. Before this there was no way to
  // re-read a conversation at all: the only thing that opened the sheet was
  // typing into the talk bar.
  function openChat() {
    if (chatThread) return;
    setChatThread([]);
    loadChatHistory();
  }

  async function sendChatMessage(text) {
    const opening = !chatThread;
    setChatThread((current) => [...(current || []), { role: "user", content: text }]);
    // Fired before converse.v1 is issued so the history is almost always the
    // state before this turn; mergeConversationHistory handles the case where
    // it is not.
    if (opening) loadChatHistory();
    setChatBusy(true);
    try {
      const res = await execute("storyforge.converse.v1", {
        tenantId: "core",
        userId: activeReaders[0] || "jonathan",
        universeId: id,
        storyId,
        message: text,
        requestedBy: activeReaders[0] || "jonathan",
      });
      const kind = res.responseType || "conversation";
      // converse.v1 returns its prose under `message` (read from the handler's
      // return statement 2026-08-30, after shipping `res.response` unverified
      // and turning every reply into "(the story had no words)").
      // suggestedReplies is [] on most turns and the row simply does not render.
      // A server that predates the field sends nothing, which is the same thing.
      const suggested = Array.isArray(res.suggestedReplies) ? res.suggestedReplies : [];
      // #1542's contract: generation PROPOSES, approval writes. The envelope
      // carries the draft; nothing is saved until a tap.
      const proposal = res.proposal && res.proposal.draftId ? res.proposal : null;
      setChatThread((current) => [...(current || []), { role: "assistant", content: res.message || res.response || "(the story had no words)", kind, suggestedReplies: suggested, proposal }]);
      if (kind === "chapter" || kind === "edit" || kind === "chapter_edit") setChatSavedChapter(true);
    } catch (error) {
      setChatThread((current) => [...(current || []), { role: "assistant", content: error.message || "The story didn't answer. Try again.", kind: "error" }]);
    } finally {
      setChatBusy(false);
    }
  }

  // Approve and dismiss are the ONLY things in this sheet that write. Both
  // report what the server said rather than assuming it worked, and both clear
  // the card by replacing the turn's proposal so a saved draft cannot be saved
  // twice by a double tap.
  async function settleProposal(proposal, command, extraArgs, successText) {
    try {
      const res = await execute(command, { tenantId: "core", userId: "jonathan", draftId: proposal.draftId, ...extraArgs });
      setChatThread((current) => (current || []).map((m) => (m.proposal?.draftId === proposal.draftId ? { ...m, proposal: null } : m)));
      setChatThread((current) => [...(current || []), { role: "assistant", content: successText(res), kind: "note" }]);
      if (command === AbilityCommandDraftApprove) setChatSavedChapter(true);
    } catch (error) {
      setChatThread((current) => [...(current || []), { role: "assistant", content: error.message || "That did not go through. The draft is still held.", kind: "error" }]);
    }
  }

  function approveDraft(proposal) {
    return settleProposal(proposal, AbilityCommandDraftApprove, {}, (res) =>
      `Saved as chapter ${res.chapterNumber ?? proposal.chapterNumber}.`);
  }

  function dismissDraft(proposal) {
    return settleProposal(proposal, AbilityCommandDraftDismiss, {}, () => "Dismissed. Nothing was saved.");
  }

  function closeChat() {
    setChatThread(null);
    if (chatSavedChapter) {
      setChatSavedChapter(false);
      getChapter(id, storyId, chapterNumber)
        .then((res) => setChapter(res))
        .catch(() => {});
    }
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
    <Page className="reader-page" style={{ "--prose-scale": textScale }}>
      <div className="scroll-progress" style={{ transform: `scaleX(${progress})` }} />
      <header className="reader-header">
        <button className="icon-button" onClick={() => nav(`/universes/${id}`)}>←</button>
        <div className="reader-title">{story?.title || "Story"}</div>
        {/* Grouped rather than four more grid columns: the 💬 is conditional,
            and a fixed template leaves a hole in the header for tier 1. */}
        <div className="reader-header-actions">
          <button className="icon-button" onClick={saveBookmarkHere} aria-label="Save your spot here">🔖</button>
          {/* The only way into the sheet used to be typing into the talk bar,
              which made the conversation invisible until you started a new one. */}
          {tier !== 1 && <button className="icon-button" onClick={openChat} aria-label="Open the conversation">💬</button>}
          <button className="icon-button" onClick={() => setMenuOpen(true)}>≡</button>
          <Avatars ids={activeReaders} />
        </div>
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
        <NarrationPanel chapter={chapter} />
        <ChapterImages chapter={chapter} tier={tier} onHeroLoad={() => setProseReady(true)} />
        {proseReady && <Prose chapter={chapter} tier={tier} entities={entities} onLongPress={setReshapePromptPoint} onEntityTap={setInteractTarget} onWordTap={tier !== 1 ? setDefineWord : undefined} pulseFrom={reshapedPulse ? reshapeAnchor?.index : null} />}
        {choiceRevealPending && <div className="choice-sweep" />}
        <ChoicePanel visible={choicesVisible} chapter={chapter} readers={activeReaders} onChoose={choose} showTooltip={showChoiceTooltip} onDismissTooltip={() => setShowChoiceTooltip(false)} />
        {tier !== 1 && <TalkBar value={talkText} setValue={setTalkText} onSend={sendChatMessage} busy={chatBusy} />}
      </motion.article>
      <ChapterMenu open={menuOpen} onClose={() => setMenuOpen(false)} total={storyChapterLimit(story, chapter.chapterNumber)} current={chapterNumber} onJump={(n) => { setMenuOpen(false); setChapterNumber(n); window.scrollTo(0, 0); }} textScale={textScale} onTextScale={changeTextScale} />
      <ReshapeConfirm point={reshapePromptPoint} onCancel={() => setReshapePromptPoint(null)} onConfirm={() => { setReshapePoint(reshapePromptPoint); setReshapePromptPoint(null); }} />
      <ReshapeSheet point={reshapePoint} tier={tier} onCancel={() => setReshapePoint(null)} onSubmit={submitReshape} />
      <StoryChatSheet thread={chatThread} busy={chatBusy} onSend={sendChatMessage} onClose={closeChat} onApprove={approveDraft} onDismiss={dismissDraft} />
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
  // The family readers ARE characters in these stories, but they live as
  // reader ids, not universe character docs -- so their names in prose fell
  // through entity linking to the word-tap handler, and short-pressing
  // "Keen" opened the dictionary definition of "keen" (live 2026-08-29).
  const known = new Set(characters.map((c) => c.name.toLowerCase()));
  const family = FAMILY
    .filter((member) => !known.has(member.displayName.toLowerCase()))
    .map((member) => ({ name: member.displayName, type: "character", description: `${member.displayName} — one of the story's own readers.` }));
  const cast = [...characters, ...family];
  if (tier === 1) return cast;
  const locations = ((data?.bible || {}).locations || []).map((l) => ({ name: l.name || String(l), type: "setting", description: l.description || "" })).filter((x) => x.name && x.name.length > 2);
  return [...cast, ...locations].sort((a, b) => b.name.length - a.name.length).slice(0, 34);
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

function findEntityIndex(haystack, name) {
  // Word-bounded, and when the entity name is capitalized the prose
  // occurrence must be capitalized too: "Keen smiled" links, "a keen eye"
  // does not, and "Keenness" never half-matches.
  const lowerHay = haystack.toLowerCase();
  const lowerName = String(name).toLowerCase();
  const isLetter = (ch) => /[A-Za-z\u00C0-\u024F]/.test(ch || "");
  let from = 0;
  while (from <= lowerHay.length - lowerName.length) {
    const idx = lowerHay.indexOf(lowerName, from);
    if (idx < 0) return -1;
    const bounded = !isLetter(haystack[idx - 1]) && !isLetter(haystack[idx + lowerName.length]);
    const caseOk = name[0] !== name[0].toLowerCase() ? haystack[idx] === name[0] : true;
    if (bounded && caseOk) return idx;
    from = idx + 1;
  }
  return -1;
}

function renderEntityText(text, entities, onEntityTap) {
  let remaining = text;
  const out = [];
  let key = 0;
  while (remaining) {
    const match = (entities || []).map((entity) => {
      const idx = findEntityIndex(remaining, String(entity.name));
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

/** The smallest markdown that makes the editor's replies readable.
 *
 * The editor answers in markdown — `###` headers, `**bold**`, bullets — and the
 * chat line printed `message.content` verbatim, so a seven-year-old and a
 * grown-up both saw `### Chapter 2` and a wall of asterisks.
 *
 * Hand-rolled on purpose. This bundle loads on a school iPad over school wifi;
 * `react-markdown` plus `remark` is roughly 40 kB gzipped for six constructs.
 * It also means NO `dangerouslySetInnerHTML` anywhere: every node below is a
 * real React element, so a reply containing `<script>` renders as the text
 * `<script>` and cannot do anything. A markdown-to-HTML library would have made
 * that a question to think about; this way it is not one.
 *
 * Supported, deliberately: headings, bold, italic, inline code, bullet and
 * numbered lists, blockquotes, paragraphs. Not supported: tables, links, images,
 * raw HTML. The editor does not emit them, and each one is more surface.
 */
const MD_INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

function renderInline(text, keyPrefix = "i") {
  const parts = String(text ?? "").split(MD_INLINE).filter((part) => part !== "");
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (/^\*[^*\n]+\*$/.test(part) || /^_[^_\n]+_$/.test(part)) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (/^`[^`\n]+`$/.test(part)) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

/** Block-level parse. Returns React nodes, never HTML. */
function renderMarkdown(source) {
  const lines = String(source ?? "").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;   // { ordered, items: [] }

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ");
    blocks.push(<p key={`p${blocks.length}`}>{renderInline(text, `p${blocks.length}`)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${blocks.length}`}>
        {list.items.map((item, index) => (
          <li key={index}>{renderInline(item, `l${blocks.length}-${index}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flush(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      // Clamped to h3..h4: the sheet already has an h2, and a reply must not
      // outrank the panel it is inside.
      const level = Math.min(6, Math.max(3, heading[1].length + 2));
      const Tag = `h${level}`;
      blocks.push(<Tag key={`h${blocks.length}`}>{renderInline(heading[2], `h${blocks.length}`)}</Tag>);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push(<blockquote key={`q${blocks.length}`}>{renderInline(quote[1], `q${blocks.length}`)}</blockquote>);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((bullet || numbered)[1]);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Tappable answers to the question the editor just asked.
 *
 * The editor routinely ends a turn with two or three enumerable answers written
 * as prose -- "Does that direction sound right? Or do you want to lean harder
 * into her apprenticeship?" -- and answering it meant typing a sentence with a
 * thumb. `storyforge.converse.v1` now offers them in `suggestedReplies`; this
 * renders whatever it gets.
 *
 * Only on the LAST assistant turn. Chips halfway up a transcript are answers to
 * a question that has already been answered, and tapping one would be
 * confusing rather than quick.
 *
 * Free text never goes away. The composer sits directly below this and a chip
 * is a shortcut, not a menu.
 */
/** A held draft, as something you can act on with a thumb.
 *
 * WHAT IT REPLACES. The editor's own words, verbatim, on a phone: "approve it
 * with storyforge.draft.approve.v1 (draftId the-embodied-age:threshold:3:64c8…)
 * or dismiss it with storyforge.draft.dismiss.v1." Nobody types that. The
 * contract from #1542 is right -- generation proposes and approval writes -- but
 * the approval surface was a paragraph of capability names.
 *
 * Nothing writes until a tap, and "Change it" writes nothing at all: it returns
 * the proposal to the composer as a quote so the next message is about this
 * draft rather than about nothing.
 */
function ProposalCard({ proposal, busy, onApprove, onDismiss, onRevise }) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState("");
  if (!proposal?.draftId) return null;

  const title = proposal.chapterTitle || (proposal.chapterNumber ? `Chapter ${proposal.chapterNumber}` : "A draft");
  const opening = String(proposal.preview || proposal.opening || "").trim();
  const disabled = busy || Boolean(pending);

  async function run(kind, fn) {
    if (disabled) return;
    setPending(kind);
    try {
      await fn();
    } finally {
      setPending("");
    }
  }

  return (
    <section className="proposal-card" aria-label={`Proposed ${title}`}>
      <div className="proposal-kicker">
        Held, not saved
        {proposal.chapterNumber ? ` · chapter ${proposal.chapterNumber}` : ""}
        {proposal.proseChars ? ` · ${Math.round(proposal.proseChars / 1000)}k characters` : ""}
      </div>
      <h3 className="proposal-title">{title}</h3>
      {opening && !expanded && <p className="proposal-opening">{opening}</p>}
      {expanded && (
        <div className="proposal-full">
          {renderMarkdown(proposal.prose || proposal.text || opening || "The full text was not sent with this proposal.")}
        </div>
      )}
      {(proposal.prose || proposal.text) && (
        <button type="button" className="proposal-expand" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Collapse" : "Read it"}
        </button>
      )}
      <div className="proposal-actions">
        <button
          type="button"
          className="proposal-approve"
          disabled={disabled}
          onClick={() => run("approve", () => onApprove(proposal))}
        >
          {pending === "approve" ? "Saving…" : "Use this"}
        </button>
        <button
          type="button"
          className="proposal-dismiss"
          disabled={disabled}
          onClick={() => run("dismiss", () => onDismiss(proposal))}
        >
          {pending === "dismiss" ? "Dismissing…" : "Not this"}
        </button>
        <button
          type="button"
          className="proposal-revise"
          disabled={disabled}
          onClick={() => onRevise(proposal)}
        >
          Change it
        </button>
      </div>
    </section>
  );
}

function SuggestedReplies({ replies, onPick, disabled }) {
  if (!replies?.length) return null;
  return (
    <div className="suggested-replies" role="group" aria-label="Suggested replies">
      {replies.map((reply, index) => (
        <button
          key={index}
          type="button"
          className="suggested-reply"
          disabled={disabled}
          onClick={() => onPick(reply)}
        >
          {reply}
        </button>
      ))}
    </div>
  );
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

/** Publish the keyboard's height as `--keyboard-inset` while a sheet is open.
 *
 * iOS Safari does not move the LAYOUT viewport for the keyboard, so a
 * `position: fixed` sheet stays exactly where it was and the keyboard covers
 * it. `visualViewport` is the only API that reports the actually-visible area.
 * Everywhere else this measures 0 and the `dvh` unit alone is enough.
 */
function useKeyboardInset(active) {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) return undefined;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, [active]);
}

const COMPOSER_MAX_ROWS = 5;

/** How many rows the field should show for this text, before soft-wrap.
 *
 * Deliberately computed from the text rather than from `scrollHeight`: jsdom
 * reports `scrollHeight` as 0, so a measurement-based grow cannot be asserted in
 * the suite at all. This is the exact half — newlines — and the effect below
 * handles the half that needs a real layout engine.
 */
function composerRows(value, max = COMPOSER_MAX_ROWS) {
  const lines = String(value ?? "").split("\n").length;
  return Math.max(1, Math.min(lines, max));
}

/** The one compose row, used by the chat sheet and by the reader's talk bar.
 *
 * WHAT IT REPLACES. Both call sites were a single-line `<input>` beside a
 * `gold-button`. `.gold-button` is `width: 100%`, and `.story-talk` declared
 * three grid columns (`auto 1fr auto`) for two children — so the field landed in
 * the `auto` column and sized to its content while the button took the `1fr`.
 * That is the small square and the full-width Send: not a styling opinion, a
 * template with one column too many.
 */
function Composer({
  value,
  onChange,
  onSubmit,
  busy = false,
  placeholder = "",
  autoFocus = false,
  label = "Message",
  className = "",
}) {
  const ref = useRef(null);
  const text = String(value ?? "");
  const hasText = Boolean(text.trim());

  // Soft-wrap growth. A long unbroken sentence has to grow too, and only a real
  // layout engine knows where it wraps. No-op under jsdom, so the suite asserts
  // `rows` and this is a device check.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined" || !el.scrollHeight) return;
    el.style.height = "auto";
    const styles = window.getComputedStyle(el);
    const lineHeight = parseFloat(styles.lineHeight) || 22;
    const chrome = el.offsetHeight - el.clientHeight;
    const cap = COMPOSER_MAX_ROWS * lineHeight + chrome;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? "auto" : "hidden";
  }, [text]);

  function send() {
    if (!hasText || busy) return;
    onSubmit(text.trim());
  }

  return (
    <form
      className={`composer${className ? ` ${className}` : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        ref={ref}
        className="composer-field"
        rows={composerRows(text)}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        // iOS labels the return key "Send" rather than "return". The keyboard
        // is the only affordance a thumb sees, so it should say what it does.
        enterKeyHint="send"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          // Mid-IME Enter commits a candidate; intercepting it eats the word.
          if (event.nativeEvent?.isComposing) return;
          event.preventDefault();
          send();
        }}
      />
      {busy ? (
        <span className="composer-spinner" role="status" aria-label="Sending" />
      ) : hasText ? (
        <button type="submit" className="composer-send" aria-label="Send">
          <span aria-hidden="true">↑</span>
        </button>
      ) : null}
    </form>
  );
}

function TalkBar({ value, setValue, onSend, busy = false }) {
  return (
    <Composer
      className="story-talk"
      value={value}
      onChange={setValue}
      onSubmit={(text) => {
        setValue("");
        onSend(text);
      }}
      busy={busy}
      placeholder="Talk to the story..."
      label="Talk to the story"
    />
  );
}

/**
 * What to write on the line between the conversation you are re-reading and the
 * one you are having now.
 *
 * Deliberately coarse — "Earlier today", "Yesterday", or the date. A timestamp
 * to the minute is precision nobody asked for, and the only question the line
 * has to answer is how long ago that was. Anything unparseable falls back to
 * "Earlier" rather than rendering `Invalid Date` into a child's screen.
 */
export function historyDividerLabel(iso, now = new Date()) {
  const then = iso ? new Date(iso) : null;
  if (!then || Number.isNaN(then.getTime())) return "Earlier";
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86400000);
  if (days <= 0) return "Earlier today";
  if (days === 1) return "Yesterday";
  return then.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/**
 * Put a thread read back from the server in front of whatever is already on
 * screen, without saying anything twice.
 *
 * The sheet opens and fetches at the same moment the first message is sent, so
 * the two can land in either order. If the fetch is slow enough that
 * `converse.v1` has already persisted the turn it is carrying, that turn comes
 * back in the history as well — and a transcript that repeats what you just
 * said reads as a bug even though nothing is wrong.
 *
 * So: drop history entries off the tail that are already at the head of the
 * local thread. Exported for the tests, which is the only reason this is not
 * an inner function.
 */
export function mergeConversationHistory(history, local) {
  const older = (history || []).map((turn) => ({
    role: turn.role,
    content: turn.content,
    createdAt: turn.createdAt,
    kind: "conversation",
    history: true,
  }));
  const current = local || [];
  const same = (a, b) => Boolean(a) && Boolean(b) && a.role === b.role && a.content === b.content;
  // The longest run where the END of the history is the START of what is on
  // screen. Only a tail-to-head run counts: a phrase repeated by coincidence in
  // the middle of an old conversation is a real thing the person said twice.
  let overlap = 0;
  for (let k = Math.min(older.length, current.length); k > 0; k -= 1) {
    let matches = true;
    for (let i = 0; i < k; i += 1) {
      if (!same(older[older.length - k + i], current[i])) {
        matches = false;
        break;
      }
    }
    if (matches) {
      overlap = k;
      break;
    }
  }
  return [...older.slice(0, older.length - overlap), ...current];
}

function StoryChatSheet({ thread, busy, onSend, onClose, onApprove, onDismiss }) {
  const [text, setText] = useState("");
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, busy]);
  useKeyboardInset(Boolean(thread));
  if (!thread) return null;
  return (
    <motion.div className="bottom-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button className="sheet-shade" onClick={onClose} />
      <motion.section className="sheet-panel chat-sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}>
        <h2>Talk to the story</h2>
        {/* The transcript is the only thing that scrolls. The panel used to
            scroll as a whole, so a forty-line reply pushed the compose row off
            the bottom and there was nothing to type into. */}
        <div className="chat-scroll" ref={scrollRef}>
          {!thread.length && !busy && (
            <div className="chat-empty">Nothing said about this story yet.</div>
          )}
          {thread.map((message, index) => (
            <React.Fragment key={index}>
            {/* Where the conversation you are re-reading ends and this sitting
                begins. Without it, an hour-old exchange and the thing you just
                typed look like one continuous conversation. */}
            {!message.history && thread[index - 1]?.history && (
              <div className="chat-divider"><span>{historyDividerLabel(thread[index - 1]?.createdAt)}</span></div>
            )}
            <div className={message.role === "user" ? "chat-line chat-user" : "chat-line chat-story"}>
              {/* The person's own turn stays exactly as they typed it: they know
                  what they wrote, and reinterpreting their asterisks would be
                  surprising. Chapter and edit kinds keep their <em>. Only the
                  editor's prose is markdown. */}
              {message.role === "user"
                ? message.content
                : message.kind === "chapter" || message.kind === "edit" || message.kind === "chapter_edit"
                  ? <em>{message.content}</em>
                  : <div className="chat-markdown">{renderMarkdown(message.content)}</div>}
            </div>
            {index === thread.length - 1 && message.role === "assistant" && message.proposal && (
              <ProposalCard
                proposal={message.proposal}
                busy={busy}
                onApprove={onApprove}
                onDismiss={onDismiss}
                onRevise={(p) => setText(`About the draft of ${p.chapterTitle || `chapter ${p.chapterNumber}`}: `)}
              />
            )}
            {index === thread.length - 1 && message.role === "assistant" && (
              <SuggestedReplies
                replies={message.suggestedReplies}
                disabled={busy}
                onPick={(reply) => {
                  setText("");
                  onSend(reply);
                }}
              />
            )}
            </React.Fragment>
          ))}
          {busy && <div className="chat-line chat-story chat-busy">The story is thinking…</div>}
        </div>
        <Composer
          value={text}
          onChange={setText}
          onSubmit={(q) => {
            setText("");
            onSend(q);
          }}
          busy={busy}
          placeholder="Say more..."
          label="Say more"
        />
      </motion.section>
    </motion.div>
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

export function TextSizeControl({ scale, onChange }) {
  const index = textScaleIndex(scale);
  return (
    <div className="text-size" role="group" aria-label="Text size">
      <button
        className="text-size-step"
        onClick={() => onChange(-1)}
        disabled={index === 0}
        aria-label="Smaller text"
      >
        A<span aria-hidden="true">−</span>
      </button>
      {/* The readout names the step. "Larger" is something you can ask for out
          loud; a percentage is not, and neither is a slider position. */}
      <span className="text-size-label" aria-live="polite">{TEXT_SCALE_LABELS[index]}</span>
      <button
        className="text-size-step"
        onClick={() => onChange(1)}
        disabled={index === TEXT_SCALES.length - 1}
        aria-label="Bigger text"
      >
        A<span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

function ChapterMenu({ open, onClose, total, current, onJump, textScale = 1, onTextScale }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="drawer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="drawer-shade" onClick={onClose} />
          <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.25 }} className="drawer-panel">
            {onTextScale && (
              <>
                <h2>Text size</h2>
                <TextSizeControl scale={textScale} onChange={onTextScale} />
              </>
            )}
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

/* --- Text size ---------------------------------------------------------
 *
 * A seven-year-old and a three-year-old read this, sometimes on a phone and
 * sometimes on an iPad held at arm's length, and 20px is one guess at all of
 * that. The scale is per reading group rather than per device: it belongs to
 * whoever is reading, and it follows them.
 *
 * Five steps, not a slider. A slider on a phone is a drag to land on a value
 * you cannot name, and a child changing text size by accident mid-chapter is a
 * worse outcome than a coarse control.
 */
export const TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5];
export const TEXT_SCALE_LABELS = ["Smaller", "Normal", "Larger", "Much larger", "Biggest"];

export function textScaleIndex(scale) {
  const found = TEXT_SCALES.indexOf(scale);
  if (found !== -1) return found;
  // An unknown value (an older build, a hand-edited key) resolves to the
  // nearest step rather than throwing the reader back to Normal.
  let best = TEXT_SCALES.indexOf(1);
  let distance = Infinity;
  TEXT_SCALES.forEach((candidate, index) => {
    const d = Math.abs(candidate - (Number(scale) || 1));
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}

export function stepTextScale(scale, direction) {
  const index = textScaleIndex(scale) + direction;
  return TEXT_SCALES[Math.max(0, Math.min(TEXT_SCALES.length - 1, index))];
}

export function readTextScale(group) {
  try {
    const raw = Number(localStorage.getItem(`sf_text_${group}`));
    return raw > 0 ? TEXT_SCALES[textScaleIndex(raw)] : 1;
  } catch {
    return 1;
  }
}

export function writeTextScale(group, scale) {
  try {
    localStorage.setItem(`sf_text_${group}`, String(scale));
  } catch {
    /* a reader with storage blocked still gets the size for this sitting */
  }
}

/**
 * Put the reader back where they were. Returns what it did, which is the only
 * way to tell "restored" apart from "there was nothing to restore" apart from
 * "the page was not on screen yet" — and it was silently the third one.
 *
 * A paragraph anchor is tried first and a scroll percentage second. The anchor
 * survives a font-size change, a reflow, and a chapter being edited underneath
 * it; a percentage survives none of those, and is only a fallback because it is
 * what gets written on every scroll without the reader doing anything.
 */
export function restoreReadingPosition({ bookmark, saved, chapterNumber, doc = document, win = window }) {
  if (bookmark && bookmark.chapterNumber === chapterNumber && bookmark.paragraphIndex != null) {
    const node = doc.querySelector(`[data-paragraph-index="${bookmark.paragraphIndex}"]`);
    if (node) {
      node.scrollIntoView({ behavior: "auto", block: "start" });
      return "bookmark";
    }
  }
  if (saved && saved.chapter === chapterNumber && saved.scrollPercent) {
    const scrollable = doc.documentElement.scrollHeight - win.innerHeight;
    // Nothing to scroll means the chapter is not laid out yet. Scrolling to
    // `percent * 0` would land at the top and be indistinguishable from having
    // no memory at all, which is exactly the bug this function exists to end.
    if (scrollable <= 0) return "not-laid-out";
    win.scrollTo(0, saved.scrollPercent * scrollable);
    return "position";
  }
  return "none";
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
  const [genre, setGenre] = useState("");
  const [audience, setAudience] = useState(() => suggestedAudienceForTier(tierForReaders(activeReaders)));
  const [error, setError] = useState("");
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
    const genreValue = genre.trim();
    const audienceValue = audience.trim();
    // The engine refuses creation without these (story_metadata_unspecified).
    // Catch it here so the user sees which field, not a failed request.
    if (!genreValue || !audienceValue) {
      setError("Genre and audience are both required. Type anything you like.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await execute("storyforge.universe.create.v1", {
        tenantId: "core",
        userId: primaryReader,
        title,
        tagline: form.get("tagline"),
        genre: genreValue,
        audienceAge: audienceValue,
        coverColor: "#1a2744",
        coverIcon: "✦",
        worldSeed: form.get("worldSeed"),
      });
      rememberGenre(genreValue);
      nav(`/universes/${res.universeId}`);
    } catch (err) {
      setBusy(false);
      setError(err.message || "Could not create the universe.");
    }
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
        <SuggestField
          label="Genre"
          name="genre"
          value={genre}
          onChange={setGenre}
          suggestions={[...recentGenres(), ...GENRE_SUGGESTIONS]}
          placeholder="Anything — fuse them, invent one"
          required
        />
        <SuggestField
          label="Who is this for?"
          name="audienceAge"
          value={audience}
          onChange={setAudience}
          suggestions={AUDIENCE_SUGGESTIONS}
          placeholder="child, adult, anything"
          required
        />
        {error && <div className="inline-error">{error}</div>}
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
  // Inherited from the universe rather than hardcoded: a story usually shares
  // its world's genre and audience, and inheriting shows the user what will be
  // stored instead of silently substituting a literal.
  const [genre, setGenre] = useState("");
  const [audience, setAudience] = useState("");
  const [metaError, setMetaError] = useState("");
  // `step` means two different things in this component: for the adult flow it
  // is a screen (1 describe, 2 answer, 3 waiting), and for the young flow it is
  // a question index. Those two meanings collided, which is what made the young
  // path a dead end. `creating` separates "we are waiting on the backend" from
  // any particular step number, so neither flow has to borrow the other's.
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let cancelled = false;
    execute("storyforge.universe.get.v1", { tenantId: "core", userId: "jonathan", universeId: id })
      .then((res) => {
        if (cancelled) return;
        const universe = res.universe || {};
        setGenre((current) => current || universe.genre || "");
        setAudience((current) => current || universe.audienceAge || suggestedAudienceForTier(tier));
      })
      .catch(() => {
        if (cancelled) return;
        setAudience((current) => current || suggestedAudienceForTier(tier));
      });
    return () => { cancelled = true; };
  }, [id, tier]);
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
  async function createStory(overrides = {}) {
    const genreValue = genre.trim();
    const audienceValue = audience.trim();
    if (!genreValue || !audienceValue) {
      setMetaError("Genre and audience are both required. Type anything you like.");
      return;
    }
    setMetaError("");
    setCreating(true);
    setStep(3);
    // Taken from the caller rather than from state: the young path calls this
    // in the same tick as the setState that would have populated them, and
    // React has not re-rendered yet. Reading state here would have sent an
    // empty seed.
    const seedDescription = overrides.description !== undefined ? overrides.description : description;
    const seedQuestions = overrides.questions !== undefined ? overrides.questions : questions;
    const seedAnswers = overrides.answers !== undefined ? overrides.answers : answers;
    const seed = `Description:\n${seedDescription}\n\nQuestions:\n${seedQuestions}\n\nAnswers:\n${seedAnswers}`;
    try {
      const res = await execute("storyforge.story.create.v1", {
        tenantId: "core",
        userId: activeReaders[0] || "jonathan",
        universeId: id,
        title: inferTitle(seedDescription),
        primaryReaders: activeReaders,
        genre: genreValue,
        audienceAge: audienceValue,
        isSpinoff: false,
        storySeed: seed,
        requestedBy: activeReaders[0] || "jonathan",
        protagonistId: readingGroup,
      });
      rememberGenre(genreValue);
      nav(`/universes/${id}/stories/${res.storyId}`);
    } catch (err) {
      setCreating(false);
      setStep(2);
      setMetaError(err.message || "Could not create the story.");
    }
  }

  /** The young flow's last step. It has nothing further to ask -- the three
   *  prompts ARE the description -- so it creates directly rather than routing
   *  through the adult question screen, which is what sent `step` backwards and
   *  turned the dead end into a loop. */
  function beginYoungStory() {
    const composed = `World: ${youngAnswers[0]}\nMain character: ${youngAnswers[1]}\nMost exciting thing: ${youngAnswers[2]}`;
    setDescription(composed);
    setQuestions("");
    setAnswers("");
    return createStory({ description: composed, questions: "", answers: "" });
  }
  // `step < 4`, not `step < 3`: at step 3 the guard used to fail, the branch
  // stopped rendering, and the fallthrough showed the waiting state forever --
  // the third prompt was never displayed and no story was ever created. A child
  // answered two questions, tapped Next, and waited.
  //
  // `!creating` is the other half. Raising the bound alone is not enough: the
  // final button used to call askQuestions(), whose tier-2 branch does
  // setStep(2), which under a raised bound sends the child back to question two
  // forever. Dead end becomes infinite loop. The button now creates directly
  // and `creating` takes the branch down while the request is in flight.
  if (tier === 2 && activeReaders.length === 1 && step < 4 && !creating) {
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
            onClick={() => idx < 2 ? setStep(step + 1) : beginYoungStory()}
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
      {step === 2 && (
        <section className="story-step">
          <div className="questions">{questions}</div>
          <textarea value={answers} onChange={(e) => setAnswers(e.target.value)} placeholder="Answer anything useful. It can be rough." />
          <SuggestField
            label="Genre"
            name="genre"
            value={genre}
            onChange={setGenre}
            suggestions={[...recentGenres(), ...GENRE_SUGGESTIONS]}
            placeholder="Anything — fuse them, invent one"
            required
          />
          <SuggestField
            label="Who is this for?"
            name="audienceAge"
            value={audience}
            onChange={setAudience}
            suggestions={AUDIENCE_SUGGESTIONS}
            placeholder="child, adult, anything"
            required
          />
          {metaError && <div className="inline-error">{metaError}</div>}
          <button className="gold-button fixed-bottom" onClick={createStory}>Create Story →</button>
        </section>
      )}
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

// Exported for tests. The young-reader flow had no automated coverage at all,
// which is how a dead end in the path a child uses survived unnoticed; a flow
// that a seven-year-old walks should not be the least-tested screen in the app.
export { NewStory, NewUniverse, AppProvider, suggestedAudienceForTier, Composer, composerRows, COMPOSER_MAX_ROWS, StoryChatSheet, renderMarkdown, SuggestedReplies, ProposalCard };

createRoot(document.getElementById("root")).render(<Root />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
