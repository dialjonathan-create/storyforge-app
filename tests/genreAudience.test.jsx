/**
 * Genre is free text, and nothing in this app may narrow it.
 *
 * The engine already permits anything: `_missing_creation_metadata` checks only
 * that the value is non-empty after `str().strip()`. There is no enum, no
 * allowlist, no validation. Verified live 2026-09-12 against the deployed
 * service (46401a8c): `storyforge.story.metadata.update.v1` accepted the genre
 * "recursive epistolary heist" and round-tripped it unchanged.
 *
 * What was stopping it was two string literals in this file:
 *   universe.create -> genre: "family-adventure"
 *   story.create    -> genre: "family-adventure"
 * and `audienceAge` appearing zero times, which is why both creation flows were
 * returning `story_metadata_unspecified` in production.
 *
 * These tests read the source rather than rendering, deliberately. The thing
 * that must not regress is not a rendered chip — it is that no fixed genre
 * string is ever sent to the engine and that no <select> is introduced. A
 * dropdown would be the only component in the whole stack that narrows what a
 * story may be.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(path.join(HERE, "..", "src", "main.jsx"), "utf8");

/**
 * Comments are stripped before any assertion runs. Two of these tests initially
 * failed against the file's own explanatory comments -- the prose describing
 * why there is no <select> contained the string "<select", and the note
 * recording what the old hardcoded value was contained "family-adventure". A
 * check that a pattern is absent from the CODE must not be satisfiable or
 * defeatable by what the comments say about it.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE = stripComments(RAW);

function callArgs(command) {
  // The object literal passed to execute("<command>", { ... }).
  const start = SOURCE.indexOf(`execute("${command}"`);
  expect(start, `${command} is not called`).toBeGreaterThan(-1);
  const open = SOURCE.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SOURCE.length; i += 1) {
    if (SOURCE[i] === "{") depth += 1;
    if (SOURCE[i] === "}") {
      depth -= 1;
      if (depth === 0) return SOURCE.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${command}`);
}

describe("creation sends what the user chose, not a literal", () => {
  it("universe.create sends no hardcoded genre", () => {
    const args = callArgs("storyforge.universe.create.v1");
    expect(args).not.toMatch(/genre:\s*["'][^"']+["']/);
    expect(args).toMatch(/genre:\s*genreValue/);
  });

  it("story.create sends no hardcoded genre", () => {
    const args = callArgs("storyforge.story.create.v1");
    expect(args).not.toMatch(/genre:\s*["'][^"']+["']/);
    expect(args).toMatch(/genre:\s*genreValue/);
  });

  it("both creation calls send audienceAge, which is why they were refusing", () => {
    expect(callArgs("storyforge.universe.create.v1")).toMatch(/audienceAge:\s*audienceValue/);
    expect(callArgs("storyforge.story.create.v1")).toMatch(/audienceAge:\s*audienceValue/);
  });

  it("the literal family-adventure is gone from the file entirely", () => {
    expect(SOURCE).not.toMatch(/family-adventure/);
  });
});

describe("nothing narrows what a genre may be", () => {
  it("introduces no select element anywhere", () => {
    expect(SOURCE).not.toMatch(/<select/i);
  });

  it("the genre field is an input, and the suggestions are only suggestions", () => {
    expect(SOURCE).toMatch(/GENRE_SUGGESTIONS\s*=\s*\[/);
    // Chips call onChange with their own value; they do not constrain it.
    expect(SOURCE).toMatch(/onClick=\{\(\)\s*=>\s*onChange\(chip\)\}/);
    expect(SOURCE).toMatch(/<input\s[\s\S]*?onChange=\{\(event\)\s*=>\s*onChange\(event\.target\.value\)\}/);
  });

  it("audience is suggested, not enumerated", () => {
    expect(SOURCE).toMatch(/AUDIENCE_SUGGESTIONS\s*=\s*\[/);
    expect(SOURCE).toMatch(/suggestedAudienceForTier/);
  });
});

describe("the display fallback no longer invents a genre", () => {
  it("does not substitute a genre string for a story that has none", () => {
    expect(SOURCE).not.toMatch(/story\.genre\s*\|\|\s*["']family adventure["']/);
  });

  it("says the genre is absent instead", () => {
    expect(SOURCE).toMatch(/story\.genre\s*\|\|\s*["']genre not set["']/);
  });
});

describe("both are editable after creation", () => {
  it("uses storyforge.story.metadata.update.v1", () => {
    const args = callArgs("storyforge.story.metadata.update.v1");
    expect(args).toMatch(/genre:\s*genreValue/);
    expect(args).toMatch(/audienceAge:\s*audienceValue/);
  });

  it("sends only genre and audienceAge, so nothing else can be blanked", () => {
    const args = callArgs("storyforge.story.metadata.update.v1");
    expect(args).not.toMatch(/tagline/);
    expect(args).not.toMatch(/styleDial/);
  });

  it("refuses to send an empty value, because the capability refuses to clear them", () => {
    expect(SOURCE).toMatch(/Genre and audience can be changed but not emptied/);
  });
});
