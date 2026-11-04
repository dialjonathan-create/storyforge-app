// The /studio area (spec §2): lazy-loaded, so the reader bundle never carries the editor.
import React, { useCallback, useEffect, useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";
import "./studio.css";
import { currentSession } from "../auth.js";
import { call } from "./api.js";
import Workspace from "./Workspace.jsx";
import Binder from "./Binder.jsx";
import PrintView from "./PrintView.jsx";
import PinResume from "./PinResume.jsx";

const LOCAL_KEY = "otherwise_studio_settings";

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); } catch { return {}; }
}

function useSettings() {
  const [settings, setLocal] = useState(() => ({ theme: "light", font: "serif", textSize: 3, ...loadLocal() }));
  useEffect(() => {
    if (!currentSession()) return;
    call("storyforge.studio.settings.get.v1", {}).then((res) => setLocal((s) => ({ ...s, ...(res.settings || {}) }))).catch(() => {});
  }, []);
  const setSettings = useCallback((next) => {
    setLocal(next);
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    call("storyforge.studio.settings.set.v1", next).catch(() => {});
  }, []);
  return [settings, setSettings];
}

function useFonts(font) {
  useEffect(() => {
    if (font !== "dyslexic" || document.getElementById("studio-font-lexend")) return;
    const link = document.createElement("link");
    link.id = "studio-font-lexend";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Lexend:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, [font]);
}

function ChapterRoute({ settings, setSettings }) {
  const { universeId, storyId, chapter } = useParams();
  return <Workspace key={`${universeId}:${storyId}:${chapter}`} universeId={universeId} storyId={storyId} chapterNumber={Number(chapter)} settings={settings} setSettings={setSettings} />;
}

function StudioHome() {
  const who = currentSession()?.userId;
  return (
    <div className="studio-home">
      <header className="home-head">
        <a href="/universes" className="st-link">Back to reading</a>
        <h1>Studio</h1>
        <p>Pick a chapter to write in. Changes stay in the draft until you publish them.</p>
      </header>
      <div className="home-binder">{who ? <Binder /> : null}</div>
    </div>
  );
}

export default function StudioApp() {
  const [settings, setSettings] = useSettings();
  useFonts(settings.font);
  const session = currentSession();
  const theme = settings.theme === "system"
    ? (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : settings.theme || "light";
  return (
    <div className="studio" data-theme={theme}>
      <div className="studio-narrow" role="note">
        The studio is made for a computer. On this screen you can read the draft; open it on a laptop to write.
      </div>
      {!session ? <PinResume userId="" onResumed={() => window.location.reload()} standalone /> : (
        <Routes>
          <Route index element={<StudioHome />} />
          <Route path="print" element={<PrintView />} />
          <Route path=":universeId/:storyId/:chapter" element={<ChapterRoute settings={settings} setSettings={setSettings} />} />
        </Routes>
      )}
    </div>
  );
}
