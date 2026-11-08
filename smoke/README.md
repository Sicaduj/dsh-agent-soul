# Agent Soul smoke harness

Keyless end-to-end verification for the plugin from its own project directory. It boots a real
`dsh --profile headless` process from the DSH source checkout with a temporary `DSH_HOME`,
the Agent Teams bundle, and this workspace's plugin, then drives it with a scripted LLM
adapter (`soul-llm.ts`). The fixtures require no credentials or network access by design; the
harness does not monitor network syscalls.

> **Safety — use a disposable package copy until the write probes are fixed.** The refused-write
> probes address the real `agents/generalist.md` beside the running package, capture its bytes, and
> restore those bytes in `finally` if the file changed. A concurrent edit can therefore be
> overwritten, and a crash after an unexpected successful write can leave the mutation behind. Do
> not run this harness against the real source/package tree.

Prerequisites:

- Start in the plugin project root (the directory containing `package.json` and `smoke/`).
- Use Node **>=24.9.0**, inherited from the DSH checkout's engine requirement.
- Have an existing DSH source checkout with its workspace dependencies installed, including `tsx`.
  `DSH_CHECKOUT` defaults to `/Users/zosyn/LLM/deepseek-harness`; set it to the actual checkout.
- The plugin has no build step, package scripts, or plugin dependencies to install. The fixtures
  need no credentials.

Create and enter a disposable copy of the first-party package files, excluding Git metadata,
dependencies, and runtime state, then run there (POSIX shell):

```sh
SMOKE_COPY="$(mktemp -d)"
mkdir -p "$SMOKE_COPY/plugin"
cp -R agents defaults docs lib locale smoke "$SMOKE_COPY/plugin/"
cp README.md client.js cordis.patch.yml icon.svg index.js package.json .gitignore "$SMOKE_COPY/plugin/"
cd "$SMOKE_COPY/plugin"
node smoke/run-smoke.mjs
# Or select another existing DSH source checkout:
DSH_CHECKOUT=/path/to/deepseek-harness node smoke/run-smoke.mjs
```

Keep the temporary location only as long as needed for inspection, then remove only that created
copy. The second command is an alternative to the first run, not an additional required pass.

The harness runs 41 checks and passed 41/41 from an isolated package copy on 2026-11-08 (a dated
point-in-time result). The direct real-tree run was deliberately not executed because of the write
hazard above. It asserts, against the real Cordis runtime and real temporary directories rather
than mocks:

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
  field, `list_agent_souls`, and one slash command per user-invocable soul. `/orchestrate` was
  observed in the command list, but the pass condition asserts only `probe-cli`; its absence would
  not fail the harness. Bundled orchestrator doctrine resolution is checked directly, without
  activating the mode end-to-end.
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
  the `--dump-config` checks above), both spawned tool matrices match an exact shared set. The child environment is
  allowlisted by construction, and the adapter checks that its canary/proxy/loader names are absent;
  the runner does not deterministically seed those canaries, so this is not proof that every
  possible inherited secret is scrubbed.

The fixture adapter is a test double: it scripts three roles — the Lead, the probe teammate, and
the command-spawned teammate — emits the model chunks a real adapter would emit for them, and
records observations to a JSON Lines file. The DSH checkout requirement comes from launching the
CLI from TypeScript source with `tsx`.

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

15 `node:test` cases; all passed on 2026-11-08.

## Focused bundledEditable regressions

`smoke/bundled-editable.test.mjs` covers the opt-in in-place authoring mode
(`config.bundledEditable`) for packaged soul documents and the packaged orchestrator
doctrine. Every case copies `lib/`, `agents/`, `defaults/`, `package.json`, and
`index.js` into a fresh temporary package and imports the copy through its own file URL, so
`BUNDLED_SOULS_DIR` and `BUNDLED_ORCHESTRATOR_PATH` resolve inside the copy and the real
package is never written; workspace roots are separate temporary directories and both are
removed afterwards. It runs 222 assertions and covers:

- config normalization (a boolean is accepted, every other type is a `TypeError`, the flag
  is inert while `bundled: false` and activation warns once) and `bundledEditableEnabled`;
- the default config: packaged rows are `bundled: true`/`packageOwned: true` with
  package-relative labels, in-place save/delete are refused with `unsafe-path`, and
  workspace shadowing plus same-name duplication behave exactly as before;
- `bundledEditable: true`: packaged rows are `bundled: false`/`packageOwned: true`,
  in-place saves are atomic (no temporary leftovers) and a stale `expectedHash` returns
  `conflict` (the GUI's 409), delete moves the file to the workspace trash and restore
  round-trips, create/duplicate still write only to workspace directories, a local
  same-name soul still shadows the packaged row, and a symlink alias of the packaged
  directory stays inside the copy while an escaping symlink is refused;
- `bundled: false`: the flag is inert and no packaged catalog is scanned or readable;
- the GUI document route: 400 `unsafe-path` for a read-only in-place save, 409
  `conflict` with `currentHash` for a stale save, and the overview's
  `settings.bundledEditable`/`settings.bundledDir`;
- the Phase 2 orchestrator: the packaged doctrine is read and saved in place (no workspace
  `orchestrator.md` is created), a workspace file wins for both read and save, deleting it
  falls back to the packaged doctrine, an appearing workspace file turns the save into
  `conflict`, and flag-off or `bundled: false` keep the historical workspace paths.

```sh
node --test smoke/bundled-editable.test.mjs
```

16 `node:test` cases and 222 counted assertions (set `AGENT_SOUL_ASSERTION_TALLY=1` to print the
tally); all passed on 2026-11-08.

## Focused "Use Default Agent Souls" toggle regressions

`smoke/config-toggle.test.mjs` covers the bundled-editable configuration toggle at both contract
boundaries. Host cases copy the package (`lib/`, `agents/`, `defaults/`, `index.js`,
`package.json`) into a temporary directory and import the copied `lib/gui-host.js`, then
call the registered route handlers with fake req/res objects and a fake Host
`configEditor` service. Client cases evaluate the real `client.js` classic artifact with a minimal
React/module-loader double and inspect its registered slots, locale dictionaries, and source
strings. Hooks, DOM, fetch, timers, and rendered interactions do not execute. No server, profile,
credential, network, or real-package write is involved. It runs 129 assertions and covers:

- `createGuiRoutes` exposes 15 endpoints over 11 exact paths, including the new
  GET+POST `/agent-soul/config` pair;
- `GET` reports the effective `bundledEditable`/`bundled` flags and `configurable` only
  when the `configEditor` service exposes `edit` and lists the plugin's `agent-soul-team` Loader
  row (missing service/edit/row, throwing `entries()`, and throwing service lookup stay not
  configurable);
- `POST` validates the JSON boolean body (400 `invalid-request`), refuses a disabled
  packaged catalog (409 `bundled-disabled`), a missing editor/row (409
  `not-configurable`), and a failed editor write (409 `overridden`), and answers a
  successful write with the applied config;
- a successful write calls `editor.edit(entry, change)` exactly once with the plugin row
  entry, and `change(current)` preserves every other config key (the profile-patch
  shallow-replacement guard);
- the connection trust fence rejects both methods with 401/403 and a composition without a
  fence fails closed with 403;
- the evaluated `client.js` artifact registers `plugins.row.config` keyed
  `@local/dsh-agent-soul#agent-soul-team` under `settings.agentSoul` and ships the twelve toggle
  locale keys non-empty in all eight dictionaries (with the exact English `Use Default Agent Souls`
  title and `Use default agent souls` labels), with old `infoBundled`/`Bundled defaults` copy
  removed. Separate static source assertions check the mount GET, boolean POST, polling calls, and
  shared hook/control source; they do not establish that those interactions ran in a browser.

```sh
node --test smoke/config-toggle.test.mjs
```

8 `node:test` cases and 129 counted assertions (same tally env flag); all passed on 2026-11-08.

## Current aggregate results

On 2026-11-08 the focused suites passed 15/15 remediation cases, 16/16 bundled-editable cases with
222 counted assertions, and 8/8 config-toggle cases with 129. Both aggregate forms passed **39/39**:

```sh
node --test smoke/
node --test smoke/remediation-bindings.test.mjs smoke/remediation-admin.test.mjs smoke/bundled-editable.test.mjs smoke/config-toggle.test.mjs
```

The isolated package-copy smoke run passed **41/41**, and the candidate remediation runtime passed
**169/169** with a canonical, isolated run root. These are point-in-time results for the current
macOS/Node environment, not claims for other platforms or Node versions.

The focused real-runtime harness boots fresh headless CLI processes with scripted models and
`claimTeamToolRow: false`. It never installs or repairs the real profile. By default it creates a
fresh random `mkdtemp` run root under the OS temporary directory and retains it. When
`QAS_RUN_ROOT` is set, require a **new, disposable, symlink-free directory outside both checkouts**.
Each invocation creates a fresh random `mkdtemp` work directory under `runtime-focused/` and a
matching retained `evidence/runtime-focused/` tree rather than rewriting an earlier attempt. On
macOS, create the canonical root explicitly (replace the DSH path with your checkout):

```sh
QAS_RUN_ROOT="$(mktemp -d /private/tmp/agent-soul-qas.XXXXXX)" \
DSH_CHECKOUT=/path/to/deepseek-harness \
node smoke/remediation-runtime.mjs --target candidate --only all
```

Do not use `/tmp/...` or another symlinked prefix for `QAS_RUN_ROOT`: the runner compares expected
workspace paths literally while the CLI reports the session's canonical working directory. A
symlinked prefix therefore fails `F001.bundled.workspace-file-path` even when the plugin answered
correctly, and the runner stops on that first failure. The default OS-temp root is also retained
and can inherit this platform alias issue, so an explicit canonical root is the reliable method on
macOS.

The current candidate run on **2026-11-08** passed **169/169** with a canonical isolated run root.
The **2026-11-07 historical observation** was different: with a symlinked `/tmp/...` root the run
stopped at `F001.bundled.workspace-file-path` with **131 pass / 1 fail and 37 checks not executed**.
That symlink failure was not reproduced in the current run. The later `F001.valid`/`F001.invalid`
variants compare `workspace-file-path` and `exact-source-path` the same literal way, so the
historical analysis expected them to fail too if reached; that is not a current executed result.

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
QAS_RUN_ROOT=/path/to/new/symlink-free-disposable-baseline-run \
QAS_BASELINE_DIR=/path/to/archived-original-plugin \
DSH_CHECKOUT=/path/to/deepseek-harness \
node smoke/remediation-runtime.mjs --target baseline --only all
```

Use the same fresh, canonical, symlink-free run-root rules as the candidate command. Both path
placeholders must name directories you created or identified for this run; the baseline archive must
not be the live installation.

## Explicitly unrun or outside this evidence

- **Baseline remediation:** not run; it requires an archived original plugin in `QAS_BASELINE_DIR`.
- **Direct real-tree smoke:** deliberately skipped for the D1 real-package mutation hazard above;
  the 41/41 result used an isolated package copy.
- **Symlink failure reproduction:** not rerun on 2026-11-08; only the historical 2026-11-07
  observation is reported.
- **Rendered browser behavior:** not run. In particular, client source-contract tests do not execute
  hooks, DOM, fetch, timers, or rendered interactions.
- **Real providers and model quality:** not exercised; scripted fixtures establish no paid-provider,
  credential, network-syscall, or model-quality evidence.
- **Orchestrator activation:** not run end to end; the command's presence is not a pass assertion.
- **Other operating systems or Node versions:** not run.
