const API_BASE = "https://kokoro.abilityai.systems";
const FALLBACK_VOICES = ["af_heart", "af_alloy", "af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george"];
const ABILITY_URL = import.meta.env.VITE_ABILITY_URL || "https://ability-supervisor-service-818269465014.us-central1.run.app";

// Kokoro sits behind a token gate on ability-core (supervisor
// ops/ability-core/kokoro-gate). The app cannot hold that gate's secret -- this
// bundle is public -- so it asks the supervisor for a 15-minute token with the
// Storyforge token it already uses, and caches it until a minute before
// expiry. With no Storyforge token, or if minting fails, requests go out with
// no Authorization header: the gate forwards those in report mode and refuses
// them in enforce mode, so nothing breaks before the gate is switched on.
let cachedKokoroToken = null;

function storyforgeBearer() {
  try {
    const stored = typeof localStorage !== "undefined" && localStorage.getItem("storyforge_token");
    return stored || import.meta.env.VITE_STORYFORGE_TOKEN || "";
  } catch {
    return import.meta.env.VITE_STORYFORGE_TOKEN || "";
  }
}

export function resetKokoroTokenForTests() {
  cachedKokoroToken = null;
}

export async function kokoroAuthHeaders(nowMs = Date.now()) {
  const bearer = storyforgeBearer();
  if (!bearer) return {};
  const nowSec = Math.floor(nowMs / 1000);
  if (!cachedKokoroToken || cachedKokoroToken.expiresAt - 60 <= nowSec) {
    try {
      const res = await fetch(`${ABILITY_URL}/v1/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ capability: "storyforge.tts.token.v1", args: { tenantId: "core", userId: "jonathan" } }),
      });
      const data = await res.json().catch(() => ({}));
      const minted = (data && data.result) || data;
      cachedKokoroToken = res.ok && minted && minted.token
        ? { token: minted.token, expiresAt: Number(minted.expiresAt) || 0 }
        : null;
    } catch {
      cachedKokoroToken = null;
    }
  }
  return cachedKokoroToken ? { Authorization: `Bearer ${cachedKokoroToken.token}` } : {};
}

export async function fetchVoices() {
  try {
    const res = await fetch(`${API_BASE}/voices`, { headers: await kokoroAuthHeaders() });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // ignore
  }
  return FALLBACK_VOICES;
}

export async function synthesize(text, voice, speed = 1.0) {
  const cleanText = text.replace(/<!--.*?-->/g, "");
  const endpoints = ["/tts/speak", "/tts", "/synthesize"];
  const auth = await kokoroAuthHeaders();

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ text: cleanText, voice, speed })
      });
      if (res.ok) {
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength > 0) {
          return bytes;
        }
      }
    } catch (err) {
      // ignore
    }
  }
  throw new Error("All endpoints failed");
}
