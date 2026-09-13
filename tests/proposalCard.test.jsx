/**
 * The editor told Jonathan to type a capability name into a phone.
 *
 * Verbatim, from the sheet: *"approve it with storyforge.draft.approve.v1
 * (draftId the-embodied-age:threshold:3:64c8e066c6) or dismiss it with
 * storyforge.draft.dismiss.v1."* Nobody does that with a thumb.
 *
 * #1542's contract is right — generation proposes, approval writes — but the
 * approval surface was a paragraph of capability names inside a chat bubble. It
 * is a card now: what is proposed, how long it is, the opening lines, and three
 * buttons.
 *
 * The property these tests exist to hold: **nothing writes until a tap, and one
 * tap writes once.** A held draft that gets saved twice by an impatient double
 * tap is a duplicate chapter, and a draft that gets dismissed because a button
 * was off the edge of a scrolling row is lost work.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

const { ProposalCard } = await import("../src/main.jsx");

afterEach(cleanup);

const PROPOSAL = {
  path: "chapter_save",
  draftId: "the-embodied-age:threshold:3:64c8e066c6",
  chapterNumber: 3,
  chapterTitle: "Where She Is Holding Tension",
  proseChars: 9368,
  writeWith: "storyforge.draft.approve.v1",
};

function draw(overrides = {}, props = {}) {
  return render(
    <ProposalCard
      proposal={{ ...PROPOSAL, ...overrides }}
      busy={false}
      onApprove={() => {}}
      onDismiss={() => {}}
      onRevise={() => {}}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// what it shows
// ---------------------------------------------------------------------------

describe("the card", () => {
  it("leads with the title, not the draft id", () => {
    draw();
    expect(screen.getByText("Where She Is Holding Tension")).toBeTruthy();
    expect(screen.queryByText(/64c8e066c6/)).toBeNull();
  });

  it("says out loud that nothing has been saved", () => {
    // The whole point of #1542's contract, and the thing a person needs to know
    // before deciding.
    draw();
    expect(screen.getByText(/Held, not saved/)).toBeTruthy();
  });

  it("names no capability anywhere on the card", () => {
    const { container } = draw();
    expect(container.textContent).not.toContain("storyforge.draft");
    expect(container.textContent).not.toContain(".v1");
  });

  it("gives the three actions in plain words", () => {
    draw();
    expect(screen.getByRole("button", { name: "Use this" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not this" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change it" })).toBeTruthy();
  });

  it("falls back to the chapter number when the draft has no title", () => {
    draw({ chapterTitle: null });
    expect(screen.getByText("Chapter 3")).toBeTruthy();
  });

  it("renders nothing at all without a draftId", () => {
    const { container } = render(<ProposalCard proposal={{ chapterTitle: "x" }} onApprove={() => {}} onDismiss={() => {}} onRevise={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("reading it", () => {
  it("offers Read it only when the full text was actually sent", () => {
    draw();
    expect(screen.queryByRole("button", { name: "Read it" })).toBeNull();
    cleanup();
    draw({ prose: "She was holding tension in her hands." });
    expect(screen.getByRole("button", { name: "Read it" })).toBeTruthy();
  });

  it("expands and collapses", () => {
    draw({ prose: "She was holding tension in her hands." });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect(screen.getByText(/holding tension in her hands/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// nothing writes until a tap, and one tap writes once
// ---------------------------------------------------------------------------

describe("writing", () => {
  it("writes nothing on render", () => {
    const onApprove = vi.fn();
    const onDismiss = vi.fn();
    draw({}, { onApprove, onDismiss });
    expect(onApprove).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("approves with the whole proposal so the caller has the draftId", () => {
    const onApprove = vi.fn();
    draw({}, { onApprove });
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ draftId: PROPOSAL.draftId }));
  });

  it("dismisses with the whole proposal", () => {
    const onDismiss = vi.fn();
    draw({}, { onDismiss });
    fireEvent.click(screen.getByRole("button", { name: "Not this" }));
    expect(onDismiss).toHaveBeenCalledWith(expect.objectContaining({ draftId: PROPOSAL.draftId }));
  });

  it("does not save twice on a double tap", async () => {
    // An impatient second tap during a slow save is a duplicate chapter.
    let release;
    const onApprove = vi.fn(() => new Promise((r) => { release = r; }));
    draw({}, { onApprove });
    const button = screen.getByRole("button", { name: "Use this" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    release();
  });

  it("locks the other actions while one is in flight", async () => {
    let release;
    const onApprove = vi.fn(() => new Promise((r) => { release = r; }));
    const onDismiss = vi.fn();
    draw({}, { onApprove, onDismiss });
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Not this" }).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Not this" }));
    expect(onDismiss).not.toHaveBeenCalled();
    release();
  });

  it("is inert while the story is thinking", () => {
    const onApprove = vi.fn();
    draw({}, { busy: true, onApprove });
    const button = screen.getByRole("button", { name: "Use this" });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe("changing it", () => {
  it("writes nothing — it hands the proposal back to the composer", () => {
    const onRevise = vi.fn();
    const onApprove = vi.fn();
    const onDismiss = vi.fn();
    draw({}, { onRevise, onApprove, onDismiss });
    fireEvent.click(screen.getByRole("button", { name: "Change it" }));
    expect(onRevise).toHaveBeenCalledWith(expect.objectContaining({ draftId: PROPOSAL.draftId }));
    expect(onApprove).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
