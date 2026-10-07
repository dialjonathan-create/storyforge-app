// Response headers for the deployed app (Otherwise r3 UI-10, 2026-10-06).
//
// The app is served by `vite preview` (package.json "start", run by the Cloud
// Run buildpack image that cloudbuild.yaml builds), so the headers are set in
// vite.config.js `preview.headers`, which vite applies to every response it
// serves -- index.html, assets, sw.js. Before this the app sent none: any site
// could frame the reader, and nothing limited where a script could send data.
//
// The CSP lists only what the app actually talks to:
//   * the story server (VITE_ABILITY_URL, default the supervisor's run.app URL)
//     for /v1/execute, sign-in, chapter status, narration and voices;
//   * the legacy Kokoro host, which kokoro.js still falls back to when an older
//     story server has no narration route (404);
//   * chapter images, stored in Cloud Storage / Firebase Storage
//     (story_engine._normalize_story_image_url);
//   * Google Fonts (index.html);
//   * blob: for MapLibre's worker and for narration audio (an object URL).
// 'unsafe-inline' is allowed for STYLES only: framer-motion and MapLibre write
// style attributes. No inline or remote script is allowed anywhere.
//
// Its own module, not vite.config.js, so a jsdom test can import it (importing
// the config drags esbuild in, which refuses to load there -- see versionJson).

export const DEFAULT_ABILITY_URL = "https://ability-supervisor-service-818269465014.us-central1.run.app";
export const LEGACY_KOKORO_ORIGIN = "https://kokoro.abilityai.systems";
export const IMAGE_ORIGINS = ["https://storage.googleapis.com", "https://firebasestorage.googleapis.com"];

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function contentSecurityPolicy(abilityUrl = process.env.VITE_ABILITY_URL || DEFAULT_ABILITY_URL) {
  const api = originOf(abilityUrl) || DEFAULT_ABILITY_URL;
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", api, ...IMAGE_ORIGINS],
    "media-src": ["'self'", "blob:", api],
    "connect-src": ["'self'", api, LEGACY_KOKORO_ORIGIN],
    "worker-src": ["'self'", "blob:"],
    "child-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`).join("; ");
}

export function securityHeaders(abilityUrl) {
  return {
    "Content-Security-Policy": contentSecurityPolicy(abilityUrl),
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}
