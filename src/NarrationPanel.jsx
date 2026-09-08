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

export default function NarrationPanel({ chapter }) {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(
    localStorage.getItem("storyforge_narrator_voice") || "af_heart"
  );
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
    localStorage.setItem("storyforge_narrator_voice", selectedVoice);
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

    if (!isPlayingRef.current || currentIdxRef.current !== idx) return;

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

  return (
    <div className="narration-panel" style={{ padding: "10px", background: "#f0f0f0", borderRadius: "8px", margin: "10px 0", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <button onClick={togglePlay} className="play-button" style={{ padding: "5px 15px", cursor: "pointer" }}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <button onClick={() => { stop(); setCurrentIdx(0); }} className="stop-button" style={{ padding: "5px 15px", cursor: "pointer" }}>
        Stop
      </button>

      <select
        value={selectedVoice}
        onChange={(e) => setSelectedVoice(e.target.value)}
        style={{ padding: "5px" }}
      >
        {voices.map(v => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>

      <span style={{ fontSize: "0.9em", color: "#555" }}>
        {segments.length > 0 ? `Para ${currentIdx + 1} of ${segments.length}` : "No content"}
      </span>

      {error && (
        <span style={{ color: "red", fontSize: "0.9em", marginLeft: "auto" }}>
          {error}
        </span>
      )}
    </div>
  );
}
