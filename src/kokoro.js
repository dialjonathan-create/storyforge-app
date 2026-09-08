const API_BASE = "https://kokoro.abilityai.systems";
const FALLBACK_VOICES = ["af_heart", "af_alloy", "af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george"];

export async function fetchVoices() {
  try {
    const res = await fetch(`${API_BASE}/voices`);
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

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
