// The chat bound to the open chapter (spec §6.1): questions answered with chapter
// citations; "tighten this" and friends land in the text as Ability's suggestions.
import React, { useEffect, useRef, useState } from "react";
import { call } from "./api.js";

const QUICK = [
  { label: "Check this against the lore", command: "check_lore" },
  { label: "Continuity pass", command: "continuity" },
  { label: "Read it as Keen would", command: "read_as_keen" },
  { label: "Summarise this chapter", command: "summarise" },
  { label: "Continue from here", command: "continue", length: "paragraph" },
];

export default function ChatPanel({ docId, getSelection, getBlocks, onResult, canWrite, aiModes, storyTitle }) {
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const ask = (e) => { setText(String(e.detail || "")); inputRef.current?.focus(); };
    window.addEventListener("studio:ask", ask);
    return () => window.removeEventListener("studio:ask", ask);
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [turns]);

  const push = (turn) => setTurns((t) => [...t, turn]);

  async function send(message) {
    const m = String(message || "").trim();
    if (!m || busy) return;
    const selection = getSelection();
    push({ role: "user", content: m, quote: selection?.quote || "" });
    setText("");
    setBusy(true);
    try {
      const history = turns.filter((t) => t.role === "user" || t.role === "assistant").slice(-8).map((t) => ({ role: t.role, content: t.content }));
      const res = await call("storyforge.studio.converse.v1", { docId, message: m, selection, history, blocks: getBlocks() });
      onResult(res);
      push({ role: "assistant", ...describe(res) });
    } catch (error) {
      push({ role: "assistant", content: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function quick(q) {
    if (busy) return;
    const selection = getSelection();
    push({ role: "user", content: q.label, quote: selection?.quote || "" });
    setBusy(true);
    try {
      const res = await call("storyforge.studio.ai.run.v1", { docId, command: q.command, length: q.length, selection, mode: "suggest", blocks: getBlocks() });
      onResult(res);
      push({ role: "assistant", ...describe(res) });
    } catch (error) {
      push({ role: "assistant", content: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-label="Conversation with Ability">
        {turns.length === 0 && (
          <div className="st-chat-empty">
            <p>Ask about {storyTitle || "the story"} — who knows what, where a thread was left, whether a scene fits the lore. Select text first to ask about that passage.</p>
            {canWrite && <p>Ask for a change ("tighten this", "continue from here") and it arrives in the text as a suggestion you accept or reject.</p>}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`chat-turn ${t.role} ${t.error ? "error" : ""}`}>
            {t.quote && <blockquote className="chat-quote">{t.quote.length > 160 ? `${t.quote.slice(0, 160)}…` : t.quote}</blockquote>}
            <p>{t.content}</p>
            {t.citations?.length > 0 && <div className="chips" aria-label="Sources">{t.citations.map((c) => <span key={c} className="chip cite">{c}</span>)}</div>}
            {t.context?.length > 0 && <div className="chips context" aria-label="What Ability read">Read: {t.context.slice(0, 8).map((c) => <span key={c} className="chip">{c}</span>)}</div>}
          </div>
        ))}
        {busy && <div className="chat-turn assistant pending" role="status">Ability is reading the chapter…</div>}
      </div>
      {canWrite && aiModes.length > 0 && (
        <div className="chat-quick" aria-label="Quick actions">
          {QUICK.map((q) => <button key={q.command} type="button" disabled={busy} onClick={() => quick(q)}>{q.label}</button>)}
        </div>
      )}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea
          ref={inputRef} rows={2} value={text} aria-label="Message to Ability" placeholder="Ask about the story, or select text and say what to change"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
        />
        <button type="submit" className="st-btn primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

function describe(res) {
  if (!res) return { content: "Nothing came back." };
  if (res.answer) return { content: res.answer, citations: res.citations, context: res.context };
  if (res.choices) return { content: `Three choices: ${res.choices.join(" / ")}`, context: res.context };
  if (res.kind === "summarise" || res.kind === "outline") return { content: res.answer || "", citations: res.citations, context: res.context };
  if (["check_lore", "continuity", "read_as_keen"].includes(res.kind)) {
    if (res.claudeUnavailable) return { content: res.message, context: res.context };
    const n = res.comments || 0;
    return { content: `${res.summary || ""} ${n ? `I left ${n} note${n === 1 ? "" : "s"} in the Review tab.` : "Nothing contradicts the lore."}`.trim(), citations: res.citations, context: res.context };
  }
  if (res.suggested || res.words || res.appliedBy) {
    const what = res.kind === "continue" || res.kind === "fill_gap" ? `${res.words || "Some"} words` : `${res.suggested || 1} change${res.suggested === 1 ? "" : "s"}`;
    return { content: res.mode === "direct" ? `${what} written into the text. Undo takes it back.` : `${what} added as suggestions. Accept or reject them in the text.`, context: res.context };
  }
  return { content: res.message || "Done." };
}
