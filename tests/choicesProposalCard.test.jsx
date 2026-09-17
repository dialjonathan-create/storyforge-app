/**
 * "Save these as the options for chapter 1" is one explicit, non-destructive tap.
 *
 * storyforge.converse.v1 now proposes end-of-chapter options for a chapter that
 * already exists (`proposal.path === "chapter_choices"`) and writes nothing.
 * This card is the approval: it names the chapter, lists exactly what will be
 * saved, and says the text is not touched. One tap, one write.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
const { ChoicesProposalCard, StoryChatSheet } = await import("../src/main.jsx");
afterEach(cleanup);

const PROPOSAL = {
  path: "chapter_choices",
  chapterNumber: 1,
  chapterTargetSource: "reader",
  choices: [{ id: "1", text: "Placeholder one." }, { id: "2", text: "Placeholder two." }, { id: "3", text: "Placeholder three." }],
  writeWith: "storyforge.chapter.choices.set.v1",
};

describe("the choices card", () => {
  it("names the chapter and lists exactly the options, numbered 1-3", () => {
    const { container } = render(<ChoicesProposalCard proposal={PROPOSAL} busy={false} onApprove={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/end of chapter 1/)).toBeTruthy();
    const items = [...container.querySelectorAll("ol.proposal-choices > li")].map((li) => li.textContent);
    expect(items).toEqual(["Placeholder one.", "Placeholder two.", "Placeholder three."]);
    expect(container.querySelectorAll("ol").length).toBe(1);
    expect(screen.getByText(/text stays exactly as it is/)).toBeTruthy();
  });

  it("writes nothing until tapped, and once when double-tapped", async () => {
    let resolve;
    const onApprove = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<ChoicesProposalCard proposal={PROPOSAL} busy={false} onApprove={onApprove} onDismiss={() => {}} />);
    expect(onApprove).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: /Save as chapter 1's options/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onApprove).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("renders nothing for a malformed proposal", () => {
    const { container } = render(<ChoicesProposalCard proposal={{ ...PROPOSAL, choices: [] }} busy={false} onApprove={() => {}} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("the sheet shows the choices card, not the draft card, for a choices proposal", () => {
    const thread = [{ role: "user", content: "options for chapter 1" }, { role: "assistant", content: "Here they are.", proposal: PROPOSAL }];
    render(<StoryChatSheet thread={thread} busy={false} onSend={() => {}} onClose={() => {}} onApprove={() => {}} onDismiss={() => {}} onApproveChoices={() => {}} onDismissChoices={() => {}} />);
    expect(screen.getByRole("button", { name: /Save as chapter 1's options/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use this" })).toBeNull();
  });
});
