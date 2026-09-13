import React, { useState, useEffect, useRef } from "react";
import { fetchVoices, synthesize } from "./kokoro";

// Segments chapter prose into paragraphs.
export function segmentProse(prose) {
  if (!prose) return [];
  return String(prose).split(/\n+/).filter(Boolean);
}

export function stripHtmlComments(text) {
  return String(text).replace(/<!--[\s\S]*?-->/g, "").trim();
}

const DEFAULT_VOICE_ID = "af_heart";

export default function NarrationPanel({ chapter, voiceId }) {
  const [voices, setVoices] = useState([]);
  // The id the synth API wants, not anything a person should ever read. The
  // picker that turns it into a name now lives in the drawer under the reading
  // page, and hands the chosen id down as `voiceId` -- so changing the voice
  // mid-chapter restarts playback in the new one rather than waiting for a
  // remount that never comes.
  const [storedVoice, setStoredVoice] = useState(() => {
    try {
      return localStorage.getItem("storyforge_narrator_voice") || DEFAULT_VOICE_ID;
    } catch {
      return DEFAULT_VOICE_ID;
    }
  });
  const selectedVoice = voiceId || storedVoice;
  const setSelectedVoice = setStoredVoice;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [error, setError] = useState(null);
  const [segments, setSegments] = useState([]);

  // Refs for tracking playback and audio elements
  const currentAudioRef = useRef(null);
  const prefetchCache = useRef(new Map());
  const isPlayingRef = useRef(false);
  const currentIdxRef = useRef(0);
  const abortControllers = useRef(new Set());
  const playRunRef = useRef(0);

  // Initialization
  useEffect(() => {
    let cancelled = false;
    fetchVoices().then((v) => {
      if (!cancelled) setVoices(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const p = segmentProse(chapter?.prose);
    setSegments(p);
    stop();
  }, [chapter]);

  useEffect(() => {
    try {
      localStorage.setItem("storyforge_narrator_voice", selectedVoice);
    } catch {
      /* a remembered voice is a nicety; losing it must not stop narration */
    }
    // Restart if changing voice while playing
    if (isPlaying) {
      stop();
      playFrom(currentIdx);
    } else {
      prefetchCache.current.clear();
      // Prefetch current if stopped
      if (segments.length > 0) prefetchSegment(currentIdx);
    }
  }, [selectedVoice]);

  // Sync state and refs
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    currentIdxRef.current = currentIdx;

    if (isPlaying && segments.length > 0) {
      // prefetch 2-3 ahead
      prefetchSegment(currentIdx + 1);
      prefetchSegment(currentIdx + 2);
    }
  }, [isPlaying, currentIdx, segments]);

  const stop = () => {
    playRunRef.current += 1;
    setIsPlaying(false);
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
    }
    prefetchCache.current.forEach((url) => URL.revokeObjectURL(url));
    prefetchCache.current.clear();
    abortControllers.current.forEach(c => c.abort());
    abortControllers.current.clear();
  };

  const pause = () => {
    playRunRef.current += 1;
    setIsPlaying(false);
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
  };

  const fetchAudioBlob = async (idx) => {
    const text = segments[idx];
    if (!text) return null;
    const cleanText = stripHtmlComments(text);
    if (!cleanText) return null;

    try {
      const buffer = await synthesize(cleanText, selectedVoice);
      const blob = new Blob([buffer], { type: "audio/wav" });
      return URL.createObjectURL(blob);
    } catch (err) {
      throw err;
    }
  };

  const prefetchSegment = (idx) => {
    if (idx >= segments.length) return;
    if (prefetchCache.current.has(idx)) return;
    if (!stripHtmlComments(segments[idx])) return; // Skip empty segments

    // Mark as fetching
    prefetchCache.current.set(idx, 'fetching');
    fetchAudioBlob(idx).then(url => {
       if (prefetchCache.current.get(idx) === 'fetching') {
         prefetchCache.current.set(idx, url);
       }
    }).catch(err => {
       // if it fails to prefetch, we'll try again when we get to it.
       if (prefetchCache.current.get(idx) === 'fetching') {
         prefetchCache.current.delete(idx);
       }
    });
  };

  const playFrom = async (idx) => {
    if (idx >= segments.length) {
      setIsPlaying(false);
      return;
    }

    // Skip empty segments
    if (!stripHtmlComments(segments[idx])) {
      setCurrentIdx(idx + 1);
      playFrom(idx + 1);
      return;
    }

    const runId = ++playRunRef.current;
    setCurrentIdx(idx);
    setIsPlaying(true);
    setError(null);

    let url = prefetchCache.current.get(idx);

    if (url === 'fetching') {
       // wait for it... this is naive polling, but acceptable for this scope
       let retries = 0;
       while(prefetchCache.current.get(idx) === 'fetching' && retries < 50) {
          await new Promise(r => setTimeout(r, 100));
          retries++;
       }
       url = prefetchCache.current.get(idx);
    }

    if (!url || url === 'fetching') {
      try {
        url = await fetchAudioBlob(idx);
        prefetchCache.current.set(idx, url);
      } catch (err) {
        setError("Audio failed. Try again.");
        setIsPlaying(false);
        return;
      }
    }

    // A newer play/pause/stop started while we were fetching: yield to it.
    // (Refs sync in an effect AFTER render, so comparing them here fails
    // synchronously on the prefetched fast path and killed chained playback.)
    if (runId !== playRunRef.current) return;

    if (currentAudioRef.current) {
        currentAudioRef.current.pause();
    }

    const audio = new Audio(url);
    currentAudioRef.current = audio;

    audio.onended = () => {
      // free up old blob
      URL.revokeObjectURL(url);
      prefetchCache.current.delete(idx);

      const nextIdx = idx + 1;
      if (runId !== playRunRef.current) return;
      if (nextIdx < segments.length) {
        playFrom(nextIdx);
      } else {
        setIsPlaying(false);
      }
    };

    audio.onerror = () => {
        setError("Audio playback error.");
        setIsPlaying(false);
    }

    try {
      await audio.play();
    } catch(err) {
        setError("Failed to play audio.");
        setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      pause();
    } else {
      if (currentAudioRef.current && currentAudioRef.current.paused && currentIdx === currentIdxRef.current && currentAudioRef.current.src) {
        currentAudioRef.current.play().then(() => setIsPlaying(true)).catch(() => playFrom(currentIdx));
      } else {
        playFrom(currentIdx);
      }
    }
  };

  // 2026-09-13: the panel was `background: "#f0f0f0"` as an inline style, with
  // zero narration rules in the stylesheet. That grey box is the only element
  // in the reading view outside the app's palette, and it makes the whole page
  // look unfinished. Every colour here is now a token; there is not a hex in
  // this file.
  //
  // This is the CURRENT player restyled, not the rebuilt one. The whole-chapter
  // render, the offsets table, the scrubber and MediaSession are a separate
  // track that has not started -- there is no server-side audio capability at
  // all yet. What this does is stop the reading view looking broken while that
  // is built.
  const ready = segments.length > 0;
  const position = ready ? `${currentIdx + 1} of ${segments.length}` : "Preparing narration";

  return (
    <div className="narration-bar" role="group" aria-label="Narration">
      <button
        type="button"
        onClick={togglePlay}
        className="narration-play"
        disabled={!ready}
        aria-label={isPlaying ? "Pause narration" : "Play narration"}
      >
        <span aria-hidden="true">{isPlaying ? "\u23F8" : "\u25B6"}</span>
      </button>

      <div className="narration-meta">
        <span className="narration-title">{chapter?.chapterTitle || "Narration"}</span>
        {/* Paragraphs, not seconds -- this player has no duration to report
            until the chapter is rendered as one file. Saying "1 of 42" is true;
            a fake timecode would not be. */}
        <span className="narration-position">{ready ? `Paragraph ${position}` : position}</span>
      </div>

      {isPlaying && (
        <button type="button" onClick={() => { stop(); setCurrentIdx(0); }} className="narration-stop" aria-label="Stop narration">
          <span aria-hidden="true">\u25A0</span>
        </button>
      )}

      {!ready && <span className="narration-working" aria-hidden="true" />}

      {error && <span className="narration-error" role="alert">{error}</span>}
    </div>
  );
}
