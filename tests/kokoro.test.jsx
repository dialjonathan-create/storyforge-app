import { describe, it, expect, vi } from "vitest";
import { fetchVoices, synthesize, FALLBACK_VOICES } from "../src/kokoro";

const SUPERVISOR = "https://ability-supervisor-service-818269465014.us-central1.run.app";

describe("Narration goes through the signed-in story server (QA O-28)", () => {
  it("asks the story server for voices, and falls back to the known set", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false });
    expect(await fetchVoices()).toEqual(FALLBACK_VOICES);
    expect(global.fetch.mock.calls[0][0]).toBe(`${SUPERVISOR}/storyforge/tts/voices`);

    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(["voice1", "voice2"]) });
    expect(await fetchVoices()).toEqual(["voice1", "voice2"]);
  });

  it("speaks through ONE address on the story server, never the open Kokoro host", async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      expect(JSON.parse(opts.body).text).toBe("Hello world");
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) });
    });
    const res = await synthesize("Hello <!-- pause -->world", "af_heart");
    expect(res.byteLength).toBe(10);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(`${SUPERVISOR}/storyforge/tts`);
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes("kokoro.abilityai.systems"))).toBe(false);
  });

  it("uses the old address only while the story server has no narration route (404)", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
    expect((await synthesize("Hi", "af_heart")).byteLength).toBe(4);
    expect(global.fetch.mock.calls[1][0]).toBe("https://kokoro.abilityai.systems/tts/speak");
  });

  it("a signed-out reader is told, and nothing else is tried", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(synthesize("Hi", "af_heart")).rejects.toThrow(/Sign in/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
