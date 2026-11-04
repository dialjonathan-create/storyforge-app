// The studio's manuscript schema as TipTap extensions (spec §3.1).
//
// Deliberately flat and small: a manuscript, not a page layout. Every block carries a
// stable `pid` so Ability's edits and comments can address it, plus the converter's
// whitespace bookkeeping (`gap`, `trail`, `verbatim`) so published prose round-trips
// byte for byte (manuscriptMarkdown.js). Tracked changes are marks (`insertion`,
// `deletion`) and two block attributes (`splitBy`, `joinBy`); see suggestions.js.
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { newPid } from "./manuscriptMarkdown.js";

const json = (value) => (value == null ? null : JSON.stringify(value));
const unjson = (value) => {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
};

/** Attributes every block shares. Only `pid` (and the tracked split/join, for display)
 *  reach the DOM; whitespace bookkeeping stays in the document so a paste never
 *  carries somebody else's gaps. */
function blockAttributes() {
  return {
    pid: { default: null, keepOnSplit: false, parseHTML: (el) => el.getAttribute("data-pid"), renderHTML: (a) => (a.pid ? { "data-pid": a.pid } : {}) },
    gap: { default: null, keepOnSplit: false, rendered: false },
    trail: { default: "", keepOnSplit: false, rendered: false },
    verbatim: { default: false, keepOnSplit: true, rendered: false },
    splitBy: {
      default: null,
      keepOnSplit: false,
      parseHTML: () => null,
      renderHTML: (a) => (a.splitBy ? { "data-split": json(a.splitBy), class: `sg-split ${a.splitBy.authorKind === "ability" ? "sg-ability" : ""}` } : {}),
    },
    joinBy: {
      default: null,
      keepOnSplit: false,
      parseHTML: () => null,
      renderHTML: (a) => (a.joinBy ? { "data-join": json(a.joinBy), class: "sg-join" } : {}),
    },
    removeBy: { default: null, keepOnSplit: false, parseHTML: () => null, renderHTML: (a) => (a.removeBy ? { class: "sg-remove" } : {}) },
  };
}

export const Doc = Node.create({ name: "doc", topNode: true, content: "block+" });
export const Text = Node.create({ name: "text", group: "inline" });

export const Paragraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  priority: 1000,
  addAttributes: blockAttributes,
  parseHTML: () => [{ tag: "p" }, { tag: "div.ms-p" }],
  renderHTML: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
  addKeyboardShortcuts() {
    return { "Mod-Alt-0": () => this.editor.commands.setNode("paragraph") };
  },
});

export const Heading = Node.create({
  name: "heading",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return { ...blockAttributes(), level: { default: 2, rendered: false } };
  },
  parseHTML: () => [1, 2, 3].map((level) => ({ tag: `h${level}`, attrs: { level } })),
  renderHTML: ({ node, HTMLAttributes }) => [`h${Math.min(3, Math.max(1, node.attrs.level || 2))}`, HTMLAttributes, 0],
  addKeyboardShortcuts() {
    return Object.fromEntries([1, 2, 3].map((level) => [`Mod-Alt-${level}`, () => this.editor.commands.toggleNode("heading", "paragraph", { level })]));
  },
});

export const Blockquote = Node.create({
  name: "blockquote",
  group: "block",
  content: "inline*",
  addAttributes() {
    return { ...blockAttributes(), prefix: { default: "> ", rendered: false } };
  },
  parseHTML: () => [{ tag: "blockquote" }],
  renderHTML: ({ HTMLAttributes }) => ["blockquote", HTMLAttributes, 0],
});

export const ListItem = Node.create({
  name: "listItem",
  group: "block",
  content: "inline*",
  addAttributes() {
    return {
      ...blockAttributes(),
      marker: { default: "- ", keepOnSplit: true, parseHTML: (el) => el.getAttribute("data-marker") || "- ", renderHTML: (a) => ({ "data-marker": a.marker }) },
    };
  },
  parseHTML: () => [{ tag: "li" }, { tag: "div.ms-li" }],
  renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: `ms-li ${/^\d/.test(node.attrs.marker || "") ? "ms-ol" : "ms-ul"}` }), 0],
});

export const SceneBreak = Node.create({
  name: "sceneBreak",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { ...blockAttributes(), marker: { default: "* * *", rendered: false } };
  },
  parseHTML: () => [{ tag: "hr" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "ms-scene", "aria-label": "Scene break", role: "separator", contenteditable: "false" }), ["span", {}, "⁂"]],
  addCommands() {
    return {
      insertSceneBreak: () => ({ commands }) => commands.insertContent({ type: "sceneBreak" }),
    };
  },
  addInputRules() {
    return [{
      find: /^(\*\*\*|\* \* \*)$/,
      handler: ({ state, range }) => {
        const $from = state.doc.resolve(range.from);
        state.tr.replaceRangeWith($from.before(), $from.after(), this.type.create());
      },
    }];
  },
});

export const HardBreak = Node.create({
  name: "hardBreak",
  inline: true,
  group: "inline",
  selectable: false,
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.insertContent({ type: "hardBreak" }) };
  },
});

/** The narrator's directions (`<!-- pause -->`): a small chip in the text, never
 *  read as prose, kept byte for byte. */
export const AudioCue = Node.create({
  name: "audioCue",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: " pause ", parseHTML: (el) => el.getAttribute("data-raw") || "", renderHTML: (a) => ({ "data-raw": a.raw }) } };
  },
  parseHTML: () => [{ tag: "span.ms-cue" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { class: "ms-cue", contenteditable: "false", title: "Narration cue (not printed or read as text)", "aria-label": `Narration cue: ${String(node.attrs.raw || "").trim()}` }),
    `♪ ${String(node.attrs.raw || "").trim()}`,
  ],
});

/** Text the converter could not interpret is kept verbatim inside an ordinary
 *  paragraph (attribute `verbatim`), so it is editable and never dropped. */

const markWithDelimiter = (name, tag, defaultD, shortcut) => Mark.create({
  name,
  addAttributes: () => ({ d: { default: defaultD, rendered: false } }),
  parseHTML: () => [{ tag }],
  renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
  addKeyboardShortcuts() {
    return { [shortcut]: () => this.editor.commands.toggleMark(name) };
  },
});

export const Bold = markWithDelimiter("bold", "strong", "**", "Mod-b");
export const Italic = markWithDelimiter("italic", "em", "*", "Mod-i");
export const Strike = Mark.create({
  name: "strike",
  parseHTML: () => [{ tag: "s" }, { tag: "del:not(.sg-del)" }],
  renderHTML: ({ HTMLAttributes }) => ["s", HTMLAttributes, 0],
  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleMark("strike") };
  },
});
export const Underline = Mark.create({
  name: "underline",
  parseHTML: () => [{ tag: "u" }],
  renderHTML: ({ HTMLAttributes }) => ["u", HTMLAttributes, 0],
  addKeyboardShortcuts() {
    return { "Mod-u": () => this.editor.commands.toggleMark("underline") };
  },
});
export const Link = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes: () => ({ href: { default: "" } }),
  parseHTML: () => [{ tag: "a[href]", getAttrs: (el) => ({ href: el.getAttribute("href") }) }],
  // Never navigates from inside the editor; rel/target only matter in exports.
  renderHTML: ({ HTMLAttributes }) => ["a", mergeAttributes(HTMLAttributes, { rel: "noopener noreferrer nofollow" }), 0],
});

const suggestionAttrs = () => ({
  id: { default: null },
  author: { default: null },
  authorKind: { default: "person" },
  requestedBy: { default: null },
  createdAt: { default: null },
  batchId: { default: null },
});

export const Insertion = Mark.create({
  name: "insertion",
  inclusive: false,
  excludes: "insertion deletion",
  addAttributes: suggestionAttrs,
  parseHTML: () => [{ tag: "ins.sg-ins", getAttrs: (el) => unjson(el.getAttribute("data-s")) || {} }],
  renderHTML: ({ mark }) => ["ins", {
    class: `sg-ins ${mark.attrs.authorKind === "ability" ? "sg-ability" : mark.attrs.authorKind === "outside" ? "sg-outside" : ""}`,
    "data-sid": mark.attrs.id,
    "data-s": json(mark.attrs),
    title: suggestionTitle(mark.attrs, "Added"),
  }, 0],
});

export const Deletion = Mark.create({
  name: "deletion",
  inclusive: false,
  excludes: "insertion deletion",
  addAttributes: suggestionAttrs,
  parseHTML: () => [{ tag: "del.sg-del", getAttrs: (el) => unjson(el.getAttribute("data-s")) || {} }],
  renderHTML: ({ mark }) => ["del", {
    class: `sg-del ${mark.attrs.authorKind === "ability" ? "sg-ability" : mark.attrs.authorKind === "outside" ? "sg-outside" : ""}`,
    "data-sid": mark.attrs.id,
    "data-s": json(mark.attrs),
    title: suggestionTitle(mark.attrs, "Removed"),
  }, 0],
});

// One comment mark per run of text (not overlapping): y-prosemirror stores an
// overlapping mark under a hashed key, which the worker would have to reproduce.
export const Comment = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: "span.ms-comment", getAttrs: (el) => ({ id: el.getAttribute("data-cid") }) }],
  renderHTML: ({ mark }) => ["span", { class: "ms-comment", "data-cid": mark.attrs.id }, 0],
});

export function authorLabel(attrs) {
  if (!attrs) return "Someone";
  if (attrs.authorKind === "ability") return attrs.requestedBy ? `Ability, asked by ${cap(attrs.requestedBy)}` : "Ability";
  if (attrs.authorKind === "outside") return attrs.author || "Changed elsewhere";
  return cap(attrs.author || "Someone");
}
function cap(s) {
  const t = String(s || "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
function suggestionTitle(attrs, verb) {
  return `${verb} by ${authorLabel(attrs)}`;
}

/** Every block has a unique pid: new blocks get one, a copied pid is replaced. */
export const UniquePids = Extension.create({
  name: "uniquePids",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("uniquePids"),
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some((t) => t.docChanged)) return null;
        const seen = new Set();
        const tr = state.tr;
        state.doc.forEach((node, offset) => {
          const pid = node.attrs?.pid;
          if (!pid || seen.has(pid)) tr.setNodeMarkup(offset, undefined, { ...node.attrs, pid: newPid() });
          else seen.add(pid);
        });
        if (!tr.docChanged) return null;
        tr.setMeta("addToHistory", false).setMeta("pidFix", true);
        return tr;
      },
    })];
  },
});

export const MANUSCRIPT_EXTENSIONS = [
  Doc, Text, Paragraph, Heading, Blockquote, ListItem, SceneBreak, HardBreak, AudioCue,
  Bold, Italic, Strike, Underline, Link, Insertion, Deletion, Comment, UniquePids,
];
