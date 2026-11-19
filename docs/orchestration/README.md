# How the Orchestrator coordinates the souls

This folder contains three SVG diagrams that outline the coordination process described by
[`defaults/orchestrator.md`](../../defaults/orchestrator.md) and the souls in [`agents/`](../../agents).
They describe the shipped doctrine, not mechanical enforcement: plan-first, gating, retry counts, and
pause-on-fatal are prompt-level guidance that the Lead applies through the Team tools.

## The set

1. **[Coordination map](01-coordination-map.svg)** — who does what, and what crosses each boundary.
   The Lead owns the outcome; producer souls take bounded assignments; the verifier challenges a frozen
   candidate; the human supplies authority and decisions; the task board holds the durable ledger.
2. **[Orchestration lifecycle](02-orchestration-lifecycle.svg)** — the end-to-end sequence from intake
   to verified delivery, including planning, routing, execution, independent review, correction,
   integration, publication, and close-out.
3. **[Gate and recovery loop](03-gate-and-recovery.svg)** — the review decision in detail:
   PASS, REVISE, and BLOCKED; finding dispositions; corrective-cycle accounting; gate modes; and the
   rule that a verdict is an input to the Lead's acceptance decision, not the decision itself.

## The process in brief

The human enables Orchestrator mode and states the goal. The Lead records the objective and acceptance
criteria, plans stable work items on the Team task board, and routes each item to the smallest capable
soul: researcher for external evidence, software engineer for implementation, scribe for documentation,
generalist when no specialist fits. Every assignment is self-contained and carries inputs, boundaries,
checks, evidence requirements, and the remaining cycle allowance.

The producer returns an identifiable candidate, the checks it actually ran, its author review, and its
limits. The Lead freezes that candidate, prepares a neutral review packet, and dispatches the independent
Adversarial Red-Team Verifier. The verifier returns one candidate-bound verdict and evidence-backed
findings. The Lead dispositions the findings, assigns corrections to the producer, and returns the revised
candidate for a new verdict. Under strict gating, a failed, blocked, or unperformed gate blocks acceptance
unless an explicit, recorded user exception authorizes a different disposition.

Once accepted, the Lead integrates the results, runs checks on the combined deliverable, and owns the Git
workflow: inspect the repository, branch, commit only task changes, push, open or update the PR, and read
CI. The task closes only when acceptance criteria are met, required gates are resolved, and the PR is
delivered or explicitly waived. Delegation transfers the assignment, not accountability for the outcome.

## Reading notes

- **Bundled defaults shown:** `gate-mode: strict`, `max-retries: 20`, `pause-on-fatal: true`,
  `plan-first: true`. These are configurable in the orchestrator definition.
- **Solid connectors** are normal sequence or assignment/handoff flows. **Dashed connectors** are durable
  records or the corrective loop. **Red** marks the independent gate.
- The diagrams are dependency-free SVGs with embedded titles and descriptions; they can be opened in a
  browser, embedded in documentation, or edited in a vector editor.

## Sources

- [`defaults/orchestrator.md`](../../defaults/orchestrator.md) — the Lead's orchestration doctrine.
- [`agents/researcher.md`](../../agents/researcher.md) — external evidence and cited briefings.
- [`agents/software-engineer.md`](../../agents/software-engineer.md) — implementation, initial checks, author review, and fixes.
- [`agents/scribe.md`](../../agents/scribe.md) — verified documentation within assigned targets.
- [`agents/generalist.md`](../../agents/generalist.md) — default soul for unmatched self-contained work.
- [`agents/adversarial-red-team-verifier.md`](../../agents/adversarial-red-team-verifier.md) — independent, read-only challenge and verdicts.
- [`README.md`](../../README.md#orchestrator-mode) — Orchestrator mode and Team tool behavior.
