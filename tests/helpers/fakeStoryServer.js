/**
 * A fake Otherwise story server for reader tests: answers /v1/execute by
 * command and the GET status route, records every call, and lets a test flip
 * answers mid-flight. Nothing here talks to a network.
 */
import { vi } from "vitest";

export function fakeStoryServer(handlers = {}) {
  const calls = [];
  const statusCalls = [];
  const server = {
    calls,
    statusCalls,
    handlers: { ...handlers },
    offline: false,
    commands: (name) => calls.filter((c) => c.command === name),
  };
  global.fetch = vi.fn(async (url, options = {}) => {
    if (server.offline) throw new TypeError("Failed to fetch");
    const u = String(url);
    if (u.includes("/storyforge/chapter/status")) {
      const params = Object.fromEntries(new URL(u).searchParams.entries());
      statusCalls.push(params);
      const fn = server.handlers.status;
      const body = fn ? await fn(params) : { ok: true, status: "not_requested" };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (u.includes("kokoro")) return new Response(JSON.stringify([]), { status: 200 });
    const body = JSON.parse(options.body || "{}");
    calls.push(body);
    const fn = server.handlers[body.command];
    if (!fn) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const out = await fn(body.args || {}, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: out && out.__status ? out.__status : 200 });
  });
  return server;
}

export const PROSE = "Keen walked to the deck. The wind was cold and smelled like salt.\n\nSable pointed at the clouds. They were pink and gold.";

export function chapterDoc(n, extra = {}) {
  return {
    ok: true,
    chapterNumber: n,
    chapterTitle: `The Deck ${n}`,
    prose: PROSE,
    choices: [{ id: "a", text: "Go left" }, { id: "b", text: "Go right" }, { id: "c", text: "Wait" }],
    ...extra,
  };
}
