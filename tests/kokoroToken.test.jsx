import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { synthesize, fetchVoices, kokoroAuthHeaders, resetKokoroTokenForTests } from "../src/kokoro";

// kokoro.abilityai.systems answered anyone (2026-09-21). The app now asks the
// supervisor for a 15-minute token and sends it to Kokoro; it never holds the
// gate's secret.
const NOW = 1_790_000_000_000;

function routeFetch(minted = { ok: true, token: "kt1.p.s", expiresAt: NOW / 1000 + 900 }) {
  const calls = [];
  global.fetch = vi.fn().mockImplementation((url, opts = {}) => {
    calls.push({ url, opts });
    if (String(url).endsWith("/v1/execute")) {
      return Promise.resolve({ ok: minted.ok !== false, json: () => Promise.resolve(minted) });
    }
    if (String(url).endsWith("/voices")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(["af_heart"]) });
    }
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
  });
  return calls;
}

describe("Kokoro token", () => {
  beforeEach(() => {
    resetKokoroTokenForTests();
    localStorage.setItem("storyforge_token", "sf-bearer");
  });

  it("mints with the Storyforge token and sends the Kokoro token to Kokoro", async () => {
    const calls = routeFetch();
    await synthesize("Hello", "af_heart");
    const mint = calls.find((c) => c.url.endsWith("/v1/execute"));
    expect(mint.opts.headers.Authorization).toBe("Bearer sf-bearer");
    expect(JSON.parse(mint.opts.body).capability).toBe("storyforge.tts.token.v1");
    const tts = calls.find((c) => c.url.startsWith("https://kokoro.abilityai.systems"));
    expect(tts.opts.headers.Authorization).toBe("Bearer kt1.p.s");
  });

  it("mints once and reuses the token until it is about to expire", async () => {
    const calls = routeFetch();
    await kokoroAuthHeaders(NOW);
    await kokoroAuthHeaders(NOW + 60_000);
    expect(calls.filter((c) => c.url.endsWith("/v1/execute"))).toHaveLength(1);
    await kokoroAuthHeaders(NOW + 850_000);
    expect(calls.filter((c) => c.url.endsWith("/v1/execute"))).toHaveLength(2);
  });

  it("sends the token on /voices too", async () => {
    const calls = routeFetch();
    await fetchVoices();
    const voices = calls.find((c) => c.url.endsWith("/voices"));
    expect(voices.opts.headers.Authorization).toBe("Bearer kt1.p.s");
  });

  it("a failed mint sends no header rather than failing narration", async () => {
    const calls = routeFetch({ ok: false, error: "KOKORO_TOKEN_SECRET_UNSET" });
    const bytes = await synthesize("Hello", "af_heart");
    expect(bytes.byteLength).toBe(4);
    const tts = calls.find((c) => c.url.startsWith("https://kokoro.abilityai.systems"));
    expect(tts.opts.headers.Authorization).toBeUndefined();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("with no Storyforge token it does not try to mint at all", async () => {
    localStorage.removeItem("storyforge_token");
    vi.stubEnv("VITE_STORYFORGE_TOKEN", "");
    const calls = routeFetch();
    expect(await kokoroAuthHeaders(NOW)).toEqual({});
    expect(calls).toHaveLength(0);
  });
});
