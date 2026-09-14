import React from "react";
import { createRoot } from "react-dom/client";
import { Prose } from "../../src/main.jsx";
import "../../src/styles.css";
import { FIXTURES } from "./fixtures.js";

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
    {body !== "__canary__" && <Prose chapter={{ prose: body }} tier={3} entities={ENTITIES}
           onLongPress={() => {}} onEntityTap={() => {}} onWordTap={() => {}} pulseFrom={null} />}
  </div>
);
