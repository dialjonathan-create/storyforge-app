// A stand-in story server for the studio's browser tests: /v1/execute for the studio's
// commands, sign-in routes, and the built app itself (SPA fallback). Synthetic prose only.
//   node tests/e2e/fakeStudioServer.mjs <port> <distDir>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.argv[2] || 4319);
const DIST = path.resolve(process.argv[3] || "tests/e2e/.dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const CH1 = "# The Rail\n\nSable stood at the rail for a very long time, watching the clouds fold over themselves.<!-- pause --> The *Meridian* hummed beneath her.\n\nKeen climbed up beside her. “Where are we going?”\n\n* * *\n\nNobody answered. The wind did, a little.";
const CH2 = "The deck tilted toward the east.\n\nVerath was a word nobody on board would say twice.";
function fresh() {
  return {
    published: { 1: { prose: CH1, title: "The Rail", choices: [{ text: "Ask Sable about Verath" }, { text: "Go below" }, { text: "Climb the mast" }] }, 2: { prose: CH2, title: "East", choices: [] } },
    checkpoints: {}, versions: [], expired: new Set(), sharing: { familyDefault: "read", people: {} }, settings: {}, calls: [], levels: { jonathan: "owner", adele: "suggest", keen: "read" },
  };
}
let S = fresh();

// LIVE mode (optional): a local otherwise-studio worker. STUDIO_SYNC_URL, STUDIO_TICKET_PKCS8 (base64
// Ed25519 private key), STUDIO_SERVICE_SECRET: tickets are signed here like the supervisor signs them.
const LIVE = process.env.STUDIO_SYNC_URL || "";
let liveKey = null;
async function signTicket(claims) {
  if (!liveKey) liveKey = await crypto.subtle.importKey("pkcs8", Buffer.from(process.env.STUDIO_TICKET_PKCS8, "base64"), { name: "Ed25519" }, false, ["sign"]);
  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const part = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, liveKey, new TextEncoder().encode(`v1.${part}`));
  return `v1.${part}.${b64u(new Uint8Array(sig))}`;
}
async function seedRoom(docId, markdown) {
  const { createHmac } = await import("node:crypto");
  const p = `/internal/${encodeURIComponent(docId)}/seed`;
  const body = JSON.stringify({ markdown, publishedProse: markdown });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env.STUDIO_SERVICE_SECRET).update(`${t}.POST.${p}.${body}`).digest("hex");
  await fetch(LIVE + p, { method: "POST", body, headers: { "X-Studio-Signature": `t=${t},s=${sig}` } });
}

const levelOf = (who) => S.sharing.people[who] || (who === "jonathan" ? "owner" : S.levels[who] || S.sharing.familyDefault);
const modesFor = (lvl) => ({ owner: ["suggest", "direct", "draft"], edit: ["suggest", "direct", "draft"], suggest: ["suggest"] }[lvl] || []);

async function handleLive(command, a, who) {
  if (LIVE && command === "storyforge.studio.ticket.v1") {
    const now = Math.floor(Date.now() / 1000);
    const level = levelOf(who);
    return { ok: true, mode: "live", level, ticket: await signTicket({ sub: who, docId: a.docId, level, iat: now, exp: now + 300, jti: `j${Math.random().toString(36).slice(2)}` }), syncUrl: LIVE };
  }
  const out = handle(command, a, who);
  if (LIVE && command === "storyforge.studio.doc.open.v1" && out.ok) {
    await seedRoom(a.docId, S.published[Number(a.docId.split(":")[2])]?.prose || "");
    return { ...out, mode: "live", syncUrl: LIVE, seed: { markdown: out.seed.markdown, checkpoint: null } };
  }
  return out;
}

function handle(command, a, who) {
  S.calls.push({ command, args: a, who });
  const n = Number(String(a.docId || "").split(":")[2] || a.chapterNumber || 1);
  switch (command) {
    case "storyforge.studio.library.v1":
      return { ok: true, universes: [{ universeId: "meridian-universe", title: "The Meridian Universe", kind: "interactive", stories: [{ storyId: "the-meridian", title: "The Meridian", level: levelOf(who), chapters: Object.entries(S.published).map(([k, v]) => ({ chapterNumber: Number(k), chapterTitle: v.title, status: S.checkpoints[k]?.length ? "draft" : "published", pending: 0 })) }] }] };
    case "storyforge.studio.settings.get.v1": return { ok: true, settings: S.settings };
    case "storyforge.studio.settings.set.v1": S.settings = { ...S.settings, ...a }; return { ok: true };
    case "storyforge.studio.ticket.v1": return { ok: true, mode: "local", ticket: null, level: levelOf(who) };
    case "storyforge.studio.doc.open.v1": {
      const lvl = levelOf(who);
      if (lvl === "none") return { status: 403, body: { ok: false, error: "forbidden", message: "That story isn't open to you." } };
      const pub = S.published[n];
      const cps = S.checkpoints[n] || [];
      return { ok: true, docId: a.docId, level: lvl, aiModes: modesFor(lvl), mode: "local", syncUrl: null,
        chapter: { chapterNumber: n, exists: Boolean(pub), chapterTitle: pub?.title || "", choices: pub?.choices || [] },
        seed: { markdown: pub?.prose || "", checkpoint: cps.length && cps.at(-1).state ? { state: cps.at(-1).state } : null },
        universe: { universeId: "meridian-universe", title: "The Meridian Universe", kind: "interactive" },
        story: { storyId: "the-meridian", title: "The Meridian", ownerId: "jonathan" }, options: { directAllowed: true, draftWho: "editors" } };
    }
    case "storyforge.studio.checkpoint.v1": {
      (S.checkpoints[n] = S.checkpoints[n] || []).push({ ...a, checkpointId: `cp${Date.now()}${Math.random().toString(36).slice(2, 5)}`, createdAt: new Date().toISOString() });
      return { ok: true, createdAt: new Date().toISOString(), checkpointId: S.checkpoints[n].at(-1).checkpointId };
    }
    case "storyforge.studio.versions.list.v1":
      return { ok: true, draft: [...(S.checkpoints[n] || [])].reverse().map((c) => ({ checkpointId: c.checkpointId, reason: c.reason, name: c.name, createdAt: c.createdAt, wordCount: c.wordCount })), published: S.versions.filter((v) => v.n === n).map((v) => ({ versionId: v.id, createdAt: v.at, chapterTitle: v.title, proseLength: v.prose.length })) };
    case "storyforge.studio.versions.restore.v1": {
      const c = (S.checkpoints[n] || []).find((x) => x.checkpointId === a.checkpointId);
      if (c) return { ok: true, kind: "draft", state: c.state, markdown: c.markdown };
      const v = S.versions.find((x) => x.id === a.versionId);
      return v ? { ok: true, kind: "published", markdown: v.prose } : { ok: false, error: "not_found", message: "That version isn't there any more." };
    }
    case "storyforge.studio.publish.v1": {
      if (!["owner", "edit"].includes(levelOf(who))) return { status: 403, body: { ok: false, error: "forbidden", message: "Only an editor can publish." } };
      if ((a.pending || {}).outside) return { ok: false, error: "outside_changes_pending", message: "This chapter was changed outside the studio. Accept or reject those changes first, then publish." };
      const old = S.published[n];
      if (old) S.versions.push({ id: `v${S.versions.length + 1}`, n, prose: old.prose, title: old.title, at: new Date().toISOString() });
      S.published[n] = { ...(old || {}), prose: a.markdown, title: a.chapterTitle || old?.title || "", choices: a.choices || old?.choices || [] };
      return { ok: true, publishedAt: new Date().toISOString(), versionKept: S.versions.at(-1)?.id };
    }
    case "storyforge.chapter.list.v1": return { ok: true, chapterNumbers: Object.keys(S.published).map(Number) };
    case "storyforge.chapter.get.v1": { const c = S.published[a.chapterNumber]; return c ? { ok: true, chapter: { chapterNumber: a.chapterNumber, chapterTitle: c.title, prose: c.prose } } : { ok: false, error: "chapter_not_found" }; }
    case "storyforge.story.get.v1": return { ok: true, story: { title: "The Meridian" } };
    case "storyforge.studio.converse.v1": {
      if (/^(tighten|rewrite)/i.test(a.message || "")) return handle("storyforge.studio.ai.run.v1", { ...a, command: "rewrite" }, who);
      return { ok: true, answer: "Not yet. Sable has only heard the name; nobody has described Verath to her [Ch 2].", citations: ["Ch 2"], context: ["Ch 1 draft", "Summaries: Ch 1–1"] };
    }
    case "storyforge.studio.ai.run.v1": {
      if (!modesFor(levelOf(who)).length) return { ok: false, error: "mode_not_allowed", message: "You can read this story but not change it." };
      const block = (a.blocks || []).find((b) => (a.selection?.pids || []).includes(b.pid)) || (a.blocks || [])[1];
      if (a.command === "check_lore") return { ok: true, kind: "check_lore", summary: "One thing to look at.", comments: 1, appliedBy: "client", mode: "suggest", ops: [{ op: "comment", pid: block.pid, quote: "Sable", body: "Sable has never been on deck at night before chapter 3 [Lore: Sable]." }], context: ["Lore: Sable"] };
      if (a.command === "choices") return { ok: true, kind: "choices", choices: ["Ask Sable what Verath looks like", "Follow the wind east", "Wake the captain"] };
      if (a.command === "continue") return { ok: true, kind: "continue", appliedBy: "client", mode: a.mode || "suggest", words: 9, ops: [{ op: "insert_after", pid: block.pid, text: "Far below, a lantern blinked twice and went out." }] };
      const quote = a.selection?.quote && block.text.includes(a.selection.quote) ? a.selection.quote : block.text;
      return { ok: true, kind: "rewrite", appliedBy: "client", mode: a.mode || "suggest", suggested: 1, ops: [{ op: "replace", pid: block.pid, quote, text: "Sable watched the clouds fold over themselves." }], context: ["Ch 1 draft"] };
    }
    case "storyforge.studio.sharing.get.v1":
      return { ok: true, sharing: { ownerId: "jonathan", familyDefault: S.sharing.familyDefault, locked: false, canChange: who === "jonathan", people: ["jonathan", "adele", "keen", "talia"].map((p) => ({ userId: p, level: p === "jonathan" ? "owner" : levelOf(p), owner: p === "jonathan", explicit: Boolean(S.sharing.people[p]), hasUniverseAccess: true })) }, options: { directAllowed: true, draftWho: "editors" } };
    case "storyforge.studio.sharing.set.v1": {
      if (who !== "jonathan") return { ok: false, error: "owner_only", message: "Only the person who made this story can change who can see it." };
      const before = Object.fromEntries(["adele", "keen", "talia"].map((p) => [p, levelOf(p)]));
      S.sharing = { familyDefault: a.familyDefault || S.sharing.familyDefault, people: { ...a.people } };
      const rank = { none: 0, read: 1, suggest: 2, edit: 3 };
      const lowered = Object.keys(before).filter((p) => rank[levelOf(p)] < rank[before[p]]);
      return { ok: true, lowered, sharing: handle("storyforge.studio.sharing.get.v1", {}, who).sharing, options: a.options };
    }
    default: return { status: 404, body: { ok: false, error: "unknown", message: `fake server has no ${command}` } };
  }
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
  let raw = "";
  req.on("data", (d) => { raw += d; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
    const who = token.startsWith("tok-") ? token.slice(4).split("-")[0] : "";
    if (url.pathname === "/__reset") { S = fresh(); return send(res, 200, { ok: true }); }
    if (url.pathname === "/__state") return send(res, 200, { published: S.published, calls: S.calls.slice(-50), checkpoints: Object.fromEntries(Object.entries(S.checkpoints).map(([k, v]) => [k, v.length])) });
    if (url.pathname === "/__expire") { S.expired.add(body.token); return send(res, 200, { ok: true }); }
    if (url.pathname === "/__level") { S.levels[body.user] = body.level; return send(res, 200, { ok: true }); }
    if (url.pathname === "/v1/auth/storyforge/refresh") return send(res, 401, { ok: false, error: "SESSION_IDLE", message: "signed out after a while away" });
    if (url.pathname === "/v1/auth/storyforge/signout") return send(res, 200, { ok: true });
    if (url.pathname === "/v1/auth/storyforge/profile") {
      if (body.pin !== "2468") return send(res, 403, { ok: false, error: "PIN_WRONG" });
      const t = `tok-${body.userId}-${Date.now()}`;
      return send(res, 200, { ok: true, accessToken: t, expiresAt: new Date(Date.now() + 3600e3).toISOString(), refreshToken: "r", refreshExpiresAt: new Date(Date.now() + 864e5).toISOString(), userId: body.userId, sessionId: `s-${Date.now()}`, child: false, personalDevice: Boolean(body.personalDevice) });
    }
    if (url.pathname === "/v1/execute") {
      if (!who) return send(res, 401, { error: "UNAUTHORIZED" });
      if (S.expired.has(token)) return send(res, 401, { error: "UNAUTHORIZED" });
      return handleLive(body.command, body.args || {}, who).then((out) => (out && out.status ? send(res, out.status, out.body) : send(res, 200, out)));
    }
    // the app
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
  });
}).listen(PORT, "127.0.0.1", () => console.log(`fake studio server on ${PORT}`));
