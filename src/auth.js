// Who is holding this device -- decided by the server, not by this file.
//
// Otherwise QA O-01 (2026-10-06, P0). Until now the web reader sent one shared
// token, compiled into this bundle (VITE_STORYFORGE_TOKEN, also in the public
// repo's .env), and told the server who was reading in `requestedBy`. Anyone on
// the internet could ask as Jonathan; Keen could tick "Jonathan" in the picker
// and read a grown-up's story. The token is gone from the build. Instead:
//
//   * A grown-up sets up the device once with their PIN (POST /v1/auth/storyforge/device).
//     The device keeps an opaque credential in localStorage.
//   * On a set-up device, Keen and Talia sign in by tapping their name
//     (POST /v1/auth/storyforge/profile, no PIN). They get only their own stories.
//   * Jonathan and Adele need their PIN every time they are chosen -- including
//     switching to them on a shared iPad. Their sessions are short and end when idle.
//
// The session token names ONE person. The server stamps that person onto every
// call; whatever `requestedBy` the app sends is ignored.

const DEFAULT_ABILITY_URL = "https://ability-supervisor-service-818269465014.us-central1.run.app";
const DEVICE_KEY = "otherwise_device";
const SESSION_KEY = "otherwise_session";
const LEGACY_TOKEN_KEY = "storyforge_token";
export const SIGNED_OUT_EVENT = "otherwise:signed-out";

// Display-only: what the picker asks for. The server decides; a profile that is
// not a child here but is one there simply never gets asked for a PIN it needs.
export const CHILD_PROFILES = new Set(["keen", "talia"]);
export const ADULT_PROFILES = ["jonathan", "adele"];

let baseUrl = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ABILITY_URL) || DEFAULT_ABILITY_URL;

export function configureAuth({ abilityUrl } = {}) {
  if (abilityUrl) baseUrl = abilityUrl;
}

export function isChildProfile(id) {
  return CHILD_PROFILES.has(String(id || "").trim().toLowerCase());
}

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the session lives for this page only */
  }
}

// An older build let a token be pasted into localStorage. It is nobody's
// identity any more; leaving it there would only invite reusing it.
try {
  if (typeof localStorage !== "undefined") localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch {
  /* ignore */
}

export function currentSession() {
  const s = read(SESSION_KEY);
  return s && s.accessToken && s.userId ? s : null;
}

export function deviceCredentials() {
  const d = read(DEVICE_KEY);
  return d && d.deviceId && d.deviceSecret ? d : null;
}

export function isDeviceEnrolled() {
  return Boolean(deviceCredentials());
}

function expired(iso, slackMs = 0) {
  const t = Date.parse(iso || "");
  return !Number.isFinite(t) || t - slackMs <= Date.now();
}

/** A session for exactly this person that can still be used or refreshed. */
export function hasSessionFor(userId) {
  const s = currentSession();
  if (!s || s.userId !== String(userId || "").toLowerCase()) return false;
  return !s.refreshExpiresAt || !expired(s.refreshExpiresAt);
}

export class SignInError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = "SignInError";
    this.code = code;
    Object.assign(this, extra);
  }
}

/** What to say to the person in front of the screen, by the server's code. */
export function signInMessage(code, name = "") {
  const who = name || "this person";
  switch (code) {
    case "PIN_WRONG": return "That PIN isn't right.";
    case "PIN_REQUIRED": return `Enter ${who}'s PIN.`;
    // Locks are per device now (O2-07): a stranger's guesses elsewhere never lock
    // a grown-up out of this one.
    case "PIN_LOCKED": return "Too many wrong PINs on this device. Try again later, or ask Jonathan for a set-up code.";
    case "PIN_SETUP_CLOSED": return "Setting up a new device with a PIN is paused for now. Ask Jonathan for a set-up code.";
    case "PIN_NOT_SET": return `${who} doesn't have a PIN yet. Jonathan sets one up first.`;
    case "PIN_FORMAT": return "A PIN is 4 to 8 numbers.";
    case "ADULT_REQUIRED": return "A grown-up has to set up this device.";
    case "DEVICE_NOT_ENROLLED":
    case "DEVICE_REVOKED": return "This device needs a grown-up to set it up again.";
    case "ENROLLMENT_CODE_INVALID": return "That code didn't work. Ask Jonathan for a new one.";
    case "UNKNOWN_PROFILE": return "That reader isn't set up on the story server.";
    case "NETWORK": return "Couldn't reach the story server. Check the wifi, then try again.";
    default: return "Signing in didn't work. Try again in a minute.";
  }
}

async function post(path, body) {
  let response;
  try {
    response = await rawFetch()(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "core", ...body }),
    });
  } catch {
    throw new SignInError("NETWORK");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new SignInError(data.error || `HTTP_${response.status}`, data.message, { status: response.status, lockedUntil: data.lockedUntil });
  }
  return data;
}

function sessionFrom(data) {
  return {
    accessToken: data.accessToken,
    expiresAt: data.expiresAt,
    refreshToken: data.refreshToken,
    refreshExpiresAt: data.refreshExpiresAt,
    sessionId: data.sessionId,
    userId: String(data.userId || "").toLowerCase(),
    child: Boolean(data.child),
  };
}

function deviceName() {
  try {
    const ua = navigator.userAgent || "";
    if (/iPad/.test(ua)) return "iPad (web)";
    if (/iPhone/.test(ua)) return "iPhone (web)";
    if (/Android/.test(ua)) return "Android (web)";
    return "Browser";
  } catch {
    return "Browser";
  }
}

async function replaceSession(next) {
  const previous = currentSession();
  write(SESSION_KEY, next);
  // The person who was signed in before is signed OUT, not merely forgotten
  // here: a grown-up's session must not outlive the child taking over the iPad.
  if (previous && previous.sessionId && previous.sessionId !== next?.sessionId) {
    post("/v1/auth/storyforge/signout", { sessionId: previous.sessionId, refreshToken: previous.refreshToken }).catch(() => {});
  }
  return next;
}

/** A grown-up sets up this device. Returns the new session (for that grown-up). */
export async function enrollDevice({ userId, pin, enrollmentCode }) {
  const data = await post("/v1/auth/storyforge/device", {
    userId: userId ? String(userId).toLowerCase() : undefined,
    pin: pin || undefined,
    enrollmentCode: enrollmentCode || undefined,
    deviceName: deviceName(),
  });
  write(DEVICE_KEY, { deviceId: data.deviceId, deviceSecret: data.deviceSecret });
  return replaceSession(sessionFrom(data));
}

/** Choose who is reading. Children need no PIN on an enrolled device; adults do. */
export async function signInProfile({ userId, pin }) {
  const device = deviceCredentials();
  if (!device) throw new SignInError("DEVICE_NOT_ENROLLED");
  try {
    const data = await post("/v1/auth/storyforge/profile", {
      ...device,
      userId: String(userId || "").toLowerCase(),
      pin: pin || undefined,
    });
    return replaceSession(sessionFrom(data));
  } catch (error) {
    if (error.code === "DEVICE_NOT_ENROLLED" || error.code === "DEVICE_REVOKED") write(DEVICE_KEY, null);
    throw error;
  }
}

let refreshing = null;

/** Refresh tokens rotate and a replay revokes the session, so only one refresh
 *  is ever in flight; everyone else waits for it. */
export function refreshSession() {
  if (refreshing) return refreshing;
  const s = currentSession();
  if (!s) return Promise.reject(new SignInError("NO_SESSION"));
  refreshing = post("/v1/auth/storyforge/refresh", { sessionId: s.sessionId, refreshToken: s.refreshToken })
    .then((data) => {
      const next = { ...s, ...sessionFrom(data), child: s.child, refreshExpiresAt: data.refreshExpiresAt || s.refreshExpiresAt };
      write(SESSION_KEY, next);
      return next;
    })
    .catch((error) => {
      if (error.code !== "NETWORK") endSession(error.code);
      throw error;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function endSession(reason) {
  write(SESSION_KEY, null);
  if (reason === "DEVICE_REVOKED" || reason === "DEVICE_NOT_ENROLLED") write(DEVICE_KEY, null);
  try {
    window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: { reason } }));
  } catch {
    /* no window in tests */
  }
}

export async function signOut() {
  const s = currentSession();
  write(SESSION_KEY, null);
  if (s) await post("/v1/auth/storyforge/signout", { sessionId: s.sessionId, refreshToken: s.refreshToken }).catch(() => {});
}

// --- every call to the story server carries the session ----------------------

let originalFetch = null;

function rawFetch() {
  return originalFetch || globalThis.fetch.bind(globalThis);
}

function withBearer(init, session) {
  const headers = new Headers(init?.headers || {});
  headers.delete("Authorization");
  if (session) headers.set("Authorization", `Bearer ${session.accessToken}`);
  return { ...(init || {}), headers };
}

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return String(input || "");
}

/**
 * Wrap fetch so every request to the story server is signed by the current
 * session -- refreshed shortly before it expires, and once more on a 401.
 * Requests anywhere else (Kokoro, map tiles) are untouched, and never see the token.
 */
export function installSessionFetch(target = globalThis) {
  if (!target.fetch || target.fetch.__otherwiseSession) return;
  originalFetch = target.fetch.bind(target);
  const wrapped = async (input, init) => {
    const url = urlOf(input);
    if (!url.startsWith(baseUrl) || url.startsWith(`${baseUrl}/v1/auth/`)) return originalFetch(input, init);
    let session = currentSession();
    if (session && expired(session.expiresAt, 60_000)) {
      session = await refreshSession().catch(() => currentSession());
    }
    let response = await originalFetch(input, withBearer(init, session));
    if (response.status === 401 && session) {
      try {
        session = await refreshSession();
        response = await originalFetch(input, withBearer(init, session));
      } catch {
        /* the 401 stands; endSession has already told the app */
      }
    }
    return response;
  };
  wrapped.__otherwiseSession = true;
  target.fetch = wrapped;
}

// Test seam.
export function __resetAuthForTests() {
  originalFetch = null;
  refreshing = null;
  write(SESSION_KEY, null);
  write(DEVICE_KEY, null);
}
