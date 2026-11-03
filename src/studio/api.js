// The studio's calls to the story server. Every request is signed by the signed-in
// person's session (the fetch wrapper in ../auth.js); the server stamps who is asking.
import { currentSession } from "../auth.js";

export const ABILITY_URL = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ABILITY_URL)
  || "https://ability-supervisor-service-818269465014.us-central1.run.app";

export class StudioError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "StudioError";
    Object.assign(this, extra);
  }
}

/** Call one capability. Throws StudioError with a sentence a person can read. */
export async function call(command, args = {}) {
  let response;
  try {
    response = await fetch(`${ABILITY_URL}/v1/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, args: { tenantId: "core", ...args } }),
    });
  } catch {
    throw new StudioError("Couldn't reach the story server.", { network: true });
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new StudioError("Your sign-in ran out.", { status: 401, signedOut: true });
  if (!response.ok || data.ok === false) {
    const technical = !data.message || /invocationId|capability|\.v1\b|[{}]/.test(String(data.message));
    throw new StudioError(technical ? "That didn't work. Try again in a minute." : data.message, {
      status: response.status, code: data.error || "", network: [502, 503, 504].includes(response.status) && !data.message, data,
    });
  }
  return data;
}

export function whoAmI() {
  return currentSession()?.userId || "";
}

export const docIdFor = (universeId, storyId, chapter) => `${universeId}:${storyId}:${Number(chapter)}`;

export function parseDocId(docId) {
  const [u, s, n] = String(docId || "").split(":");
  return u && s && n ? { universeId: u, storyId: s, chapterNumber: Number(n) } : null;
}
