/**
 * After a reshape the waiting screen must not take the chapter's OLD text as
 * the answer.
 *
 * The reshaped chapter already exists, so `chapter.status` answers `complete`
 * for it right up until `storyforge.chapter.reshape.v1` has written the queue
 * item `{ type: "reshape", status: "reshaping" }`. The poll starts the moment
 * the reader taps, before that write. On 2026-09-21 the first poll read
 * `complete`, showed the old chapter and stopped; the edit was saved 2.5
 * minutes later and the page never showed it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
const { chapterPollStep, waitTimeoutMs, CHAPTER_WAIT_TIMEOUT_MS } = await import("../src/main.jsx");

const OLD = { ok: true, status: "complete", chapter: { chapterNumber: 3, prose: "The old text." } };
const RESHAPING = { ok: true, status: "reshaping", chapterNumber: 3 };
const NEW = { ok: true, status: "complete", chapter: { chapterNumber: 3, prose: "The new text." } };

/** Feed a sequence of status answers through the poll; return the index it stops on. */
function run(kind, sequence) {
  let saw = false;
  for (let i = 0; i < sequence.length; i += 1) {
    const step = chapterPollStep(kind, sequence[i], saw);
    saw = step.sawReshaping;
    if (step.action !== "wait") return { index: i, action: step.action };
  }
  return { index: -1, action: "wait" };
}

describe("waiting for a reshape", () => {
  it("accepts only the complete that comes after reshaping: complete(old) -> reshaping -> complete", () => {
    expect(run("reshape", [OLD, RESHAPING, NEW])).toEqual({ index: 2, action: "reread" });
  });

  it("does not end the wait on a complete that arrives before any reshaping", () => {
    expect(run("reshape", [OLD]).action).toBe("wait");
    expect(run("reshape", [OLD, OLD, OLD]).action).toBe("wait");
  });

  it("keeps waiting through every reshaping answer", () => {
    expect(run("reshape", [OLD, RESHAPING, RESHAPING, RESHAPING]).action).toBe("wait");
  });

  it("ignores a failed left behind by an earlier reshape, but reports one after reshaping", () => {
    const failed = { ok: true, status: "failed", error: "boom" };
    expect(run("reshape", [failed]).action).toBe("wait");
    expect(run("reshape", [failed, RESHAPING, failed])).toEqual({ index: 2, action: "failed" });
  });

  it("re-reads the chapter rather than trusting the status route's copy", () => {
    expect(chapterPollStep("reshape", NEW, true).action).toBe("reread");
  });

  it("waits longer than a new chapter does, past the 2.5 minutes the real one took", () => {
    expect(waitTimeoutMs("reshape")).toBeGreaterThan(150000);
    expect(waitTimeoutMs(undefined)).toBe(CHAPTER_WAIT_TIMEOUT_MS);
  });
});

describe("waiting for a new chapter (unchanged)", () => {
  it("shows the chapter on the first complete", () => {
    expect(run(undefined, [{ status: "generating" }, NEW])).toEqual({ index: 1, action: "show" });
  });

  it("reports failure", () => {
    expect(run(undefined, [{ status: "failed" }]).action).toBe("failed");
  });
});
