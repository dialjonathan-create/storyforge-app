/**
 * Otherwise QA O-01 (2026-10-06, P0): who is reading is decided by the server.
 *
 * Before: one shared token compiled into this bundle, and the reader's name sent
 * in `requestedBy`. From the internet anyone could ask as Jonathan; on the iPad,
 * Keen ticked "Jonathan" and read a grown-up's story (QA RU-09, RU-10).
 *
 * After: no token in the build; a grown-up sets up the device with a PIN; Keen and
 * Talia tap their names; Jonathan and Adele need their PIN every time they are
 * chosen. Every call to the story server carries the signed-in reader's session.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const auth = await import("../src/auth.js");
const { SignInSheet } = await import("../src/SignIn.jsx");
const main = await import("../src/main.jsx");
const { credentialEnvNames, findSecretsInText } = await import("../build/checkBundleSecrets.js");
const { MemoryRouter, Routes, Route } = await import("react-router-dom");

const BASE = "https://story.example";
const USERS = [
  { userId: "jonathan", displayName: "Jonathan" },
  { userId: "adele", displayName: "Adele" },
  { userId: "keen", displayName: "Keen" },
  { userId: "talia", displayName: "Talia" },
];

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function sessionBody(userId, extra = {}) {
  return {
    ok: true,
    accessToken: `access-${userId}-${Math.random().toString(36).slice(2)}`,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    refreshToken: `refresh-${userId}`,
    refreshExpiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
    sessionId: `sid-${userId}`,
    userId,
    child: userId === "keen" || userId === "talia",
    ...extra,
  };
}

let calls;
let server;
beforeEach(() => {
  localStorage.clear();
  auth.__resetAuthForTests();
  auth.configureAuth({ abilityUrl: BASE });
  calls = [];
  server = {};
  global.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    const headers = new Headers(init.headers || {});
    calls.push({ url: String(url), body, auth: headers.get("Authorization") });
    const route = String(url).replace(BASE, "");
    if (server[route]) return server[route](body, headers);
    return json(200, { ok: true });
  });
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
// the build
// ---------------------------------------------------------------------------

describe("no credential is compiled into the app", () => {
  it("the repo's .env no longer carries a Storyforge token", () => {
    const env = readFileSync(path.resolve(__dirname, "../.env"), "utf8");
    expect(env).not.toMatch(/STORYFORGE_TOKEN/);
    expect(credentialEnvNames(Object.fromEntries(env.split("\n").filter(Boolean).map((l) => l.split("="))))).toEqual([]);
  });

  it("the source never reads a token from the build environment", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/main.jsx"), "utf8");
    expect(src).not.toMatch(/import\.meta\.env\.VITE_STORYFORGE_TOKEN/);
    expect(src).not.toMatch(/getItem\("storyforge_token"\)/);
  });

  it("the build check refuses a credential-named VITE_ variable and a bearer-looking literal", () => {
    expect(credentialEnvNames({ VITE_STORYFORGE_TOKEN: "x", VITE_ABILITY_URL: "https://a" })).toEqual(["VITE_STORYFORGE_TOKEN"]);
    expect(findSecretsInText(`headers:{Authorization:"Bearer abcdefabcdef0123456789abcdef0123"}`).length).toBeGreaterThan(0);
    expect(findSecretsInText("const t='dbe1df00112233445566778899aabbccddeeff00112233445566778899aabbcc'").length).toBeGreaterThan(0);
    expect(findSecretsInText("const url='https://story.example/v1/execute'")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sessions on the wire
// ---------------------------------------------------------------------------

describe("every story-server call carries the signed-in reader's session", () => {
  async function signedInAs(userId) {
    server["/v1/auth/storyforge/device"] = () => json(200, { ...sessionBody("jonathan"), deviceId: "dev-1", deviceSecret: "dev-secret" });
    server["/v1/auth/storyforge/profile"] = (body) => json(200, sessionBody(body.userId));
    await auth.enrollDevice({ userId: "jonathan", pin: "482913" });
    if (userId !== "jonathan") await auth.signInProfile({ userId });
    return auth.currentSession();
  }

  it("adds the bearer to the story server only -- never to anyone else", async () => {
    const target = { fetch: global.fetch };
    const s = await signedInAs("keen");
    auth.installSessionFetch(target);
    await target.fetch(`${BASE}/v1/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await target.fetch("https://tts.example/voices", {});
    const story = calls.find((c) => c.url === `${BASE}/v1/execute`);
    const other = calls.find((c) => c.url === "https://tts.example/voices");
    expect(story.auth).toBe(`Bearer ${s.accessToken}`);
    expect(other.auth).toBeNull();
  });

  it("the PIN and the device secret never land anywhere but the sign-in call", async () => {
    await signedInAs("keen");
    const stored = JSON.stringify({ ...localStorage });
    expect(stored).not.toContain("482913");
    const enroll = calls.find((c) => c.url.endsWith("/v1/auth/storyforge/device"));
    expect(enroll.body.pin).toBe("482913");
    expect(calls.filter((c) => JSON.stringify(c.body).includes("482913"))).toHaveLength(1);
  });

  it("switching readers signs the previous one OUT on the server", async () => {
    await signedInAs("keen");
    const out = calls.filter((c) => c.url.endsWith("/v1/auth/storyforge/signout"));
    expect(out.map((c) => c.body.sessionId)).toContain("sid-jonathan");
  });

  it("a 401 refreshes once and retries; concurrent 401s share one refresh", async () => {
    const target = { fetch: global.fetch };
    await signedInAs("keen");
    let refreshed = 0;
    server["/v1/auth/storyforge/refresh"] = () => { refreshed += 1; return json(200, sessionBody("keen", { accessToken: "access-new" })); };
    server["/v1/execute"] = (_b, headers) => (headers.get("Authorization") === "Bearer access-new"
      ? json(200, { ok: true })
      : json(401, { error: "UNAUTHORIZED" }));
    auth.installSessionFetch(target);
    const results = await Promise.all([1, 2, 3].map(() => target.fetch(`${BASE}/v1/execute`, { method: "POST", body: "{}" })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshed).toBe(1);
  });

  it("an idle grown-up session ends: stored session cleared, the app told", async () => {
    const target = { fetch: global.fetch };
    await signedInAs("jonathan");
    server["/v1/auth/storyforge/refresh"] = () => json(401, { ok: false, error: "SESSION_IDLE" });
    server["/v1/execute"] = () => json(401, { error: "UNAUTHORIZED" });
    const heard = vi.fn();
    window.addEventListener(auth.SIGNED_OUT_EVENT, heard);
    auth.installSessionFetch(target);
    const res = await target.fetch(`${BASE}/v1/execute`, { method: "POST", body: "{}" });
    window.removeEventListener(auth.SIGNED_OUT_EVENT, heard);
    expect(res.status).toBe(401);
    expect(auth.currentSession()).toBeNull();
    expect(heard).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// the sign-in sheet
// ---------------------------------------------------------------------------

describe("signing in as the person who is reading", () => {
  it("a grown-up is asked for their PIN and nothing is sent until it is entered", async () => {
    const done = vi.fn();
    render(<SignInSheet who="jonathan" users={USERS} onDone={done} onCancel={() => {}} />);
    expect(screen.getByLabelText("Jonathan's PIN")).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
  });

  it("a wrong PIN says so, and opens nothing", async () => {
    server["/v1/auth/storyforge/device"] = () => json(401, { ok: false, error: "PIN_WRONG" });
    const done = vi.fn();
    render(<SignInSheet who="jonathan" users={USERS} onDone={done} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Jonathan's PIN"), { target: { value: "1111" } });
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("That PIN isn't right.");
    expect(done).not.toHaveBeenCalled();
    expect(auth.currentSession()).toBeNull();
  });

  it("Keen on a set-up device is signed in at once, with no PIN", async () => {
    localStorage.setItem("otherwise_device", JSON.stringify({ deviceId: "dev-1", deviceSecret: "dev-secret" }));
    server["/v1/auth/storyforge/profile"] = (body) => json(200, sessionBody(body.userId));
    const done = vi.fn();
    render(<SignInSheet who="keen" users={USERS} onDone={done} onCancel={() => {}} />);
    await waitFor(() => expect(done).toHaveBeenCalled());
    const call = calls.find((c) => c.url.endsWith("/v1/auth/storyforge/profile"));
    expect(call.body).toMatchObject({ userId: "keen", deviceId: "dev-1" });
    expect(call.body.pin).toBeUndefined();
    expect(auth.currentSession().userId).toBe("keen");
  });

  it("Keen on a new device needs a grown-up to set it up first", async () => {
    server["/v1/auth/storyforge/device"] = () => json(200, { ...sessionBody("adele"), deviceId: "dev-2", deviceSecret: "s2" });
    server["/v1/auth/storyforge/profile"] = (body) => json(200, sessionBody(body.userId));
    const done = vi.fn();
    render(<SignInSheet who="keen" users={USERS} onDone={done} onCancel={() => {}} />);
    expect(screen.getByText("A grown-up needs to set up this device")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Adele" }));
    fireEvent.change(screen.getByLabelText("Adele's PIN"), { target: { value: "7788" } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(done).toHaveBeenCalled());
    // The device was set up by Adele, and the session left on it is Keen's.
    expect(calls.find((c) => c.url.endsWith("/device")).body).toMatchObject({ userId: "adele", pin: "7788" });
    expect(auth.currentSession().userId).toBe("keen");
  });
});

// ---------------------------------------------------------------------------
// RU-09: Keen ticks "Jonathan" in the picker
// ---------------------------------------------------------------------------

describe("the reader picker", () => {
  function mountPicker() {
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <main.AppProvider>
          <Routes>
            <Route path="/" element={<main.ReaderPicker />} />
            <Route path="/universes" element={<div>LIBRARY</div>} />
          </Routes>
        </main.AppProvider>
      </MemoryRouter>
    );
  }

  it("Keen, signed in, ticking Jonathan gets a PIN prompt -- not Jonathan's library", async () => {
    localStorage.setItem("otherwise_device", JSON.stringify({ deviceId: "dev-1", deviceSecret: "dev-secret" }));
    localStorage.setItem("otherwise_session", JSON.stringify(sessionBody("keen")));
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["keen"]));
    server["/v1/execute"] = () => json(200, { ok: true, users: USERS });
    mountPicker();
    fireEvent.click(await screen.findByText("Keen"));      // untick Keen
    fireEvent.click(screen.getByText("Jonathan"));          // tick Jonathan
    fireEvent.click(screen.getByText("Reading as Jonathan"));
    expect(await screen.findByLabelText("Jonathan's PIN")).toBeTruthy();
    expect(screen.queryByText("LIBRARY")).toBeNull();
    expect(JSON.parse(localStorage.getItem("storyforge_reading_group"))).toEqual(["keen"]);
  });

  it("Keen with his own session goes straight to his library", async () => {
    localStorage.setItem("otherwise_session", JSON.stringify(sessionBody("keen")));
    localStorage.setItem("storyforge_reading_group", JSON.stringify(["keen"]));
    server["/v1/execute"] = () => json(200, { ok: true, users: USERS });
    mountPicker();
    fireEvent.click(await screen.findByText("Reading as Keen"));
    expect(await screen.findByText("LIBRARY")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Otherwise r2 O2-08 / O2-07: a set-up code, and a lock that is this device's
// ---------------------------------------------------------------------------

describe("setting up with a code (O2-08)", () => {
  it("the set-up sheet offers a code, and a code sets the device up for Keen", async () => {
    server["/v1/auth/storyforge/device"] = (body) => json(200, { ...sessionBody("keen"), deviceId: "dev-9", deviceSecret: "s9" });
    const done = vi.fn();
    render(<SignInSheet who="keen" users={USERS} onDone={done} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Set up with a code"));
    fireEvent.change(screen.getByLabelText("Set-up code"), { target: { value: "bcdf ghjk" } });
    expect(screen.getByLabelText("Set-up code").value).toBe("BCDF-GHJK");
    fireEvent.click(screen.getByText("Set up this device"));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const enroll = calls.find((c) => c.url.endsWith("/v1/auth/storyforge/device"));
    expect(enroll.body.enrollmentCode).toBe("BCDF-GHJK");
    expect(enroll.body.pin).toBeUndefined();
    expect(auth.isDeviceEnrolled()).toBe(true);
  });

  it("a grown-up on a new device can use a code too; a bad code says so", async () => {
    server["/v1/auth/storyforge/device"] = () => json(403, { ok: false, error: "ENROLLMENT_CODE_INVALID" });
    render(<SignInSheet who="jonathan" users={USERS} onDone={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Set up with a code"));
    fireEvent.change(screen.getByLabelText("Set-up code"), { target: { value: "BCDFGHJK" } });
    fireEvent.click(screen.getByText("Set up this device"));
    await screen.findByText("That code didn't work. Ask Jonathan for a new one.");
  });

  it("Escape closes the sheet (O-31)", () => {
    const cancel = vi.fn();
    render(<SignInSheet who="jonathan" users={USERS} onDone={() => {}} onCancel={cancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });

  it("formats whatever was typed into the server's shape", async () => {
    const { formatSetupCode } = await import("../src/SignIn.jsx");
    expect(formatSetupCode("bcdf-ghjk")).toBe("BCDF-GHJK");
    expect(formatSetupCode(" b c d f g h j k z")).toBe("BCDF-GHJK");
    expect(formatSetupCode("bcd")).toBe("BCD");
  });
});

describe("a PIN lock is this device's, and says what to do (O2-07)", () => {
  it("locked and paused are told apart, and both point at a set-up code", () => {
    expect(auth.signInMessage("PIN_LOCKED")).toMatch(/on this device/);
    expect(auth.signInMessage("PIN_LOCKED")).toMatch(/set-up code/);
    expect(auth.signInMessage("PIN_SETUP_CLOSED")).toMatch(/set-up code/);
  });
});
