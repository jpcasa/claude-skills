---
name: quick-ask-me
description: Lightweight interview for quick tasks. Asks the objective, then the success criteria, then only the questions needed to make the plan solid enough to implement. Writes glossary terms to CONTEXT.md and rare ADRs as it goes, and ends with a short brief. User-invoked only.
disable-model-invocation: true
---

# Quick Ask Me

A quick-task variant of a full grilling interview such as Matt Pocock's `/grill-with-docs`. Same engine (a one-question-at-a-time interview), same deliverable (`CONTEXT.md` glossary entries and rare ADRs), but with a hard question budget and two mandatory openers. The goal is shared understanding plus a short brief an implementation step can run from — not a full spec.

Do not act on anything until the user confirms we have reached a shared understanding. Never start implementing from inside this skill.

## Opening questions — always, in this order, one at a time

### Q1 — Objective

Ask: "What's the main goal?"

If the user already passed the goal as the skill argument or in the surrounding conversation, restate it in one sentence and ask them to confirm or correct it. That is still one question — wait for the answer.

### Q2 — Success criteria

Ask: "How will we know it's done?"

Every criterion must be observable: a test passes, a command prints X, a user can do Y, a metric moves from A to B. Reject "it works", "it's clean", "it feels right" — push once for something checkable. Offer a recommended set of two to four criteria based on the objective and what you can see in the codebase.

## Grill rules

- Ask one question at a time. Wait for the answer before asking the next. Asking multiple questions at once is bewildering.
- Every question ships with your recommended answer.
- If a *fact* can be found by exploring the environment (filesystem, git, tools), look it up rather than asking. *Decisions* are the user's — put each one to them and wait.
- State facts you looked up alongside the question they inform ("the repo has no export script yet, so…"). Stating a fact is not a question and does not count against the budget.
- Walk dependencies in order: resolve the decision that other decisions hang on before asking about the ones that hang on it.

## Lightweight rules — what makes this not a full grill

- **Question budget: at most 6 questions after the two openers.** When the budget is spent, summarise where things stand and ask exactly one more question: "Good enough to implement, or keep going?" Continue only if the user says so.
- **Only ask what would change what gets built.** Skip the full decision-tree walk. If the answer wouldn't alter the code, the tests, or the scope, don't ask it.
- **Stop early** — before the budget is spent — when all five are true:
  1. the objective is confirmed
  2. every success criterion is observable
  3. the scope boundary is named (what is explicitly *not* being done)
  4. the seam is known — where the tests will live and what interface they exercise
  5. there are no unresolved term conflicts with `CONTEXT.md`

## Docs as you go

This is the domain-modeling discipline (Matt Pocock's `domain-modeling` skill), slimmed. If the `domain-modeling` skill is available in this host, use its format files instead of the copies in `references/` — same content, avoids drift.

- **Challenge terms.** When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. When they use a vague or overloaded term, propose a precise canonical one.
- **Write resolved terms to `CONTEXT.md` inline, the moment they resolve.** Don't batch them for the end. Format is in [references/CONTEXT-FORMAT.md](./references/CONTEXT-FORMAT.md). Create the file lazily — only when the first term resolves. If a `CONTEXT-MAP.md` exists, write to the relevant context's `CONTEXT.md` instead of the root.
- **Glossary only.** `CONTEXT.md` holds vocabulary and nothing else — no implementation details, no spec, no scratch notes.
- **ADRs only when all three hold:** hard to reverse, surprising without context, and the result of a real trade-off. Format is in [references/ADR-FORMAT.md](./references/ADR-FORMAT.md). Create `docs/adr/` lazily. Expect zero ADRs on most quick tasks — that is the intended shape, not a failure.

## Closing brief

When shared understanding is confirmed, print this in chat and stop:

```md
## Brief: <title>

**Objective:** <one sentence>

**Success criteria:**
- [ ] <observable criterion>
- [ ] <observable criterion>

**Decisions:**
- <decision> (see docs/adr/000N-<slug>.md, if one was written)

**Out of scope:** <what is explicitly not being done>

**Seam / where tests live:** <interface the tests exercise, and the test location>

**Docs written:** CONTEXT.md (terms: <list>), docs/adr/000N-<slug>.md (if any)

Next: implement (e.g. `/implement`, if installed)
```

Then ask exactly one question: "Save this brief to `docs/briefs/<slug>.md`?" Recommend **no** for quick tasks — the brief lives in the conversation and the implementation step reads it from there. Write the file only if the user says yes.

Do not start implementing yourself. Hand off and stop.
