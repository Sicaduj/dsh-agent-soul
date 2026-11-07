# Agent Soul smoke harness

Keyless end-to-end verification for the plugin from its own project directory. It boots a real
`dsh --profile headless` process from the DSH source checkout with a temporary `DSH_HOME`,
the Agent Teams bundle, and this workspace's plugin, then drives it with a scripted LLM
adapter (`soul-llm.ts`). No credentials and no network calls are used.

```sh
node smoke/run-smoke.mjs
# or, when the checkout is elsewhere:
DSH_CHECKOUT=/path/to/deepseek-harness node smoke/run-smoke.mjs
```

The harness runs 41 checks and passed 41/41 on 2026-11-07 (a dated point-in-time result; re-run
`node smoke/run-smoke.mjs` to confirm). It asserts, against the real Cordis runtime and real
temporary directories rather than mocks:

- the plugin's bundled defaults are workspace-independent: a brand-new workspace with no
  plugin files at all still sees the shipped soul catalog and the shipped orchestrator
  doctrine as the effective definition, and `bundled: false` restores the strict
  workspace-only behavior;
- the document layer's filesystem fence: a workspace whose `.dsh` is a symlink to an outside
  directory cannot auto-create or duplicate a soul outside the workspace, a configured
  absolute/workspace-relative/symlink alias of the packaged `agents/` directory is classified
  `bundled` and refuses save/delete while the packaged content stays unchanged, and duplicating a
  bundled soul into a fresh workspace still lands under `<workspace>/.dsh/agents`;
- the composed fresh profile (`--dump-config`) exits cleanly, disables the shipped
  `tool-agent-team` row through this bundle's own patch, mounts `agent-soul-team`, and lists exactly
  one `tool-agent-team` row — the portable counterpart of a per-machine profile override;
- the plugin installs its soul surface for the Lead: the Team tools with an `agent_type`
  field, `list_agent_souls`, and one slash command per user-invocable soul (the built-in
  `/orchestrate` command is registered in the same scope; this harness verifies its bundled
  doctrine resolution directly rather than activating the mode end-to-end);
- the Lead prompt carries the soul catalog, `spawn_teammate` exposes `agent_type`, and
  `list_agent_souls` is registered;
- a `spawn_teammate({ agent_type })` teammate gets the soul persona (deployment persona
  shadowed) and the soul body in its system prompt;
- its inherited tool set is exactly the soul's `tools` list, with the Team tools still
  available;
- its model is routed (`deepseek-v4-pro` recorded as the child Session's `model/selection`);
- a `user-invocable` soul registers a slash command that executes and spawns a second
  correctly-configured teammate;
- the durable binding document is written at the portable `<workspace>/.dsh/agent-soul/bindings.json`
  location; the first recorded binding's soul name, tool matrix, and routed model are validated,
  and a binding exists under each teammate's soul name;
- the profile composes from this bundle's real manifest and `cordis.patch.yml` (verified through
  the `--dump-config` checks above), both spawned tool matrices match an exact shared set, and
  inherited canary credentials, proxies, and Node loader flags are scrubbed.

The fixture adapter is a test double: it emits the model chunks a real adapter would emit
for the two scripted turns and records observations to a JSON Lines file. The harness
requires the DSH source checkout (default `/Users/zosyn/LLM/deepseek-harness`; set
`DSH_CHECKOUT` to point elsewhere) because it launches the CLI from TypeScript source with
`tsx`.

## Focused QAS-F001/QAS-F002 remediation regressions

The additional module tests exercise the real binding store with temporary files and the real admin
tool registration with a capturing registry. They cover independent roots/store instances, eight
primed OS processes, canonical symlink aliases, same-root mutation journaling, deletion without
resurrection, read/write failure recovery, equal-timestamp and newest-500 retention, bounded lock
contention, detached snapshots, and all three orchestrator-read variants against the registered
closed output schema:

```sh
node --test smoke/remediation-bindings.test.mjs smoke/remediation-admin.test.mjs
```

The focused real-runtime harness boots fresh headless CLI processes with scripted models and
`claimTeamToolRow: false`. It never installs or repairs the real profile. By default it creates a
new run root under the OS temporary directory; set `QAS_RUN_ROOT` to retain evidence in a chosen
new disposable directory. Every invocation creates fresh timestamp-unique work/evidence folders
rather than rewriting an earlier attempt:

```sh
QAS_RUN_ROOT=/path/to/new/disposable-run \
DSH_CHECKOUT=/path/to/deepseek-harness \
node smoke/remediation-runtime.mjs --target candidate --only all
```

It primes two real plugin stores in separate processes before concurrently spawning through a
shared absolute bindings file, then uses actual process recreation to check cold resume and
fail-closed missing-binding behavior. It also invokes `get_orchestrator` through the registered
tools/results pipeline for bundled, valid-workspace, and invalid-workspace definitions, checks exact
source/path results and unchanged digests, and observes writes during the read. The model adapter is
a fixture: this is runtime evidence, not model-quality, paid-provider, or rendered-browser evidence.

For a before/after comparison, reconstruct the original plugin commit in a separate archive and
name it explicitly. The baseline mode succeeds only when it reproduces one lost binding plus cold
refusal and the exact `INVALID_TOOL_OUTPUT` defects; do not point it at a live installation:

```sh
QAS_RUN_ROOT=/path/to/new/disposable-baseline-run \
QAS_BASELINE_DIR=/path/to/archived-original-plugin \
DSH_CHECKOUT=/path/to/deepseek-harness \
node smoke/remediation-runtime.mjs --target baseline --only all
```
