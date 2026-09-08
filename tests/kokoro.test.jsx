import { describe, it, expect, vi } from "vitest";
import { fetchVoices, synthesize } from "../src/kokoro";

describe("Kokoro API", () => {
  it("fetches voices or uses fallback", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false
    });

    const voices = await fetchVoices();
    expect(voices).toEqual(["af_heart", "af_alloy", "af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george"]);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(["voice1", "voice2"])
    });
    const voices2 = await fetchVoices();
    expect(voices2).toEqual(["voice1", "voice2"]);
  });

  it("strips HTML comments and tests endpoint fallback", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      callCount++;
      const body = JSON.parse(opts.body);
      expect(body.text).toBe("Hello world");

      if (callCount === 1 || callCount === 2) {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(10))
      });
    });

    const res = await synthesize("Hello <!-- pause -->world", "af_heart");
    expect(res.byteLength).toBe(10);
    expect(callCount).toBe(3);
  });
});
