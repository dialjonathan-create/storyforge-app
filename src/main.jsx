import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import "./styles.css";

const ABILITY_URL = import.meta.env.VITE_ABILITY_URL || "https://ability-supervisor-service-818269465014.us-central1.run.app";
const FAMILY = [
  { userId: "jonathan", displayName: "Jonathan", avatar: "⚓" },
  { userId: "adele", displayName: "Adele", avatar: "🧭" },
  { userId: "keen", displayName: "Keen", avatar: "⚡" },
  { userId: "talia", displayName: "Talia", avatar: "🌟" },
];
const AppContext = createContext(null);

function groupKey(ids) {
  return [...new Set((ids || []).filter(Boolean))].sort().join("&");
}

function userFor(id, users = FAMILY) {
  return users.find((u) => u.userId === id) || FAMILY.find((u) => u.userId === id) || { userId: id, displayName: id, avatar: "✦" };
}

async function execute(command, args = {}) {
  const response = await fetch(`${ABILITY_URL}/v1/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false || data.error) throw new Error(data.message || data.error || "Storyforge request failed");
  return data;
}

function AppProvider({ children }) {
  const [users, setUsers] = useState(FAMILY);
  const [activeReaders, setActiveReaders] = useState(() => {
    try {
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

function AppHeader({ backTo, title, right }) {
  const nav = useNavigate();
  const { activeReaders } = useApp();
  return (
    <header className="app-header">
      <button className="icon-button" onClick={() => nav(backTo || -1)} aria-label="Back">←</button>
      <div className="header-title">{title || <Wordmark small />}</div>
      <button className="avatar-cluster" onClick={() => nav("/")} aria-label="Switch readers"><Avatars ids={activeReaders} /></button>
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
  useEffect(() => {
    execute("storyforge.universe.list.v1", { tenantId: "core", userId: "jonathan", requestedBy: activeReaders[0] || "jonathan" })
      .then((res) => setUniverses(res.universes || []))
      .catch(() => setUniverses([]));
  }, [activeReaders]);
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
          {universes?.map((universe) => {
            const pos = lastUniversePosition(universe, readingGroup);
            return (
              <motion.article whileTap={{ scale: 0.992 }} className="universe-card" key={universe.universeId} onClick={() => { setCurrentUniverse(universe); nav(`/universes/${universe.universeId}`); }}>
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
        </div>
      </section>
      <button className="fab" onClick={() => nav("/universes/new")} aria-label="New universe">+</button>
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
              <button className={tab === "lore" ? "active" : ""} onClick={() => setTab("lore")}>Lore</button>
            </div>
            {tab === "stories" ? (
              <div className="card-list">
                {stories?.map((story) => {
                  const pos = readPosition(readingGroup, story.storyId);
                  return (
                    <article className="story-card" key={story.storyId} onClick={() => { setCurrentStory(story); nav(`/universes/${id}/stories/${story.storyId}`); }}>
                      <h2>{story.title}</h2>
                      <p>{story.genre || "family adventure"}</p>
                      <div className="metadata">{story.totalChapters || 0} chapters · {pos.chapter ? `Chapter ${pos.chapter}` : "not started"}</div>
                      <Progress value={pos.chapter || 0} max={story.totalChapters || 1} />
                      <Avatars ids={story.primaryReaders || activeReaders} />
                    </article>
                  );
                })}
                <button className="outline-button" onClick={() => nav(`/universes/${id}/new-story`)}>+ Begin a New Story</button>
              </div>
            ) : <Lore data={data} />}
          </>
        )}
      </section>
    </Page>
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
  const [chapterNumber, setChapterNumber] = useState(() => readPosition(readingGroup, storyId).chapter || 1);
  const [choicesVisible, setChoicesVisible] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    execute("storyforge.story.list.v1", { tenantId: "core", userId: "jonathan", universeId: id })
      .then((res) => {
        const found = (res.stories || []).find((s) => s.storyId === storyId);
        setStory(found || { storyId, title: "Story", totalChapters: chapterNumber });
        setCurrentStory(found);
      });
  }, [id, storyId, chapterNumber, setCurrentStory]);

  useEffect(() => {
    setChoicesVisible(false);
    setWaiting(false);
    getChapter(id, storyId, chapterNumber)
      .then((res) => setChapter(res))
      .catch(() => setChapter({ ok: false, error: "chapter_not_found" }));
    const timer = setTimeout(() => setChoicesVisible(true), 240000);
    return () => clearTimeout(timer);
  }, [id, storyId, chapterNumber]);

  useEffect(() => {
    const handler = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const pct = scrollable > 0 ? window.scrollY / scrollable : 0;
      setProgress(Math.max(0, Math.min(1, pct)));
      writePosition(readingGroup, storyId, chapterNumber, pct);
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 150) setChoicesVisible(true);
    };
    window.addEventListener("scroll", handler, { passive: true });
    requestAnimationFrame(() => {
      const saved = readPosition(readingGroup, storyId);
      if (saved.chapter === chapterNumber && saved.scrollPercent) window.scrollTo(0, saved.scrollPercent * (document.documentElement.scrollHeight - window.innerHeight));
    });
    return () => window.removeEventListener("scroll", handler);
  }, [readingGroup, storyId, chapterNumber]);

  useSwipe((dir) => {
    if (dir === "left" && chapterNumber < (story?.totalChapters || chapterNumber)) setChapterNumber(chapterNumber + 1);
    if (dir === "right" && chapterNumber > 1) setChapterNumber(chapterNumber - 1);
  });

  async function choose(choice) {
    setWaiting(true);
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
    setTimeout(async () => {
      try {
        await getChapter(id, storyId, chapterNumber + 1);
        setChapterNumber(chapterNumber + 1);
        window.scrollTo(0, 0);
      } catch {
        setWaiting(true);
      }
    }, 1500);
  }

  if (!chapter) return <ReadingLoading text="Turning the page..." />;
  if (waiting) return <WaitingState text="The story is being written..." />;

  return (
    <Page className="reader-page">
      <div className="scroll-progress" style={{ transform: `scaleX(${progress})` }} />
      <header className="reader-header">
        <button className="icon-button" onClick={() => nav(`/universes/${id}`)}>←</button>
        <div className="reader-title">{story?.title || "Story"}</div>
        <button className="icon-button" onClick={() => setMenuOpen(true)}>≡</button>
        <Avatars ids={activeReaders} />
      </header>
      <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="reading-column">
        <div className="chapter-kicker">Chapter {chapter.chapterNumber}</div>
        <h1>{chapter.chapterTitle}</h1>
        <div className="gold-divider" />
        <ChapterImages chapter={chapter} tier={activeReaders.includes("talia") ? 1 : activeReaders.includes("keen") ? 2 : 3} />
        <Prose chapter={chapter} tier={activeReaders.includes("talia") ? 1 : activeReaders.includes("keen") ? 2 : 3} />
        <ChoicePanel visible={choicesVisible} chapter={chapter} readers={activeReaders} onChoose={choose} />
      </motion.article>
      <ChapterMenu open={menuOpen} onClose={() => setMenuOpen(false)} total={story?.totalChapters || chapter.chapterNumber} current={chapterNumber} onJump={(n) => { setMenuOpen(false); setChapterNumber(n); window.scrollTo(0, 0); }} />
    </Page>
  );
}

function ChapterImages({ chapter, tier }) {
  const images = (chapter.images || []).filter((img) => img.url);
  if (!images.length) return null;
  if (tier === 1) return null;
  return <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="chapter-image hero-image" src={images[0].url} alt={images[0].sceneDescription || "Chapter illustration"} />;
}

function Prose({ chapter, tier }) {
  const paragraphs = String(chapter.prose || "").split(/\n+/).filter(Boolean);
  const images = (chapter.images || []).filter((img) => img.url);
  return (
    <div className="prose">
      {paragraphs.map((p, i) => (
        <React.Fragment key={i}>
          <p>{p}</p>
          {tier === 1 && images[i % Math.max(1, images.length)] && i > 0 && i % 2 === 1 && (
            <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="chapter-image" src={images[i % images.length].url} alt={images[i % images.length].sceneDescription || "Chapter illustration"} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function ChoicePanel({ visible, chapter, readers, onChoose }) {
  if (!chapter?.choices?.length || chapter.choiceMade) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 24, visibility: "hidden", pointerEvents: "none" }}
      animate={visible ? { opacity: 1, y: 0, visibility: "visible", pointerEvents: "auto" } : { opacity: 0, y: 24, visibility: "hidden", pointerEvents: "none" }}
      transition={{ duration: 0.4 }}
      className="choice-panel"
    >
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

function WaitingState({ text }) {
  return <div className="waiting"><div className="compass" /><h1>{text}</h1><p>The page is turning under a different sky.</p></div>;
}

function NewUniverse() {
  const nav = useNavigate();
  const { primaryReader } = useApp();
  const [style, setStyle] = useState("Golden age illustration");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
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
  const [step, setStep] = useState(1);
  const [description, setDescription] = useState("");
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
          <Route path="/" element={<ReaderPicker />} />
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
