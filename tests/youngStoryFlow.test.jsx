/**
 * A child could answer two questions, tap Next, and wait forever.
 *
 * `NewStory` uses `step` for two different things. In the adult flow it is a
 * screen (1 describe, 2 answer, 3 waiting). In the young flow — `tier === 2`
 * with a single reader — it is a question index. The two meanings collided:
 *
 *   guard `step < 3`, `idx = Math.min(step - 1, 2)`
 *   step 1 -> idx 0 -> idx < 2 -> setStep(2)
 *   step 2 -> idx 1 -> idx < 2 -> setStep(3)
 *   step 3 -> guard fails, branch stops rendering, `step === 3` shows
 *             <WaitingState/>. Forever.
 *
 * The third prompt was never displayed, `askQuestions()` was never called and
 * `createStory()` was never reached. This predates the genre work entirely.
 *
 * Raising the bound to `step < 4` is NOT the whole fix and this file is largely
 * here to say so: the final button called `askQuestions()`, whose tier-2 branch
 * does `setStep(2)`, which under a raised bound sends the child back to question
 * two. Dead end becomes infinite loop — traced before the change was written.
 * The button now creates directly, and a `creating` flag takes the branch down
 * while the request is in flight so step 3 can still mean "waiting".
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";

const executed = [];

// createRoot runs at module scope in main.jsx; the app must not actually mount
// when the module is imported for a test.
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => () => {}, useParams: () => ({ id: "u1" }) };
});

beforeEach(() => {
  executed.length = 0;
  global.fetch = vi.fn(async (url, options) => {
    const body = JSON.parse(options?.body || "{}");
    executed.push(body);
    if (body.command === "storyforge.universe.get.v1") {
      return new Response(JSON.stringify({
        ok: true, universe: { universeId: "u1", genre: "fairy tale", audienceAge: "child" },
      }), { status: 200 });
    }
    if (body.command === "storyforge.story.create.v1") {
      return new Response(JSON.stringify({ ok: true, storyId: "s1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

async function renderYoungFlow() {
  // keen => tier 2; a single active reader is the young path.
  // keen => tierForReaders returns 2; one reader is the young path.
  localStorage.setItem("storyforge_default_reader", "keen");
  const mod = await import("../src/main.jsx");
  return mod;
}


const PROMPTS = [
  "What kind of world should this story happen in?",
  "Who is the main character?",
  "What's the most exciting thing that could happen?",
];

/** Walk the three prompts, answering each. Waits on the prompt TEXT rather than
 *  on the input, so a step that silently fails to advance fails the test here
 *  instead of somewhere confusing later. */
async function walkYoungFlow(answers) {
  for (let i = 0; i < 3; i += 1) {
    expect(await screen.findByText(PROMPTS[i])).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: answers[i] } });
    fireEvent.click(screen.getByRole("button", { name: i < 2 ? /Next/ : /Begin the Story/ }));
  }
}

function createCall() {
  return executed.find((c) => c.command === "storyforge.story.create.v1");
}

describe("the young-reader story flow reaches a created story", () => {
  it("the trace that was broken: three prompts, then a create call", async () => {
    const { NewStory, AppProvider } = await renderYoungFlow();
    render(<MemoryRouter><AppProvider><NewStory /></AppProvider></MemoryRouter>);

    // Prompt 1
    expect(await screen.findByText("What kind of world should this story happen in?")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a floating island" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    // Prompt 2
    expect(await screen.findByText("Who is the main character?")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a brave penguin" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    // Prompt 3 — this is the one that never rendered.
    expect(await screen.findByText("What's the most exciting thing that could happen?")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "the island starts sinking" } });
    fireEvent.click(screen.getByRole("button", { name: /Begin the Story/ }));

    await waitFor(() => expect(createCall()).toBeTruthy());
  });

  it("the three answers all reach the seed, not just the first two", async () => {
    const { NewStory, AppProvider } = await renderYoungFlow();
    render(<MemoryRouter><AppProvider><NewStory /></AppProvider></MemoryRouter>);
    const answers = ["a floating island", "a brave penguin", "the island starts sinking"];
    await walkYoungFlow(answers);
    await waitFor(() => expect(createCall()).toBeTruthy());
    const seed = createCall().args.storySeed;
    for (const answer of answers) expect(seed).toContain(answer);
  });

  it("genre and audience are inherited from the universe, so the child is never asked", async () => {
    const { NewStory, AppProvider } = await renderYoungFlow();
    render(<MemoryRouter><AppProvider><NewStory /></AppProvider></MemoryRouter>);
    await walkYoungFlow(["answer 0", "answer 1", "answer 2"]);
    await waitFor(() => expect(createCall()).toBeTruthy());
    expect(createCall().args.genre).toBe("fairy tale");
    expect(createCall().args.audienceAge).toBe("child");
  });

  it("it never returns to an earlier prompt — the loop the raised bound alone would cause", async () => {
    const { NewStory, AppProvider } = await renderYoungFlow();
    render(<MemoryRouter><AppProvider><NewStory /></AppProvider></MemoryRouter>);
    await walkYoungFlow(["answer 0", "answer 1", "answer 2"]);
    await waitFor(() => expect(createCall()).toBeTruthy());
    expect(screen.queryByText("Who is the main character?")).toBeNull();
    expect(screen.queryByText("What kind of world should this story happen in?")).toBeNull();
  });
});
