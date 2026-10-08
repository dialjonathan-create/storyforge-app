// What the library shows about ONE reader's reading: where they stopped
// ("Continue reading"), how far through each story they are, and which
// chapters they asked for have finished while they were elsewhere ("Your
// chapter is ready").
//
// Everything here lives under the signed-in reader's id (auth.js readerKey,
// `sf_u_<userId>__...`), so it is wiped with the rest of their story data
// whenever the person on the device changes, signs out, or their session ends
// (r3 UI-01). A reader's progress is never read from anybody else's keys: the
// owner is always passed in, and every read is by that owner's prefix.
import { readerKey, isChildProfile } from "./auth";

export const RECENT_KIND = "recent";
export const WATCH_KIND = "chapter_watch";
export const NEW_KIND = "new_chapter";
export const NEW_CHAPTER_EVENT = "otherwise:new-chapter";
/** Past this a watched chapter is dropped: the wait has long since failed or
 *  been seen some other way, and polling for it forever costs a request a tick. */
export const WATCH_MAX_AGE_MS = 3 * 60 * 60 * 1000;
export const CONTINUE_READING_LIMIT = 6;

function storageKeys() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
    return keys.filter(Boolean);
  } catch {
    return [];
  }
}

function readJson(key, fallback = null) {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (!key) return;
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the library just shows less */
  }
}

/** Every entry of one kind this reader has, keyed `<storyId>`. */
function entriesOf(owner, kind) {
  const prefix = readerKey(owner, kind, "");
  if (!prefix) return [];
  const head = `${prefix}_`;
  return storageKeys()
    .filter((key) => key.startsWith(head))
    .map((key) => readJson(key))
    .filter((entry) => entry && typeof entry === "object" && entry.storyId);
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// --- where each reader stopped ----------------------------------------------

/** Remember the place this reader is at in a story (called as they scroll). */
export function recordRecentRead(owner, { universeId, storyId, title, universeTitle, chapter, scrollPercent, totalChapters } = {}) {
  if (!owner || !storyId || !universeId || !Number(chapter)) return;
  const key = readerKey(owner, RECENT_KIND, storyId);
  const before = readJson(key) || {};
  writeJson(key, {
    universeId: String(universeId),
    storyId: String(storyId),
    title: title || before.title || "",
    universeTitle: universeTitle || before.universeTitle || "",
    chapter: Number(chapter),
    scrollPercent: clamp01(scrollPercent),
    totalChapters: Math.max(Number(totalChapters) || 0, Number(chapter) || 0, Number(before.totalChapters) || 0),
    lastRead: Date.now(),
  });
}

export function recentReadFor(owner, storyId) {
  return readJson(readerKey(owner, RECENT_KIND, storyId));
}

/** The reader's stories, most recently read first, each with chapter + percent. */
export function continueReading(owner, limit = CONTINUE_READING_LIMIT) {
  return entriesOf(owner, RECENT_KIND)
    .filter((entry) => entry.universeId && Number(entry.chapter) > 0)
    .sort((a, b) => (Number(b.lastRead) || 0) - (Number(a.lastRead) || 0))
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      percent: Math.round(clamp01(entry.scrollPercent) * 100),
      storyFraction: storyProgressFraction(entry),
    }));
}

/** How far through the whole story: whole chapters behind, plus this one's share. */
export function storyProgressFraction({ chapter, scrollPercent, totalChapters } = {}) {
  const total = Math.max(1, Number(totalChapters) || 0, Number(chapter) || 0);
  const at = Number(chapter) || 0;
  if (at <= 0) return 0;
  return clamp01((at - 1 + clamp01(scrollPercent)) / total);
}

/** "Chapter 3 · 40%" -- the line on a Continue card. */
export function continueLine(entry) {
  if (!entry?.chapter) return "";
  const pct = Math.round(clamp01(entry.scrollPercent) * 100);
  if (pct >= 98) return `Finished chapter ${entry.chapter}`;
  return `Chapter ${entry.chapter} · ${pct}%`;
}

// --- "your chapter is ready" ------------------------------------------------

/** A chapter this reader asked for and has not seen yet. */
export function watchChapter(owner, { universeId, storyId, chapterNumber, title } = {}) {
  if (!owner || !universeId || !storyId || !Number(chapterNumber)) return;
  writeJson(readerKey(owner, WATCH_KIND, storyId), {
    universeId: String(universeId), storyId: String(storyId), chapterNumber: Number(chapterNumber),
    title: title || "", requestedAt: Date.now(),
  });
}

/** Stop watching (any chapter, or only up to `chapterNumber`). */
export function unwatchChapter(owner, storyId, chapterNumber = null) {
  const key = readerKey(owner, WATCH_KIND, storyId);
  const watch = readJson(key);
  if (!watch) return;
  if (chapterNumber == null || Number(watch.chapterNumber) <= Number(chapterNumber)) writeJson(key, null);
}

export function chapterWatches(owner) {
  return entriesOf(owner, WATCH_KIND).filter((watch) => Number(watch.chapterNumber) > 0 && watch.universeId);
}

export function markNewChapter(owner, { universeId, storyId, chapterNumber, title } = {}) {
  if (!owner || !storyId || !Number(chapterNumber)) return;
  writeJson(readerKey(owner, NEW_KIND, storyId), {
    universeId: String(universeId || ""), storyId: String(storyId), chapterNumber: Number(chapterNumber),
    title: title || "", readyAt: Date.now(),
  });
}

export function newChapterFor(owner, storyId) {
  return readJson(readerKey(owner, NEW_KIND, storyId));
}

export function newChaptersIn(owner, universeId) {
  return entriesOf(owner, NEW_KIND).filter((entry) => entry.universeId === String(universeId)).length;
}

/** The reader opened the chapter (or a later one): it is not new any more. */
export function clearNewChapter(owner, storyId, chapterNumber) {
  const key = readerKey(owner, NEW_KIND, storyId);
  const flag = readJson(key);
  if (flag && Number(flag.chapterNumber) <= Number(chapterNumber || 0)) writeJson(key, null);
}

/** The words on the toast. A child gets the friendly line with a "!". */
export function readyLine({ title, chapterNumber } = {}, readerId = "") {
  const story = String(title || "").trim() || "your story";
  const n = Number(chapterNumber);
  const which = n ? `Chapter ${n} of ${story}` : `A new chapter of ${story}`;
  return isChildProfile(readerId) ? `${which} is ready!` : `${which} is ready.`;
}

/** One round of checking: asks the server about each watched chapter (with the
 *  reader's own credential, through `getStatus`) and returns the ones that are
 *  now written. A finished chapter is marked new and no longer watched; a
 *  failed, unknown or very old one is dropped quietly (the reader page says
 *  what went wrong when it is opened); a network error keeps watching. */
export async function checkWatches(owner, getStatus, now = Date.now()) {
  const ready = [];
  for (const watch of chapterWatches(owner)) {
    if (now - (Number(watch.requestedAt) || 0) > WATCH_MAX_AGE_MS) {
      unwatchChapter(owner, watch.storyId);
      continue;
    }
    let status;
    try {
      status = await getStatus(watch.universeId, watch.storyId, watch.chapterNumber);
    } catch (error) {
      // Refused (signed out, or the story is not theirs any more): stop asking.
      if (error?.status === 401 || error?.status === 403 || error?.status === 404) unwatchChapter(owner, watch.storyId);
      continue;
    }
    const state = status?.status;
    if (state === "complete") {
      unwatchChapter(owner, watch.storyId, watch.chapterNumber);
      markNewChapter(owner, watch);
      ready.push(watch);
    } else if (state === "failed" || state === "not_requested" || state === "unknown") {
      unwatchChapter(owner, watch.storyId, watch.chapterNumber);
    }
  }
  if (ready.length && typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent(NEW_CHAPTER_EVENT, { detail: { ready } })); } catch { /* old browsers */ }
  }
  return ready;
}

/** Everything of this reader's about one story (a story they were refused). */
export function forgetProgressFor(owner, storyId) {
  for (const kind of [RECENT_KIND, WATCH_KIND, NEW_KIND]) writeJson(readerKey(owner, kind, storyId), null);
}
