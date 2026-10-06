// Fail the build when a credential is compiled into what browsers download.
//
// Otherwise QA O-01 (2026-10-06): VITE_STORYFORGE_TOKEN -- a bearer token -- was
// inlined into the bundle by Vite (every VITE_* variable is) and served to every
// visitor from 2026-05-18 until this check existed. Nothing failed. Now the
// build does, in two places:
//
//   1. configResolved: any VITE_* variable whose NAME says it is a credential
//      (TOKEN, SECRET, PASSWORD, PRIVATE, API_KEY, BEARER) stops the build
//      before anything is emitted. A VITE_ variable is public by construction.
//   2. generateBundle: the emitted files are scanned for a bearer-looking
//      literal (a 32+ character hex run, or "Bearer " followed by a long
//      token-shaped string) and for the retired variable's name.

const CREDENTIAL_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|API_?KEY|BEARER)/i;
const HEX_RUN = /(?<![0-9a-f])[0-9a-f]{32,}(?![0-9a-f])/i;
const BEARER_LITERAL = /Bearer\s+[A-Za-z0-9._~+/-]{24,}/;
const RETIRED = /VITE_STORYFORGE_TOKEN/;

export function credentialEnvNames(env) {
  return Object.keys(env || {}).filter((k) => k.startsWith("VITE_") && CREDENTIAL_NAME.test(k) && String(env[k] || "").trim());
}

export function findSecretsInText(text) {
  const hits = [];
  const hex = String(text).match(HEX_RUN);
  if (hex) hits.push(`hex run ${hex[0].slice(0, 6)}… (${hex[0].length} chars)`);
  const bearer = String(text).match(BEARER_LITERAL);
  if (bearer) hits.push(`bearer literal ${bearer[0].slice(0, 12)}…`);
  if (RETIRED.test(String(text))) hits.push("the retired VITE_STORYFORGE_TOKEN name");
  return hits;
}

export function checkBundleSecrets() {
  return {
    name: "otherwise-check-bundle-secrets",
    configResolved(config) {
      const names = credentialEnvNames(config.env);
      if (names.length) {
        throw new Error(
          `Refusing to build: ${names.join(", ")} would be compiled into the public bundle. `
          + "A VITE_ variable is readable by every visitor. Readers sign in instead (src/auth.js)."
        );
      }
    },
    generateBundle(_options, bundle) {
      const problems = [];
      for (const [fileName, item] of Object.entries(bundle)) {
        if (!/\.(js|mjs|html|json|webmanifest)$/.test(fileName)) continue;
        const text = item.type === "chunk" ? item.code : String(item.source || "");
        for (const hit of findSecretsInText(text)) problems.push(`${fileName}: ${hit}`);
      }
      if (problems.length) {
        this.error(`Possible credential in the emitted bundle:\n  ${problems.join("\n  ")}`);
      }
    },
  };
}
