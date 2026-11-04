// One chapter open in the studio: binder | manuscript | chat (spec §2.1).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { ySyncPluginKey } from "y-prosemirror";
import { SIGNED_OUT_EVENT, currentSession, isChildProfile } from "../auth.js";
import { call, whoAmI } from "./api.js";
import { MANUSCRIPT_EXTENSIONS, authorLabel } from "./schema.js";
import { blockPlainText, countWords, docPlainText, docToMarkdown, markdownToDoc, pendingSuggestions, textHash } from "./manuscriptMarkdown.js";
import { applyAbilityOps, convertToSuggestion, listSuggestions, resolveSuggestions, suggestionAttrs } from "./suggestions.js";
import { applyOutsideChange, encodeState, FRAGMENT, writeDocToFragment, base64ToBytes, yFragmentToDoc } from "./yjsManuscript.js";
import { StudioSync, claimStudioData } from "./sync.js";
import ChatPanel from "./ChatPanel.jsx";
import ReviewPanel from "./ReviewPanel.jsx";
import HistoryDrawer from "./HistoryDrawer.jsx";
import ShareDialog from "./ShareDialog.jsx";
import PinResume from "./PinResume.jsx";
import FindBar from "./FindBar.jsx";
import PrintDialog from "./PrintDialog.jsx";
import Binder from "./Binder.jsx";

const CHECKPOINT_EVERY_MS = 60_000;
const KEEPALIVE_MS = 10 * 60 * 1000;
const RANK = { read: 1, suggest: 2, edit: 3, owner: 4 };
const MODE_LABEL = { editing: "Editing", suggesting: "Suggesting", viewing: "Viewing" };
const COLORS = ["#2f6f86", "#8a5a12", "#5b6b2f", "#7a3d5c"];

function prefs() {
  try { return JSON.parse(localStorage.getItem("otherwise_studio_prefs") || "{}"); } catch { return {}; }
}
function savePrefs(next) {
  try { localStorage.setItem("otherwise_studio_prefs", JSON.stringify(next)); } catch { /* private mode */ }
}

/** The blocks the model reads: [{pid, type, text}] (what reads now: pending deletions out). */
export function draftBlocks(doc) {
  return (doc?.content || []).map((b) => ({ pid: b.attrs?.pid, type: b.type, text: blockPlainText(b, "accepted") }));
}

/** Pids + quote of the current selection (the model's handle on what the writer means). */
function selectionInfo(editor) {
  if (!editor) return null;
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    const $pos = editor.state.doc.resolve(from);
    const block = $pos.depth >= 1 ? $pos.node(1) : null;
    return block?.attrs?.pid ? { pids: [block.attrs.pid], quote: "", cursorOnly: true } : null;
  }
  const pids = [];
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.isBlock && node.attrs?.pid) pids.push(node.attrs.pid);
    return node.type.name === "doc";
  });
  const quote = editor.state.doc.textBetween(from, to, "\n\n").slice(0, 6000);
  return { pids, quote };
}

export default function Workspace({ universeId, storyId, chapterNumber, settings, setSettings }) {
  const nav = useNavigate();
  // Who is writing is fixed for this page: a lapsed session must still say whose PIN to ask for.
  const [me] = useState(() => whoAmI());
  const docId = `${universeId}:${storyId}:${chapterNumber}`;
  const [opened, setOpened] = useState(null);
  const [openError, setOpenError] = useState("");
  const [status, setStatus] = useState({ mode: "local", connected: false });
  const [signedOut, setSignedOut] = useState(!currentSession());
  const [mode, setMode] = useState("editing");
  const [panel, setPanel] = useState("chat");
  const [drawer, setDrawer] = useState(null); // history | share | print
  const [findOpen, setFindOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [saveState, setSaveState] = useState({ state: "saved", at: null });
  const [publishState, setPublishState] = useState(null);
  const [tick, setTick] = useState(0);
  const [binderOpen, setBinderOpen] = useState(() => prefs().binder !== false);
  const [chatOpen, setChatOpen] = useState(() => prefs().chat !== false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const ydocRef = useRef(null);
  const syncRef = useRef(null);
  const modeRef = useRef(mode);
  const dirtyRef = useRef(false);
  const sessionStart = useRef(null);
  const lastActivity = useRef(Date.now());
  const editorReady = useRef(false);
  modeRef.current = mode;

  const level = opened?.level || "read";
  const canWrite = RANK[level] >= RANK.suggest && !signedOut;
  const canEdit = RANK[level] >= RANK.edit && !signedOut;
  const child = isChildProfile(me);

  // --- open the document ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setOpened(null);
    setOpenError("");
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    (async () => {
      await claimStudioData(me);
      let res;
      try {
        res = await call("storyforge.studio.doc.open.v1", { docId });
      } catch (error) {
        if (!cancelled) setOpenError(error.signedOut ? "signed_out" : error.message);
        if (error.signedOut) setSignedOut(true);
        return;
      }
      if (cancelled) return;
      const sync = new StudioSync({
        ydoc, docId, syncUrl: res.mode === "live" ? res.syncUrl : null, userId: me,
        keepOffline: !settings.sharedDevice,
        getTicket: () => call("storyforge.studio.ticket.v1", { docId }),
        onStatus: (s) => setStatus({ ...s }),
        onControl: (msg) => {
          if (msg.t === "rejected") setToast({ kind: "warn", text: msg.reason === "read_only" ? "You can read this chapter but not change it." : "Only suggestions are allowed here, so that change wasn't kept." });
          if (msg.t === "saved") setSaveState({ state: "saved", at: msg.at });
          if (msg.t === "ability") setToast({ kind: "ability", text: msg.applied ? "Ability's suggestion is in the text." : "Ability left a note." });
          if (msg.code === "access_changed") setToast({ kind: "warn", text: "Your access to this chapter changed. Reopening…" });
        },
      });
      syncRef.current = sync;
      const loadedLocal = await sync.localLoaded;
      const fragment = ydoc.getXmlFragment(FRAGMENT);
      if (res.mode !== "live" && fragment.length === 0) {
        if (res.seed?.checkpoint?.state) Y.applyUpdate(ydoc, base64ToBytes(res.seed.checkpoint.state), "seed");
        else writeDocToFragment(fragment, markdownToDoc(res.seed?.markdown || ""));
      }
      if (res.outsideChange && !res.outsideChange.mergedBy && res.mode !== "live") {
        applyOutsideChange(ydoc, markdownToDoc(res.outsideChange.oldProse), markdownToDoc(res.outsideChange.newProse), {
          source: res.outsideChange.source, plain: blockPlainText,
        });
      }
      if (res.outsideChange) setToast({ kind: "info", text: "This chapter changed outside the studio. Those changes are in the text as suggestions." });
      const meta = ydoc.getMap("meta");
      if (!meta.get("choices") && res.chapter?.choices?.length) meta.set("choices", res.chapter.choices.map((c) => (typeof c === "string" ? c : c.text || "")));
      if (!meta.get("title") && res.chapter?.chapterTitle) meta.set("title", res.chapter.chapterTitle);
      const startMode = (settings.modes || {})[docId] || (RANK[res.level] >= RANK.edit ? "editing" : RANK[res.level] >= RANK.suggest ? "suggesting" : "viewing");
      setMode(RANK[res.level] >= RANK.edit ? startMode : RANK[res.level] >= RANK.suggest ? "suggesting" : "viewing");
      setOpened({ ...res, loadedLocal });
      sync.connect();
    })();
    return () => {
      cancelled = true;
      syncRef.current?.destroy();
      syncRef.current = null;
      ydoc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // --- the editor ---------------------------------------------------------------------
  const suggestMode = useMemo(() => Extension.create({
    name: "suggestMode",
    addKeyboardShortcuts: () => ({
      "Mod-Alt-a": () => { resolveAtCursor("accept"); return true; },
      "Mod-Alt-r": () => { resolveAtCursor("reject"); return true; },
      "Mod-k": () => { setPanel("chat"); setChatOpen(true); setTimeout(() => document.querySelector(".chat-input textarea")?.focus(), 0); return true; },
      "Mod-f": () => { setFindOpen(true); return true; },
      "Mod-/": () => { setChatOpen((v) => !v); return true; },
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const editor = useEditor({
    extensions: opened && ydocRef.current ? [
      ...MANUSCRIPT_EXTENSIONS,
      Collaboration.configure({ document: ydocRef.current, field: FRAGMENT }),
      ...(syncRef.current ? [CollaborationCursor.configure({ provider: { awareness: syncRef.current.awareness }, user: { name: displayName(me), color: COLORS[Math.abs(hashCode(me)) % COLORS.length] } })] : []),
      suggestMode,
    ] : MANUSCRIPT_EXTENSIONS,
    editable: false,
    editorProps: {
      attributes: { class: "ms-page-body", "aria-label": "Manuscript", spellcheck: "true", lang: "en" },
      // Pasted HTML is cleaned to the manuscript schema by ProseMirror's parser; no raw HTML is ever rendered.
      transformPastedHTML: (html) => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ""),
    },
    onUpdate: ({ transaction }) => {
      if (!transaction.getMeta(ySyncPluginKey) && !transaction.getMeta("pidFix") && editorReady.current) {
        dirtyRef.current = true;
        lastActivity.current = Date.now();
        setSaveState((s) => ({ ...s, state: "unsaved" }));
      }
      setTick((t) => t + 1);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      setTick((t) => t + 1);
      if (settings.typewriter) {
        try {
          const coords = ed.view.coordsAtPos(ed.state.selection.head);
          const host = document.querySelector(".ms-scroll");
          if (host) host.scrollBy({ top: coords.top - host.getBoundingClientRect().top - host.clientHeight / 2, behavior: "auto" });
        } catch { /* not laid out yet */ }
      }
    },
  }, [opened?.docId]);

  // Suggesting mode: every edit is converted into its tracked form before it lands.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const original = editor.view.props.dispatchTransaction;
    editor.view.setProps({
      dispatchTransaction: (tr) => {
        const passThrough = !tr.docChanged || modeRef.current !== "suggesting" || tr.getMeta(ySyncPluginKey)
          || tr.getMeta("suggestConverted") || tr.getMeta("pidFix") || tr.getMeta("suggestResolved")
          || tr.getMeta("abilityBatch") || tr.getMeta("restore") || tr.getMeta("y-undo$") || tr.getMeta("addToHistory") === false;
        if (passThrough) return original(tr);
        const converted = convertToSuggestion(editor.state, tr, suggestionAttrs({ author: me, authorKind: "person" }));
        return original(converted || editor.state.tr);
      },
    });
    return () => { if (!editor.isDestroyed) editor.view.setProps({ dispatchTransaction: original }); };
  }, [editor, me]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(Boolean(opened) && canWrite && mode !== "viewing");
  }, [editor, opened, canWrite, mode]);

  // "Words this session" counts from what the chapter held once it finished loading.
  useEffect(() => {
    if (!editor || !opened) return undefined;
    editorReady.current = false;
    const t = setTimeout(() => {
      sessionStart.current = countWords(docPlainText(editor.getJSON(), "accepted"));
      editorReady.current = true;
      setTick((n) => n + 1);
    }, 400);
    return () => clearTimeout(t);
  }, [editor, opened]);

  // --- saving (local mode checkpoints; live mode: the worker does it) -------------------
  const checkpoint = useCallback(async (reason = "auto", name = null) => {
    const ydoc = ydocRef.current;
    if (!ydoc || !opened || RANK[opened.level] < RANK.edit) return null;
    const doc = yFragmentToDoc(ydoc.getXmlFragment(FRAGMENT));
    const markdown = docToMarkdown(doc, { view: "base" });
    setSaveState((s) => ({ ...s, state: "saving" }));
    try {
      const res = await call("storyforge.studio.checkpoint.v1", {
        docId, reason, name, state: encodeState(ydoc), markdown,
        wordCount: countWords(docPlainText(doc, "base")), pending: pendingSuggestions(doc),
      });
      dirtyRef.current = false;
      setSaveState({ state: "saved", at: res.createdAt });
      return res;
    } catch (error) {
      setSaveState((s) => ({ ...s, state: error.network ? "offline" : "error" }));
      if (error.signedOut) setSignedOut(true);
      return null;
    }
  }, [opened, docId]);

  useEffect(() => {
    if (!opened || opened.mode === "live") return undefined;
    const timer = setInterval(() => { if (dirtyRef.current && !signedOut && navigator.onLine !== false) checkpoint("auto"); }, CHECKPOINT_EVERY_MS);
    const away = () => { if (document.visibilityState === "hidden" && dirtyRef.current) checkpoint("idle"); };
    document.addEventListener("visibilitychange", away);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", away); };
  }, [opened, checkpoint, signedOut]);

  // Editing counts as activity: keep the session alive while the writer is writing.
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current < KEEPALIVE_MS && !signedOut) call("storyforge.studio.settings.get.v1", {}).catch(() => {});
    }, KEEPALIVE_MS);
    return () => clearInterval(timer);
  }, [signedOut]);

  // --- signed out / offline ----------------------------------------------------------------
  useEffect(() => {
    const out = () => { setSignedOut(true); syncRef.current?.pause(); };
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener(SIGNED_OUT_EVENT, out);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener(SIGNED_OUT_EVENT, out); window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  const resumed = useCallback(() => {
    setSignedOut(false);
    syncRef.current?.resume();
    if (dirtyRef.current) checkpoint("auto");
  }, [checkpoint]);

  // --- suggestions and Ability's edits -----------------------------------------------------
  const suggestions = useMemo(() => (editor ? listSuggestions(editor.state.doc) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, tick]);

  function resolveAtCursor(action) {
    if (!editor || !canEdit) return;
    const pos = editor.state.selection.from;
    const here = listSuggestions(editor.state.doc).find((s) => s.ins.concat(s.del).some((r) => pos >= r.from && pos <= r.to) || s.blocks.some((b) => pos >= b.pos && pos <= b.pos + b.size));
    if (here) editor.view.dispatch(resolveSuggestions(editor.state, [here.id], action));
  }

  const resolve = useCallback((ids, action) => {
    if (!editor || !canEdit) return;
    editor.view.dispatch(resolveSuggestions(editor.state, ids, action));
  }, [editor, canEdit]);

  const addComments = useCallback((comments) => {
    const map = ydocRef.current?.getMap("comments");
    if (!map || !comments?.length) return;
    ydocRef.current.transact(() => {
      for (const c of comments) {
        map.set(c.id, { ...c, author: c.author || "ability", authorKind: c.authorKind || "ability", requestedBy: c.requestedBy || me, createdAt: c.createdAt || new Date().toISOString(), resolved: false, replies: [] });
      }
    });
  }, [me]);

  /** An AI result: apply it here when the server could not (local mode). */
  const landResult = useCallback((res) => {
    if (!editor || !res) return;
    if (res.appliedBy === "client" && res.ops?.length) {
      const { tr, comments } = applyAbilityOps(editor.state, res.ops, { mode: res.mode || "suggest", requestedBy: me, batchId: res.batchId });
      if (tr.docChanged) editor.view.dispatch(tr);
      addComments(comments);
    } else if (res.comments?.length && res.appliedBy !== "sync") {
      addComments(res.comments);
    }
  }, [editor, me, addComments]);

  const blocksForServer = useCallback(() => (opened?.mode === "live" ? undefined : draftBlocks(editor?.getJSON())), [opened, editor]);

  const runCommand = useCallback(async (command, extra = {}) => {
    const selection = selectionInfo(editor);
    const aiMode = mode === "editing" && (opened?.aiModes || []).includes("direct") && extra.direct ? "direct" : "suggest";
    const res = await call("storyforge.studio.ai.run.v1", { docId, command, selection, mode: aiMode, blocks: blocksForServer(), ...extra });
    landResult(res);
    return res;
  }, [editor, mode, opened, docId, blocksForServer, landResult]);

  // --- publish --------------------------------------------------------------------------
  const publish = useCallback(async () => {
    if (!editor || !canEdit) return;
    const doc = editor.getJSON();
    const pending = pendingSuggestions(doc);
    if (pending.outside) {
      setPublishState({ state: "error", text: "This chapter was changed outside the studio. Accept or reject those changes first." });
      return;
    }
    const markdown = docToMarkdown(doc, { view: "base" });
    setPublishState({ state: "working" });
    try {
      const choices = ydocRef.current.getMap("meta").get("choices");
      const res = await call("storyforge.studio.publish.v1", {
        docId, markdown, markdownHash: textHash(markdown), pending, state: encodeState(ydocRef.current),
        wordCount: countWords(docPlainText(doc, "base")), chapterTitle: ydocRef.current.getMap("meta").get("title") || undefined,
        choices: Array.isArray(choices) && choices.filter(Boolean).length ? choices.filter(Boolean).map((text) => ({ text })) : undefined,
      });
      setPublishState({ state: "done", text: pending.total ? `Published. ${pending.total} suggestion${pending.total === 1 ? " is" : "s are"} still waiting and weren't included.` : "Published. Readers see the new text now.", at: res.publishedAt });
      dirtyRef.current = false;
      setSaveState({ state: "saved", at: res.publishedAt });
    } catch (error) {
      setPublishState({ state: "error", text: error.message });
    }
  }, [editor, canEdit, docId]);

  const setModeSaved = (next) => {
    setMode(next);
    const modes = { ...(settings.modes || {}), [docId]: next };
    setSettings({ ...settings, modes });
  };

  // --- render ------------------------------------------------------------------------------
  const json = editor?.getJSON();
  const words = json ? countWords(docPlainText(json, "accepted")) : 0;
  const selectionWords = editor && !editor.state.selection.empty ? countWords(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ")) : 0;
  const sessionWords = sessionStart.current === null ? 0 : Math.max(0, words - sessionStart.current);
  const goal = Number(settings.dailyGoal || 0);
  const pending = json ? pendingSuggestions(json) : { total: 0 };
  const title = ydocRef.current?.getMap("meta").get("title") || opened?.chapter?.chapterTitle || "";

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (openError === "signed_out" || (!opened && signedOut)) {
    return <PinResume userId={me} onResumed={() => { setSignedOut(false); setOpenError(""); window.location.reload(); }} standalone />;
  }
  if (openError) {
    return (
      <div className="studio-empty" role="alert">
        <h2>This chapter didn't open</h2>
        <p>{openError}</p>
        <button type="button" className="st-btn" onClick={() => nav("/studio")}>Back to the binder</button>
      </div>
    );
  }

  const statusText = signedOut ? "Signed out: your changes are kept on this device"
    : !online ? "Offline: your changes are saved on this device and will sync"
      : status.mode === "live" ? (status.connected ? (saveState.state === "saved" && saveState.at ? `Saved ${timeAgo(saveState.at)}` : "All changes synced") : "Reconnecting…")
        : saveState.state === "saving" ? "Saving…" : saveState.state === "unsaved" ? "Unsaved changes" : saveState.state === "error" ? "Not saved yet: retrying" : saveState.at ? `Saved ${timeAgo(saveState.at)}` : "Saved";

  return (
    <div className={`studio-shell ${settings.focus ? "is-focus" : ""} ${binderOpen && !settings.focus ? "" : "no-binder"} ${chatOpen && !settings.focus ? "" : "no-chat"} chat-${settings.chatSide || "right"}`}>
      <header className="st-header">
        <button type="button" className="st-icon" aria-label={binderOpen ? "Hide binder" : "Show binder"} aria-pressed={binderOpen} onClick={() => { setBinderOpen(!binderOpen); savePrefs({ ...prefs(), binder: !binderOpen }); }}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14M3 10h14M3 16h14" /></svg>
        </button>
        <div className="st-title">
          <span className="st-story">{opened?.story?.title || storyId}</span>
          <input
            className="st-chapter-title" aria-label="Chapter title" value={title} placeholder={`Chapter ${chapterNumber}`}
            readOnly={!canEdit}
            onChange={(e) => { ydocRef.current?.getMap("meta").set("title", e.target.value); dirtyRef.current = true; setTick((t) => t + 1); }}
          />
        </div>
        <div className="st-modes" role="radiogroup" aria-label="Mode">
          {["editing", "suggesting", "viewing"].map((m) => {
            const allowed = m === "viewing" || (m === "suggesting" && canWrite) || (m === "editing" && canEdit);
            return (
              <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={!allowed} className={mode === m ? "on" : ""} onClick={() => setModeSaved(m)}>
                {MODE_LABEL[m]}
              </button>
            );
          })}
        </div>
        <span className={`st-status ${signedOut || !online ? "warn" : ""}`} role="status" aria-live="polite">{statusText}</span>
        <div className="st-actions">
          <button type="button" className="st-btn ghost" onClick={() => setDrawer("history")}>History</button>
          <button type="button" className="st-btn ghost" onClick={() => setDrawer("print")}>Print</button>
          <button type="button" className="st-btn ghost" onClick={() => setDrawer("share")}>Share</button>
          {canEdit && (
            <button type="button" className="st-btn primary" disabled={publishState?.state === "working" || !online} onClick={publish}>
              {publishState?.state === "working" ? "Publishing…" : "Publish"}
            </button>
          )}
          <button type="button" className="st-icon" aria-label={chatOpen ? "Hide chat" : "Show chat"} aria-pressed={chatOpen} onClick={() => { setChatOpen(!chatOpen); savePrefs({ ...prefs(), chat: !chatOpen }); }}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v9H8l-4 3v-3H3z" /></svg>
          </button>
        </div>
      </header>

      {publishState?.text && (
        <div className={`st-banner ${publishState.state}`} role={publishState.state === "error" ? "alert" : "status"}>
          {publishState.text}
          <button type="button" className="st-link" onClick={() => setPublishState(null)}>Dismiss</button>
        </div>
      )}

      {binderOpen && !settings.focus && (
        <aside className="st-binder" aria-label="Binder">
          <Binder current={{ universeId, storyId, chapterNumber }} />
        </aside>
      )}

      <main className="st-manuscript">
        <Toolbar editor={editor} canWrite={canWrite && mode !== "viewing"} settings={settings} setSettings={setSettings} onFind={() => setFindOpen(true)} tick={tick} />
        {findOpen && editor && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
        <div className="ms-scroll">
          <article className={`ms-page font-${settings.font || "serif"} size-${settings.textSize || 3}`}>
            <div className="ms-meridian" aria-hidden="true" style={{ "--goal": goal ? Math.min(1, sessionWords / goal) : 0 }} />
            {!opened ? <div className="ms-loading" role="status">Opening chapter {chapterNumber}…</div> : <EditorContent editor={editor} />}
            {editor && opened && <SelectionBar editor={editor} allowed={canWrite && mode !== "viewing"} tick={tick}>
              <button type="button" onClick={() => runCommand("rewrite", { how: "tighter" }).catch((e) => setToast({ kind: "warn", text: e.message }))}>Tighten</button>
                <button type="button" onClick={() => { setChatOpen(true); setPanel("chat"); window.dispatchEvent(new CustomEvent("studio:ask", { detail: "Rewrite this " })); }}>Rewrite…</button>
                <button type="button" onClick={() => runCommand("continue", { length: "paragraph" }).catch((e) => setToast({ kind: "warn", text: e.message }))}>Continue</button>
                <button type="button" onClick={() => runCommand("check_lore").catch((e) => setToast({ kind: "warn", text: e.message }))}>Check lore</button>
                <button type="button" onClick={() => { addComment(editor, ydocRef.current, me); setPanel("review"); setChatOpen(true); }}>Comment</button>
            </SelectionBar>}
          </article>
          {opened && opened.universe?.kind !== "manuscript" && <ChoicesPanel ydoc={ydocRef.current} canEdit={canEdit} tick={tick} onChange={() => { dirtyRef.current = true; setTick((t) => t + 1); }} onPropose={() => runCommand("choices")} />}
        </div>
        <footer className="st-footer">
          <span>{words.toLocaleString("en-US")} words</span>
          {selectionWords > 0 && <span>{selectionWords.toLocaleString("en-US")} selected</span>}
          <span>{sessionWords.toLocaleString("en-US")} this session{goal ? ` of ${goal.toLocaleString("en-US")}` : ""}</span>
          {pending.total > 0 && <button type="button" className="st-link" onClick={() => { setPanel("review"); setChatOpen(true); }}>{pending.total} suggestion{pending.total === 1 ? "" : "s"}</button>}
          <span className="st-level">{levelWords(level, child)}</span>
        </footer>
      </main>

      {chatOpen && !settings.focus && (
        <aside className="st-side" aria-label="Chat and review">
          <div className="st-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={panel === "chat"} onClick={() => setPanel("chat")}>Chat</button>
            <button type="button" role="tab" aria-selected={panel === "review"} onClick={() => setPanel("review")}>Review{pending.total ? ` (${pending.total})` : ""}</button>
          </div>
          {panel === "chat" ? (
            <ChatPanel docId={docId} getSelection={() => selectionInfo(editor)} getBlocks={blocksForServer} onResult={landResult} canWrite={canWrite} mode={mode} aiModes={opened?.aiModes || []} storyTitle={opened?.story?.title} />
          ) : (
            <ReviewPanel suggestions={suggestions} ydoc={ydocRef.current} canEdit={canEdit} onResolve={resolve} editor={editor} tick={tick} me={me} />
          )}
        </aside>
      )}

      {drawer === "history" && <HistoryDrawer docId={docId} editor={editor} ydoc={ydocRef.current} canEdit={canEdit} onCheckpoint={checkpoint} live={opened?.mode === "live"} onClose={() => setDrawer(null)} />}
      {drawer === "share" && <ShareDialog universeId={universeId} storyId={storyId} onClose={() => setDrawer(null)} />}
      {drawer === "print" && <PrintDialog universeId={universeId} storyId={storyId} chapterNumber={chapterNumber} getDraft={() => ({ doc: editor?.getJSON(), comments: ydocRef.current?.getMap("comments").toJSON() || {}, title })} onClose={() => setDrawer(null)} />}
      {signedOut && opened && <PinResume userId={me} onResumed={resumed} />}
      {toast && <div className={`st-toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  );
}

/** The selection bar: a small floating toolbar above a selection (our own, positioned from
 *  the editor's coordinates; nothing moves React's DOM around). */
function SelectionBar({ editor, allowed, children }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const update = () => {
      if (!allowed || editor.isDestroyed || editor.state.selection.empty || !editor.isFocused) { setPos(null); return; }
      try {
        const { from, to } = editor.state.selection;
        const a = editor.view.coordsAtPos(from);
        const b = editor.view.coordsAtPos(to);
        setPos({ top: Math.min(a.top, b.top) - 46, left: (a.left + b.right) / 2 });
      } catch { setPos(null); }
    };
    update();
    editor.on("selectionUpdate", update);
    editor.on("focus", update);
    editor.on("blur", ({ event }) => { if (!event?.relatedTarget?.closest?.(".st-bubble")) setPos(null); });
    const scroller = document.querySelector(".ms-scroll");
    scroller?.addEventListener("scroll", update, { passive: true });
    return () => { editor.off("selectionUpdate", update); editor.off("focus", update); scroller?.removeEventListener("scroll", update); };
  }, [editor, allowed]);
  if (!pos) return null;
  return (
    <div className="st-bubble" role="toolbar" aria-label="Selection" style={{ position: "fixed", top: Math.max(60, pos.top), left: pos.left, transform: "translateX(-50%)", zIndex: 35 }}
      onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

function Toolbar({ editor, canWrite, settings, setSettings, onFind }) {
  if (!editor) return <div className="st-toolbar" />;
  const block = editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : editor.isActive("blockquote") ? "quote" : "p";
  const setBlock = (v) => {
    const chain = editor.chain().focus();
    if (v === "p") chain.setNode("paragraph").run();
    else if (v === "quote") chain.setNode("blockquote").run();
    else chain.setNode("heading", { level: Number(v.slice(1)) }).run();
  };
  const mark = (name, label, key) => (
    <button type="button" className={`st-tool ${editor.isActive(name) ? "on" : ""}`} aria-pressed={editor.isActive(name)} aria-label={label} title={`${label} (${key})`} disabled={!canWrite}
      onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleMark(name).run()}>
      <span className={`glyph-${name}`}>{label[0]}</span>
    </button>
  );
  return (
    <div className="st-toolbar" role="toolbar" aria-label="Formatting">
      <select aria-label="Paragraph style" value={block} disabled={!canWrite} onChange={(e) => setBlock(e.target.value)}>
        <option value="p">Text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="quote">Quote</option>
      </select>
      {mark("bold", "Bold", "⌘B")}
      {mark("italic", "Italic", "⌘I")}
      {mark("underline", "Underline", "⌘U")}
      {mark("strike", "Strikethrough", "⌘⇧X")}
      <button type="button" className="st-tool" aria-label="Scene break" title="Scene break (***)" disabled={!canWrite} onClick={() => editor.chain().focus().insertContent({ type: "sceneBreak" }).run()}>⁂</button>
      <span className="st-sep" />
      <button type="button" className="st-tool" aria-label="Undo" title="Undo (⌘Z)" disabled={!canWrite} onClick={() => editor.chain().focus().undo().run()}>↶</button>
      <button type="button" className="st-tool" aria-label="Redo" title="Redo (⌘⇧Z)" disabled={!canWrite} onClick={() => editor.chain().focus().redo().run()}>↷</button>
      <button type="button" className="st-tool" aria-label="Find and replace" title="Find and replace (⌘F)" onClick={onFind}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5L17 17" /></svg>
      </button>
      <span className="st-grow" />
      <select aria-label="Theme" value={settings.theme || "light"} onChange={(e) => setSettings({ ...settings, theme: e.target.value })}>
        <option value="light">Light</option>
        <option value="sepia">Sepia</option>
        <option value="dark">Dark</option>
      </select>
      <select aria-label="Reading font" value={settings.font || "serif"} onChange={(e) => setSettings({ ...settings, font: e.target.value })}>
        <option value="serif">Book</option>
        <option value="sans">Plain</option>
        <option value="dyslexic">Easier reading</option>
      </select>
      <button type="button" className={`st-tool ${settings.focus ? "on" : ""}`} aria-pressed={Boolean(settings.focus)} title="Focus: hide everything but the page" onClick={() => setSettings({ ...settings, focus: !settings.focus })}>Focus</button>
    </div>
  );
}

function ChoicesPanel({ ydoc, canEdit, onChange, onPropose }) {
  const meta = ydoc?.getMap("meta");
  const choices = (meta?.get("choices") || ["", "", ""]).concat(["", "", ""]).slice(0, 3);
  const [busy, setBusy] = useState(false);
  const [offered, setOffered] = useState(null);
  const set = (i, v) => {
    const next = [...choices];
    next[i] = v;
    meta.set("choices", next);
    onChange();
  };
  return (
    <section className="ms-choices" aria-label="End-of-chapter choices">
      <h3>What the reader chooses next</h3>
      {choices.map((c, i) => (
        <input key={i} aria-label={`Choice ${i + 1}`} value={c} readOnly={!canEdit} placeholder={`Choice ${i + 1}`} onChange={(e) => set(i, e.target.value)} />
      ))}
      {canEdit && (
        <button type="button" className="st-btn ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try { const res = await onPropose(); setOffered(res?.choices || null); } catch { setOffered([]); } finally { setBusy(false); }
        }}>{busy ? "Asking Ability…" : "Suggest three choices"}</button>
      )}
      {offered && offered.length > 0 && (
        <div className="ms-offered">
          <p>Ability suggests:</p>
          <ol>{offered.map((c, i) => <li key={i}>{c}</li>)}</ol>
          <button type="button" className="st-btn" onClick={() => { meta.set("choices", offered.slice(0, 3)); setOffered(null); onChange(); }}>Use these</button>
          <button type="button" className="st-link" onClick={() => setOffered(null)}>Keep mine</button>
        </div>
      )}
    </section>
  );
}

export function addComment(editor, ydoc, me) {
  if (!editor || editor.state.selection.empty) return;
  const id = `c_${Math.random().toString(36).slice(2, 12)}`;
  const { from, to } = editor.state.selection;
  const $pos = editor.state.doc.resolve(from);
  const pid = $pos.depth >= 1 ? $pos.node(1).attrs.pid : null;
  editor.view.dispatch(editor.state.tr.addMark(from, to, editor.schema.marks.comment.create({ id })).setMeta("suggestConverted", true));
  ydoc.getMap("comments").set(id, { id, pid, quote: editor.state.doc.textBetween(from, to, " ").slice(0, 200), body: "", author: me, authorKind: "person", createdAt: new Date().toISOString(), resolved: false, replies: [], draft: true });
  editor.commands.setTextSelection(to);
}

function levelWords(level, child) {
  if (level === "owner") return "You own this story";
  if (level === "edit") return child ? "You can write here" : "You can edit";
  if (level === "suggest") return "Your changes are suggestions";
  return "Read only";
}

function displayName(id) {
  const s = String(id || "");
  return s ? s[0].toUpperCase() + s.slice(1) : "Writer";
}

function hashCode(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

export function timeAgo(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export { authorLabel, TextSelection };
