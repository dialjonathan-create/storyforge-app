import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Prose, coverGlyph, ContinueReading, NewChapterBadge, StoryProgress } from "../../src/main.jsx";
import { recordRecentRead } from "../../src/readerProgress.js";
import "../../src/styles.css";
import { FIXTURES, LONG_WORD, LONG_COVER } from "./fixtures.js";

const name = new URLSearchParams(location.search).get("fixture") || "clean";
const ENTITIES = [
  { name: "Keen", type: "character", description: "" },
  { name: "Adele", type: "character", description: "" },
];

const body = FIXTURES[name];

if (name === "libraryPolish") {
  recordRecentRead("keen", { universeId: "u1", storyId: "a", title: LONG_WORD, universeTitle: LONG_WORD, chapter: 7, scrollPercent: 0.42, totalChapters: 12 });
  for (let i = 0; i < 5; i += 1) {
    recordRecentRead("keen", { universeId: "u1", storyId: `s${i}`, title: `The Meridian ${i}`, universeTitle: "Meridian", chapter: i + 1, scrollPercent: 0.3, totalChapters: 9 });
  }
}

createRoot(document.getElementById("root")).render(
  <div className="reader-page">
    {/* The canary is a box that is simply too wide. If the check ever stops
        failing on this, the check has stopped working. */}
    {body === "__canary__" && <div style={{ width: 900, height: 20 }} />}
    {/* UI-03: the titles that carry user-written words, at their real classes. */}
    {name === "longWord" && (
      <>
        <header className="app-header">
          <button className="icon-button" type="button" aria-label="Back">←</button>
          <div className="header-title">{LONG_WORD}</div>
        </header>
        <header className="reader-header">
          <button className="icon-button" type="button" aria-label="Back">←</button>
          <div className="reader-title">{LONG_WORD}</div>
          <div className="reader-header-actions"><button className="icon-button" type="button" aria-label="Menu">≡</button></div>
        </header>
        <div className="universe-hero">
          <div className="hero-icon">{coverGlyph(LONG_COVER)}</div>
          <h1>{LONG_WORD}</h1>
        </div>
        <article className="reading-column">
          <h1>{LONG_WORD}</h1>
        </article>
      </>
    )}
    {name === "libraryPolish" && (
      <MemoryRouter>
        <section className="content">
          <ContinueReading owner="keen" />
          <article className="story-card">
            <h2>{LONG_WORD}</h2>
            <NewChapterBadge entry={{ chapterNumber: 5 }} />
            <div className="metadata">12 chapters · Chapter 7</div>
            <StoryProgress fraction={0.53} label="progress" />
          </article>
        </section>
        <div className="chapter-ready-stack" role="status">
          <div className="chapter-ready-toast">
            <span className="chapter-ready-glyph" aria-hidden="true">✦</span>
            <span className="chapter-ready-line">{`Chapter 5 of ${LONG_WORD} is ready!`}</span>
            <button type="button" className="chapter-ready-open">Read it</button>
            <button type="button" className="chapter-ready-close" aria-label="Dismiss">×</button>
          </div>
        </div>
      </MemoryRouter>
    )}
    {body !== "__canary__" && <Prose chapter={{ prose: body }} tier={3} entities={ENTITIES}
           onLongPress={() => {}} onEntityTap={() => {}} onWordTap={() => {}} pulseFrom={null} />}
  </div>
);
