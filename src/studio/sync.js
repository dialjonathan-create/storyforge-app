// Keeping one studio document in sync (spec §3.2-§3.5).
//
// LIVE mode (the server named a sync URL): a WebSocket to the otherwise-studio worker. The
// ticket is the FIRST message, never in the URL; it is refreshed every 4 minutes over the
// open socket. y-protocols framing for document updates and presence.
// LOCAL mode (no sync server yet): the draft lives on this device and editors checkpoint it
// to the Dell through storyforge.studio.checkpoint.v1.
// Either way the draft is also kept on this device (IndexedDB, scoped to the signed-in person,
// wiped when another person signs in) unless the device is marked shared.
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { IndexeddbPersistence } from "y-indexeddb";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const TICKET_REFRESH_MS = 4 * 60 * 1000;
export const DB_PREFIX = "otherwise-studio";
const OWNER_KEY = "otherwise_studio_owner";

export function dbName(userId, docId) {
  return `${DB_PREFIX}:${String(userId || "").toLowerCase()}:${docId}`;
}

/** Another person now holds this device: their drafts go first (like reader data, UI-01). */
export async function claimStudioData(userId) {
  const who = String(userId || "").toLowerCase();
  let owner = "";
  try { owner = localStorage.getItem(OWNER_KEY) || ""; } catch { /* ignore */ }
  if (owner && owner !== who) await wipeStudioData();
  try { if (who) localStorage.setItem(OWNER_KEY, who); } catch { /* ignore */ }
}

export async function wipeStudioData() {
  try {
    const dbs = (await indexedDB.databases?.()) || [];
    await Promise.all(dbs.filter((d) => d.name && d.name.startsWith(`${DB_PREFIX}:`)).map((d) => new Promise((res) => {
      const req = indexedDB.deleteDatabase(d.name);
      req.onsuccess = req.onerror = req.onblocked = () => res();
    })));
  } catch { /* no IndexedDB here */ }
}

export class StudioSync {
  /**
   * @param {object} o
   * @param {Y.Doc} o.ydoc
   * @param {string} o.docId
   * @param {string|null} o.syncUrl
   * @param {string} o.userId
   * @param {boolean} o.keepOffline   keep a copy on this device (false on a shared device)
   * @param {() => Promise<{ticket: string, level: string}>} o.getTicket
   * @param {(status: object) => void} o.onStatus
   * @param {(msg: object) => void} o.onControl
   */
  constructor({ ydoc, docId, syncUrl, userId, keepOffline = true, getTicket, onStatus = () => {}, onControl = () => {} }) {
    this.ydoc = ydoc;
    this.docId = docId;
    this.syncUrl = syncUrl;
    this.getTicket = getTicket;
    this.onStatus = onStatus;
    this.onControl = onControl;
    this.awareness = new awarenessProtocol.Awareness(ydoc);
    this.ws = null;
    this.level = null;
    this.ready = false;
    this.closed = false;
    this.paused = false;
    this.retry = 0;
    this.status = { mode: syncUrl ? "live" : "local", connected: false, synced: false };
    this.persistence = keepOffline && typeof indexedDB !== "undefined" ? new IndexeddbPersistence(dbName(userId, docId), ydoc) : null;
    this.localLoaded = this.persistence ? this.persistence.whenSynced.then(() => true).catch(() => false) : Promise.resolve(false);
    this.onUpdate = (update, origin) => {
      if (origin === this || !this.ready || this.level === "read") return;
      this.send(encoding.encode((e) => { encoding.writeVarUint(e, MSG_SYNC); syncProtocol.writeUpdate(e, update); }));
    };
    this.onAwareness = ({ added, updated, removed }, origin) => {
      if (origin === this || !this.ready) return;
      const changed = added.concat(updated, removed);
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
      this.send(encoding.encode((e) => { encoding.writeVarUint(e, MSG_AWARENESS); encoding.writeVarUint8Array(e, update); }));
    };
    ydoc.on("update", this.onUpdate);
    this.awareness.on("update", this.onAwareness);
    this.onOnline = () => this.connect();
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  send(data) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(data); } catch { /* reconnect will resync */ }
    }
  }

  async connect() {
    if (!this.syncUrl || this.closed || this.paused) return;
    if (this.ws && this.ws.readyState <= 1) return;
    let ticket;
    try {
      ticket = await this.getTicket();
    } catch (error) {
      this.setStatus({ connected: false, error: error?.signedOut ? "signed_out" : "ticket" });
      if (!error?.signedOut) this.scheduleRetry();
      return;
    }
    if (!ticket?.ticket) { this.setStatus({ mode: "local" }); return; }
    this.level = ticket.level;
    const url = `${this.syncUrl.replace(/^http/, "ws")}/ws/${encodeURIComponent(this.docId)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: "auth", ticket: ticket.ticket }));
    ws.onmessage = (event) => this.onMessage(event);
    ws.onclose = (event) => {
      this.ready = false;
      clearInterval(this.refreshTimer);
      this.setStatus({ connected: false, synced: false });
      awarenessProtocol.removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()].filter((id) => id !== this.ydoc.clientID), this);
      if (event.code === 4403) this.onControl({ t: "error", code: "access_changed" });
      if (!this.closed && !this.paused) this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    const wait = Math.min(30_000, 500 * 2 ** this.retry) + Math.random() * 400;
    this.retry += 1;
    this.retryTimer = setTimeout(() => this.connect(), wait);
  }

  onMessage(event) {
    if (typeof event.data === "string") {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.t === "ready") {
        this.ready = true;
        this.retry = 0;
        this.level = msg.level;
        this.setStatus({ connected: true, level: msg.level, error: null });
        this.send(encoding.encode((e) => { encoding.writeVarUint(e, MSG_SYNC); syncProtocol.writeSyncStep1(e, this.ydoc); }));
        if (this.awareness.getLocalState()) {
          const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID]);
          this.send(encoding.encode((e) => { encoding.writeVarUint(e, MSG_AWARENESS); encoding.writeVarUint8Array(e, update); }));
        }
        clearInterval(this.refreshTimer);
        this.refreshTimer = setInterval(async () => {
          try {
            const next = await this.getTicket();
            if (next?.ticket) this.send(JSON.stringify({ t: "auth", ticket: next.ticket }));
          } catch { /* the socket closes when the old ticket lapses; reconnect asks again */ }
        }, TICKET_REFRESH_MS);
      } else if (msg.t === "level") {
        this.level = msg.level;
        this.setStatus({ level: msg.level });
      }
      this.onControl(msg);
      return;
    }
    const decoder = decoding.createDecoder(new Uint8Array(event.data));
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      const kind = syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, this);
      if (kind === syncProtocol.messageYjsSyncStep2) this.setStatus({ synced: true });
      if (encoding.length(encoder) > 1 && this.level !== "read") this.send(encoding.toUint8Array(encoder));
      else if (encoding.length(encoder) > 1 && kind === syncProtocol.messageYjsSyncStep1) this.send(encoding.toUint8Array(encoder));
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }

  /** Signed out: stop talking to the server, keep everything on this device. */
  pause() {
    this.paused = true;
    clearInterval(this.refreshTimer);
    clearTimeout(this.retryTimer);
    try { this.ws?.close(1000, "paused"); } catch { /* closed */ }
  }

  resume() {
    this.paused = false;
    this.connect();
  }

  destroy() {
    this.closed = true;
    this.pause();
    this.ydoc.off("update", this.onUpdate);
    this.awareness.off("update", this.onAwareness);
    this.awareness.destroy();
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
    this.persistence?.destroy();
  }
}
