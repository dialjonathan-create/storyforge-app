// Narration, through the story server, signed in (QA O-28, open in the r2 re-audit).
//
// This used to call kokoro.abilityai.systems directly: an open text-to-speech
// service anyone on the internet could use (no auth, access-control-allow-origin
// *), whose /voices was a 404 -- so the drawer listed a hardcoded set -- and the
// reader tried three endpoints one after another, one of them a 500.
//
// Now there is one address, on the story server, and the session fetch wrapper
// in ./auth.js signs it like every other call. The server forwards to Kokoro on
// a private address. Only while a story server without that route is still
// deployed (it answers 404) does the reader fall back to the old address, so a
// deploy in the wrong order never silences a bedtime chapter.
const DEFAULT_ABILITY_URL = "https://ability-supervisor-service-818269465014.us-central1.run.app";
const LEGACY_KOKORO = "https://kokoro.abilityai.systems";
export const FALLBACK_VOICES = ["af_heart", "af_alloy", "af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george"];

function abilityUrl() {
  return (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ABILITY_URL) || DEFAULT_ABILITY_URL;
}

// UI-09 (r3): the reader and the narration panel each asked for the voice list
// on every mount -- two requests per chapter page, again on every chapter. The
// list changes when the server is redeployed, not while a page is open, so it
// is fetched once per page load and shared. Only a real answer is kept: a
// failure (signed out, offline) is asked again next time.
let voicesOnce = null;

export function fetchVoices() {
  if (voicesOnce) return voicesOnce;
  const attempt = (async () => {
    try {
      const res = await fetch(`${abilityUrl()}/storyforge/tts/voices`);
      if (res.ok) {
        const voices = await res.json();
        if (Array.isArray(voices) && voices.length) return { voices, keep: true };
      }
    } catch (err) {
      // the drawer still offers the known voices
    }
    return { voices: FALLBACK_VOICES, keep: false };
  })();
  voicesOnce = attempt.then(({ voices, keep }) => {
    if (!keep) voicesOnce = null;
    return voices;
  });
  return voicesOnce;
}

// Test seam.
export function __resetVoicesForTests() {
  voicesOnce = null;
}

export async function synthesize(text, voice, speed = 1.0) {
  const cleanText = String(text || "").replace(/<!--.*?-->/gs, "");
  const body = JSON.stringify({ text: cleanText, voice, speed });
  const res = await fetch(`${abilityUrl()}/storyforge/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.ok) {
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 0) return bytes;
    throw new Error("The narrator sent no sound.");
  }
  if (res.status === 404) {
    // An older story server, without the narration route.
    const legacy = await fetch(`${LEGACY_KOKORO}/tts/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (legacy.ok) {
      const bytes = await legacy.arrayBuffer();
      if (bytes.byteLength > 0) return bytes;
    }
  }
  throw new Error(res.status === 401 ? "Sign in to hear the story read aloud." : "The narrator isn't answering. Try again in a minute.");
}
