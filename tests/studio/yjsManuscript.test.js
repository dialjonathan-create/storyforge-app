// Spike 1 (spec §6.2): Ability's edits applied HEADLESSLY to the Y.Doc -- no
// ProseMirror, no browser -- arrive in the editor as ordinary suggestions.
// y-prosemirror is the editor's own binding; agreeing with it byte for byte is the proof.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { MANUSCRIPT_EXTENSIONS } from "../../src/studio/schema.js";
import { blockPlainText, docToMarkdown, markdownToDoc } from "../../src/studio/manuscriptMarkdown.js";
import { listSuggestions, resolveSuggestions } from "../../src/studio/suggestions.js";
import { applyOpsToYDoc, applyOutsideChange, FRAGMENT, writeDocToFragment, yFragmentToDoc } from "../../src/studio/yjsManuscript.js";

const schema = getSchema(MANUSCRIPT_EXTENSIONS);
const PROSE = "# Chapter 12\n\nSable stood at the rail for a very long time.<!-- pause --> The sea was *grey*.\n\n* * *\n\n“Verath,” she said. **Nobody** answered.";

function editorView(ydoc) {
  // What the editor would show: y-prosemirror's own reading of the Y.Doc.
  const json = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(FRAGMENT));
  return EditorState.create({ schema, doc: schema.nodeFromJSON(json) });
}

describe("the Y.Doc encoding matches y-prosemirror", () => {
  it("writeDocToFragment == prosemirrorJSONToYDoc", () => {
    const doc = schema.nodeFromJSON(markdownToDoc(PROSE)).toJSON();
    const ours = new Y.Doc();
    writeDocToFragment(ours.getXmlFragment(FRAGMENT), doc);
    const theirs = prosemirrorJSONToYDoc(schema, doc, FRAGMENT);
    expect(yXmlFragmentToProsemirrorJSON(ours.getXmlFragment(FRAGMENT))).toEqual(yXmlFragmentToProsemirrorJSON(theirs.getXmlFragment(FRAGMENT)));
  });

  it("yFragmentToDoc reads what y-prosemirror wrote, and round-trips the prose", () => {
    const doc = schema.nodeFromJSON(markdownToDoc(PROSE)).toJSON();
    const ydoc = prosemirrorJSONToYDoc(schema, doc, FRAGMENT);
    expect(docToMarkdown(yFragmentToDoc(ydoc.getXmlFragment(FRAGMENT)))).toBe(PROSE);
  });
});

describe("headless application", () => {
  function seeded() {
    const ydoc = new Y.Doc();
    writeDocToFragment(ydoc.getXmlFragment(FRAGMENT), schema.nodeFromJSON(markdownToDoc(PROSE)).toJSON());
    return ydoc;
  }
  const pidOf = (ydoc, n) => ydoc.getXmlFragment(FRAGMENT).get(n).getAttribute("pid");

  it("a replace arrives in the editor as Ability's suggestion; accept + publish gives the new text", () => {
    const ydoc = seeded();
    const res = applyOpsToYDoc(ydoc, [{ op: "replace", pid: pidOf(ydoc, 1), quote: "for a very long time", text: "a long while" }], { requestedBy: "jonathan" });
    expect(res.applied).toHaveLength(1);
    const state = editorView(ydoc);
    const [s] = listSuggestions(state.doc);
    expect(s.attrs).toMatchObject({ authorKind: "ability", requestedBy: "jonathan" });
    expect(docToMarkdown(state.doc.toJSON(), { view: "base" })).toBe(PROSE);
    const accepted = state.apply(resolveSuggestions(state, [s.id], "accept"));
    expect(docToMarkdown(accepted.doc.toJSON())).toBe(PROSE.replace("for a very long time", "a long while"));
  });

  it("keeps the surrounding formatting and writes formatted text", () => {
    const ydoc = seeded();
    applyOpsToYDoc(ydoc, [{ op: "replace", pid: pidOf(ydoc, 3), quote: "answered", text: "*ever* answered" }], { mode: "direct" });
    expect(docToMarkdown(yFragmentToDoc(ydoc.getXmlFragment(FRAGMENT)))).toContain("**Nobody** *ever* answered.");
  });

  it("a quote that is gone becomes a comment, never a blind edit", () => {
    const ydoc = seeded();
    const res = applyOpsToYDoc(ydoc, [{ op: "replace", pid: pidOf(ydoc, 1), quote: "words that are not there", text: "x" }]);
    expect(res.applied).toHaveLength(0);
    expect(res.comments[0].stale).toBe(true);
    expect(ydoc.getMap("comments").size).toBe(1);
    expect(docToMarkdown(yFragmentToDoc(ydoc.getXmlFragment(FRAGMENT)), { view: "accepted" })).toBe(PROSE);
  });

  it("insert_after adds whole suggested paragraphs that reject removes", () => {
    const ydoc = seeded();
    const res = applyOpsToYDoc(ydoc, [{ op: "insert_after", pid: pidOf(ydoc, 3), text: "She turned.\n\nThe ship turned with her." }]);
    const state = editorView(ydoc);
    expect(docToMarkdown(state.doc.toJSON(), { view: "accepted" })).toBe(`${PROSE}\n\nShe turned.\n\nThe ship turned with her.`);
    const rejected = state.apply(resolveSuggestions(state, (a) => a.batchId === res.batchId, "reject"));
    expect(docToMarkdown(rejected.doc.toJSON(), { view: "accepted" })).toBe(PROSE);
  });

  it("concurrent typing and Ability's batch converge on two replicas", () => {
    const a = seeded();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyOpsToYDoc(a, [{ op: "replace", pid: pidOf(a, 1), quote: "very long", text: "long" }]);
    const t = b.getXmlFragment(FRAGMENT).get(3).get(0);
    t.insert(0, "Then ");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(yFragmentToDoc(a.getXmlFragment(FRAGMENT))).toEqual(yFragmentToDoc(b.getXmlFragment(FRAGMENT)));
  });
});

describe("outside changes arrive as suggestions", () => {
  it("edits a paragraph the draft still has as published; comments on one it changed", () => {
    const published = "The sea was grey.\n\nSable waited.\n\nThe end.";
    const ydoc = new Y.Doc();
    writeDocToFragment(ydoc.getXmlFragment(FRAGMENT), markdownToDoc(published));
    // The writer changed paragraph 2 in the draft.
    const p2 = ydoc.getXmlFragment(FRAGMENT).get(1).get(0);
    p2.insert(p2.length - 1, " and waited");
    const reshaped = "The sea was silver.\n\nSable was gone.\n\nThe end.";
    const res = applyOutsideChange(ydoc, markdownToDoc(published), markdownToDoc(reshaped), { source: "Changed in the reader, 3 Nov", plain: blockPlainText });
    expect(res.commented).toBe(1);
    const state = editorView(ydoc);
    const out = listSuggestions(state.doc);
    expect(out.every((s) => s.attrs.authorKind === "outside")).toBe(true);
    expect(docToMarkdown(state.doc.toJSON(), { view: "accepted" })).toBe("The sea was silver.\n\nSable waited and waited.\n\nThe end.");
  });
});
