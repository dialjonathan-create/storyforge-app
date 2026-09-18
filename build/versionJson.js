// 2026-09-18: storyforge-app published no git sha at all, so "is what is
// deployed the same as main?" could only be answered by reading a Cloud Run
// image tag with gcloud. The supervisor has answered it at /health since day
// one. `pack build --env VITE_GIT_SHA=$SHORT_SHA` (cloudbuild.yaml) supplies
// the value; a build with no sha says "unknown" rather than pretending.
//
// Its own module, not vite.config.js: importing the config into a jsdom test
// drags esbuild in with it, and esbuild refuses to load there.
export function versionJson(sha = process.env.VITE_GIT_SHA, builtAt = new Date().toISOString()) {
  return {
    name: "storyforge-version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(
          { service: "storyforge-app", gitSha: (sha || "unknown").trim() || "unknown", builtAt },
          null,
          2,
        ),
      });
    },
  };
}
