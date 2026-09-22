import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import "./styles.css";
import NarrationPanel from "./NarrationPanel";
import { fetchVoices } from "./kokoro";
import StoryMap, { mappablePlaces } from "./StoryMap";

// The build this browser is actually running, for when "did it deploy?" is
// asked from a phone rather than from gcloud. Also served as /version.json.
const BUILD_SHA = typeof __GIT_SHA__ === "string" ? __GIT_SHA__ : "unknown";
if (typeof window !== "undefined") {
  window.__STORYFORGE_BUILD__ = BUILD_SHA;
}

const AbilityCommandDraftApprove = "storyforge.draft.approve.v1";
const AbilityCommandDraftDismiss = "storyforge.draft.dismiss.v1";
const AbilityCommandChapterChoicesSet = "storyforge.chapter.choices.set.v1";
const AbilityCommandConversationList = "storyforge.conversation.list.v1";
// The only call that writes a chapter from a recorded choice (supervisor #1627).
// Recording a choice is a fact about what the reader wanted; writing the next
// chapter is a decision with a cost, and until 2026-09-18 they were the same
// call -- `choice.record.v1` armed a 30-second timer and then generated. A
// seven-year-old tapping an option started a model call, a chapter save, a
// postprocess pass and a Drive export, and saying nothing for half a minute
// counted as consent. It fired on Field Notes at 2026-09-18T06:20:18Z and wrote
// a chapter nobody asked for. This is the second tap.
const AbilityCommandChapterRequest = "storyforge.chapter.request.v1";
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

/**
 * Who is holding the phone, for the server's permission checks.
 *
 * 2026-09-13: thirteen Storyforge read capabilities had no permission check at
 * all, and the five that did were being asked the wrong question — this client
 * put `userId: "jonathan"` in the envelope from every device in the house, so
 * `_can_read_universe` evaluated as Jonathan on Adele's phone and let
 * everything through. The server reads `requestedBy`; only one call site in
 * twenty-four was sending it.
 *
 * So `execute` stamps it, rather than twenty-four call sites remembering to.
 * The initial value is read from storage at module load, so a call that beats
 * the first render is still asking as the right person.
 *
 * `userId` is deliberately left alone: it decides ownership on the write paths,
 * and changing who owns a created universe is not a thing a security fix should
 * do quietly.
 */
export function readStoredReaders() {
  try {
    const defaultReader = localStorage.getItem("storyforge_default_reader");
    if (defaultReader) return [defaultReader];
    const saved = JSON.parse(localStorage.getItem("storyforge_reading_group") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

let currentReaderId = readStoredReaders()[0] || "jonathan";

export function setCurrentReaderId(id) {
  currentReaderId = String(id || "").trim().toLowerCase() || "jonathan";
}

export function getCurrentReaderId() {
  return currentReaderId;
}

async function execute(command, args = {}) {
  const response = await fetch(`${ABILITY_URL}/v1/execute`, {
    method: "POST",
    headers: abilityHeaders({ "Content-Type": "application/json" }),
    // requestedBy first so an explicit one from the caller overrides it.
    body: JSON.stringify({ command, args: { requestedBy: currentReaderId, ...args } }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("Otherwise is not signed in on this device (no token). Ask Jonathan.");
  if (!response.ok || data.ok === false || data.error) throw new Error(data.message || data.error || "Otherwise request failed");
  return data;
}

function AppProvider({ children }) {
  const [users, setUsers] = useState(FAMILY);
  const [activeReaders, setActiveReaders] = useState(readStoredReaders);
  // Switching readers switches identity. Without this the picker changes the
  // avatars and nothing else.
  useEffect(() => setCurrentReaderId(activeReaders[0]), [activeReaders]);
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
  return <div className={`wordmark ${small ? "wordmark-small" : ""}`}>Otherwise</div>;
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
          await navigator.share({ title: story.title || "Otherwise Adventure", files: [file] });
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
              {/* The way into the universe itself. Every capability behind it
                  already shipped; there was simply no screen. Hidden for the
                  younger tiers, who have no business rewriting the world. */}
              {tierForReaders(activeReaders) > 2 && (
                <button className="inline-button" type="button" onClick={() => nav(`/universes/${id}/edit`)}>
                  Edit this universe
                </button>
              )}
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
            ) : (
              // The tab that took the app down on 2026-09-13. A bible field
              // that is a string where the code expected an array must cost
              // this panel and nothing more.
              <ErrorBoundary name="the lore" resetKey={id}>
                <Lore data={data} />
              </ErrorBoundary>
            )}
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

/**
 * The thing that was missing when the Lore tab took the whole app down.
 *
 * 2026-09-13: `Lore` called `.map` on `bible.worldRules`, which on
 * `the-embodied-age` is a 1,243-character STRING. `.map` is not a string
 * method, so it threw during render. There was no boundary anywhere in the
 * app — no `componentDidCatch`, no `getDerivedStateFromError` — so React did
 * what React does with an unhandled render error and **unmounted the whole
 * tree**. The screen went to the background gradient and the only way out was
 * force-quitting.
 *
 * That is the part worth fixing permanently. The `.map` was one line in one
 * component; the blank screen was the architecture. A child holding this phone
 * should never lose the app because one panel is unhappy.
 *
 * Class component on purpose: error boundaries have no hook equivalent. React
 * still offers no way to catch a render error from inside a function component.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No telemetry to send this to yet. The console is at least reachable from
    // a tethered device, and swallowing it entirely would make the next one
    // just as hard to find as this one was.
    console.error(`[storyforge] ${this.props.name || "screen"} failed to render`, error, info);
  }

  componentDidUpdate(previous) {
    // A boundary that latches forever turns one bad render into a permanently
    // dead panel. Navigating away and back, or switching tabs, should get a
    // fresh attempt.
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error);
    return (
      <div className="boundary-fallback" role="alert">
        <h2>This part didn't open</h2>
        <p>
          Something went wrong showing {this.props.name || "this screen"}. Nothing was lost —
          the story and everything in it are fine.
        </p>
        <button className="outline-button" type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

function Progress({ value, max }) {
  return <div className="progress-track"><span style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} /></div>;
}

/**
 * Split a prose field into paragraphs. Blank lines first, since that is how the
 * editor writes them; a single unbroken block stays one paragraph rather than
 * being chopped at every newline, which would shred a wrapped sentence.
 */
export function loreParagraphs(value) {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const byBlankLine = trimmed.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;
  return trimmed.split(/\n/).map((part) => part.trim()).filter(Boolean);
}

/**
 * One bible field, whatever shape it actually is.
 *
 * These fields are written by two different paths — a structured update that
 * produces arrays and a prose update that produces strings — so the SAME key is
 * a list on one universe and a paragraph on another. `the-embodied-age` has
 * `establishedFacts` as a 5-item array and `worldRules` as a 1,243-character
 * string, side by side in one document.
 *
 * So: check the shape, never assume it. A string renders as prose, an array
 * renders as cards, and anything else renders nothing at all rather than
 * `[object Object]` or a crash.
 */
export function LoreField({ title, value, render, className = "lore-card" }) {
  if (Array.isArray(value)) {
    const items = value.filter((item) => item != null && item !== "");
    if (!items.length) return null;
    return (
      <LoreSection title={title}>
        {items.map((item, i) => (
          <div className={className} key={i}>{render ? render(item, i) : loreText(item)}</div>
        ))}
      </LoreSection>
    );
  }
  const paragraphs = loreParagraphs(value);
  if (!paragraphs.length) return null;
  return (
    <LoreSection title={title}>
      {paragraphs.map((paragraph, i) => <p className="lore-paragraph" key={i}>{paragraph}</p>)}
    </LoreSection>
  );
}

/** A value a person can read. Never "[object Object]". */
export function loreText(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") return item.text || item.description || item.name || item.event || "";
  return item == null ? "" : String(item);
}

/**
 * The character list. `storyforge.universe.get.v1` returns `characters: []` at
 * the top level for `the-embodied-age` while `lore.characters` holds all 11, so
 * the section was empty even before the crash.
 *
 * Those entries carry `name`, `role` and `universeId` — no `characterId` and no
 * `description`. Keying on `characterId` gave every card the key `undefined`,
 * and the body read `description`, which is not there.
 */
export function loreCharacters(data) {
  const top = Array.isArray(data?.characters) ? data.characters : [];
  if (top.length) return top;
  return Array.isArray(data?.lore?.characters) ? data.lore.characters : [];
}

function Lore({ data }) {
  const bible = data?.bible || {};
  const characters = loreCharacters(data);
  return (
    <div className="lore">
      <LoreField title="World Rules" value={bible.worldRules} className="lore-card italic" />
      <LoreSection title="Characters">
        {characters.map((c, i) => (
          // Key on the name, which these entries do have, with the index as the
          // tiebreak for two characters sharing one.
          <div className="lore-card" key={`${c.name || "character"}-${i}`}>
            <h3>{c.name || "Unnamed"}</h3>
            {/* `role` carries the description on lore entries; `description`
                only exists on the structured character records. Whichever is
                present is the body, and it is never printed twice. */}
            {(c.description || c.role) && <p>{c.description || c.role}</p>}
            {c.description && c.role && <span>{c.role}</span>}
            {c.currentStatus && <small>{c.currentStatus}</small>}
          </div>
        ))}
      </LoreSection>
      {/* One map for the story, above the places it belongs to -- rather than a
          map per location, which is five downloads of the same tiles and five
          places to tap. It renders only when the bible says where somewhere
          actually is. */}
      <StoryMap places={mappablePlaces(bible.locations)} />
      <LoreField
        title="Locations"
        value={bible.locations}
        render={(loc) => (loc && typeof loc === "object"
          ? <><h3>{loc.name || "Unknown"}</h3><p>{loc.description || ""}</p></>
          : loreText(loc))}
      />
      <LoreField title="Factions" value={bible.factions} />
      {/* The "Something stirs in..." voice only works on a short list item.
          On a 579-character paragraph it would be absurd, so the flourish stays
          with the array shape it was written for. */}
      <LoreField
        title="Open Mysteries"
        value={bible.openMysteries}
        className="lore-card muted-card"
        render={(m) => `Something stirs in ${loreText(m).replace(/^where|what|who/i, "").trim()}...`}
      />
      <LoreField title="Established Facts" value={bible.establishedFacts} />
      <LoreField title="Where Things Stand" value={bible.worldState} />
      <LoreField title="Lore Entries" value={bible.lore} />
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
  const { readingGroup, activeReaders, users, setCurrentStory } = useApp();
  // Narration settings live in the drawer, not on the page: the reason the
  // picker never shipped was that there was nowhere to put it that did not
  // cover the chapter.
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState(readNarratorVoice);
  useEffect(() => {
    let cancelled = false;
    fetchVoices().then((v) => { if (!cancelled) setVoices(Array.isArray(v) ? v : []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  function chooseVoice(next) {
    setVoice(next);
    try { localStorage.setItem(NARRATOR_VOICE_KEY, next); } catch { /* a picker is not worth a crash */ }
  }
  // Switching readers switches identity, so it clears the remembered default
  // and goes back to the picker -- the same thing the header avatar did, now
  // with a label on it.
  function switchReaders() {
    try { localStorage.removeItem("storyforge_default_reader"); } catch { /* ignore */ }
    nav("/");
  }
  const [story, setStory] = useState(null);
  const [chapter, setChapter] = useState(null);
  const [chapterNumber, setChapterNumber] = useState(null);
  const [choicesVisible, setChoicesVisible] = useState(false);
  const [choiceRevealPending, setChoiceRevealPending] = useState(false);
  const [showChoiceTooltip, setShowChoiceTooltip] = useState(false);
  const [waiting, setWaiting] = useState(null);
  // A recorded choice that is waiting for somebody to ask for the chapter.
  const [pendingWrite, setPendingWrite] = useState(() => readPendingWrite(storyId));
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeError, setWriteError] = useState(null);
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
    setPendingWrite(readPendingWrite(storyId));
    setWriteError(null);
    setWriteBusy(false);
  }, [storyId]);

  useEffect(() => {
    if (!chapterNumber) return undefined;
    setChoicesVisible(false);
    setChoiceRevealPending(false);
    setWaiting(null);
    setChapter(null);
    getChapter(id, storyId, chapterNumber)
      .then((res) => {
        setChapter(res);
        // The chapter the card was offering to write now exists -- somebody
        // asked for it, here or somewhere else. The card has nothing left to
        // offer, and an offer to write a chapter that is already written is
        // how two chapters were lost.
        setPendingWrite((current) => {
          if (current?.chapterNumber !== res?.chapterNumber) return current;
          writePendingWrite(storyId, null);
          return null;
        });
      })
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
    // `recording` is the gap between the tap and the server's answer. Nothing is
    // queued yet, and chapter.status.v1 answers "generating" for a chapter it
    // has never heard of, so polling here invents a generation.
    if (!waiting?.chapterNumber || waiting.recording) return undefined;
    let cancelled = false;
    let finished = false;
    const targetChapter = waiting.chapterNumber;
    const startedAt = waiting.startedAt || Date.now();
    const kind = waiting.kind;
    // Kept on `waiting` too, so Try Again after a timeout does not forget that
    // the server already said it started.
    let sawReshaping = Boolean(waiting.sawReshaping);
    function showChapter(next) {
      cacheChapter(`sf_chapter_cache_${storyId}`, next);
      setChapter(next);
      setChapterNumber(targetChapter);
      setWaiting(null);
      setReshapedPulse(kind === "reshape");
      requestAnimationFrame(() => {
        if (kind === "reshape" && reshapeAnchor?.index != null) {
          document.querySelector(`[data-paragraph-index="${reshapeAnchor.index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          window.scrollTo(0, 0);
        }
      });
      setTimeout(() => setReshapedPulse(false), 1800);
    }
    async function poll() {
      if (cancelled || finished) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > waitTimeoutMs(kind)) {
        setWaiting((current) => current?.chapterNumber === targetChapter ? { ...current, timedOut: true } : current);
        return;
      }
      setWaiting((current) => current?.chapterNumber === targetChapter
        ? { ...current, messageIndex: ((current.messageIndex || 0) + 1) % CHAPTER_WAIT_MESSAGES.length }
        : current);
      try {
        const status = await getChapterStatus(id, storyId, targetChapter);
        if (cancelled || finished) return;
        const step = chapterPollStep(kind, status, sawReshaping);
        if (step.sawReshaping && !sawReshaping) {
          sawReshaping = true;
          setWaiting((current) => current?.chapterNumber === targetChapter ? { ...current, sawReshaping: true } : current);
        }
        if (step.action === "show") {
          finished = true;
          showChapter(status.chapter);
        } else if (step.action === "reread") {
          // The status route's `complete` carries the chapter, but a reshape is
          // the one case where the text on screen is the thing being replaced:
          // read it again, from the server, not the device cache.
          finished = true;
          const fresh = await execute("storyforge.chapter.get.v1", { tenantId: "core", userId: "jonathan", universeId: id, storyId, chapterNumber: targetChapter });
          if (!cancelled) showChapter(fresh);
        } else if (step.action === "failed") {
          setWaiting((current) => current?.chapterNumber === targetChapter
            ? { ...current, failed: true, error: status.error || (kind === "reshape" ? "The change could not be written." : "Chapter generation failed.") }
            : current);
        }
      } catch (error) {
        finished = false;
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
  }, [id, storyId, waiting?.chapterNumber, waiting?.startedAt, waiting?.recording]);

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

  // Tapping a choice says what the reader wants. It does not write anything.
  //
  // The waiting screen here used to go up before the call and stay up: "The
  // story is being written..." was printed the instant a child's finger left
  // the glass, whether or not anything was being written. Post-#1627 the server
  // records and stops, so that screen would have spun until the 120-second
  // timeout on a chapter that nobody had asked for. The screen now says only
  // what is true -- the pick is being saved -- and then either the server says
  // it is writing (and the waiting screen is honest) or it says it is waiting
  // for a request, and the card goes up instead.
  async function choose(choice) {
    const nextChapter = chapterNumber + 1;
    const choiceText = choice.text || String(choice);
    setWriteError(null);
    setWaiting({ chapterNumber: nextChapter, startedAt: Date.now(), messageIndex: 0, recording: true });
    try {
      const res = await execute("storyforge.choice.record.v1", {
        tenantId: "core",
        userId: "jonathan",
        universeId: id,
        storyId,
        chapterNumber,
        choiceId: String(choice.id || ""),
        choiceText,
        madeBy: activeReaders[0] || "jonathan",
        protagonistId: readingGroup,
        protagonistGroup: activeReaders.length > 1 ? readingGroup : null,
      });
      if (heldForRequest(res)) {
        const pending = {
          chapterNumber: Number(res?.chapterNumber) || nextChapter,
          choiceText,
          madeBy: activeReaders[0] || "jonathan",
          narratorOnly: res?.status === "awaiting_narrator" || res?.awaitingNarrator === true,
          recordedAt: Date.now(),
        };
        setPendingWrite(pending);
        writePendingWrite(storyId, pending);
        setWaiting(null);
        return;
      }
      setWaiting({ chapterNumber: Number(res?.chapterNumber) || nextChapter, startedAt: Date.now(), messageIndex: 0 });
    } catch (error) {
      setWaiting({ chapterNumber: nextChapter, startedAt: Date.now(), failed: true, error: error.message || "Choice could not be recorded." });
    }
  }

  // The write tap. The only thing in this app that asks for a chapter to exist.
  async function requestChapter() {
    if (!pendingWrite?.chapterNumber || writeBusy) return;
    const target = pendingWrite.chapterNumber;
    setWriteBusy(true);
    setWriteError(null);
    try {
      const res = await execute(AbilityCommandChapterRequest, {
        tenantId: "core",
        userId: "jonathan",
        universeId: id,
        storyId,
        chapterNumber: target,
        requestedBy: activeReaders[0] || "jonathan",
      });
      setPendingWrite(null);
      writePendingWrite(storyId, null);
      setWaiting({ chapterNumber: Number(res?.chapterNumber) || target, startedAt: Date.now(), messageIndex: 0 });
    } catch (error) {
      // The pick stays recorded and the card stays up. A failed ask is not a
      // reason to throw away what the reader already decided.
      setWriteError(writeChapterMessage(error, target));
    } finally {
      setWriteBusy(false);
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
      // A held chapter draft, or proposed end-of-chapter options for a chapter
      // that already exists (storyforge.chapter.choices.set.v1). Both write
      // nothing until a tap.
      const proposal = res.proposal && (res.proposal.draftId || isChoicesProposal(res.proposal)) ? res.proposal : null;
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
      // The server's sentence first. `chapter_landed_elsewhere` explains that
      // the save resolved to a different chapter and the proposal is still
      // held, which no generic message here could say.
      setChatThread((current) => [...(current || []), { role: "assistant", content: error.message || "That did not go through. The draft is still held.", kind: "error" }]);
    }
  }

  function approveDraft(proposal) {
    // The number comes from the SERVER'S REPORT of the write, and from nowhere
    // else.
    //
    // This used to fall back to the draft's own chapterNumber when the server
    // did not name one, and that fallback is the whole bug: `storyforge.chapter.save.v1` resolves its own
    // chapter target and can land somewhere other than the draft's slot, so a
    // reader was told "Saved as chapter 1" about a write that went elsewhere.
    // Falling back to what we ASKED for, when the server did not say what it
    // DID, is stating a fact we do not have.
    //
    // If the server does not name a chapter, the confirmation does not name one
    // either. "Saved." is less informative and true; the alternative was
    // informative and wrong.
    // `Number.isFinite(Number(x))` is NOT the check: `Number(null)` and
    // `Number("")` are both 0, so a missing chapter rendered as
    // "Saved as chapter null." The value has to actually be a number.
    return settleProposal(proposal, AbilityCommandDraftApprove, {}, (res) =>
      typeof res?.chapterNumber === "number" && Number.isFinite(res.chapterNumber)
        ? `Saved as chapter ${res.chapterNumber}.`
        : "Saved.");
  }

  // The one write a choices proposal can make. It sets the options at the end of
  // an EXISTING chapter and nothing else; the confirmation is built from the
  // server's read-back (`verified`, `chapterNumber`, `choices`), never from the
  // proposal, and an unverified write is reported as one.
  async function approveChoices(proposal) {
    try {
      const res = await execute(AbilityCommandChapterChoicesSet, {
        tenantId: "core",
        userId: activeReaders[0] || "jonathan",
        universeId: id,
        storyId,
        chapterNumber: proposal.chapterNumber,
        choices: proposal.choices,
      });
      setChatThread((current) => (current || []).map((m) => (m.proposal === proposal ? { ...m, proposal: null } : m)));
      const count = Array.isArray(res?.choices) ? res.choices.length : 0;
      const text = res?.verified === true && typeof res?.chapterNumber === "number"
        ? `Saved ${count} option${count === 1 ? "" : "s"} at the end of chapter ${res.chapterNumber}. The chapter's text was not touched.`
        : (res?.message || "The options were written but could not be verified. Check the chapter before relying on them.");
      setChatThread((current) => [...(current || []), { role: "assistant", content: text, kind: res?.verified ? "note" : "error" }]);
    } catch (error) {
      setChatThread((current) => [...(current || []), { role: "assistant", content: error.message || "Those options were not saved.", kind: "error" }]);
    }
  }

  function dismissChoices(proposal) {
    setChatThread((current) => [...(current || []).map((m) => (m.proposal === proposal ? { ...m, proposal: null } : m)),
      { role: "assistant", content: "Not saved. The chapter's options are unchanged.", kind: "note" }]);
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
  // The card belongs to the chapter the reader just finished, not to whichever
  // chapter they have since paged back to.
  const awaitingWrite = Boolean(pendingWrite?.chapterNumber && pendingWrite.chapterNumber === chapterNumber + 1);
  const waitMessages = waiting?.kind === "reshape" ? RESHAPE_WAIT_MESSAGES : CHAPTER_WAIT_MESSAGES;
  if (waiting) {
    return (
      <WaitingState
        text={waiting.recording ? "Saving what you picked..." : waitMessages[waiting.messageIndex || 0]}
        timedOut={waiting.timedOut}
        timedOutText={waiting.kind === "reshape" ? "Your change is not on the page yet." : undefined}
        error={waiting.timedOut && waiting.kind === "reshape" && !waiting.error
          ? (waiting.sawReshaping
            ? "The story server is still rewriting it. Nothing is lost. Try Again keeps waiting; it does not send the change twice."
            : "The story server never said it started your change. It may not have arrived. Try Again keeps waiting; if nothing changes, send it again.")
          : waiting.error}
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
        <NarrationPanel chapter={chapter} voiceId={voice} />
        <ChapterImages chapter={chapter} tier={tier} onHeroLoad={() => setProseReady(true)} />
        {/* Separate boundaries so the chapter and the conversation cannot take
            each other down. A crash in the sheet should not cost the page a
            child is reading, and vice versa. */}
        {proseReady && (
          <ErrorBoundary name="this chapter" resetKey={`${storyId}:${chapterNumber}`}>
            <Prose chapter={chapter} tier={tier} entities={entities} onLongPress={setReshapePromptPoint} onEntityTap={setInteractTarget} onWordTap={tier !== 1 ? setDefineWord : undefined} pulseFrom={reshapedPulse ? reshapeAnchor?.index : null} />
          </ErrorBoundary>
        )}
        {choiceRevealPending && !awaitingWrite && <div className="choice-sweep" />}
        {/* One or the other, never both. The choices are the question; the card
            is the answer already given and the separate act of writing it up.
            A reader looking at the card has no choice button on the screen to
            confuse it with. */}
        {awaitingWrite ? (
          <WriteNextChapterCard
            pending={pendingWrite}
            busy={writeBusy}
            error={writeError?.text}
            detail={writeError?.detail}
            onWrite={requestChapter}
          />
        ) : (
          <ChoicePanel visible={choicesVisible} chapter={chapter} readers={activeReaders} onChoose={choose} showTooltip={showChoiceTooltip} onDismissTooltip={() => setShowChoiceTooltip(false)} />
        )}
        {/* 2026-09-13: the talk bar is gone. It opened the same StoryChatSheet
            the 💬 in the header opens, and it sat there permanently taking a
            third of the reading view to do it. The reading view is prose. */}
      </motion.article>
      <ChapterMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        total={storyChapterLimit(story, chapter.chapterNumber)}
        current={chapterNumber}
        onJump={(n) => { setMenuOpen(false); setChapterNumber(n); window.scrollTo(0, 0); }}
        textScale={textScale}
        onTextScale={changeTextScale}
        voices={voices}
        voice={voice}
        onVoice={chooseVoice}
        readerName={userFor(activeReaders[0] || "jonathan", users).displayName}
        onSwitchReader={() => { setMenuOpen(false); switchReaders(); }}
      />
      <ReshapeConfirm point={reshapePromptPoint} onCancel={() => setReshapePromptPoint(null)} onConfirm={() => { setReshapePoint(reshapePromptPoint); setReshapePromptPoint(null); }} />
      <ReshapeSheet point={reshapePoint} tier={tier} onCancel={() => setReshapePoint(null)} onSubmit={submitReshape} />
      <ErrorBoundary
        name="the conversation"
        resetKey={chatThread ? "open" : "closed"}
        fallback={() => (
          <div className="bottom-sheet">
            <button className="sheet-shade" onClick={closeChat} />
            <section className="sheet-panel">
              <div className="boundary-fallback" role="alert">
                <h2>The conversation didn't open</h2>
                <p>Something went wrong here. Nothing you said was lost — it is saved with the story.</p>
                <button className="outline-button" type="button" onClick={closeChat}>Close</button>
              </div>
            </section>
          </div>
        )}
      >
        <StoryChatSheet thread={chatThread} busy={chatBusy} onSend={sendChatMessage} onClose={closeChat} onApprove={approveDraft} onDismiss={dismissDraft} onApproveChoices={approveChoices} onDismissChoices={dismissChoices} />
      </ErrorBoundary>
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

/* --- What a reader is allowed to see ------------------------------------
 *
 * Read on the device, 2026-09-13, chapter 2 of `the-embodied-age/threshold`:
 *
 *     record; it was an architecture. <!-- pause --> Maren Voss sat at the
 *     Before her lay the *Codex of Internal Rhythms*, a book
 *
 * The `<!-- ... -->` markers are TTS direction -- the live chapter carries
 * `pause`, `character: maren` and `dramatic`. They are **data for the audio
 * renderer** and must stay in Firestore and in Drive exactly as written. They
 * simply have no business on a page. The `*italics*` are markdown, which the
 * chat sheet learned to render in #12 and the chapter reader never did.
 *
 * THE SECOND ATTEMPT.
 *
 * #22 shipped this as three passes that each re-split a string, and it made the
 * reader unusable on any paragraph that had both markdown and a character name
 * in it -- words run together, short words gone, spans repeating down the page.
 * It was NOT a string-offset bug, which is what it looked like. It was
 * duplicate React keys: `renderInteractiveText` seeded `let key = 10000` per
 * call, #22 called it once per markdown segment, and every segment therefore
 * produced keys 10000, 10001, ... into the same parent's children. React
 * reconciles by key, so on the first re-render it duplicated some children and
 * dropped others; whitespace and words under three letters were returned as
 * bare unkeyed strings, so those were the ones that vanished.
 *
 * The first render was correct, which is why every test passed and why it could
 * only be seen on a device.
 *
 * So this version does not build strings in layers. It resolves the paragraph
 * ONCE into a flat list of typed tokens, and rendering is a single walk over
 * that list with one key counter for the whole paragraph. Two properties hold
 * by construction, and both are asserted:
 *
 *   1. Concatenating every token's text reproduces the cue-stripped,
 *      markdown-stripped source character for character. Nothing can be
 *      duplicated or dropped, because nothing is ever re-split.
 *   2. Every rendered node has a key, including whitespace. There are no bare
 *      string children for React to lose.
 */

// Every TTS directive the generator emits, and anything shaped like one it
// starts emitting tomorrow. Deliberately broad: an unknown directive is still
// not something a reader should see.
const PROSE_DIRECTIVE = /<!--[\s\S]*?-->/g;

/** A scene break, in either of the two spellings the prose uses. */
const SCENE_BREAK = /^\s*(?:\*\*\*|---|—\s*◈\s*—|◈)\s*$/;

/** Markdown emphasis, as one scan rather than a split. */
const MD_SPAN = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(\*|_)(?=\S)([^*_\n]*?\S)\3|`([^`\n]+)`/g;

/**
 * The stored text with the audio cues taken out. Everything a person reads
 * passes through this; nothing that writes or narrates does.
 */
export function stripProseDirectives(text) {
  return String(text ?? "").replace(PROSE_DIRECTIVE, "");
}

/**
 * What the audio renderer wants back: the cues, in order, with what they said.
 * Exported so a test can prove the reader and the narrator are looking at the
 * same source and disagreeing only about the cues.
 */
export function proseDirectives(text) {
  return [...String(text ?? "").matchAll(PROSE_DIRECTIVE)].map((match) => {
    const body = match[0].slice(4, -3).trim();
    const [name, ...rest] = body.split(":");
    return { directive: name.trim().toLowerCase(), value: rest.join(":").trim() || null, raw: match[0] };
  });
}

/**
 * One paragraph, as a flat list of `{ kind, text }`.
 *
 * `kind` is "plain" | "em" | "strong" | "code" | "entity" | "word". The scan
 * only ever moves FORWARD, and each step consumes at least one character, so
 * this cannot fail to terminate however strange the input. Joining the `text`
 * of every token returns the input minus the markdown punctuation and nothing
 * else -- which is the property `proseTokens` exists to make testable.
 */
export function proseTokens(text, entities, { words = false } = {}) {
  const source = stripProseDirectives(text);
  const emphasised = [];
  let at = 0;
  MD_SPAN.lastIndex = 0;
  for (let match = MD_SPAN.exec(source); match; match = MD_SPAN.exec(source)) {
    if (match.index > at) emphasised.push({ kind: "plain", text: source.slice(at, match.index) });
    if (match[2] != null) emphasised.push({ kind: "strong", text: match[2] });
    else if (match[4] != null) emphasised.push({ kind: "em", text: match[4] });
    else emphasised.push({ kind: "code", text: match[5] });
    at = match.index + match[0].length;
    // A zero-length match would spin here forever. It cannot happen with this
    // pattern -- every branch requires at least one non-space character -- but
    // the guard costs nothing and the thing being guarded against is what took
    // the reader down.
    if (MD_SPAN.lastIndex <= match.index) MD_SPAN.lastIndex = match.index + 1;
  }
  if (at < source.length) emphasised.push({ kind: "plain", text: source.slice(at) });

  // Entities, then words, each splitting a token's own text and never the
  // paragraph. `code` is left alone: a character name inside backticks is a
  // literal, not a link.
  const withEntities = emphasised.flatMap((token) =>
    token.kind === "code" ? [token] : splitEntities(token, entities));
  if (!words) return withEntities;
  return withEntities.flatMap((token) =>
    token.kind === "entity" || token.kind === "code" ? [token] : splitWords(token));
}

function splitEntities(token, entities) {
  const list = (entities || []).filter((entity) => String(entity?.name || "").trim().length > 0);
  if (!list.length) return [token];
  const out = [];
  let rest = token.text;
  let guard = 0;
  while (rest && guard++ < 5000) {
    const found = list
      .map((entity) => {
        const idx = findEntityIndex(rest, String(entity.name));
        return idx >= 0 ? { entity, idx, length: String(entity.name).length } : null;
      })
      .filter((hit) => hit && hit.length > 0)
      .sort((a, b) => a.idx - b.idx || b.length - a.length)[0];
    if (!found) break;
    if (found.idx > 0) out.push({ ...token, text: rest.slice(0, found.idx) });
    out.push({ kind: "entity", emphasis: token.kind, entity: found.entity,
               text: rest.slice(found.idx, found.idx + found.length) });
    rest = rest.slice(found.idx + found.length);
  }
  if (rest) out.push({ ...token, text: rest });
  return out;
}

function splitWords(token) {
  // Words of three letters or more are tappable for a definition; everything
  // else -- punctuation, spaces, "a", "of" -- stays as text, but as a TOKEN
  // with a key rather than a bare string React can lose.
  return token.text.split(/(\s+)/).filter((part) => part !== "").map((part) => {
    const clean = part.replace(/[^a-zA-Z']/g, "");
    return clean.length >= 3 && !/^\s+$/.test(part)
      ? { ...token, kind: "word", word: clean.toLowerCase(), emphasis: token.kind, text: part }
      : { ...token, text: part };
  });
}

/**
 * Blocks, in reading order. A paragraph or a scene break — never a paragraph
 * whose entire content is three asterisks, which is what the reader showed.
 */
export function proseBlocks(text) {
  return stripProseDirectives(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (SCENE_BREAK.test(line) ? { type: "break" } : { type: "paragraph", text: line }));
}

function Prose({ chapter, tier, entities, onLongPress, onEntityTap, onWordTap, pulseFrom }) {
  const blocks = proseBlocks(chapter.prose);
  const images = (chapter.images || []).filter((img) => img.url);
  // Paragraphs keep their own numbering across scene breaks, because the
  // bookmark and the reshape anchor both address a paragraph index and a rule
  // is not a paragraph.
  let paragraphIndex = -1;
  return (
    <div className={`prose ${pulseFrom != null ? "reshaped-pulse" : ""}`}>
      {blocks.map((block, blockIndex) => {
        if (block.type === "break") {
          return <hr className="scene-break" key={`b${blockIndex}`} aria-hidden="true" />;
        }
        paragraphIndex += 1;
        const i = paragraphIndex;
        return (
          <React.Fragment key={`p${blockIndex}`}>
            <InteractiveParagraph text={block.text} index={i} entities={entities} onLongPress={onLongPress} onEntityTap={onEntityTap} onWordTap={onWordTap} pulsing={pulseFrom != null && i >= pulseFrom} />
            {tier === 1 && images[i % Math.max(1, images.length)] && i > 0 && i % 2 === 1 && (
              <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="chapter-image" src={images[i % images.length].url} alt={images[i % images.length].sceneDescription || "Chapter illustration"} />
            )}
          </React.Fragment>
        );
      })}
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
      {renderProseText(text, entities, onEntityTap, onWordTap ? handleWordTap : null)}
    </p>
  );
}

/**
 * One paragraph of chapter prose, rendered in a single walk.
 *
 * ONE key counter for the whole paragraph, and EVERY node carries a key —
 * whitespace included. #22's corruption was three separate key sequences
 * flattened into one parent plus bare unkeyed strings between them; there is
 * nothing here for React to duplicate or drop.
 */
function renderProseText(text, entities, onEntityTap, onWordTap) {
  const tokens = proseTokens(text, entities, { words: Boolean(onWordTap) });
  return tokens.map((token, index) => {
    const key = `t${index}`;
    if (token.kind === "entity") {
      return (
        <button type="button" className="entity-link" key={key}
                onClick={(event) => { event.stopPropagation(); onEntityTap({ ...token.entity, context: text }); }}>
          {wrapEmphasis(token.emphasis, token.text)}
        </button>
      );
    }
    if (token.kind === "word") {
      return (
        <span className="tap-word" key={key}
              onClick={(event) => { event.stopPropagation(); onWordTap(token.word); }}>
          {wrapEmphasis(token.emphasis, token.text)}
        </span>
      );
    }
    return <React.Fragment key={key}>{wrapEmphasis(token.kind, token.text)}</React.Fragment>;
  });
}

function wrapEmphasis(kind, text) {
  if (kind === "strong") return <strong>{text}</strong>;
  if (kind === "em") return <em>{text}</em>;
  if (kind === "code") return <code>{text}</code>;
  return text;
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

// `renderEntityText` lived here until 2026-09-14. It consumed a string by
// offset inside a `while (remaining)` loop, which terminates only as long as
// every match has non-zero length -- an entity whose name was empty or
// whitespace would have spun forever. `proseTokens` replaces it and cannot:
// the scan is a `for` over a bounded token list, and an entity with a blank
// name is filtered out before it gets there.

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
// A delimiter must sit against a non-space character, as CommonMark requires
// and as MD_SPAN already does. The looser pattern turned "2 * 3 * 4" into
// "2 <em> 3 </em> 4" -- arithmetic silently rewritten (found porting to iOS).
const MD_INLINE = /(\*\*(?=\S)[^*]*?\S\*\*|__(?=\S)[^_]*?\S__|\*(?=\S)[^*\n]*?\S\*|_(?=\S)[^_\n]*?\S_|`[^`\n]+`)/g;

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

/** Block-level parse. Returns React nodes, never HTML.
 *
 * Lists are LOOSE-aware (2026-09-16). The editor writes numbered options with a
 * blank line between items and a parenthetical on the next line:
 *
 *     1. **"Forget the speed limits…"**
 *        (Push Jonathan to drive…)
 *
 *     2. **"Wait—if the compass is 1885…"**
 *
 * A blank line used to close the list, so each item became its own <ol> and a
 * seven-year-old saw "1. / 1. / 1.". Now a blank line only ends a list when the
 * next non-blank line is not another item of the same kind, an indented line
 * continues the item above it, and an ordered list starts at the number the
 * source gave its first item.
 */
function renderMarkdown(source) {
  const lines = String(source ?? "").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;   // { ordered, start, items: [] }

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ");
    blocks.push(<p key={`p${blocks.length}`}>{renderInline(text, `p${blocks.length}`)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const startAttr = list.ordered && list.start !== 1 ? { start: list.start } : {};
    blocks.push(
      <Tag key={`l${blocks.length}`} {...startAttr}>
        {list.items.map((item, index) => (
          <li key={index}>
            {item.map((part, partIndex) => (
              partIndex === 0
                ? <React.Fragment key={partIndex}>{renderInline(part, `l${blocks.length}-${index}-${partIndex}`)}</React.Fragment>
                : <span key={partIndex} className="li-continuation">{renderInline(part, `l${blocks.length}-${index}-${partIndex}`)}</span>
            ))}
          </li>
        ))}
      </Tag>
    );
    list = null;
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

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
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, start: ordered ? Math.max(1, parseInt(numbered[1], 10) || 1) : 1, items: [] };
      }
      list.items.push([numbered ? numbered[2] : bullet[1]]);
      continue;
    }

    // An indented line under an item belongs to that item, blank line or not.
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1].push(line.trim());
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

function isChoicesProposal(proposal) {
  return Boolean(proposal && proposal.path === "chapter_choices" && typeof proposal.chapterNumber === "number"
    && Array.isArray(proposal.choices) && proposal.choices.length);
}

/** Proposed end-of-chapter options for a chapter that already exists.
 *
 * "Save these as the options for chapter 1" used to have no door that did not
 * rewrite the chapter. This card is the explicit, non-destructive one: it names
 * the chapter, lists exactly what will be saved, says the text is not touched,
 * and writes once on a tap.
 */
function ChoicesProposalCard({ proposal, busy, onApprove, onDismiss }) {
  const [pending, setPending] = useState("");
  if (!isChoicesProposal(proposal)) return null;
  const disabled = busy || Boolean(pending);
  async function run(kind, fn) {
    if (disabled) return;
    setPending(kind);
    try { await fn(); } finally { setPending(""); }
  }
  return (
    <section className="proposal-card choices-proposal" aria-label={`Proposed options for chapter ${proposal.chapterNumber}`}>
      <div className="proposal-kicker">Options at the end of chapter {proposal.chapterNumber} · not saved</div>
      <ol className="proposal-choices">
        {proposal.choices.map((choice, index) => (
          <li key={choice.id || index}>{typeof choice === "string" ? choice : choice.text}</li>
        ))}
      </ol>
      <p className="proposal-note">Only the options change. The chapter's text stays exactly as it is.</p>
      <div className="proposal-actions">
        <button type="button" className="proposal-approve" disabled={disabled} onClick={() => run("approve", () => onApprove(proposal))}>
          {pending === "approve" ? "Saving…" : `Save as chapter ${proposal.chapterNumber}'s options`}
        </button>
        <button type="button" className="proposal-dismiss" disabled={disabled} onClick={() => run("dismiss", () => onDismiss(proposal))}>
          Not these
        </button>
      </div>
    </section>
  );
}

/** The second tap: the one that writes a chapter.
 *
 * Modelled on ChoicesProposalCard above (#31) rather than invented fresh --
 * same card, same kicker, same one gold pill that does the write -- because the
 * pattern is already "here is exactly what will be written, and which chapter,
 * and nothing happens until you tap". This one names the chapter number and
 * quotes the choice that is waiting.
 *
 * It is deliberately nothing like the choice panel underneath the prose. That
 * is an open list of soft, full-width, left-aligned options with no border; a
 * tap there says what the reader wants and writes no chapter. This is a bounded
 * gold-edged card with a single pill button. A reader who taps a choice cannot
 * have tapped this, because this is not on the screen until the choice is
 * already recorded and the choices are gone.
 */
function WriteNextChapterCard({ pending, busy, error, detail, onWrite }) {
  if (!pending?.chapterNumber) return null;
  const n = pending.chapterNumber;
  return (
    <section className="proposal-card write-chapter-card" aria-label={`Write chapter ${n}`}>
      <div className="proposal-kicker">Chapter {n} is not written yet</div>
      {pending.choiceText && <p className="write-chapter-pick">You picked: “{pending.choiceText}”</p>}
      {pending.narratorOnly ? (
        <p className="proposal-note">A grown-up has to ask for chapter {n}. Your pick is saved until then.</p>
      ) : (
        <>
          <p className="proposal-note">Tap the button to make chapter {n}. Nothing happens until you do.</p>
          <div className="proposal-actions">
            <button
              type="button"
              className="proposal-approve write-chapter-button"
              disabled={busy}
              onClick={onWrite}
            >
              {busy ? `Writing chapter ${n}…` : `Write chapter ${n}`}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="write-chapter-error" role="alert">
          {error}
          {detail ? <span className="write-chapter-detail">{detail}</span> : null}
        </p>
      )}
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

/** The one compose row. Lives in the chat sheet, which is now the only place
 * anyone types to the story.
 *
 * WHAT IT REPLACED. Both original call sites were a single-line `<input>` beside
 * a `gold-button`. `.gold-button` is `width: 100%`, and `.story-talk` declared
 * three grid columns (`auto 1fr auto`) for two children — so the field landed in
 * the `auto` column and sized to its content while the button took the `1fr`.
 * That was the small square and the full-width Send: not a styling opinion, a
 * template with one column too many. The second call site, the reader's talk
 * bar, was removed on 2026-09-13 — it opened the same sheet as the 💬 in the
 * header while occupying a third of the reading view.
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

function StoryChatSheet({ thread, busy, onSend, onClose, onApprove, onDismiss, onApproveChoices = () => {}, onDismissChoices = () => {} }) {
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
            {index === thread.length - 1 && message.role === "assistant" && isChoicesProposal(message.proposal) && (
              <ChoicesProposalCard proposal={message.proposal} busy={busy} onApprove={onApproveChoices} onDismiss={onDismissChoices} />
            )}
            {index === thread.length - 1 && message.role === "assistant" && message.proposal?.draftId && (
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

/**
 * A narrator's name, out of a synthesiser's id.
 *
 * Kokoro ships ids like `af_heart` and `bm_george`: first letter the accent,
 * second the voice's gender, then the name. That is a fine key and a terrible
 * label -- `NarrationPanel` has carried the comment "the human-readable name
 * and the picker belong in the settings sheet; until that exists this is a
 * default nobody sees" since the panel was written. This is that sheet.
 *
 * Unknown ids are not dropped: a voice the server adds tomorrow shows up with
 * whatever of its name can be read, rather than disappearing from the list.
 */
const VOICE_ACCENTS = { a: "American", b: "British", e: "Spanish", f: "French", i: "Italian", j: "Japanese", p: "Portuguese", z: "Chinese" };
const VOICE_REGISTERS = { f: "warm", m: "low" };

export function voiceLabel(voiceId) {
  const id = String(voiceId || "").trim();
  if (!id) return "";
  const match = /^([a-z])([fm])_(.+)$/i.exec(id);
  if (!match) return id.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const [, accent, register, rawName] = match;
  const name = rawName.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const accentName = VOICE_ACCENTS[accent.toLowerCase()];
  const registerName = VOICE_REGISTERS[register.toLowerCase()];
  const parts = [accentName, registerName].filter(Boolean);
  return parts.length ? `${name} — ${parts.join(", ")}` : name;
}

export const NARRATOR_VOICE_KEY = "storyforge_narrator_voice";

export function readNarratorVoice(fallback = "af_heart") {
  try {
    return localStorage.getItem(NARRATOR_VOICE_KEY) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * The voice picker, in the drawer rather than on the reading page.
 *
 * It is a list of buttons and not a `<select>`: a native select on iOS opens a
 * full-screen wheel over the chapter, and the point of putting this in the
 * drawer was to stop narration controls covering the words.
 */
export function VoiceChoice({ voices, value, onChange }) {
  const list = (voices || []).map((v) => (typeof v === "string" ? v : v?.id || v?.voice || v?.name)).filter(Boolean);
  if (!list.length) return <p className="drawer-note">Voices load when narration is available.</p>;
  return (
    <div className="voice-choice" role="radiogroup" aria-label="Narrator voice">
      {list.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={id === value}
          className={id === value ? "voice-option current" : "voice-option"}
          onClick={() => onChange(id)}
        >
          {voiceLabel(id)}
        </button>
      ))}
    </div>
  );
}


function ChapterMenu({ open, onClose, total, current, onJump, textScale = 1, onTextScale, voices = [], voice, onVoice, onSwitchReader, readerName }) {
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
            {onVoice && (
              <>
                <h2>Reading voice</h2>
                <VoiceChoice voices={voices} value={voice} onChange={onVoice} />
              </>
            )}
            {onSwitchReader && (
              <>
                <h2>Who's reading</h2>
                {/* It was a tap on the avatar in the header and nothing said so.
                    Same action, now with a name on it. */}
                <button className="outline-button menu-switch-reader" type="button" onClick={onSwitchReader}>
                  {readerName ? `Reading as ${readerName} — switch` : "Switch readers"}
                </button>
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

// A choice that has been recorded and is waiting for somebody to ask for the
// chapter. It is kept on the device because the server cannot be asked about
// it: `storyforge.chapter.status.v1` folds every queue status it does not
// recognise into "generating", so an `awaiting_request` item reads back as a
// generation that is already running. Polling it would show a spinner for a
// chapter nobody has asked for -- exactly the lie this whole change removes.
// Keyed by storyId alone, like the bookmark, so it survives a reload, a reader
// switch and a closed tab.
function readPendingWrite(storyId) {
  try {
    const value = JSON.parse(localStorage.getItem(`sf_pending_write_${storyId}`) || "null");
    return value && value.chapterNumber ? value : null;
  } catch {
    return null;
  }
}

function writePendingWrite(storyId, pending) {
  try {
    if (pending) localStorage.setItem(`sf_pending_write_${storyId}`, JSON.stringify(pending));
    else localStorage.removeItem(`sf_pending_write_${storyId}`);
  } catch {
    // Private mode. The card is still correct for this session.
  }
}

/** Did the server record the choice and stop, rather than start writing?
 *
 * Post-#1627 `choice.record.v1` answers `autoGenerates: false` with
 * `status: "awaiting_request"` and names the call that writes. A server that
 * predates #1627 answers `awaitingDirection: true` with a non-zero
 * `directionTimeoutSeconds`, which means a chapter really is coming whether or
 * not anybody asks -- so that server keeps the old waiting screen, because on
 * it the waiting screen is true.
 */
function heldForRequest(result) {
  if (!result) return false;
  if (result.status === "awaiting_request" || result.awaitingRequest === true) return true;
  if (result.status === "awaiting_narrator" || result.awaitingNarrator === true) return true;
  return result.autoGenerates === false;
}

// A server that has not deployed `storyforge.chapter.request.v1` refuses it at
// the dispatcher, before any handler: HTTP 403 COMMAND_NOT_DECLARED_IN_CODE, or
// 404 UNKNOWN_CANONICAL_COMMAND when the code is there and the binding is not.
const CHAPTER_REQUEST_MISSING = /COMMAND_NOT_DECLARED_IN_CODE|UNKNOWN_CANONICAL_COMMAND|not declared in this service|no firestore binding/i;

/** What to say to a seven-year-old when the chapter was not written.
 *
 * `detail` is the server's own words, kept verbatim and shown small, because
 * the person who has to fix it is reading over the child's shoulder.
 */
function writeChapterMessage(error, chapterNumber) {
  const raw = String(error?.message || error || "").trim();
  const n = chapterNumber;
  if (CHAPTER_REQUEST_MISSING.test(raw)) {
    return {
      text: `Not yet. The app asked for chapter ${n}, but the story server does not know how to write one this way yet. Your pick is saved. Try again later.`,
      detail: raw,
    };
  }
  if (/chapter_exists/i.test(raw)) return { text: `Chapter ${n} is already written. Turn the page to read it.`, detail: "" };
  if (/no_recorded_choice/i.test(raw)) return { text: `The story did not keep your pick. Tap what happens next again.`, detail: raw };
  if (/already_generating|already_complete/i.test(raw)) return { text: `Chapter ${n} is already being written. It will be here soon.`, detail: "" };
  if (/awaiting_narrator/i.test(raw)) return { text: `A grown-up has to ask for chapter ${n}.`, detail: "" };
  if (/not signed in/i.test(raw)) return { text: raw, detail: "" };
  return { text: `Chapter ${n} was not written. Nothing is lost — your pick is saved. Try again in a minute.`, detail: raw };
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

export const CHAPTER_WAIT_TIMEOUT_MS = 120000;
// A reshape rewrites a whole chapter from the intervention on. 2026-09-21 one
// took two and a half minutes, past the chapter timeout.
export const RESHAPE_WAIT_TIMEOUT_MS = 6 * 60 * 1000;

export function waitTimeoutMs(kind) {
  return kind === "reshape" ? RESHAPE_WAIT_TIMEOUT_MS : CHAPTER_WAIT_TIMEOUT_MS;
}

/** What one `chapter.status` answer means to the waiting screen.
 *
 * A reshape rewrites a chapter that already exists, so that chapter is
 * already `complete` -- with the OLD text -- until the server has marked the
 * reshape as running. `storyforge.chapter.reshape.v1` writes the queue item
 * `{ type: "reshape", status: "reshaping" }`, and while it is there the status
 * route answers `status: "reshaping"`. The poll starts the moment the tap
 * lands, before that write, so on 2026-09-21 the first poll read `complete`,
 * showed the old chapter and stopped; the edit landed 2.5 minutes later and
 * the page never showed it. Nothing before `reshaping` is about this reshape:
 * not `complete`, and not a `failed` left by an earlier one.
 *
 * Returns `{ action, sawReshaping }`, where action is "wait", "show" (use
 * `status.chapter`), "reread" (fetch the chapter again) or "failed".
 */
export function chapterPollStep(kind, status, sawReshaping = false) {
  const state = status?.status;
  if (kind === "reshape") {
    if (state === "reshaping") return { action: "wait", sawReshaping: true };
    if (!sawReshaping) return { action: "wait", sawReshaping: false };
    if (state === "complete") return { action: "reread", sawReshaping };
    if (state === "failed") return { action: "failed", sawReshaping };
    return { action: "wait", sawReshaping };
  }
  if (state === "complete" && status.chapter) return { action: "show", sawReshaping };
  if (state === "failed") return { action: "failed", sawReshaping };
  return { action: "wait", sawReshaping };
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

function WaitingState({ text, timedOut, timedOutText = "This is taking longer than expected.", error, onRetry }) {
  return (
    <div className="waiting">
      <div className="compass" />
      <h1>{timedOut ? timedOutText : text}</h1>
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

/* --- The universe editor ------------------------------------------------
 *
 * Every capability below already shipped. The PWA could create a universe and
 * then never touch it again: no way to fix a title, a genre, a bible field, or
 * a lore entry stamped with the wrong chapter. The editing all happened in a
 * chat window by typing capability names, which is not something anybody does
 * with a thumb.
 *
 * Two rules run through the whole screen:
 *
 *   1. **Nothing reports success until it has been read back.** Every save
 *      re-reads `storyforge.universe.get.v1` and compares. A green tick that
 *      means "the request did not throw" is worse than no tick, because it
 *      stops you checking.
 *   2. **Shape is never coerced.** A bible field that is prose stays prose and
 *      a field that is a list stays a list. These are written by two different
 *      paths, so the same key is a string on one universe and an array on
 *      another — `the-embodied-age` has both in one document.
 */

export const BIBLE_FIELDS = [
  ["worldRules", "World rules"],
  ["lore", "Lore"],
  ["locations", "Locations"],
  ["openMysteries", "Open mysteries"],
  ["factions", "Factions"],
  ["arcDirection", "Where the arc is going"],
  ["establishedFacts", "Established facts"],
  ["worldState", "Where things stand"],
];

export const LORE_COLLECTIONS = [
  ["characters", "Characters", "name"],
  ["worldFacts", "World facts", "fact"],
  ["timeline", "Timeline", "event"],
  ["choiceHistory", "Choices made", "choiceText"],
];

/** "list" or "prose", from what the value actually is. Absent means prose:
 *  new writing is prose, and guessing "list" would turn a paragraph into a
 *  one-item array the next reader has to undo. */
export function bibleFieldShape(value) {
  if (Array.isArray(value)) return "list";
  return "prose";
}

/** What the editor should show for a value, without ever coercing it. */
export function bibleFieldDraft(value) {
  if (Array.isArray(value)) return value.map((item) => loreText(item));
  return typeof value === "string" ? value : "";
}

/**
 * Did the save actually take? Compares what was sent with what came back.
 *
 * Deliberately tolerant about whitespace only — the server trims — and strict
 * about everything else. A "saved" that did not save is the failure this whole
 * screen is built to avoid.
 */
export function savedValueMatches(sent, got) {
  if (Array.isArray(sent)) {
    if (!Array.isArray(got) || got.length !== sent.length) return false;
    return sent.every((item, i) => String(loreText(item)).trim() === String(loreText(got[i])).trim());
  }
  return String(got ?? "").trim() === String(sent ?? "").trim();
}

function SaveStatus({ state }) {
  if (!state) return null;
  if (state.busy) return <span className="save-status" role="status">Saving…</span>;
  if (state.error) return <span className="save-status save-error" role="alert">{state.error}</span>;
  if (state.message) return <span className="save-status save-ok" role="status">{state.message}</span>;
  return null;
}

function UniverseEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { activeReaders } = useApp();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState({});
  const tier = tierForReaders(activeReaders);

  const reload = React.useCallback(
    () => execute("storyforge.universe.get.v1", { tenantId: "core", userId: "jonathan", universeId: id }),
    [id]
  );

  useEffect(() => {
    // The gate below is a render guard; without this the effect still fires and
    // a child's device fetches a universe it is not allowed to see.
    if (tier <= 2) return;
    reload().then(setData).catch((error) => setLoadError(error.message || "Could not open this universe."));
  }, [reload, tier]);

  function mark(key, state) {
    setStatus((current) => ({ ...current, [key]: state }));
  }

  /**
   * Run one write, then read the universe back and check it landed.
   * `verify(fresh)` returns true when the change is visible in the fresh read.
   */
  async function saveAndVerify(key, command, args, verify, okMessage) {
    mark(key, { busy: true });
    try {
      const result = await execute(command, { tenantId: "core", userId: "jonathan", universeId: id, ...args });
      const fresh = await reload();
      setData(fresh);
      if (!verify(fresh)) {
        // The request succeeded and the value did not change. Saying "saved"
        // here is the lie this screen exists to not tell.
        mark(key, { error: "The server accepted that but still shows the old value. Nothing was lost — try again." });
        return false;
      }
      mark(key, { message: okMessage || "Saved" });
      return result;
    } catch (error) {
      mark(key, { error: error.message || "That did not save." });
      return false;
    }
  }

  if (tier <= 2) {
    return (
      <Page>
        <AppHeader title="Universe" backTo={`/universes/${id}`} />
        <section className="content">
          <div className="boundary-fallback">
            <h2>This part is for grown-ups</h2>
            <p>Ask a grown-up if you want to change how this world works.</p>
            <button className="outline-button" type="button" onClick={() => nav(`/universes/${id}`)}>Back</button>
          </div>
        </section>
      </Page>
    );
  }

  if (loadError) {
    return (
      <Page>
        <AppHeader title="Universe" backTo={`/universes/${id}`} />
        <section className="content"><div className="inline-error">{loadError}</div></section>
      </Page>
    );
  }
  if (!data) return <ReadingLoading text="Opening the universe..." />;

  return (
    <Page>
      <AppHeader title={data.universe?.title || "Universe"} backTo={`/universes/${id}`} />
      <section className="content universe-editor">
        <ErrorBoundary name="the details" resetKey={id}>
          <UniverseDetailsEditor universe={data.universe || {}} status={status} save={saveAndVerify} />
        </ErrorBoundary>
        <ErrorBoundary name="the world bible" resetKey={id}>
          <BibleEditor bible={data.bible || {}} status={status} save={saveAndVerify} />
        </ErrorBoundary>
        <ErrorBoundary name="the lore entries" resetKey={id}>
          <LoreEntryEditor lore={data.lore || {}} status={status} save={saveAndVerify} />
        </ErrorBoundary>
      </section>
    </Page>
  );
}

function UniverseDetailsEditor({ universe, status, save }) {
  const [title, setTitle] = useState(universe.title || "");
  const [tagline, setTagline] = useState(universe.tagline || "");
  const [genre, setGenre] = useState(universe.genre || "");
  const [audience, setAudience] = useState(universe.audienceAge || "");
  const state = status.details;

  // Only what changed. An unchanged key is not sent, because the capability
  // leaves absent keys alone and sending everything makes every save look like
  // an edit to every field.
  const patch = {};
  if (title.trim() && title.trim() !== (universe.title || "")) patch.title = title.trim();
  if (tagline.trim() && tagline.trim() !== (universe.tagline || "")) patch.tagline = tagline.trim();
  if (genre.trim() && genre.trim() !== (universe.genre || "")) patch.genre = genre.trim();
  if (audience.trim() && audience.trim() !== (universe.audienceAge || "")) patch.audienceAge = audience.trim();
  const dirty = Object.keys(patch).length > 0;

  return (
    <section className="editor-block">
      <h2>Details</h2>
      <div className="suggest-field">
        <label htmlFor="field-universeTitle">Title</label>
        <input id="field-universeTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="suggest-field">
        <label htmlFor="field-universeTagline">Tagline</label>
        <textarea id="field-universeTagline" className="editor-textarea" rows={2} value={tagline} onChange={(e) => setTagline(e.target.value)} />
      </div>
      <SuggestField
        label="Genre"
        name="universeGenre"
        value={genre}
        onChange={setGenre}
        suggestions={[...recentGenres(), ...GENRE_SUGGESTIONS]}
        placeholder="Anything — fuse them, invent one"
      />
      <SuggestField
        label="Who is this for?"
        name="universeAudience"
        value={audience}
        onChange={setAudience}
        suggestions={AUDIENCE_SUGGESTIONS}
        placeholder="child, teen, adult, anything"
      />
      {/* A field cannot be cleared here, only corrected — the capability
          ignores a blank value, and pretending otherwise would show a save
          that never happened. */}
      <p className="editor-note">Fields can be corrected but not emptied.</p>
      <div className="editor-actions">
        <button
          className="gold-button"
          type="button"
          disabled={!dirty || state?.busy}
          onClick={() => save(
            "details",
            "storyforge.universe.update.v1",
            patch,
            (fresh) => Object.entries(patch).every(([key, value]) => savedValueMatches(value, fresh.universe?.[key])),
            "Saved"
          )}
        >
          {state?.busy ? "Saving…" : "Save details"}
        </button>
        <SaveStatus state={state} />
      </div>
    </section>
  );
}

function BibleEditor({ bible, status, save }) {
  return (
    <section className="editor-block">
      <h2>World bible</h2>
      {BIBLE_FIELDS.map(([key, label]) => (
        <BibleField key={key} field={key} label={label} value={bible[key]} state={status[`bible:${key}`]} save={save} />
      ))}
    </section>
  );
}

export function BibleField({ field, label, value, state, save }) {
  const shape = bibleFieldShape(value);
  const [draft, setDraft] = useState(() => bibleFieldDraft(value));
  const original = bibleFieldDraft(value);
  const dirty = shape === "list"
    ? JSON.stringify(draft) !== JSON.stringify(original)
    : draft.trim() !== String(original).trim();

  function commit() {
    const next = shape === "list" ? draft.map((s) => s.trim()).filter(Boolean) : draft.trim();
    return save(
      `bible:${field}`,
      "storyforge.bible.field.update.v1",
      { field, value: next },
      (fresh) => savedValueMatches(next, fresh.bible?.[field]),
      "Saved"
    );
  }

  return (
    <div className="editor-field">
      <div className="editor-field-head">
        <h3>{label}</h3>
        <span className="editor-shape">{shape === "list" ? "list" : "prose"}</span>
      </div>
      {shape === "list" ? (
        <div className="editor-list">
          {draft.map((item, i) => (
            <div className="editor-list-row" key={i}>
              <textarea
                className="editor-textarea"
                rows={2}
                aria-label={`${label} ${i + 1}`}
                value={item}
                onChange={(e) => setDraft((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))}
              />
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove ${label} ${i + 1}`}
                onClick={() => setDraft((cur) => cur.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button className="outline-button" type="button" onClick={() => setDraft((cur) => [...cur, ""])}>
            + Add one
          </button>
        </div>
      ) : (
        <textarea
          className="editor-textarea"
          rows={6}
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <div className="editor-actions">
        <button className="outline-button" type="button" disabled={!dirty || state?.busy} onClick={commit}>
          {state?.busy ? "Saving…" : `Save ${label.toLowerCase()}`}
        </button>
        <SaveStatus state={state} />
      </div>
    </div>
  );
}

function LoreEntryEditor({ lore, status, save }) {
  return (
    <section className="editor-block">
      <h2>Lore entries</h2>
      {LORE_COLLECTIONS.map(([collection, label, textKey]) => (
        <LoreCollection
          key={collection}
          collection={collection}
          label={label}
          textKey={textKey}
          entries={Array.isArray(lore[collection]) ? lore[collection] : []}
          status={status}
          save={save}
        />
      ))}
    </section>
  );
}

function LoreCollection({ collection, label, textKey, entries, status, save }) {
  const [adding, setAdding] = useState("");
  const [chapter, setChapter] = useState("");
  const addState = status[`lore:add:${collection}`];

  function add() {
    const text = adding.trim();
    if (!text) return;
    const entry = collection === "worldFacts"
      ? text
      : { [textKey]: text, ...(chapter.trim() ? { chapterNumber: Number(chapter.trim()) } : {}) };
    return save(
      `lore:add:${collection}`,
      "storyforge.lore.update.v1",
      { lore: { [collection]: [entry] } },
      (fresh) => (fresh.lore?.[collection] || []).some((item) => loreText(item).trim() === text),
      "Added"
    ).then((ok) => {
      if (ok) {
        setAdding("");
        setChapter("");
      }
      return ok;
    });
  }

  return (
    <div className="editor-field">
      <div className="editor-field-head">
        <h3>{label}</h3>
        <span className="editor-shape">{entries.length}</span>
      </div>
      {entries.map((entry, index) => (
        <LoreEntryRow
          key={`${collection}-${index}-${loreText(entry).slice(0, 24)}`}
          collection={collection}
          entry={entry}
          index={index}
          status={status}
          save={save}
        />
      ))}
      <textarea
        className="editor-textarea"
        rows={2}
        aria-label={`New ${label.toLowerCase()} entry`}
        placeholder={`Add to ${label.toLowerCase()}...`}
        value={adding}
        onChange={(e) => setAdding(e.target.value)}
      />
      {collection !== "worldFacts" && (
        <input
          className="editor-chapter"
          inputMode="numeric"
          aria-label={`Chapter for the new ${label.toLowerCase()} entry`}
          placeholder="Chapter (optional)"
          value={chapter}
          onChange={(e) => setChapter(e.target.value.replace(/[^0-9]/g, ""))}
        />
      )}
      <div className="editor-actions">
        <button className="outline-button" type="button" disabled={!adding.trim() || addState?.busy} onClick={add}>
          {addState?.busy ? "Adding…" : "Add"}
        </button>
        <SaveStatus state={addState} />
        <SaveStatus state={status[`lore:remove:${collection}`]} />
      </div>
    </div>
  );
}

export function LoreEntryRow({ collection, entry, index, status, save }) {
  const [confirming, setConfirming] = useState(false);
  const [chapter, setChapter] = useState("");
  const key = `lore:${collection}:${index}`;
  // A successful removal unmounts this row, taking any status rendered inside
  // it with it — so "Removed" is reported by the collection, which survives.
  const removeKey = `lore:remove:${collection}`;
  const state = status[key];
  const text = loreText(entry);
  const isDict = entry && typeof entry === "object";
  const currentChapter = isDict ? entry.chapterNumber : undefined;

  return (
    <div className="lore-entry-row">
      <p className="lore-entry-text">{text}</p>
      <div className="lore-entry-meta">
        {currentChapter != null && <span className="editor-shape">chapter {currentChapter}</span>}
        {/* Re-attribution only: a bare string carries no chapterNumber and the
            capability refuses rather than inventing a wrapper around it. */}
        {isDict && (
          <>
            <input
              className="editor-chapter"
              inputMode="numeric"
              aria-label={`Move ${collection} entry ${index + 1} to chapter`}
              placeholder="Chapter"
              value={chapter}
              onChange={(e) => setChapter(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <button
              className="outline-button"
              type="button"
              /* Index 0 exists in every collection, so an unqualified label
                 names four different buttons on one screen. */
              aria-label={`Move ${collection} entry ${index + 1}`}
              disabled={!chapter.trim() || state?.busy}
              onClick={() => save(
                key,
                "storyforge.lore.entry.reattribute.v1",
                { collection, entryIndex: index, chapterNumber: Number(chapter) },
                (fresh) => String((fresh.lore?.[collection] || [])[index]?.chapterNumber) === chapter.trim(),
                `Moved to chapter ${chapter}`
              )}
            >
              Move
            </button>
          </>
        )}
        {confirming ? (
          <>
            <button
              className="danger-button"
              type="button"
              aria-label={`Really remove ${collection} entry ${index + 1}`}
              disabled={state?.busy}
              onClick={() => save(
                removeKey,
                "storyforge.lore.entry.remove.v1",
                { collection, entryIndex: index },
                (fresh) => !(fresh.lore?.[collection] || []).some((item) => loreText(item) === text),
                "Removed"
              )}
            >
              Really remove
            </button>
            <button className="inline-button" type="button" onClick={() => setConfirming(false)}>Keep</button>
          </>
        ) : (
          <button className="inline-button" type="button" aria-label={`Remove ${collection} entry ${index + 1}`} onClick={() => setConfirming(true)}>Remove</button>
        )}
      </div>
      <SaveStatus state={state} />
    </div>
  );
}

function Root() {
  return (
    <BrowserRouter>
      <AppProvider>
        {/* The outermost net. Nothing below this can blank the app: the worst
            case is one screen replaced by a message and a way back. */}
        <RoutedBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/universes" element={<UniverseList />} />
            <Route path="/universes/new" element={<NewUniverse />} />
            <Route path="/universes/:id" element={<UniverseDetail />} />
            <Route path="/universes/:id/edit" element={<UniverseEditor />} />
            <Route path="/universes/:id/new-story" element={<NewStory />} />
            <Route path="/universes/:id/stories/:storyId" element={<ChapterReader />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RoutedBoundary>
      </AppProvider>
    </BrowserRouter>
  );
}

/**
 * The app-level boundary, with a way out that is a real way out.
 *
 * `resetKey` is the pathname, so the boundary clears itself the moment the
 * reader navigates somewhere else — otherwise one bad render would latch and
 * every subsequent screen would show the same apology.
 */
function RoutedBoundary({ children }) {
  const location = useLocation();
  const nav = useNavigate();
  return (
    <ErrorBoundary
      name="this screen"
      resetKey={location.pathname}
      fallback={() => (
        <div className="page">
          <div className="boundary-fallback" role="alert">
            <h2>This screen didn't open</h2>
            <p>Something went wrong here. Nothing was lost — every story is still saved.</p>
            <button className="gold-button" type="button" onClick={() => nav("/universes")}>
              Back to the universes
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

// Exported for tests. The young-reader flow had no automated coverage at all,
// which is how a dead end in the path a child uses survived unnoticed; a flow
// that a seven-year-old walks should not be the least-tested screen in the app.
export { NewStory, NewUniverse, AppProvider, suggestedAudienceForTier, Composer, composerRows, COMPOSER_MAX_ROWS, StoryChatSheet, renderMarkdown, SuggestedReplies, ProposalCard, ChoicesProposalCard, WriteNextChapterCard, ChoicePanel, heldForRequest, writeChapterMessage, AbilityCommandChapterRequest, ErrorBoundary, Lore, UniverseEditor, Prose, InteractiveParagraph };

createRoot(document.getElementById("root")).render(<Root />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
