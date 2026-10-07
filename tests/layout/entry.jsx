import React from "react";
import { createRoot } from "react-dom/client";
import { Prose, coverGlyph } from "../../src/main.jsx";
import "../../src/styles.css";
import { FIXTURES, LONG_WORD, LONG_COVER } from "./fixtures.js";

const name = new URLSearchParams(location.search).get("fixture") || "clean";
const ENTITIES = [
  { name: "Keen", type: "character", description: "" },
  { name: "Adele", type: "character", description: "" },
];

const body = FIXTURES[name];

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
    {body !== "__canary__" && <Prose chapter={{ prose: body }} tier={3} entities={ENTITIES}
           onLongPress={() => {}} onEntityTap={() => {}} onWordTap={() => {}} pulseFrom={null} />}
  </div>
);
