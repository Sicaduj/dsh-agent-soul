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

15 `node:test` cases; all passed on 2026-11-07.

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
tally); all passed on 2026-11-07.

## Focused "Use Default Agent Souls" toggle regressions

`smoke/config-toggle.test.mjs` covers the P3 configuration toggle at both contract
boundaries. Host cases copy the package (`lib/`, `agents/`, `defaults/`, `index.js`,
`package.json`) into a temporary directory and import the copied `lib/gui-host.js`, then
call the registered route handlers with fake req/res objects and a fake Host
`configEditor` service. Client cases load the real `client.js` classic artifact in a fake
module loader and inspect its registered slot contribution, locale dictionaries, and
toggle source contract. No server, profile, credential, network, or real-package write is
involved. It runs 129 assertions and covers:

- `createGuiRoutes` exposes 15 endpoints over 11 exact paths, including the new
  GET+POST `/agent-soul/config` pair;
- `GET` reports the effective `bundledEditable`/`bundled` flags and `configurable` only
  when the `configEditor` service and the plugin's `agent-soul-team` Loader row are both
  available (missing service, missing row, throwing `entries()`, and throwing service
  lookup stay not configurable);
- `POST` validates the JSON boolean body (400 `invalid-request`), refuses a disabled
  packaged catalog (409 `bundled-disabled`), a missing editor/row (409
  `not-configurable`), and a failed editor write (409 `overridden`), and answers a
  successful write with the applied config;
- a successful write calls `editor.edit(entry, change)` exactly once with the plugin row
  entry, and `change(current)` preserves every other config key (the profile-patch
  shallow-replacement guard);
- the connection trust fence rejects both methods with 401/403 and a composition without a
  fence fails closed with 403;
- `client.js` registers `plugins.row.config` keyed
  `@local/dsh-agent-soul#agent-soul-team` under `settings.agentSoul`, ships the twelve
  toggle locale keys non-empty in all eight dictionaries (with the exact English
  `Use Default Agent Souls` title and `Use default agent souls` labels), removes the old
  `infoBundled`/`Bundled defaults` copy, reads `agent-soul/config` on mount, POSTs
  `{ bundledEditable: boolean }` on toggle, polls the read route after success, and shares
  one control between the Plugins row page and the Settings `Plugin settings & runtime` card.

```sh
node --test smoke/config-toggle.test.mjs
```

8 `node:test` cases and 129 counted assertions (same tally env flag); all passed on 2026-11-07.

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

Give `QAS_RUN_ROOT` a **symlink-free** path (on macOS use `/private/tmp/...` or a directory under
your home, not `/tmp/...` or the default OS temporary directory): the runner compares its expected
workspace paths literally while the CLI reports the session's canonical working directory, so a
run root under a symlinked prefix fails the exact-path check `F001.bundled.workspace-file-path`
even though the plugin answered correctly. The runner throws on the first failed check, so a
symlinked run **stops there** — the remaining checks do not pass, they never run. Observed on
2026-11-07 (macOS, default `DSH_CHECKOUT`): `--target candidate --only all` passed all **169**
checks with a canonical run root; with a symlinked run root (`/tmp/...`; the default OS temporary
directory behaves the same) the run stopped at `F001.bundled.workspace-file-path` with **131 pass
/ 1 fail and 37 checks not executed**. The later `F001.valid`/`F001.invalid` variants compare
`workspace-file-path` and `exact-source-path` the same literal way, so those checks share the
defect and would fail identically if the run reached them.

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
