// A deploy you cannot verify is a deploy you cannot trust. 2026-09-18: this
// service published no git sha, so yesterday's audit could only confirm what
// was live by reading a Cloud Run image tag with gcloud.
import { describe, expect, it } from "vitest";
import { versionJson } from "../build/versionJson.js";

function emitted(plugin) {
  const files = [];
  plugin.generateBundle.call({ emitFile: (f) => files.push(f) }, {}, {});
  return files;
}

describe("version.json", () => {
  it("writes the sha the build was given", () => {
    const [file] = emitted(versionJson("1681e5e", "2026-09-18T00:00:00.000Z"));
    expect(file.fileName).toBe("version.json");
    expect(JSON.parse(file.source)).toEqual({
      service: "storyforge-app",
      gitSha: "1681e5e",
      builtAt: "2026-09-18T00:00:00.000Z",
    });
  });

  it("says unknown rather than pretending, when no sha was supplied", () => {
    const [file] = emitted(versionJson("", "2026-09-18T00:00:00.000Z"));
    expect(JSON.parse(file.source).gitSha).toBe("unknown");
    const [blank] = emitted(versionJson("   ", "2026-09-18T00:00:00.000Z"));
    expect(JSON.parse(blank.source).gitSha).toBe("unknown");
  });

  it("only runs on build, never on the dev server", () => {
    expect(versionJson().apply).toBe("build");
  });
});
