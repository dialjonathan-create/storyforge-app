import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { contentSecurityPolicy, studioOrigins } from "../../build/securityHeaders.js";
import { MANUSCRIPT_EXTENSIONS } from "../../src/studio/schema.js";
import { markdownToDoc } from "../../src/studio/manuscriptMarkdown.js";
import { findMatches } from "../../src/studio/FindBar.jsx";
import { parseRange } from "../../src/studio/PrintView.jsx";
import { dbName } from "../../src/studio/sync.js";

const schema = getSchema(MANUSCRIPT_EXTENSIONS);

describe("studio helpers", () => {
  it("lets the page talk to the sync server only when one is configured", () => {
    expect(studioOrigins("")).toEqual([]);
    expect(studioOrigins("http://insecure.example")).toEqual([]);
    expect(studioOrigins("https://otherwise-studio.example.workers.dev")).toEqual(["https://otherwise-studio.example.workers.dev", "wss://otherwise-studio.example.workers.dev"]);
    expect(contentSecurityPolicy("https://api.example", "https://sync.example")).toContain("connect-src 'self' https://api.example https://kokoro.abilityai.systems https://sync.example wss://sync.example");
  });

  it("keeps each person's drafts in their own on-device store", () => {
    expect(dbName("Jonathan", "u:s:1")).toBe("otherwise-studio:jonathan:u:s:1");
  });

  it("finds text with case and whole-word options, skipping pending deletions", () => {
    const doc = schema.nodeFromJSON(markdownToDoc("The sea, the Sea, theSea."));
    expect(findMatches(doc, "sea").length).toBe(3);
    expect(findMatches(doc, "Sea", { caseSensitive: true }).length).toBe(2);
    expect(findMatches(doc, "sea", { wholeWord: true }).length).toBe(2);
  });

  it("reads print ranges", () => {
    expect(parseRange("1-3, 5", [1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 5]);
    expect(parseRange("all", [1, 2])).toEqual([1, 2]);
    expect(parseRange("9", [1, 2])).toEqual([]);
  });
});
