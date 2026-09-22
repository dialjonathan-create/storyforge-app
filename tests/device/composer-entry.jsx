/**
 * Device check for the chat composer with the on-screen keyboard raised.
 *
 * jsdom has no keyboard, no visualViewport and no dvh, so this cannot be a unit
 * test. It is a page to open on a phone (or the iOS Simulator with the hardware
 * keyboard disconnected): tap "Say more…", type a long sentence, and read the
 * overlay. The overlay reports, from the live layout, whether the composer and
 * the send button sit inside the visible viewport.
 *
 * See tests/device/README.md.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { StoryChatSheet } from "../../src/main.jsx";
import "../../src/styles.css";

const BASE_THREAD = [
  { role: "user", content: "Show me options for chapter 1." },
  { role: "assistant", content: "Here are three ways Keen can go:\n\n1. **Beat the tide.**\n\n2. **Read the logs first.**\n\n3. **Wait for help.**\n\nWhich path should we take?" },
  { role: "user", content: "No. I meant options at the end of chapter 1 to decide chapter 2." },
  { role: "assistant", content: "That makes sense — the end of the chapter, where the compass has just hummed to life in Keen's hand." },
];
// A real conversation is long: the transcript must fill the sheet, or the check
// only proves the short case. `?short=1` gives the four-turn version.
const THREAD = new URLSearchParams(location.search).get("short")
  ? BASE_THREAD
  : Array.from({ length: 6 }, () => BASE_THREAD).flat();

function Overlay() {
  const [m, setM] = useState({});
  useEffect(() => {
    let raf;
    const tick = () => {
      const vv = window.visualViewport;
      const form = document.querySelector(".composer");
      const send = document.querySelector(".composer-send");
      const field = document.querySelector(".composer-field");
      const top = vv ? vv.offsetTop : 0;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const r = (el) => (el ? el.getBoundingClientRect() : null);
      const f = r(form), s = r(send), t = r(field);
      setM({
        inner: window.innerHeight, vvH: vv && Math.round(vv.height), vvTop: vv && Math.round(vv.offsetTop),
        formBottom: f && Math.round(f.bottom), sendBottom: s && Math.round(s.bottom),
        fieldH: t && Math.round(t.height), fieldScroll: field && field.scrollHeight,
        visibleBottom: Math.round(bottom),
        composerVisible: f ? f.top >= top && f.bottom <= bottom : null,
        sendVisible: s ? s.top >= top && s.bottom <= bottom : "no text",
        inset: getComputedStyle(document.documentElement).getPropertyValue("--keyboard-inset"),
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <pre style={{ position: "fixed", top: "env(safe-area-inset-top)", left: 0, zIndex: 9999, margin: 0, padding: 4,
                  font: "10px/1.2 monospace", background: "rgba(0,0,0,.75)", color: "#7f7", pointerEvents: "none" }}>
      {JSON.stringify(m)}
    </pre>
  );
}

function Page() {
  return (
    <div className="reader-page" style={{ minHeight: "3000vh" }}>
      <p style={{ padding: 20 }}>Reader behind the sheet.</p>
      <StoryChatSheet thread={THREAD} busy={false} onSend={() => {}} onClose={() => {}} onApprove={() => {}} onDismiss={() => {}} />
      <Overlay />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Page />);
// Readers open the chat from deep inside a chapter; iOS's focus scrolling
// behaves differently when the document is already scrolled a long way.
setTimeout(() => window.scrollTo(0, 12000), 300);
