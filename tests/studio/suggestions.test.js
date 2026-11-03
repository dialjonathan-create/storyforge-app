import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { MANUSCRIPT_EXTENSIONS } from "../../src/studio/schema.js";
import { markdownToDoc, docToMarkdown } from "../../src/studio/manuscriptMarkdown.js";
import { applyAbilityOps, convertToSuggestion, listSuggestions, resolveSuggestions, suggestionAttrs } from "../../src/studio/suggestions.js";

const schema = getSchema(MANUSCRIPT_EXTENSIONS);
const ME = suggestionAttrs({ author: "jonathan" });

function stateOf(md) {
  return EditorState.create({ schema, doc: schema.nodeFromJSON(markdownToDoc(md)) });
}
const md = (state, view = "base") => docToMarkdown(state.doc.toJSON(), { view });
function textPos(state, needle) {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text.includes(needle)) found = pos + node.text.indexOf(needle);
  });
  return found;
}
function suggest(state, build) {
  const tr = build(state.tr);
  const out = convertToSuggestion(state, tr, ME);
  return out ? state.apply(out) : state;
}

describe("suggesting mode", () => {
  it("typing becomes an insertion; published text unchanged until accepted", () => {
    let s = stateOf("The sea was calm.");
    const at = textPos(s, "calm") + 4;
    s = suggest(s, (tr) => tr.insertText(" and grey", at));
    expect(md(s, "base")).toBe("The sea was calm.");
    expect(md(s, "accepted")).toBe("The sea was calm and grey.");
    const [one] = listSuggestions(s.doc);
    expect(one.inserted).toBe(" and grey");
    s = s.apply(resolveSuggestions(s, [one.id], "accept"));
    expect(md(s)).toBe("The sea was calm and grey.");
    expect(listSuggestions(s.doc)).toHaveLength(0);
  });

  it("deleting marks the text; reject restores it, accept removes it", () => {
    let s = stateOf("The sea was very calm.");
    const at = textPos(s, "very ");
    s = suggest(s, (tr) => tr.delete(at, at + 5));
    expect(md(s, "base")).toBe("The sea was very calm.");
    expect(md(s, "accepted")).toBe("The sea was calm.");
    const id = listSuggestions(s.doc)[0].id;
    expect(md(s.apply(resolveSuggestions(s, [id], "reject")))).toBe("The sea was very calm.");
    expect(md(s.apply(resolveSuggestions(s, [id], "accept")))).toBe("The sea was calm.");
  });

  it("typing over a selection is one deletion plus one insertion, consecutive keys coalesce", () => {
    let s = stateOf("A red door.");
    const at = textPos(s, "red");
    s = suggest(s, (tr) => tr.insertText("b", at, at + 3));
    const pos = textPos(s, "b");
    s = suggest(s, (tr) => tr.insertText("lue", pos + 1));
    expect(md(s, "accepted")).toBe("A blue door.");
    expect(listSuggestions(s.doc)).toHaveLength(1);
  });

  it("deleting your own suggested text removes it for real", () => {
    let s = stateOf("Hello.");
    s = suggest(s, (tr) => tr.insertText(" there", textPos(s, ".")));
    const p = textPos(s, " there");
    s = suggest(s, (tr) => tr.delete(p, p + 6));
    expect(md(s, "accepted")).toBe("Hello.");
    expect(listSuggestions(s.doc)).toHaveLength(0);
  });

  it("Enter is a suggested split; rejecting it joins the paragraph again", () => {
    let s = stateOf("First half. Second half.");
    const at = textPos(s, "Second");
    s = suggest(s, (tr) => tr.split(at));
    expect(md(s, "base")).toBe("First half. Second half.");
    expect(md(s, "accepted")).toBe("First half. \n\nSecond half.");
    const id = listSuggestions(s.doc)[0].id;
    expect(md(s.apply(resolveSuggestions(s, [id], "reject")))).toBe("First half. Second half.");
  });

  it("Backspace at a paragraph start is a suggested join", () => {
    let s = stateOf("One.\n\nTwo.");
    const second = textPos(s, "Two");
    s = suggest(s, (tr) => tr.delete(second - 2, second));
    expect(md(s, "base")).toBe("One.\n\nTwo.");
    const id = listSuggestions(s.doc)[0].id;
    expect(md(s.apply(resolveSuggestions(s, [id], "accept")))).toBe("One.Two.");
    expect(md(s.apply(resolveSuggestions(s, [id], "reject")))).toBe("One.\n\nTwo.");
  });

  it("formatting cannot strip a suggestion mark", () => {
    let s = stateOf("Hello.");
    s = suggest(s, (tr) => tr.insertText("!", textPos(s, ".")));
    const before = listSuggestions(s.doc).length;
    s = suggest(s, (tr) => tr.removeMark(0, s.doc.content.size, schema.marks.insertion));
    expect(listSuggestions(s.doc).length).toBe(before);
  });
});

describe("Ability's operations (client fallback)", () => {
  it("lands a replace as Ability's suggestion, asked by the person", () => {
    const s = stateOf("Sable looked at the sea for a very long time.");
    const pid = s.doc.firstChild.attrs.pid;
    const { tr, applied } = applyAbilityOps(s, [{ op: "replace", pid, quote: "for a very long time", text: "a long while" }], { requestedBy: "jonathan" });
    const next = s.apply(tr);
    expect(applied).toHaveLength(1);
    expect(md(next, "base")).toBe("Sable looked at the sea for a very long time.");
    expect(md(next, "accepted")).toBe("Sable looked at the sea a long while.");
    const [sg] = listSuggestions(next.doc);
    expect(sg.attrs).toMatchObject({ author: "ability", authorKind: "ability", requestedBy: "jonathan" });
  });

  it("turns an edit whose quote has changed into a comment, never applies it blind", () => {
    const s = stateOf("The text is different now.");
    const pid = s.doc.firstChild.attrs.pid;
    const { tr, applied, comments } = applyAbilityOps(s, [{ op: "replace", pid, quote: "was here", text: "is" }]);
    expect(applied).toHaveLength(0);
    expect(tr.docChanged).toBe(false);
    expect(comments[0]).toMatchObject({ stale: true, pid });
  });

  it("continues after a paragraph as suggested new paragraphs; reject removes them whole", () => {
    const s = stateOf("Chapter end.");
    const pid = s.doc.firstChild.attrs.pid;
    const { tr, batchId } = applyAbilityOps(s, [{ op: "insert_after", pid, text: "New one.\n\nNew two." }]);
    const next = s.apply(tr);
    expect(md(next, "base")).toBe("Chapter end.");
    expect(md(next, "accepted")).toBe("Chapter end.\n\nNew one.\n\nNew two.");
    const rejected = next.apply(resolveSuggestions(next, (a) => a.batchId === batchId, "reject"));
    expect(md(rejected, "accepted")).toBe("Chapter end.");
    const accepted = next.apply(resolveSuggestions(next, (a) => a.batchId === batchId, "accept"));
    expect(md(accepted)).toBe("Chapter end.\n\nNew one.\n\nNew two.");
  });

  it("direct mode edits the text straight away", () => {
    const s = stateOf("Grey sky.");
    const pid = s.doc.firstChild.attrs.pid;
    const { tr } = applyAbilityOps(s, [{ op: "replace", pid, quote: "Grey", text: "Pale" }], { mode: "direct" });
    expect(md(s.apply(tr))).toBe("Pale sky.");
  });
});
