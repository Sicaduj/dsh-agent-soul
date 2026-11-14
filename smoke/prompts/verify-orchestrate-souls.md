# Verification prompt: prove /orchestrate delegates real Agent Souls

Copy everything below into a fresh DSH session in the workspace you want to verify. This is a read-only verification exercise: do not modify repository files or plugin source.

---

You are a verification operator. Your task is to demonstrate, with independent evidence, that `/orchestrate` requires Soul-bound delegation and that children spawned through `spawn_teammate` receive the selected Agent Soul's real system prompt, tool matrix, and model route.

Do not accept a child's self-report as proof by itself. Verify the child session logs and durable bindings as well. Do not edit any repository file. Report PASS, FAIL, or BLOCKED for every check.

## Preconditions

- The installed `@local/dsh-agent-soul` must include the soul-only orchestrator enforcement and the shipped verifier route.
- A human controls **Use Agent Teams** in the Session model menu. You cannot toggle it yourself.
- The destination profile must provide the verifier's pinned route `kimi-code-bridge/k3.1-pro` with reasoning effort `max`.

Record the plugin version, workspace path, and current Lead provider/model before starting.

## Phase 1 — Team-off denial

Ask the human to turn **Use Agent Teams OFF**, then wait for confirmation.

1. Run `/orchestrate`. Record the activation result.
2. Confirm `spawn_teammate` is absent from your available tools while Team mode is off.
3. Attempt a direct `subagent` call with a harmless prompt. Then attempt `subagent_fork`.
4. Inspect the results. Both calls must be denied with the Soul-only message. If either starts a child, report FAIL and stop.
5. Verify no new child appeared by comparing `list_agents` before and after. A raw service-level bypass is not required in a live GUI session; the two model-facing tool calls are the acceptance surface here.

Expected result: `/orchestrate` is active, Team mode remains off, and both stock delegation tools are denied.

## Phase 2 — positive Soul delegation

Ask the human to turn **Use Agent Teams ON**, then wait for confirmation. Do not re-run `/orchestrate`.

1. Call `list_agent_souls` and confirm these exact catalog names and routes:
   - `software-engineer` — inherits the Lead route.
   - `adversarial-red-team-verifier` — `kimi-code-bridge/k3.1-pro`, reasoning effort `max`.
2. Call `list_subagent_models` for provider `kimi-code-bridge` and model `k3.1-pro`. Confirm the route is available. If it is not, report BLOCKED; do not accept the Lead model as a substitute.
3. Spawn two named teammates through `spawn_teammate`:
   - `soul-check-engineer`, `agent_type: "software-engineer"`: read one small repository file and report its path, purpose, and a short quoted line. No edits.
   - `soul-check-verifier`, `agent_type: "adversarial-red-team-verifier"`: independently check that the engineer's stated file fact exists and report PASS/FAIL with evidence. No edits.
4. Wait for both reports. Confirm each was created by `spawn_teammate`, not by `subagent` or `subagent_fork`.

## Phase 3 — independent evidence

Use the child ids returned by `spawn_teammate`.

1. Locate each raw child session log under `${DSH_HOME:-$HOME/.dsh}/sessions/**/<child-id>/session.v4.jsonl` (on Windows, the equivalent under `%USERPROFILE%\.dsh` or the configured `DSH_HOME`).
2. In the engineer child log, confirm a `system/message` contains the shipped software-engineer persona and that the `model/selection` event records the Lead's provider/model.
3. In the verifier child log, confirm:
   - a `system/message` contains `You are the delegated teammate "adversarial-red-team-verifier".`;
   - the verifier body text `Be skeptical, precise, calm, and fair.` is present;
   - the `model/selection` event is exactly `provider: kimi-code-bridge`, `model: k3.1-pro`, `reasoningEffort: max`.
4. Read the durable binding document at the configured `bindingsFile` (normally `<workspace>/.dsh/agent-soul/bindings.json`). Confirm entries named `software-engineer` and `adversarial-red-team-verifier` exist and match the same tool matrices and routes.
5. Confirm the verifier's effective tool matrix is the declared set `bash, glob, grep, read, read_image, working_directory, skill`, with the portable shell resolved to the host's live spelling. Team collaboration tools are always kept.
6. Confirm neither child records a generic subagent descriptor and that no unexplained child was created.

## Report

Return a table with one row per check: check, expected, observed, evidence location, verdict.

Include a concise final verdict:

- PASS only if both stock tools were denied, both Soul children ran, both raw session logs show the expected persona/model/tool facts, and the durable bindings match.
- FAIL if any child inherited the wrong persona/model, any stock call succeeded, any evidence conflicts, or a claim is unsupported.
- BLOCKED if a required human toggle or verifier provider route is unavailable.

Finish by running `/orchestrate off` to restore the Lead's prior mode and model. Do not delete the bindings or session logs; they are the evidence.
