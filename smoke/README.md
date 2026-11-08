# Agent Soul smoke harness

Keyless end-to-end and focused verification for the plugin from its own project directory. The
end-to-end harness boots a real `dsh --profile headless` process from the DSH source checkout with a
temporary `DSH_HOME`, the Agent Teams bundle, and this workspace's plugin, then drives it with a
scripted LLM adapter (`soul-llm.ts`). The fixtures require no credentials or network access by
design; the harness does not monitor network syscalls.

> **Safety — the direct package tree is supported.** The document write-refusal probes run against a
> run-owned copy of the package imported through its own file URL. The real
> `agents/generalist.md` is read only to snapshot its digest before and after the probes; the
> harness never passes it to a write API and never restores captured bytes. A concurrent legitimate
> edit is therefore preserved and reported as a concurrent external edit, not overwritten.

Prerequisites:

- Start in the plugin project root (the directory containing `package.json` and `smoke/`).
- Use Node **>=24.9.0**, inherited from the DSH checkout's engine requirement.
- Have an existing DSH source checkout with its workspace dependencies installed, including `tsx`.
  `DSH_CHECKOUT` defaults to `/Users/zosyn/LLM/deepseek-harness`; set it to the actual checkout.
- The plugin has no build step, package scripts, or plugin dependencies to install. The fixtures
  need no credentials.

Run it directly from the project root:

```sh
node smoke/run-smoke.mjs
# Or select another existing DSH source checkout:
DSH_CHECKOUT=/path/to/deepseek-harness node smoke/run-smoke.mjs
```

A disposable copy remains optional for extra isolation. If you want one, copy the first-party package
files (excluding Git metadata, dependencies, and runtime state), run there, and remove only that
created copy afterwards (POSIX shell):

```sh
SMOKE_COPY="$(mktemp -d)"
mkdir -p "$SMOKE_COPY/plugin"
cp -R agents defaults docs lib locale smoke "$SMOKE_COPY/plugin/"
cp README.md client.js cordis.patch.yml icon.svg index.js package.json .gitignore "$SMOKE_COPY/plugin/"
cd "$SMOKE_COPY/plugin"
node smoke/run-smoke.mjs
```

The harness runs **50 checks**. It passed **50/50** directly from this working tree on 2026-11-08
(macOS arm64, Node 26.13.0) — a dated point-in-time result, not a platform matrix. It asserts,
against the real Cordis runtime and real temporary directories rather than mocks:

- the plugin's bundled defaults are workspace-independent: a brand-new workspace with no plugin
  files at all still sees the shipped soul catalog and the shipped orchestrator doctrine as the
  effective definition, and `bundled: false` restores the strict workspace-only behavior;
- the document layer's filesystem fence against a run-owned package copy: a workspace whose `.dsh`
  is a symlink to an outside directory cannot auto-create or duplicate a soul outside the workspace,
  a configured absolute/workspace-relative/symlink alias of the packaged `agents/` directory is
  classified `bundled` and refuses save/delete while the isolated packaged content stays unchanged,
  and duplicating a bundled soul into a fresh workspace still lands under
  `<workspace>/.dsh/agents`. The real packaged file is only snapshotted around the probes: an
  unchanged digest and a preserved concurrent external edit are both honest outcomes;
- the composed fresh profile (`--dump-config`) exits cleanly, disables the shipped
  `tool-agent-team` row through this bundle's own patch, mounts `agent-soul-team`, and lists exactly
  one `tool-agent-team` row — the portable counterpart of a per-machine profile override;
- the plugin installs its soul surface for the Lead: the Team tools with an `agent_type` field,
  `list_agent_souls`, and one slash command per user-invocable soul. `/orchestrate` registration is
  an explicit pass assertion, so its absence now fails the run; the mode itself is not activated
  end-to-end;
- the Lead prompt carries the soul catalog, `spawn_teammate` exposes `agent_type`, and
  `list_agent_souls` is registered;
- a `spawn_teammate({ agent_type })` teammate gets the soul persona (deployment persona shadowed)
  and the soul body in its system prompt;
- its inherited tool set is exactly the soul's `tools` list, with the Team tools still available;
- its model is routed (`deepseek-v4-pro` recorded as the child Session's `model/selection`);
- a `user-invocable` soul registers a slash command that executes and spawns a second
  correctly-configured teammate;
- the durable binding document is written at the portable
  `<workspace>/.dsh/agent-soul/bindings.json` location; the first recorded binding's soul name,
  tool matrix, and routed model are validated, and a binding exists under each teammate's soul name;
- the child environment is allowlisted by construction and the harness deterministically seeds
  removable credential, proxy, and loader canaries into its own environment first. The adapter then
  asserts that `SMOKE_CANARY_CREDENTIAL`/`SMOKE_CANARY_SECRET`, `HTTP_PROXY`/`HTTPS_PROXY`,
  `DYLD_INSERT_LIBRARIES`, and the loader canary in `NODE_OPTIONS` are absent while
  `DEEPSEEK_API_KEY` is the empty override. This proves those variables are scrubbed; it is not a
  claim about every possible inherited secret.

The fixture adapter is a test double: it scripts three roles — the Lead, the probe teammate, and
the command-spawned teammate — emits the model chunks a real adapter would emit for them, and
records observations to a JSON Lines file. The DSH checkout requirement comes from launching the
CLI from TypeScript source with `tsx`.

## Focused module suites

The keyless `node:test` suites use temporary directories, real module imports, and fake service
objects; they never write the real package or workspace state. Run all of them with:

```sh
node --test smoke/
```

On 2026-11-08 that command ran **81/81 tests** across eight `node:test` modules (the remediation
pair shares one table row):

| Suite | Cases | Coverage |
|---|---:|---|
| `smoke/remediation-bindings.test.mjs` + `smoke/remediation-admin.test.mjs` | 15 | real binding store with temporary files, independent roots/store instances, primed processes, canonical symlink aliases, same-root mutation journaling, deletion without resurrection, read/write failure recovery, equal-timestamp/newest-500 retention, bounded lock contention, detached snapshots, and all three orchestrator-read variants against the registered closed output schema |
| `smoke/bundled-editable.test.mjs` | 16 (222 assertions) | packaged-editable authoring: config normalization, read-only vs in-place save/delete/restore, bundled-soul shadowing and duplication, symlink confinement, the inert `bundled: false` combination, and the packaged-orchestrator target (in-place save, workspace precedence, mid-edit conflict, flag-off behavior) |
| `smoke/config-toggle.test.mjs` | 8 (129 assertions) | the fifteen-endpoint/eleven-path route pair, the config GET/POST contract and refusal codes, config-editor persistence with every other row key preserved, the connection trust fence, and static client-artifact registration/locale/source assertions |
| `smoke/gui-fixes.test.mjs` | 9 (159 assertions) | client contracts for search wording (all eight dictionaries), raw draft persistence/restore, shared toggle state and clean-view invalidation, poll terminal states (never false Applied), Session-root/dirty-Orchestrator guard, overview shape validation, and live-empty catalog tool rejection through the real Host routes |
| `smoke/storage-fixes.test.mjs` | 18 | transactional refusal of corrupt/unsupported/malformed binding documents with bytes preserved; typed missing/unreadable/corrupt/unsupported/unsafe diagnostics; revalidation after an earlier healthy read (including `get` fail-closed on a partial malformed document); the unpersisted-pending-mutation exception; invalid-snapshot refusal (`E_BINDING_INVALID_RECORD`); repair visibility; trash-failure source preservation; packaged rename collision vs local shadowing; the relative/absolute `bindingsFile` rule including symlinked `.dsh`/`.dsh/agent-soul`, dangling/document symlinks, and trash/restore containment; and the live-catalog missing-default warning |
| `smoke/orchestrator-fixes.test.mjs` | 8 (97 assertions) | handler-seam fault injection for first-enable and already-active queue rollback (exact/partial/fallback/inactive/unknown reports), the corrected bundled doctrine (conditional route, supported task states, strict/budget-scoped correction, quote fix), and the `spawn_teammate` context resolution contract |
| `smoke/smoke-fixes.test.mjs` | 7 (72 assertions) | isolated packaged-write probes and concurrent-edit preservation, seeded environment canaries and explicit `/orchestrate` command assertion, canonicalized symlink run roots, atomic/tolerant readiness barriers, and honest incomplete/unexecuted-suite reporting |

These suites are static/source-contract and route-level evidence where noted; none renders the
browser or executes real UI interactions. Assertion tallies can be printed with
`AGENT_SOUL_ASSERTION_TALLY=1`.

## Remediation runtime

`smoke/remediation-runtime.mjs` is the focused real-runtime harness. It boots fresh headless CLI
processes with scripted models and `claimTeamToolRow: false`, and never installs or repairs the real
profile. It primes two real plugin stores in separate processes before concurrently spawning through
a shared absolute bindings file, then uses actual process recreation to check cold resume and
fail-closed missing-binding behavior. It also invokes `get_orchestrator` through the registered
tools/results pipeline for bundled, valid-workspace, and invalid-workspace definitions, checks exact
source/path results and unchanged digests, and observes writes during the read. The model adapter is
a fixture: this is runtime evidence, not model-quality, paid-provider, or rendered-browser evidence.

By default it creates a fresh random `mkdtemp` run root under the OS temporary directory and retains
it. When `QAS_RUN_ROOT` is set, use a new disposable directory outside both checkouts; it is created
when absent and canonicalized with `realpath` before any expected workspace path is derived. Both a
canonical root and a symlink-prefixed root (for example a `/tmp/...` path on macOS) are supported and
produce the same exact-path assertions. Each invocation creates a fresh random `mkdtemp` work
directory under `runtime-focused/` and a matching retained `evidence/runtime-focused/` tree rather
than rewriting an earlier attempt.

```sh
QAS_RUN_ROOT="$(mktemp -d)" \
DSH_CHECKOUT=/path/to/deepseek-harness \
node smoke/remediation-runtime.mjs --target candidate --only all
```

The candidate run on **2026-11-08** passed **169/169** checks with **2/2 suites**, both with a
canonical root and with a symlink-prefixed root. Each run writes `summary.json` with `status`
(`PASS`/`FAIL`), `complete`, `incompleteSuites`, `unexecutedSuites`, `runnerChecks`,
`adapterAssertions`, suite counts, per-check rows, child-process evidence, and input digests. A run
that stops at the first failure therefore reports the incomplete and unexecuted suites and cannot
read as a full pass. The readiness barriers are published atomically (temporary file plus rename),
and the runner retries an empty or partially written readiness document instead of failing with a
JSON syntax error.

The **2026-11-07 historical observation** is preserved for context: with a symlinked `/tmp/...` root
the run stopped at `F001.bundled.workspace-file-path` with **131 pass / 1 fail and 37 checks not
executed**. That historical path comparison has been fixed by canonicalizing the run root; the
current run above covers both root styles.

For a before/after comparison, reconstruct the original plugin commit in a separate archive and
name it explicitly. The baseline mode succeeds only when it reproduces one lost binding plus cold
refusal and the exact `INVALID_TOOL_OUTPUT` defects; do not point it at a live installation:

```sh
QAS_RUN_ROOT=/path/to/new/disposable-baseline-run \
QAS_BASELINE_DIR=/path/to/archived-original-plugin \
DSH_CHECKOUT=/path/to/deepseek-harness \
node smoke/remediation-runtime.mjs --target baseline --only all
```

Both path placeholders must name directories you created or identified for this run; the baseline
archive must not be the live installation.

## Current aggregate results

On 2026-11-08 the focused suites passed **81/81**:

```sh
node --test smoke/
```

The direct-tree smoke harness passed **50/50**, and the candidate remediation runtime passed
**169/169** with **2/2 suites** on both canonical and symlink-prefixed disposable run roots. These
are point-in-time results for the current macOS arm64 / Node 26.13.0 environment, not claims for
other platforms or Node versions.

## Explicitly unrun or outside this evidence

- **Baseline remediation:** not run; it requires an archived original plugin in `QAS_BASELINE_DIR`.
- **Rendered browser behavior:** not run. Client source-contract cases do not execute hooks, DOM,
  fetch, timers, or rendered interactions.
- **Real providers and model quality:** not exercised; scripted fixtures establish no paid-provider,
  credential, network-syscall, or model-quality evidence.
- **Full orchestration lifecycle:** Orchestrator mode is not activated end to end; its command
  registration is asserted, and rollback/doctrine behavior is covered at the handler seam with an
  in-memory Agent double.
- **Other operating systems or Node versions:** not run.
- **Full DSH repository suite:** outside this plugin package's scope.
