# @local/dsh-agent-soul — internals (maintainers)

This is the module-by-module architecture contract for the plugin. It covers the Agent Teams
runtime, the soul/orchestrator document layers, the Host GUI routes, and the lifecycle that ties
them together.

- User onboarding: [`../README.md`](../README.md)
- Every editable control, explained: [`SOUL-OPTIONS.md`](SOUL-OPTIONS.md)
- GUI/API contract (routes, payloads, browser artifact, styling, phase history):
  [`GUI-INTERNALS.md`](GUI-INTERNALS.md)
- End-to-end harness: [`../smoke/README.md`](../smoke/README.md)

Status: P0–P4, the soul-only/default-Soul release, and the release-remediation contracts (reserved
`lead` identity, built-in-command priority and handler-identity status, orchestrator route
validation, and actionable cold-resume refusals) are implemented and live. The phase sections in
`GUI-INTERNALS.md` are history, not a roadmap; this document describes the resulting architecture.

## What the plugin does

Agent Teams spawns teammates through `spawn_teammate`. This bundle's profile patch disables the
shipped `tool-agent-team` row and inserts `agent-soul-team`, a soul-aware copy of the Team
tool surface. It keeps the shipped tools and adds:

1. **Soul definitions** — Markdown files with YAML frontmatter (`name`, `description`, `tools`,
   optional `model`/`provider`/`reasoning-effort`/`context`/`user-invocable`) and a body with the
   conventional Role Definition / Inputs You Will See / Hard Rules / Output Format sections.
2. `spawn_teammate({ ..., agent_type })` — starts a teammate running one soul: persona section placed at the deployment-persona order,
   tool permission matrix, routed model, default spawn context. Omitting `agent_type` resolves the
   configured **default Soul** (usable preference document → persisted selection → any live catalog
   definition named `generalist` → actionable failure); the fallback need not be packaged. A
   malformed/corrupt preference fails the spawn rather than falling back, and there is no plain
   no-Soul path.
3. `list_agent_souls` — full definition rows plus diagnostics and optional bodies.
4. A Lead-only prompt catalog so the Lead can semantically match task → soul.
5. An optional user-invocable slash command per soul (the bundled souls are AI-only until opted in).
6. A durable binding store so cold-resumed teammates re-apply their soul. Admission is fail-closed:
   a new or cold-resumed roster teammate with no pending plan and no readable durable binding is
   refused.
7. An optional **orchestrator definition** and the `/orchestrate` session command, which applies
   Lead doctrine and optional model/tool overrides, always announces activation, and renames the
   Session title when the optional session-title service is present and a prior title exists.
8. **Soul-only delegation fences** — scoped tool restriction (reconciled across late tool
   registrations) + `tools.guard` in every Team member scope, plus the `agent/created` creation veto
   for any non-roster child of a Team member.

The plugin is plain ESM JavaScript with no runtime dependencies. It is loaded from a DSH profile
where only the harness installation resolves, so imports must be `node:` builtins or relative
`./x.js` files.

## Architecture at a glance

```
profile cordis.patch.yml
  tool-agent-team (shipped)        → disabled
  agent-soul-team (index.js)    → this plugin
      normalizeConfig
      createCatalog            (lib/soul.js)
      createPreferenceStore    (lib/preferences.js)
      createBindingStore       (lib/bindings.js)
      createPendingSpawns      (lib/apply.js)
      createOrchestratorRuntime(lib/orchestrator.js)
      await sessionProjections.register(orchestratorModeDefinition) (lib/orchestrator-mode.js)
      deps object              (index.js)
      creation fence           → assertSoulOnlyTeamChild (lib/spawn.js)
      per-Agent install:
        every Team member      → installTeamTools (lib/tools.js)
                                 + generic-subagent restriction/guard
                                 + tools/change reconciliation
                                 + team prompt sections
        Lead                   → /orchestrate command (built-in first; lib/orchestrator.js)
                                 + soul slash commands (lib/commands.js)
                                 + manage_agent_souls (lib/admin-tool.js)
                                 + orchestrator.reapplyIfActive
        teammate               → applyTeammateSoul (lib/apply.js)
      optional ctx.inject(webServer, connection, agents, agentTeams):
        installGui             → lib/gui-host.js routes
                                 → lib/admin.js document layer
                                 → lib/preferences.js default-Soul state
                                 → lib/orchestrator.js definition layer

browser client.js  →  relative fetch  →  authenticated Host routes  →  files on disk
```

The GUI and the Lead-facing `manage_agent_souls` tool share the document layer and parser, but not
every semantic validator or concurrency guard: GUI saves add live semantic validation and optional
`expectedHash` protection, while the agent tool saves raw source without those GUI validators and
uses last-write-wins. The orchestrator has one document layer and one runtime; the GUI and agent
tool share the document layer, while the command and runtime share the application path.

## Module map

| File | Role | Main exports / entry points |
|---|---|---|
| [`index.js`](../index.js) | Cordis plugin entry; config normalization; deps; creation fence; veto-only admission and lifecycle-safe per-Agent installation; pre-existing-Agent activation policy | `name`, `inject`, `normalizeConfig(raw, logger)`, `resolveRoot(ctx, agent)`, `createDeps(ctx, config, catalog, bindings, pending, logger)`, `apply(ctx, rawConfig)` |
| [`lib/soul.js`](../lib/soul.js) | Soul parser/validator (including the reserved `lead` identity), persona composition, catalog discovery and prompt text | `parseFrontmatter`, `parseSoulMarkdown`, `composePersona`, `catalogPromptText`, `createCatalog` |
| [`lib/model.js`](../lib/model.js) | Resolve a frontmatter `model`/`provider`/`reasoning-effort` into one route | `resolveModelRoute(raw, services)` |
| [`lib/spawn.js`](../lib/spawn.js) | Spawn orchestration shared by the tool and slash commands; default-Soul resolution; soul-only creation fence; list/command operations | `commandNameFor`, `nextTeammateName`, `assertSoulOnlyTeamChild`, `spawnTeamMember`, `describeSouls`, `spawnSoulFromCommand` |
| [`lib/preferences.js`](../lib/preferences.js) | Plugin-owned default-Soul preference document, default resolution, GUI-facing preference block | `PREFERENCES_FILE_NAME`, `BUILTIN_DEFAULT_SOUL`, `preferencesPathOf`, `readPreferences`, `savePreferences`, `resolveDefaultSoul`, `describePreferences`, `createPreferenceStore` |
| [`lib/apply.js`](../lib/apply.js) | Apply one soul to a freshly created or cold-resumed teammate; fail-closed plan resolution (pending plan, then durable binding); pending-spawn handoff; bounded cold-resume admission diagnostics | `createPendingSpawns`, `createAdmissionDiagnostics`, `SoulPlanUnavailableError`, `applyTeammateSoul` |
| [`lib/commands.js`](../lib/commands.js) | Register one Lead-scoped slash command per user-invocable soul; reconcile them by handler identity; report collisions | `installSoulCommands`, `createSoulCommandSync`, `soulCommandRegistrationState` |
| [`lib/tools.js`](../lib/tools.js) | Soul-aware copy of the Team tool surface, prompt sections, and the tools/change-reconciled generic-subagent restriction/guard | `TEAM_TOOL_NAMES`, `GENERIC_SUBAGENT_TOOLS`, `installTeamTools(agent, scope, args)` |
| [`lib/composition.js`](../lib/composition.js) | Team-tool row composition: Loader inspection, Plugin Manager repair, opt-in automatic claim | `TEAM_TOOL_ROW_ID`, `TEAM_TOOL_PLUGIN_NAME`, `PROFILE_PATCH_FIX`, `inspectTeamToolSurface(ctx)`, `repairTeamToolSurface(options)`, `createCompositionGuard(options)` |
| [`lib/bindings.js`](../lib/bindings.js) | Durable per-teammate binding store for cold resume and GUI usage | `createBindingStore(options)` |
| [`lib/admin.js`](../lib/admin.js) | Document layer: split/compose/validate, scan, read/save/create/duplicate/delete/restore, path safety, hashes | `documentHash`, `resolveSoulDirs`, `resolveGuiRoot`, `splitDocument`, `composeDocument`, `canonicalSkeleton`, `listDocuments`, `readDocument`, `saveDocument`, `saveDocumentSource`, `createDocument`, `duplicateDocument`, `deleteDocument`, `restoreDocument` |
| [`lib/orchestrator.js`](../lib/orchestrator.js) | Orchestrator definition layer (with declaration-level route validation and an optional live-route validator), compact summary, `/orchestrate` command, session-scoped runtime | `ORCHESTRATE_COMMAND_NAME`, `splitOrchestrator`, `composeOrchestrator`, `canonicalOrchestratorSkeleton`, `orchestratorPathOf`, `readOrchestrator`, `saveOrchestrator`, `orchestratorRouteDiagnostics`, `orchestratorSummary`, `substituteTemplate`, `createOrchestratorRuntime`, `installOrchestratorCommand` |
| [`lib/orchestrator-mode.js`](../lib/orchestrator-mode.js) | Shared pure durable-mode fold and Host session projection definition used by the runtime read and the Session-header badge | `ORCHESTRATE_COMMAND_NAME`, `ORCHESTRATOR_MODE_PROJECTION_KEY`, `ORCHESTRATOR_MODE_STATE_VERSION`, `orchestratorModeNext`, `orchestratorModeInit`, `orchestratorModeFold`, `orchestratorModeOf`, `orchestratorModeView`, `orchestratorModeStateSchema`, `orchestratorModeViewSchema`, `orchestratorModeDefinition` |
| [`lib/gui-host.js`](../lib/gui-host.js) | Authenticated JSON routes, overview assembly, workspace-root selection, command/usage/health status | `createGuiRoutes(deps)`, `installGui(pluginCtx, deps)` |
| [`lib/admin-tool.js`](../lib/admin-tool.js) | Lead-only `manage_agent_souls` tool over the document/orchestrator layers | `installSoulAdminTool(agent, scope, deps)` |
| [`client.js`](../client.js) | Classic browser artifact: Settings → "Agent Soul" page (Souls + Orchestrator tabs, dialogs, locale dictionaries; both editors share the live provider/model catalog pickers) plus the Plugins-page row config (the **Use Default Agent Souls** toggle) and the Session-header Orchestrator-mode badge | `window.__ModuleLoader__.load({ id, factory(require) { … } })` |
| [`locale/`](../locale/) | Package locale metadata (`en`, `zh`); the page's eight full dictionaries are inside `client.js` | JSON metadata |
| [`smoke/run-smoke.mjs`](../smoke/run-smoke.mjs) | Keyless end-to-end harness: real headless DSH plus a scripted LLM adapter | runner |
| [`smoke/soul-llm.ts`](../smoke/soul-llm.ts) | Scripted test-double LLM adapter for the smoke harness | adapter |
| [`smoke/contract.mjs`](../smoke/contract.mjs) | Shared expected Team-tool contract for the smoke run | `TEAM_TOOL_NAMES`, `expectedSoulTools` |

This tree ships no `tests/` directory and no test glob or test script:
[`package.json`](../package.json) has no `scripts` section and ships no test pattern in its `files`
list (the `smoke/*.mjs` suites and [`smoke/README.md`](../smoke/README.md) are listed there).
Focused keyless `node:test` suites live under `smoke/` instead — details in *Testing expectations*
below.

## Configuration and shared deps

`apply()` normalizes the loader row before building anything. Unknown keys warn and are ignored;
malformed values throw, which fails activation rather than running with half-applied limits.

```js
// Config passed to the modules. Values below are the defaults; ranges are enforced.
{
  dirs: ['.dsh/agents'],                 // non-empty string[]; absolute, ~/…, or workspace-relative
  bundled: true,                         // boolean; append the package catalog + default doctrine
  bundledEditable: false,                // boolean; opt-in: edit the packaged catalog/doctrine in place
                                         //   (inert + one activation warning while bundled is false)
  commandPrefix: '',                     // /^[a-z0-9_-]*$/
  maxDefinitions: 64,                    // integer 1..1000
  maxPromptChars: 12000,                 // integer 1000..200000
  bindingsFile: '.dsh/agent-soul/bindings.json', // non-empty string; absolute or relative
  freshProvider: 'spawn',                // non-empty string
  forkProvider: 'fork',                  // non-empty string
  interrupt: true,                       // boolean
  defaultContext: 'fresh',               // 'fresh' | 'fork'
  claimTeamToolRow: false,               // boolean; the bundled patch sets true
}
```

The bundled [`cordis.patch.yml`](../cordis.patch.yml) deliberately sets no paths: one installation is
portable, and every Session resolves user content against its own workspace root. The package
resolves its own bundled assets from `import.meta.url` (so a linked checkout, a profile package
copy, and a source run behave the same):

- `lib/soul.js` exports `BUNDLED_SOULS_DIR` (`<package>/agents`); with `bundled` enabled the catalog
  scan appends it after the configured directories. A local soul with the same name shadows the
  bundled copy and suppresses the duplicate diagnostic.
- `lib/orchestrator.js` exports `BUNDLED_ORCHESTRATOR_PATH` (`<package>/defaults/orchestrator.md`);
  when the workspace definition is absent and `bundled` is enabled, `readOrchestrator` reports the
  packaged source as the effective detail (`configured: true`, `bundled: true`, `sourcePath` set,
  `path` still the writable workspace target). With `bundledEditable` enabled it instead reports the
  packaged file as the editable effective document (`path` = `sourcePath` = the packaged path,
  `bundled: false`), and `saveOrchestrator` rewrites that file in place under a dedicated
  packaged-path check (exact packaged path, real parent equal to the package's real `defaults/`
  directory, no symlink escape) instead of the state-directory fence. A workspace definition always
  wins, and one that appears while the save is in flight is re-checked just before the write and
  answers `conflict` instead of being clobbered.
- `lib/admin.js` exposes `bundledSoulsDir(config)` and `bundledEditableEnabled(config)`; package
  ownership and read-only status are separate. The packaged-directory check is canonical (`realpath`)
  and runs before any configured-directory match, so an absolute path, workspace-relative alias, or
  symlink to `<package>/agents` keeps its packaged identity (`packageOwned: true`) instead of
  becoming an editable configured directory. By default (`bundledEditable` false) a package-owned
  document is read-only (`bundled: true`): `resolveTarget` refuses writes/deletes there with a
  message telling the caller to duplicate the soul into a workspace directory, and `writableDirs`
  excludes that canonical directory from writable targets. With `bundledEditable` true the same
  files are listed with `bundled: false` + `packageOwned: true`, keep package-relative labels and
  the local-shadow/duplicate-name semantics, and accept save/delete/restore in place (delete still
  trashes into the workspace trash) while create/duplicate still write the configured directories.
  `writableDirs` also
  creates the first workspace-relative configured directory on demand so a fresh workspace can save
  a new soul, but only after resolving the real workspace root and the real nearest existing
  ancestor with `realpath`: an ancestor outside the real workspace refuses the creation (nothing is
  written), and the created directory is canonically re-checked before it is returned.

The `deps` object is built once by `index.js` and passed unchanged to every module:

```js
// deps = {
//   ctx,                      // ROOT plugin context (not the Agent scope)
//   config,                   // normalized config above
//   catalog,                  // createCatalog() result
//   bindings,                 // createBindingStore() result
//   pending,                  // createPendingSpawns() result
//   preferences,              // createPreferenceStore({ config }) result
//   admissionDiagnostics,     // createAdmissionDiagnostics() bounded cold-resume refusal sink
//   logger,                   // ctx.logger('agent-soul')-style logger
//   rootOf(agent),            // absolute workspace root for one agent
//   pendingKey(leadOrRoot, name), // stable key: `${id}\0${name}`
//   async resolveModel(raw),  // { model?, provider?, reasoningEffort? } -> ResolvedModel | undefined
//   async spawnTeamMember(deps, lead, args),
//   async describeSouls(deps, lead, options),
//   async spawnSoulFromCommand(deps, lead, definition, rawInput, options),
//   composition,              // createCompositionGuard({ ctx, config, logger }) result
//   orchestrator,             // the process-wide runtime, for isActive() reads from lib/tools.js
//   soulCommandRegistration(agent), // per-Lead { registered, failed } record, for handler-identity status
//   syncSouls(),              // reconcile every live Lead's soul slash commands
// }
```

`resolveModel` resolves against the live provider topology and model catalogs on every request so
adapter/catalog changes cannot leave a stale route cached. Its optional `{ signal }` argument is
forwarded to adapter model-info resolution and checked between sequential provider/definition calls.

The plugin's required services are `agents`, `agentTeams`, `tools`, `systemPrompt`, and
`sessionProjections` (`inject`). Optional services are looked up per use: `llm` and
`agentDefaultModel` for routing, `workingDirectory` for roots, `commands` for slash commands,
`sessionTitle` for the orchestrator Session rename, and `webServer` + `connection` for the GUI. A
missing optional service degrades a feature, not plugin activation.

`apply()` also creates one process-wide `createOrchestratorRuntime(deps)`. It is stored on `deps` as
`deps.orchestrator` so `lib/tools.js` can read `isActive(agent)` when rendering `team:identity` and
the model-facing roster; the runtime object is also passed explicitly to the command and lifecycle
wiring.

Before installing any live Agent, `apply()` awaits
`ctx.sessionProjections.register(orchestratorModeDefinition)` and retains the ready handle on
`deps.orchestratorModeProjection`. The projection key is `agentSoulOrchestrator`, its
`stateVersion` is 1, and `wire.summary` is `false` (the badge value is needed only for an open
Session, not a Session-list summary). Registration failure is logged and only the badge is absent;
the command, runtime, and every other soul capability still activate. The registration's fiber
lifetime releases the unit on plugin teardown.

## Operation flows

### 1. Spawning a teammate

Both `spawn_teammate` (Lead tool) and a user-invocable slash command enter through
`lib/spawn.js`:

1. Validate `name` (lower-kebab-case, at most 64, not `lead`), `description` (non-empty, at most
   200), `prompt` (non-empty), and any supplied `context` before reading a service.
2. Refresh the catalog for the Lead's workspace. With `agent_type`, find that definition; unknown
   names throw with the available names and an invalid-file hint. The reserved identity is rejected
   even before the catalog lookup: `requireSoul` throws
   `agent soul "lead" is reserved for the Team Lead; choose a different agent_type`, and the
   default-Soul path runs the same guard on the resolved definition, so a manually written or stale
   catalog entry named `lead` can never reach a child. The refusal happens before model resolution,
   the pending plan, roster creation, or a durable binding write, so it leaves no half-created
   teammate. Without `agent_type`, read
   `<dirname(bindingsFile)>/preferences.json` and resolve the default Soul:
   explicit selection → any live catalog definition named `generalist` → an actionable failure. The
   fallback is not inherently bundled: a configured-directory/local definition counts, including one
   that shadows the packaged copy or appears with `bundled: false`; the result's `source: 'builtin'`
   label does not establish package origin. A stale selection fails; a corrupt, malformed, or
   unsupported preferences document is a warning that fails the default spawn with that reason (there
   is no fallback to `generalist`); a document or state directory that cannot be read fails the spawn
   with its path. An explicit `agent_type` never reads the preferences document. There is no generic
   fallback.
3. Validate the soul's tool list against the Lead's visible tool definitions:
   - Team tools are rejected: they are own-scope and cannot be restricted.
   - Any name not visible in the current session is rejected before a teammate exists.
   - When the `tools` service is unavailable, the check is skipped; a failure of
     `tools.definitions(lead)` itself is logged and the check is skipped.
4. Resolve `context`: explicit tool argument → soul `context` → `config.defaultContext`; reject
   anything other than `fresh`/`fork`. The Agent Teams provider is `freshProvider`/`forkProvider`.
5. Resolve the model declaration through `deps.resolveModel`. `undefined` means inherit.
6. Build the plan:
   `{ name, persona, tools, model, context, sourceLabel }`.
7. Put the plan in `deps.pending` under `deps.pendingKey(lead, requestedName)`, call
   `ctx.agentTeams.spawnTeammate`, and remove the pending entry in `finally`. After the spawn
   resolves, write the durable binding for `member.id`.
8. Return `{ member, soul: { name, tools, model } }` (model rendered as
   `provider/model`, or `null` only when no model was declared and the route was inherited). An
   unresolved declaration throws; it is never reported as inherited `null`. The `spawn_teammate`
   tool rejects a result without a named Soul, so the output contract cannot regress to a plain
   teammate.
9. The child's `agent/created` listeners run in order: the plugin's creation fence first, then
   `install()`. For a teammate, `installTeamTools` runs first, then `applyTeammateSoul`:
   - resolve the plan: pending entry first (consumed, whether or not it resolves), then
     `bindings.get(root, agent.id)`. A missing plan, or a binding read that throws, is a
     `SoulPlanUnavailableError`: admission is fail-closed and the creation listener rejects
     publication instead of running the child under the deployment persona;
   - register the persona section `deployment:persona-prefix` at the deployment persona order,
     with the composed persona text;
   - probe every `tools` name with `restrict({ allow: [name] })`, immediately disposing the probe;
     names that throw are not restrictable in this scope (Team tools, unknown names) and are
     skipped with a warning; apply one final `restrict({ allow: restrictable })` (or `allow: []` to
     deny all inherited tools);
   - select the resolved model with `agent.model.select(route)`;
   - persist the binding only when the plan came from the pending spawn (a cold-resume plan already
     exists in the store).
   - Plan-resolution failure is the one admission veto and also unwinds the Team tools registered
     earlier in `install()`. Agent disposal, creation cancellation, plugin teardown, and unexpected
     persona/tool/model failures unwind partial effects but resolve as logged skips rather than
     escaping as another veto. Binding persistence failures are logged without vetoing an otherwise
     fully applied soul. `maybeInstall` observes its shared task internally, so an abandoned caller
     cannot produce an unhandled rejection even for the explicit veto.

**Creation fence.** `index.js` registers `assertSoulOnlyTeamChild(deps, agent)` as a serial
`agent/created` listener before installing anything. It resolves the child's
`session.header.parentSession` to a live Agent and asks `agentTeams.tryMembership`. A child that
resolves as `role: 'teammate'` is allowed; a child of a Team member that resolves outside the roster
(an undefined membership for a provider-owned `origin: 'subagent'` child, or an unclassifiable
direct child) throws, and the serial listener failure vetoes publication. A seeded host fork is
its own Team root and stays allowed. Because every child Agent creation passes through this event,
the fence also catches generic children started indirectly through the subagent seam — for example a
workflow run's `agent()` calls, which start a provider-owned child with the calling Agent as parent;
the child is never published and the start fails, so the workflow `agent()` promise rejects with an
`AGENT_START` error instead of returning a child.

The roster allowance is not an admission without a Soul: `applyTeammateSoul` runs in the same serial
listener chain and throws `SoulPlanUnavailableError` when a new or cold-resumed roster teammate has
no pending plan and no durable binding (or the binding read throws), so publication is vetoed. At
plugin activation the same predicate is evaluated for existing Agents: a non-roster child is skipped
with a warning, and a pre-existing roster teammate without a usable plan is skipped with a warning
after its partial registrations (including the Team tools) are unwound. Those Agents were already
published, so activation cannot veto them; it only declines to attach the plugin surface.

There is no plain no-Soul spawn path. The three independent layers are: the scoped tool restriction,
the scoped `tools.guard`, and this creation fence.

**Teammate-name contract (DOC-01).** The direct `spawn_teammate` path passes the requested name
unchanged to `ctx.agentTeams.spawnTeammate`; the Team service refuses a name already used in the
Team, and the plugin adds one earlier check: a second spawn for the same Lead and requested name while
the first is still pending is refused by `deps.pending.set` before the Team service is reached
(`a soul spawn for this Lead and teammate name is already pending`). The slash-command path is
different by design: `nextTeammateName` derives a free name from the roster (`<soul>`,
`<soul>-2`, … up to the suffix limit). The roster duplicate check and the pending-plan collision are
different layers; both are clean refusals, neither silently renames the caller's name, and a failed
direct duplicate adds no roster member, pending plan, or binding.

### 2. Catalog, list, and commands

- `lib/soul.js` scans configured directories recursively for `*.md`, skips dot entries and
  `node_modules`, limits depth to 8, and sorts entries for stable output. Missing directories are
  not diagnostics. One refresh reads at most 1000 files across all configured directories (one
  diagnostic when the budget stops the scan), and a soul file larger than 1 MiB is skipped before
  it is read (its own diagnostic). With `bundled` enabled (the default) the package `agents/` directory is scanned
  last, after the configured directories, so installs expose the bundled souls in every workspace;
  a local definition with the same name shadows the bundled one and the duplicate diagnostic is
  suppressed for the shadowed packaged copy. Each file is strict-parsed; a file with any diagnostic
  is skipped and reported.
  A file with `name: lead` produces the reserved-name diagnostic and no definition: it stays visible
  to the GUI as invalid but is absent from `definitions`/`byName`, the prompt catalog, and spawn
  resolution. Duplicate names keep the first file (scan order: configured directories in order,
  sorted within each directory) and report the later one. `maxDefinitions` overflow is one
  diagnostic.
- `list_agent_souls` calls `deps.catalog.refresh(root)` first, then
  `deps.describeSouls`. Rows are sorted by name and carry `model` (raw or `"inherit"`),
  `model_resolved` (`provider/model` or null), `context`, `source`, `command`
  (`/<commandPrefix><name>` only when this plugin's own handler for the name is the effective one;
  null when the soul is not invocable, not registered, or the name is owned by another handler;
  compositions without a registration record keep the documented name-presence fallback), and an
  optional `body`. `diagnostics` additionally carries cold-resume admission refusals recorded by
  the plugin, with `source: "admission:<teammate>"` (see "Bindings and cold resume").
- `installSoulCommands` reads the Lead's current catalog snapshot (no refresh of its own) and
  registers one command per `userInvocable` definition. The command name is
  `config.commandPrefix + definition.name` and must match `/^[a-z][a-z0-9_-]*$/`; an invalid
  prefixed name is skipped with a warning. Handlers re-read the catalog and re-check that the
  soul still exists and is invocable, derive a unique teammate name from the roster, and spawn.
  Empty task text returns a usage error. Registration goes through
  `agentCtx.inject(['commands'], child => child.commands.register(...))`; the returned disposer
  disposes the injected child. Each registration is contained, so one colliding or failing name
  warns and the remaining commands stay installed. The returned record keeps the exact accepted
  handler per name (`registered`) and the failure reason per refused name (`failed`), which is what
  handler-identity status consumes.
- `createSoulCommandSync(deps)` owns the live reconciliation: it tracks one registration bundle
  per Lead with a desired-set signature, and `sync()` (async) refreshes each Lead's catalog and
  re-registers only when the desired commands changed, dropping commands of deleted/renamed
  souls and registrations of Agents that are no longer live Leads. `index.js` builds it once and
  exposes it as `deps.syncSouls()`; the GUI's `rescan()` after each soul-document mutation and the
  overview call it, and `lib/admin-tool.js` calls it after agent-tool create/save/delete. Preference,
  orchestrator, and plugin-config mutations do not share that rescan path. This is why a new
  user-invocable soul gets its slash command — and why deleting or renaming a colliding soul clears
  the collision — without a Host reload. An unchanged desired set reuses the record, so a failed
  name is not retried until the catalog changes.
- Command collisions are a registration condition, not a file validation error. `index.js` installs
  the built-in `/orchestrate` **before** soul commands for every Lead, so a user-invocable soul named
  `orchestrate` fails its registration, warns, and leaves the built-in in place; the other soul
  commands survive. `soulCommandRegistrationState(commands, lead, name, record)` decides
  `registered` by comparing the registry's resolved handler with this plugin's accepted handler, and
  reports `collision` (with a reason) otherwise; `lib/gui-host.js` and `lib/spawn.js` both use it.
  `commandPrefix: 'agent-'` registers the soul as `/agent-orchestrate` while `/orchestrate` stays
  built-in; the prefix is bundle config, so changing it needs the usual reload.

### 3. Document save: GUI vs agent tool

Both callers use `lib/admin.js`.

**GUI save.** `POST /agent-soul/document` validates the wire body, then calls
`saveDocument` (`fields`/`sections`) or `saveDocumentSource` (raw `source`). Both:

1. Resolve and validate the target path (`.md`, inside a configured soul directory — or the
   packaged `agents/` directory when `bundledEditable` makes it a write target — with a
   realpath/symlink fence).
2. When `expectedHash` is a string (including `''`), re-read the current file under its mutation
   lock; a missing file or a different hash returns `conflict` with `currentHash`/`currentModifiedAt`
   and writes nothing. Omitting `expectedHash` (or sending `null`) leaves the save unguarded
   (last-write-wins); at the HTTP API any other non-string value is rejected with 400
   `invalid-request` (`expectedHash must be a string`) before the save. `expectedMissing: true` is
   the separate no-replace recreation guard used by Overwrite after a file was removed: the target
   must still be absent and is published no-replace, a target that appeared answers `conflict`, and
   an empty `expectedHash` never substitutes for it.
3. Compose the document (fields/sections) or take the raw text, then run the plugin parser. A parse
   failure returns `invalid` with diagnostics.
4. Run the route's semantic validator: Team tools and Lead-only `manage_agent_souls`, unknown tools
   when a live Lead catalog is available, unresolvable model declarations, and duplicate names are
   rejected with `field`-tagged diagnostics. The route mirrors them into `fieldErrors`.
5. Write atomically (temp file in the target directory + `rename`), re-read the document, and
   rescan the catalog via `catalog.refresh(root)`.
6. Respond with the re-read `DocumentDetail` so the browser renders exactly what the next scan sees.

**Agent tool save.** `manage_agent_souls({ action: "save" })` calls `saveDocumentSource` with
raw Markdown, no `expectedHash` (last-write-wins), and no semantic validator. The parser is the same,
so syntactically invalid files are still refused; in particular a reserved `name: lead` source is
refused (`invalid`, name-tagged diagnostic) and writes nothing. `createDocument` and
`duplicateDocument` reserve the same name (`invalid-name`) and write nothing; `deleteDocument` moves
the file to trash (hard delete only as a fallback); `restoreDocument` moves it back and refuses an
existing target.

The document layer preserves the parser's `field` tag: a reserved-name save through the GUI answers
HTTP 400 `invalid` with `fieldErrors.name` (and the diagnostics list), writes nothing, and the
browser focuses the name control. This holds for both the raw-source and fields/sections save
paths, and for the preview route.

The GUI's document GET returns `hash` and `modifiedAt`; a save from the agent tool does not see a
conflict. This asymmetry is intentional: the model path behaves like a normal editor, while the
browser gets optimistic concurrency.

### 4. Orchestrator enable / disable / reapply

**Mode.** `modeOf(agent, { excludeCommandId, settledOnly })` walks `agent.session.eventAt(seq)`
from 0 through `session.seq`, folds every event through the shared pure transition in
[`lib/orchestrator-mode.js`](../lib/orchestrator-mode.js), and reports the durable mode. The same
transition backs the Host `agentSoulOrchestrator` projection, so the command runtime and the
Session-header badge cannot drift. `excludeCommandId` ignores one exact invocation id. The
`/orchestrate` handler passes its own `invocation.commandId` because the real `CommandsService`
appends the current `command/run` **before** invoking the handler; without that exclusion a first
`/orchestrate <task>` would see its own pending task run as prior durable activity. The handler also
passes `settledOnly: true` for its pre-invocation read: a run without a paired `command/done` is
still pending (another overlapping first command may not have settled yet) and does not count as
durable on-state; only settled successful runs count, while settled errors suppress their own run.
General durable reads keep the default behavior where a pending enable already took effect. Thus a
pending first enable reads `on` normally, reads `off` in the `settledOnly` pre-invocation read, and
returns to `off` if that run later settles as an error (when no earlier qualifying run was on).
Earlier runs and their paired errors fold normally:

- `event.type === 'command/run'`, `event.data.name === 'orchestrate'`: `data.args` trimmed and
  lowercased; `off|exit|stop|disable` ⇒ off; every other argument form (the bare command or a task
  submitted as `<task>`) ⇒ on.
- A recognized run is paired with its `command/done`. If the command settled as `kind === 'error'`
  (missing/invalid definition, or a task that could not be queued), the previous mode is restored
  and the failed run does not count.
- An unreadable event is skipped; an unreadable session log or missing `eventAt` means off.

The folded projection state is plain JSON with two arrays:
`runs: [{ commandId, next: 'on' | 'off' }]` keeps every recognized invocation in log order
(including repeated command ids), and `settlements: [{ commandId, settled: 'success' | 'error' }]`
keeps one outcome per command id (`error` wins over `success`; the first success otherwise). The
mode fold walks the runs in invocation order and consults the settlement map, exactly like the
pre-refactor full scan: an unpaired run is pending (it counts by default and is ignored by
`settledOnly`), a settlement recorded before its run still settles that later run at its actual
position, and repeated ids each participate in order. A repeated identical settlement is not a
state change, and an excluded command id drops only that id's runs from the read.

The mode is therefore per Session and durable in the session command log, not in plugin memory.

**Document validation before save (RB-03).** `analyzeOrchestrator` validates route declarations as
declaration logic, so it works without an LLM service and runs for every reader/writer
(`splitOrchestrator`, `readOrchestrator`, `orchestratorSummary`, `saveOrchestrator` source and
fields/sections paths, the GUI, and the Lead tool): a full `provider/model` plus a different
`provider`, a provider without a model, and an empty model id after the slash each produce a
field-tagged diagnostic (`model` or `provider`) and no definition. A reasoning effort with no
`model`/`provider` is not invalid: activation inherits the Lead route and ignores the effort, and
read/save validation must agree with activation. Invalid input is refused before any path check or write, so a refused save
leaves the previous file byte-identical and writes no temp artifact. `saveOrchestrator` also accepts
the optional `validate(definition)` callback (same contract as the soul document layer);
`lib/gui-host.js` and `lib/admin-tool.js` pass `orchestratorRouteDiagnostics(definition,
deps.resolveModel)` as the second, live layer, which refuses a well-formed route the deployment's
catalog cannot serve. Without a resolver that layer reports nothing, so a complete
`provider/model` route remains a valid document when no LLM service exists. `orchestratorSummary`
reports an invalid document as `valid: false` with `modelResolved: null` (never a resolved route),
while activation keeps its own fail-closed conflict error and rollback attempt (the rollback
outcome is qualified in step 10 under **Enable**).

**Enable.** `runtime.enable(agent)` calls
`applyTo(agent, { capturePrevious: true, renameTitle: true })`:

1. Read the definition (`<dirname(bindingsFile)>/orchestrator.md`). When that workspace file is
   absent and `bundled` is enabled (the default), the packaged
   [`defaults/orchestrator.md`](../defaults/orchestrator.md) is the effective document; only when
   neither exists (or `bundled: false` and the workspace file is absent) is a missing definition an
   error — reported before any state is touched, so the mode is unchanged. An invalid document is
   likewise an error. This is the only visible activation
   surface: a successful enable answers
   with `ORCHESTRATOR MODE ACTIVE` plus identity/path/model/gate/retries (a failed enable answers
   with the error instead).
2. Re-analyze the source to obtain the parsed definition (the public detail does not carry it).
3. Resolve the optional model route and probe the optional tools list before touching the current
   bundle. A failure here aborts with no partial state.
4. Build prompt texts: substitute variables in each section. The persona text is
   `ORCHESTRATOR_FIXED_IDENTITY` followed by the substituted editable identity (or the fixed text
   alone when the section is empty), so the document can add boundaries but never remove the runtime
   role. The five non-identity sections become `orchestrator:plan`, `:delegation`, `:state`,
   `:verification`, `:recovery`; extra markdown becomes `orchestrator:extra`. Empty sections are
   skipped.
5. Compute orders from the live prompt service: `TEAM_POLICY - 100`, `+10`, `+20`, `+30`, `+40`,
   and `+50` for extras.
6. Capture the current Lead model only for a genuine first explicit enable (a route exists, no
   previous capture is carried, and the active plan did not already route). A reapply or a
   replacement of an active definition never re-captures. The Session title is captured the same
   way: only a first explicit enable records the prior `session/title`, and a reapply never captures
   or renames.
7. Snapshot the current selection for rollback even when it is not the durable capture.
8. Rename the Session to exactly `orchestrator` through the optional `sessionTitle` service before
   touching the live bundle, but only when a prior title was captured. A rename is skipped — title
   untouched — when the service is absent (`titleSkippedReason: 'service-unavailable'`) or, with the
   service present, when no prior `session/title` exists (`titleSkippedReason: 'no-prior-title'`);
   in both cases enable continues with `titleSkipped: true` and the activation block reports the
   matching reason. A rejected rename aborts enable with no registrations applied.
9. Dispose the existing bundle if any, then create a new `agent.ctx.effect` bundle that registers:
   - the persona section (when identity is non-empty),
   - the doctrine sections,
   - the tool restriction (when `tools` is a list; `allow: []` for an empty list),
   - the model selection (when a route exists).
10. If creation throws, recreate the previous bundle when one existed, restore the pre-attempt model
   selection if it changed, restore the captured Session title when this was the first enable (and
   it is still exactly `orchestrator`), log, and return an error. Recreating the previous bundle
   keeps the previous doctrine active (`previousStateRestored=true`); if recreation also fails, the
   error reports `previousStateRestored=false` and the mode ends inactive. If the new plan has no
   model route and a previous capture exists, restore the previous model after the replacement is
   in place.
11. Return `{ ok, path, name, model, tools, gateMode, maxRetries, planFirst, pauseOnFatal, title,
   titleSkipped, titleSkippedReason }`.

**Disable.** Restore the captured previous model selection first, when one exists;
`restoredModel` reports whether a selection was applied, and a model-restore failure answers with
the error while the active bundle and its capture remain in place for an off retry. Then, when a
prior title was captured and the current title is still exactly `orchestrator`, rename it back; a
title the human changed is preserved and a restore failure is only a warning (`restoredTitle` is
`true | false | null`). With no captured title — no prior title at enable, a reapply after a reload,
or a profile without the `sessionTitle` service — there is nothing to restore, `restoredTitle` is
`null`, and no false `orchestrator` title is left behind. Finally the bundle is deleted and its
sections and restrictions disposed.

**Reapply.** On plugin activation and on Lead creation, `reapplyIfActive(agent)` checks the session
log; if on, it runs the same application path with `capturePrevious: false` and no title rename. It
must never capture the route or title it just applied.

**Runtime state predicates.** `isActive(agent)` reports whether a bundle currently owns the scope;
`lib/tools.js` uses it to add the orchestrator wording to `team:identity` and the
`orchestrator: true` marker on the Lead's `list_agents` row.

**Disposal.** `agent/disposed` drops that Agent's bundle without restoring a model (the Agent is
gone). Plugin unload disposes every bundle and restores every captured model.

**Command.** `installOrchestratorCommand(agent, agentCtx, deps, runtime)` registers the Lead-scoped
`orchestrate` command in an injected `commands` child scope. Every handler invocation, including
`off`, runs under a per-exact-Lead promise tail (`orchestrateHandlerTails`) so two overlapping
`/orchestrate` executions cannot interleave their enable/rollback work. A waiter that aborts before
acquiring the tail releases its own slot without applying anything and settles as an error result,
but its tail stays chained to the in-flight holder until that work settles: later invocations still
queue behind the holder, and the map entry is removed only after the settled tail is still current.
Unrelated commands never enter this lock.

- trimmed `off|exit|stop|disable` → `runtime.disable`; `rawInput` empty → `runtime.enable`;
- any other input → `runtime.enable`, then `agent.followup({ id, role: 'user', content:
  [{ type: 'text', text }], source: { kind: 'user' } })` queues the task as the next ordinary user
  turn. The message mirrors the `createUserMessage` shape because this package imports only Node
  builtins; its random `id` is the durable identity. The task is trimmed and must be non-empty;
- a missing/invalid definition, an unresolvable model/tools plan, or a queue failure returns an
  error result. Before enabling, the command records whether the mode was already active live
  (`runtime.isActive`) or durably (`runtime.modeOf(agent, {
  excludeCommandId: invocation.commandId, settledOnly: true })`, excluding the current prelogged run
  and ignoring other still-pending runs). On a queue failure it attempts to keep an already-active
  mode: it snapshots the live bundle and Session title before the invocation, then tries a two-step
  ladder — `runtime.restore()` recreates the pre-invocation bundle and captured model/title state;
  when bundle recreation fails it recreates the freshly applied bundle instead, and only when both
  recreations fail is no bundle left active. A durably active mode with no live bundle has no
  snapshot, so the freshly applied bundle is kept. The `stateNote` normally says `; the
  already-active mode was kept`, or reports inactivity after a both-fail restoration.

  These rollback paths have compound-failure defects. `runtime.restore()` returns `true` after bundle
  recreation even if restoring the captured model selection throws; that failure is only logged, so
  the queue error can claim the prior mode was kept while old doctrine remains with the new route.
  On a first enable with a route override, a queue failure followed by a model-restore failure makes
  `runtime.disable()` return `ok: false` with the live bundle still active, but the handler returns
  only the queue error with no rollback note; the command's error settlement folds durable mode back
  to `off`, leaving live and durable state inconsistent. Recovery is to inspect the actual bundle and
  model, restore the intended route, and retry `/orchestrate off` (or reapply the intended doctrine).
  These compound outcomes are derived from source and a focused handler probe for the first-enable
  case, not real-runtime end-to-end results; the already-active mixed-doctrine/route case still needs
  such a test.

The command's `input.hint` is `[<task>|off]`, and the command registration disposes with the
Lead's Agent scope.

### 5. Bindings and cold resume

`createBindingStore` is lazy and per workspace root:

- On first use it reads the configured file. Missing files are an empty store. Unsupported versions,
  unreadable files, and malformed JSON log a warning and produce an empty cached snapshot;
  individual malformed records are dropped. The load promise is retained: read/JSON failures stay
  cached as empty, and a later `get` miss does not re-read the file. External repair and writes from
  another process may therefore require a plugin reload or a fresh store before this root sees them.
- `set` writes the smallest record needed to re-apply a soul and stamps `savedAt`. Each root
  queues persistence attempts; a filesystem lock at the **canonical bindings pathname** coordinates
  different roots, store instances, and cooperating processes. Under that lock the writer re-reads
  the latest document, applies only its uncommitted sets/deletes, and prunes to the newest 500
  records. Equal timestamps retain the prior stable insertion-order pruning rule. Each replacement
  uses a uniquely named temp file in the same directory plus `rename`, with normal-error cleanup.
  Failed attempts keep local mutations for a later healthy write; cached snapshots are never
  merged wholesale, so another writer's updates, deletions, or retention pruning are not undone.
- `get` returns the cached snapshot; `list` returns detached rows newest first (`childId`, `name`,
  `tools`, `model`, `context`, `sourceLabel`, `savedAt`); `size` returns the retained count; `flush`
  waits for pending writes; `dispose` flushes and clears. An unreadable input that became an empty
  cache can consequently surface as `missing-binding`, not `unreadable-binding`, because `get`
  returns `undefined` instead of throwing. These cache and diagnostic consequences are source-derived
  limitations, not a claim of dedicated fault-injection coverage.
- `applyTeammateSoul` falls back to `bindings.get(root, agent.id)` when no pending plan exists,
  which is the cold-resume path. The root is the child Session's immutable creation `header.cwd`
  when available, not the Lead's mutable current directory; older Sessions without it use the Lead
  root fallback. Admission is fail-closed: a missing record or a binding read failure throws
  `SoulPlanUnavailableError`, so a cold-resumed roster teammate is never admitted Soul-less. At
  plugin activation only, a pre-existing live teammate in that state is skipped with a warning and
  its partial registrations (including the Team tools) are unwound. Binding writes remain
  diagnostic-only.

**Cold-resume refusal diagnostics (RA-01).** The admission itself stays fail-closed. The
Soul-specific cause is kept reachable because the shared subagent lifecycle wraps the veto as a
generic `SubagentError('… is unavailable', 'NOT_RESUMABLE', { cause })` (the Remote surface may wrap
it again) whose public message the plugin does **not** change. Instead:

- The plugin's own `send_message` tool walks the bounded `.cause` chain for a structurally tagged
  `SoulPlanUnavailableError`/`SOUL_PLAN_UNAVAILABLE` cause and, only when it finds one, replaces the
  generic failure with
  `teammate "<name>" could not be resumed: <Soul-specific cause>. The teammate was not started. Restore its durable Agent Soul binding or re-spawn it with spawn_teammate to create a valid one.`
  (the original wrapper is preserved as `cause`). Unrelated `NOT_RESUMABLE` failures, self-messages,
  and cancellations are rethrown unchanged.
- It records one entry in the bounded `deps.admissionDiagnostics` sink
  (`createAdmissionDiagnostics(limit = 20)`): `{ teammate, code, reason, message, at }`, where
  `reason` is `missing-binding` or `unreadable-binding` for the two admission cases. `index.js` also
  records the veto when it catches `SoulPlanUnavailableError`, including the activation skip of a
  pre-existing live teammate.
- It logs one Host warning:
  `agent-soul: cold resume refused for teammate "<name>": <message> (code SOUL_PLAN_UNAVAILABLE, reason <reason>)`.
  The `, reason <reason>` part is omitted when the veto carries no reason; the code stays.
- `list_agent_souls` appends the recorded entries to its `diagnostics` as
  `{ source: "admission:<teammate>", message }`, so the Lead can re-check the real cause after the
  generic lifecycle error. The sink is best-effort: a failing record/log never blocks the refusal.

## Prompt registrations and orders

Every Team member gets the Team policy and identity. Only the Lead gets the soul catalog. While
orchestrator mode is on, the Lead also gets the orchestrator sections.

| Registration | Kind | Name | Order in this profile | Scope |
|---|---|---|---|---|
| Deployment persona | system-prompt section | `deployment:persona-prefix` | deployment persona order | All agents |
| Team policy | system-prompt section | `team:policy` | `TEAM_POLICY` = 600 | Every Team member |
| Soul catalog | system-prompt section | `team:agent-souls` | `TEAM_POLICY + 20` = 620 | Lead only; text function, empty when no definitions |
| Team identity | system-prompt context | `team:identity` | `TEAM_IDENTITY` | Every Team member; required |
| Orchestrator identity | persona-position system-prompt section | `deployment:persona-prefix` | deployment persona order | Lead, only while mode is on |
| Orchestrator plan | system-prompt section | `orchestrator:plan` | `TEAM_POLICY - 100` = 500 | Lead, only while mode is on |
| Orchestrator delegation | system-prompt section | `orchestrator:delegation` | `TEAM_POLICY + 10` = 610 | Lead, only while mode is on |
| Orchestrator state | system-prompt section | `orchestrator:state` | `TEAM_POLICY + 20` = 620 | Lead, only while mode is on |
| Orchestrator verification | system-prompt section | `orchestrator:verification` | `TEAM_POLICY + 30` = 630 | Lead, only while mode is on |
| Orchestrator recovery | system-prompt section | `orchestrator:recovery` | `TEAM_POLICY + 40` = 640 | Lead, only while mode is on |
| Orchestrator extras | system-prompt section | `orchestrator:extra` | `TEAM_POLICY + 50` = 650 | Lead, only while mode is on |

The numeric values are the current profile's order names resolved at runtime with
`getSectionOrder`/`getContextOrder`; modules never hard-code 600/620. The Lead composition is:

```
deployment persona prefix
  (shadowed by orchestrator Identity & Boundaries when the mode is on)
preset plugin sections (including the preset's persona/sections)
team policy (600)
soul catalog (620)
Team identity context
```

The orchestrator doctrine sections sit at the orders in the table above, so plan generation precedes
the Team policy and the remaining doctrine follows it. The catalog section is registered even when
the catalog is empty; its text function returns `''` until definitions exist, which is what lets a
later refresh become visible without re-registering the section.

The teammate composition uses the same shared registrations plus the soul persona at the
deployment persona order:

```
You are the delegated teammate "<name>".

<description>

The Agent Soul below is your system-level operating contract for this session. It is your
authoritative role definition: where it conflicts with the deployment persona or other generic
guidance, follow the Agent Soul, including its Hard Rules and Output Format.

<body>
```

`composePersona` is exact; the persona section is registered at the deployment-persona order,
after the harness's configured deployment persona-prefix line (which is not removed). The
soul body is one text, not four separate prompt sections. The teammate does not get the soul
catalog section.

The catalog text is `catalogPromptText(snapshot, { maxPromptChars, commandPrefix })`:

```text
## Available teammate souls

A teammate started with `spawn_teammate({ ..., agent_type: "<name>" })` runs with the matching soul: its role definition is applied at the deployment-persona position (a configured deployment prefix line is still emitted first), its tool list becomes a hard permission matrix, and its model becomes the routed model. Every Team child must run a defined Agent Soul. If no soul matches the task, omit `agent_type` and the configured default Agent Soul is used; if no default is usable, `spawn_teammate` fails and names the reason. Never start a child with `subagent` or `subagent_fork` (both are hidden, guarded, and rejected at creation), and never invent a soul name. Match a task to a soul by its description; call `list_agent_souls` for full detail.

- <name> — <one-line description, <= 600 chars> (tools: <a, b | all | none>; model: <raw | inherit>; command: /<commandPrefix><name> | AI only)
```

`formatCatalogEntry` applies the configured `commandPrefix` to the bullet: a user-invocable soul
renders `command: /<commandPrefix><name>` and an AI-only soul renders `command: AI only`. The GUI's
per-soul catalog line is the same formatter with a single definition, so the preview line and the
overview row carry exactly the bullet the Lead's catalog emits for that definition and prefix (the
GUI regression compares the prefixed preview/overview lines against the formatter output). Entries
are sorted by name and kept whole. If the next entry would exceed the budget, the text ends with
`- (N more souls; call list_agent_souls)`. When no whole entry fits, the section is empty.

## On-disk data shapes

### Soul file

```markdown
---
name: code-reviewer
description: One-line trigger.
tools:
  - read
  - grep
model: deepseek-flash
provider: deepseek-official
reasoning-effort: high
context: fresh
user-invocable: true
---

<body markdown>
```

Parsed definition (optional keys are omitted when absent):

```js
// SoulDefinition = {
//   name: string,
//   description: string,
//   tools: string[] | null,          // null = inherit every tool; [] = deny every inherited tool
//   model?: string,                  // raw declaration
//   provider?: string,
//   reasoningEffort?: string,
//   context?: 'fresh' | 'fork',
//   userInvocable: boolean,
//   body: string,                    // trimmed markdown
//   persona: string,                 // composePersona(definition)
//   sourcePath: string,
//   sourceLabel: string,
//   mtimeMs: number,
// }
```

Only the four canonical body headings (`#`/`##`, case-insensitive) delimit sections in the document
layer. Other headings stay content of the current section. Text before the first canonical heading is
the preamble and becomes `extraMarkdown`; the composer emits the preamble first, then
`## Role Definition`, `## Inputs You Will See`, `## Hard Rules`, `## Output Format`, then any content
assigned to a section. A body without a canonical heading is entirely extra markdown. The soul
parser itself does not require any of the four headings; the document layer uses them for editing.

### Catalog snapshot

```js
// {
//   root: string,                    // absolute
//   dirs: string[],                  // absolute directories that existed at scan time
//   bundledDir: string | null,       // packaged agents/ when bundled is on and it exists
//   definitions: SoulDefinition[],
//   byName: Map<string, SoulDefinition>,
//   diagnostics: { source: string, message: string }[],
//   scannedAt: number,
// }
```

`createCatalog` returns `refresh(root)`, `get(root)`, `ensure(root)`, `promptText(root)`,
`promptCatalogExtension(root)` (a legacy alias returning the same catalog text), and `dispose()`.

### Binding store

```json
{
  "version": 1,
  "bindings": {
    "<child-session-id>": {
      "name": "code-reviewer",
      "persona": "You are the delegated teammate \"code-reviewer\".\n\n…",
      "tools": ["read", "grep"],
      "model": { "provider": "deepseek-official", "model": "deepseek-flash" },
      "context": "fresh",
      "sourceLabel": "agents/code-reviewer.md",
      "savedAt": 1793461007624
    }
  }
}
```

`model` is `null` when the soul inherited the Lead's model; `context` may be `null`;
`sourceLabel` may be `null` in old records. The store retains the newest 500 records **per
bindings document**: normally one per workspace root. An intentionally shared absolute
`bindingsFile` shares both the child-id keyspace and the retention budget; it does not create a
second root namespace. Use the default workspace-relative file for separate workspace state.
Reads remain lazy per-root caches; a fresh store sees the complete shared document. Returned
snapshots/rows are detached as before. No on-disk format migration is needed.

Writes use canonical-file read/modify/write transactions. Existing file and parent-directory
symlink aliases resolve to the same target (including not-yet-created parent directories);
dangling symlinks refuse persistence rather than being replaced. A sibling `<canonical-file>.lock`
directory excludes cooperating writers across processes. The writer waits at most five seconds
(monotonic time), then logs a persistence warning while retaining the in-memory plan and pending
mutations. It never steals a lock merely because it is old. Other bindings files make progress
independently. A temp file and `rename` make each complete JSON replacement atomic.

**Crash recovery and coordination limits.** Every writer sharing a document must use this locking
protocol; older plugin versions, external editors, hard-link aliases, and network filesystems
without local atomic mkdir/rename semantics are not coordinated. A process killed while holding
the lock can leave its empty lock directory (and possibly its uniquely named temp file). Stop
**all** processes using that bindings document, verify the resolved lock/temp paths and that no
writer is active, then remove only the stale lock and abandoned temp files. Do not delete or
restore over the bindings document. Restart/retry afterward. There is no automatic stale-lock
reclamation or fsync/power-loss durability guarantee. A transactional read I/O error aborts the
replacement rather than overwriting unknown shared data. **High-severity defect:** corrupt or
unsupported JSON is instead converted to an empty map even in the transactional read; a subsequent
mutation can then write only its surviving/local records and overwrite unrelated valid records that
the parser rejected. This overwrite path is derived from `readEntries` and `enqueueWrite`, not from a
fault-injection test. Do not use another mutation as corruption recovery: stop writers, preserve and
repair the JSON externally, then reload or construct a fresh store. Cold-resume admission remains
fail-closed if the required binding is absent, although cached read/JSON failure can be misreported
as missing.

### State-path layout and the relative-escape mismatch

The resolved `bindingsFile` itself is the binding document path. Preferences, the orchestrator
definition, and trash are siblings in its directory: `preferences.json`, `orchestrator.md`, and
`trash/`. The stores do not currently enforce one consistent path policy. `createBindingStore`
accepts a relative `bindingsFile` containing `../` and joins it to the workspace root, while the
preferences and orchestrator real-path fences reject a relative state directory that escapes the
workspace lexically or through symlinks as `unsafe-path`. An explicitly absolute `bindingsFile` is
the supported way to place the shared state directory outside a workspace; do not rely on the
relative `../` inconsistency.

### Preferences document

```json
{ "version": 1, "selected": "generalist" }
```

`selected` is `null` for "no explicit selection". The document lives at
`<dirname(bindingsFile)>/preferences.json`. It is written atomically by the GUI route. Reads are
lenient at the document boundary: a corrupt, malformed, or unsupported document returns
`{ ok: true, preferences: { path, selected: null, warning } }` (a path-fence or read failure is a
typed `ok: false` instead). That
warning is not reinterpreted as "no selection": the GUI block sets `valid: false`, `effective: null`,
and `source: 'none'`, and a default spawn (`agent_type` omitted) fails with the warning. The
real-path fence is the same one the orchestrator document uses.

### Orchestrator document

```markdown
---
name: orchestrator
model: deepseek-v4-pro
provider: deepseek-official
reasoning-effort: high
tools:
  - read
  - grep
plan-first: true
gate-mode: strict
max-retries: 3
pause-on-fatal: true
---

## Identity & Boundaries
…
## Plan Generation
…
## Delegation & Context Minimization
…
## State Tracking
…
## Quality Verification
…
## Exception & Recovery
…
```

Parsed shape (fields and sections are also the GUI's editable shape):

```js
// definition = {
//   name, model, provider, reasoningEffort,   // strings; '' when absent
//   tools: string[] | null,                   // null = inherit all; [] = deny all inherited
//   planFirst: boolean, gateMode: 'strict'|'advisory'|'off',
//   maxRetries: number, pauseOnFatal: boolean,
//   body: string,
//   sections: { identity, plan, delegation, state, verification, recovery, extraMarkdown },
// }
```

The composer always writes `name`, `plan-first`, `gate-mode`, `max-retries`, and `pause-on-fatal`;
it omits `model`, `provider`, `reasoning-effort`, and `tools` when they are inherit/absent, and emits
`tools: []` for deny-all. `saveOrchestrator` accepts either raw `source` or `fields`/`sections`; it
runs `analyzeOrchestrator` (shape plus declaration-level route consistency), then the optional
`validate(definition)` live-route layer, creates the parent directory on demand, writes atomically,
and re-reads. Any refusal returns `invalid` with field-tagged diagnostics and writes nothing, before
even the path check. `readOrchestrator` resolves the **effective** document: an existing workspace
file always wins; when the workspace file is absent and `bundled` is enabled (the default) the
packaged [`defaults/orchestrator.md`](../defaults/orchestrator.md) is returned with
`configured: true, bundled: true, sourcePath: <package path>` and `path` still the writable
workspace target; otherwise it returns a valid skeleton with `configured: false`. An existing
contradictory file reads as `valid: false` with the same diagnostics, and `orchestratorSummary`
reports it with `modelResolved: null` and the same `bundled`/`sourcePath` fields.

Extra markdown rules: content before the first canonical heading; content after
`<!-- orchestrator:extra -->`; and any other `#`/`##` heading with its following lines until a
canonical heading resumes, all become extras. The composer emits extras after the canonical
sections. This round-trips after one composition but can move content on the next read; use `###` or
deeper for sub-headings inside a section.

### Trash

Deletes move the file to `<dirname(bindingsFile)>/trash/` with a name of
`YYYYMMDDTHHMMSSmmmZ-<original basename>`. `restoreDocument` requires the trashed path to be inside
that trash directory and the target to be an empty `.md` path inside a configured soul
directory. Both paths get the same lexical + realpath/symlink fencing as saves. A trash failure
currently falls back to an irreversible hard unlink: the result omits `trashedFile`, so Undo and
`restoreDocument` have no entry to recover. That fallback is a defect, not a preferred recovery
path; preserve the source before deleting when trash failure would be consequential.

### Browser-only state

- `dsh.agent-soul.draft:<absolute file>` — unsaved Form-mode Soul `{ fields, sections }` plus a
  timestamp. Raw source/mode, Orchestrator edits, New/Paste inputs, and Undo state are memory-only.
- `dsh.agent-soul.editor-size` — the resizable dialog's persisted size.
- The page's locale dictionaries are compiled into `client.js`; `locale/en.json` and
  `locale/zh.json` hold package-level locale metadata, not the page's full dictionaries.

### Session mode derivation

There is no mode flag on disk for `/orchestrate`. `modeOf(agent)` derives it from the Session event
log by folding the shared pure transition in `lib/orchestrator-mode.js`: `command/run` events whose
`data.name === 'orchestrate'` interpret `data.args` (off-words = off, every other argument form —
bare command or `<task>` — = on), and a recognized run whose paired `command/done` settled as
`kind === 'error'` is suppressed. The resulting on/off state is per Session and is the only durable
mode source. The Host registers the same transition as the `agentSoulOrchestrator` session
projection before installing a live Agent; its `wire.view` is that `'on' | 'off'` primitive and its
`wire.summary` is false. The browser badge reads the projection with
`props.useProjection('agentSoulOrchestrator')`, so it is a read of the durable log, never a separate
client-side flag. The Session title is similarly durable in the Session log: a successful explicit
enable renames it to `orchestrator` only when the optional `sessionTitle` service is mounted **and**
a prior `session/title` was captured; otherwise the title is untouched and the enable result records
`titleSkipped: true` plus a `titleSkippedReason` of `no-prior-title` or `service-unavailable`. Off
appends the captured prior title only while the current title is still exactly `orchestrator` (and
only when a title was captured).

## Team-tool row composition

The shipped Agent Teams bundle and this bundle both touch the `tool-agent-team` row. Bundle patch
layers apply in `dsh.profile.bundles` order, so this bundle's `- id: tool-agent-team disabled: true`
only takes effect when its layer follows the Agent Teams bundle's layer. In the reverse order the
Loader warns (`patch: entry "tool-agent-team" not found`) and skips the disable, the later layer
re-inserts the row, and both rows race for `team:policy` and the Team tool names.

`lib/composition.js` reads the live Loader tree through the optional `loader` service; every
response degrades to `status: 'unknown'` when that service is absent:

| `status` | Meaning |
|---|---|
| `replaced` | A `@deepseek-ai/dsh-experimental-tool-agent-team` row is composed and disabled. |
| `conflict` | At least one such row is composed enabled (`!disabled`, known before its fiber starts). |
| `absent` | No such row is composed in this profile. |
| `unknown` | The Loader service is unavailable, or entry enumeration threw. |

`repairTeamToolSurface` locates the manageable row through the optional `pluginManager` service
(`listPlugins` → matching `moduleName`/`patchId` → `setPluginEnabled(entryId, false)`) and reports
`applied`/`not-applied` plus the manual `PROFILE_PATCH_FIX` snippet on every failure path. When the
Loader service is not exposed to plugins (the Web profile's normal case), detection falls back to
the Plugin Manager listing: any listed `@deepseek-ai/dsh-experimental-tool-agent-team` row with
`enabled !== false` is treated as a live conflict, so a Plugins-page re-enable that reorders
bundles still heals on the next activation. `createCompositionGuard` adds the opt-in
`claimTeamToolRow` path: `scheduleClaim()` waits one tick, awaits the Loader tree (concurrently
mounted rows must be visible) when available, inspects (manager fallback included), and repairs at
most once per activation; the persisted override makes the next recomposition clean. On profiles where this bundle's layer precedes the Agent Teams layer (common when the Team bundle is added or re-enabled later), the bundled patch's disable is skipped and that persisted override — not the patch — is the effective composition owner. The guard is logged
at activation, named in the `installTeamTools` failure message, exposed as the overview
`runtime.health.teamTools` block, and surfaced through `manage_agent_souls` actions `diagnose` and
`repair_team_tools`.

## Lifecycle, effects, and disposal

### Activation

1. `apply()` builds logger, config, catalog, binding store, pending map, deps, the composition
   guard, and the orchestrator runtime. The guard inspects the Team-tool row composition once and
   logs an actionable warning when the shipped row is still active.
2. It installs the optional GUI in a child `ctx.inject(['webServer', 'connection', 'agents',
   'agentTeams'], …)`. The child is only created when those services exist (a Web profile). A GUI
   install failure is logged and does not fail the plugin.
3. It registers `agent/created` and `agent/disposed`, then prepares every already-live Agent with
   `await maybeInstall(agent)`, and finally calls `composition.scheduleClaim()` (a no-op unless
   `claimTeamToolRow` is on). A pre-existing Agent that fails closed (non-roster child, or roster
   teammate without a usable Soul plan) is skipped with a warning; it does not fail activation and
   keeps no plugin registrations.
4. `maybeInstall` deduplicates concurrent installation per Agent. `agent/created` listeners are
   awaited by the Team service before creation resolves, which is why the pending spawn plan is
   still available to the child and why a `SoulPlanUnavailableError` vetoes publication. During
   activation, `SoulPlanUnavailableError` is the one failure class the loop swallows for
   pre-existing Agents; every other creation path lets it reject.
5. For each member:
   - Lead only, first: refresh the catalog so the later registrations see fresh definitions;
   - every member: `installTeamTools` (Team tools + policy/identity; the Lead also gets the catalog
     section);
   - Lead: install the built-in `/orchestrate` **first**, then reconcile the
     soul commands, install `manage_agent_souls`, then `orchestrator.reapplyIfActive(agent)` (the
     built-in-first order is what prevents a soul named `orchestrate` from shadowing it on a fresh
     Lead);
   - teammate: `applyTeammateSoul`.
   Each step is individually wrapped: a failure is logged and the remaining steps still run where
   possible. The disposer list is stored in the `installed` map only after installation.
6. `agent/disposed` marks the Agent as disposing but deliberately leaves any in-flight installation
   promise in `installing` until that task's own `finally` removes it, preventing a duplicate install.
   It drops the orchestrator bundle without model restore and disposes member registrations in
   reverse order.

### Plugin unload

`ctx.effect(() => () => { … }, 'agent-soul.members()')` disposes:

1. every installed member record (reverse disposers),
2. the orchestrator runtime (dispose every bundle; restore every captured model),
3. the soul-command reconciler (every Lead's slash-command bundle),
4. the catalog cache,
5. pending spawns,
6. the binding store, initiating disposal and its pending-write flush without awaiting it.

Binding disposal is initiated with `void bindings.dispose().catch(...)`; a flush failure is logged,
but plugin unload does not await the flush and is not a durability barrier. The GUI routes are
registered through their own `ctx.effect` calls inside `installGui`, so they dispose with the plugin
child. The `/orchestrate` command registration is a child injection disposed with the Agent scope;
the runtime is a process-wide object disposed by the plugin's member effect.

### Effect ownership

| Effect | Owns | Disposal behavior |
|---|---|---|
| Per-Agent `installTeamTools` | `team:policy`, `team:identity`, Lead catalog section, the soul-only restriction + guard bundle, every Team tool | One disposer unregisters everything in reverse order |
| Per-Agent Soul apply | persona section at the deployment-persona order (via `agent.ctx.effect`), tool restriction, model selection | Both the Agent scope and the root installation record own disposers; plugin unload removes persona/restriction, while model selection has no automatic undo (the session survives) |
| Per-Agent orchestrator bundle | persona section at the deployment-persona order, five doctrine sections, extra section, tool restriction, model selection | Bundle disposal removes sections/restriction. `/orchestrate off` restores the captured model and eligible Session title when present; runtime disposal restores only the captured model, not the title. Agent disposal drops the bundle without restoration |
| Per-command injection | the Lead's scoped command registrations | Disposes the injected child |
| GUI route registration | eleven exact paths | Each route's `ctx.effect` disposes with the plugin |

### HMR and reload

Module-mutable state comprises the monotonically increasing temp-file counters, `lib/admin.js`'s
`mutationTails` map, and `lib/orchestrator.js`'s per-Lead `orchestrateHandlerTails` WeakMap. A plugin
reload constructs a new catalog, binding store, pending map, runtime, and installation records. That
is what makes a profile/bundle toggle a valid reload path. The browser half is loaded as a classic
client artifact: running `pnpm run dev:web` in the DSH source checkout rebuilds client-plugin
bundles while that watcher is active; otherwise rebuild the affected Web artifacts and refresh or
reload the page. Editing `client.js` alone does not guarantee an automatic browser update.

## Host GUI routes

The browser half talks to fifteen authenticated endpoints registered as eleven exact paths:
`overview`, `document` (GET/POST), `create`, `delete`, `parse`, `preview`, `duplicate`, `restore`,
`orchestrator` (GET/POST), `preferences` (GET/POST), and `config` (GET/POST). `createGuiRoutes(deps)` returns one
descriptor per endpoint in contract order; `installGui` groups by path, merges method dispatch for
`document`, `orchestrator`, `preferences`, and `config`, and registers each group with `kind: 'exact'`. Every handler runs the connection
trust fence first, answers JSON with `cache-control: no-store`, bounds request bodies to 1 MiB, and
delegates mutations to the document/orchestrator/preferences layers. The full payload and status-code contract
is maintained in [`GUI-INTERNALS.md`](GUI-INTERNALS.md#endpoint-inventory); do not restate it here.

The `config` pair (GET/POST `/agent-soul/config`) is the packaged-defaults toggle and is
plugin-wide (no `root`): GET reports the effective `bundledEditable`, whether `bundled` is on, and
whether the row is configurable; POST persists `bundledEditable` through the Host `configEditor`
service into the plugin's own Loader row (`agent-soul-team`) in the profile patch — every other row
key is preserved — and the Loader reloads the plugin row once. A refused POST answers 400
`invalid-request` (bad body) or 409 `bundled-disabled` / `not-configurable` / `overridden`.

The browser derives the current workspace root from the page's own `props.sessionId` summary
first, then the Session summary with a positive `retainedBy.mainView`, then a sole listed
workspace as the compatibility fallback; it pins that root for the editor session and sends it on
every route. The Host authorizes the requested root against live top-level
Session/deployment candidates and pins it for the whole request; unknown roots answer 403. Legacy
requests without a root still choose the first candidate whose configured soul directories exist.
Command status is checked against the Lead whose Session directory equals the pinned root (falling
back to the first live Lead), which keeps concurrent Sessions from reporting false collisions.

## Hard constraints and invariants

- **ESM only, zero dependencies.** Imports are `node:` builtins or relative `./x.js`; no
  `@deepseek-ai/*` imports and no bare package imports. No TypeScript syntax; JSDoc is welcome.
  `node --check <file>` must pass.
- **No hidden service capture.** All DSH services come through the passed `ctx`/`deps`; modules do
  not import the harness. Optional services are read per call and degrade safely.
- **Atomic writes.** Replacement uses a temp file in the target directory plus `rename`; no-replace
  creation uses a same-directory hard link so an existing destination cannot be clobbered.
  Orchestrator and preference saves create their parent directories on demand; soul document saves
  require the parent directory to exist already.
- **Path safety.** Targets are `.md` files inside a resolved soul directory (or the trash
  directory for restore), checked lexically and through `realpath`/`lstat`; symlink escapes are
  refused. The packaged `agents/` directory is fenced canonically before configured-directory
  matching, so aliases of it keep their packaged identity — read-only by default, writable in place
  only when `bundledEditable` is enabled. Implicit soul-directory creation resolves the real
  workspace root and the real nearest existing ancestor before `mkdir`, and re-checks the created
  directory canonically. Orchestrator reads and writes share a real-path state-directory fence,
  including parent symlinks, with a second check after parent creation (the `bundledEditable`
  packaged target uses its own packaged-path check instead).
- **Canonical JSON schemas.** Tool definitions use object-level `required` arrays, not per-property
  `required: true`. Tool arguments are not registry-validated, so each module validates in
  `execute`. Tool output values are validated against `output.schema` and must be plain JSON (never
  `undefined`).
- **Browser artifact rules.** `client.js` is a classic artifact using
  `window.__ModuleLoader__.load({ id, factory(require) { … } })`, takes React from `require('react')`,
  registers one `settings.section`, and emits one inline `<style>` with theme tokens only. No module
  syntax, no dynamic evaluation, no package imports.
- **Eight locales, identical keys.** Plugin-authored UI chrome flows through the
  `settings.agentSoul` namespace; Host diagnostics/messages and file content can remain untranslated.
  Every dictionary must have the same key set as `en`, and placeholders must survive.
- **The Team Lead's identity is reserved.** `lead` is the one name the shared parser refuses as a
  soul name (`name: "lead" is reserved for the Team Lead`, `field: 'name'`). Every caller inherits
  the refusal — catalog scan, agent-tool save, GUI raw and fields saves, create, duplicate, and both
  spawn paths — and the requested teammate name is separately refused
  (`name must be lower-kebab-case, at most 64 characters, and not "lead"`), so a
  child can never be addressed as `lead` either. A caller that bypasses the parser (a manually
  written file, a stale snapshot) is still stopped by `requireSoul`'s spawn guard. Only the exact
  name is reserved; `leadership`, `lead-review`, and `lead-2` stay valid.
- **Built-in commands have priority.** On every Lead, `installOrchestratorCommand` runs before the
  soul-command reconciler, so a user-invocable soul that would take `/orchestrate` fails its
  registration (warned, contained) instead of shadowing the built-in. Status is decided by handler
  identity (`registered` only when this plugin's accepted handler is effective; otherwise
  `collision` with a reason), never by name presence. `/orchestrate off|exit|stop|disable` never
  spawns; deleting the colliding soul clears the collision on the next sync without a Host reload.
- **Route declarations must be internally consistent before any orchestrator write.** A full
  `provider/model` plus a different `provider`, provider without model, or empty model id is
  `invalid` with a field-tagged diagnostic on every save path, and invalid documents
  read/summarize as `valid: false` with `modelResolved: null`. A reasoning effort without any
  model/provider is valid and ignored at enable (Lead route inherited), matching activation; with
  a declared model the live layer validates the effort against the catalog.
- **Admission has one veto; installation failures cannot kill the Host.** A new or cold-resumed
  roster teammate must resolve a pending spawn plan or a durable binding; a missing plan or a
  binding read failure throws `SoulPlanUnavailableError` and vetoes publication. Agent disposal,
  creation cancellation, plugin teardown, and unexpected post-plan persona/restriction/model
  failures instead unwind every partial registration (Team tools included) and resolve as logged
  skips. The shared installation task is observed internally even when its caller abandons it, and
  `agent/disposed` contains synchronous cleanup failures. At plugin activation, a pre-existing live
  teammate without a plan is skipped with a warning because its publication already happened.
  Binding persistence, catalog rescans, and GUI route installation log failures without blocking
  unrelated operations.
- **Soul-only delegation is deterministic.** Every Team member scope hides visible `subagent` /
  `subagent_fork` globals and denies both names with `tools.guard`; the visible-set restriction is
  reconciled on `tools/change`, so a late-mounted generic tool is hidden as well. Each generic tool has
  an independent lifetime-held deny entry: an unregistered tool's inert entry is retained and hides the
  same tool if it remounts, without ever being revalidated in a replacement union. This avoids probe
  restrictions whose own synchronous `tools/change` emissions recursively woke every other Agent's
  listener and could block the Host's event loop during a spawn. Each pass re-reads until no newly visible
  generic name remains, and disposal is rechecked around registration, so nested mounts and reentrant
  disposal cannot leave a missing or stale restriction.
  `agent/created`
  refuses a provider-owned non-roster child of a Team member, and a roster child without a Soul plan
  is vetoed by the fail-closed applier. The creation veto covers the whole subagent
  seam, not just those two tool names: a tool that starts generic children indirectly (a workflow
  run's `agent()` calls, for example) also cannot publish them under a Team member.
  `spawn_teammate` has no plain path and its output schema requires `soul`.
- **Prompt budgets are real.** The catalog is kept whole-entry and budgeted, and the health card
  exposes both definition-count and character pressure.

## Testing expectations

This tree ships no `tests/` directory and no test glob or test script in
`package.json`. `node --test tests/*.test.mjs` runs **0 tests** and exits 0 (the unmatched glob
reaches Node unchanged), so that command proves nothing. **Orchestrator mode activation still has no
automated end-to-end coverage in this candidate**: the smoke harness does not activate `/orchestrate`,
but it does verify the bundled-default resolution that makes the command available in any workspace
(direct module checks against a brand-new empty workspace, plus the `bundled: false` strict path).

The executable checks are `node --check`, the focused `node:test` suites under `smoke/` — 39 cases
across the four `*.test.mjs` modules (remediation-bindings + remediation-admin 15,
bundled-editable 16, config-toggle 8) — and the keyless end-to-end harness. **Run `run-smoke.mjs`
only from a disposable package copy:** its refused-write probes address the real
`agents/generalist.md` of the package containing the runner, and `finally` rewrites the captured
bytes if they changed. A concurrent edit can be overwritten, and a crash after an unexpected write
can leave the mutation behind. The current run used an isolated copy; a direct real-tree run was
deliberately not executed. See [`../smoke/README.md`](../smoke/README.md) for the copy procedure.

```sh
node --check index.js
for f in lib/*.js; do node --check "$f" || exit 1; done
node --check client.js
node --test smoke/
# Only after changing to the disposable package-copy directory:
node smoke/run-smoke.mjs
```

When adding a new `node:test` suite, the established style is temp directories under `os.tmpdir()`,
fake service objects for Agent/Tool/Command scopes, real Harness prompt-rendering checks, and no
writes to the real workspace `.dsh` or `state/`.

The smoke harness boots a real `dsh --profile headless` process from the DSH source
checkout with a temporary `DSH_HOME`, the Agent Teams bundle, this bundle selected through its real
manifest/patch, and a scripted LLM adapter. It first checks the workspace-independent bundled
defaults directly (an empty workspace sees the packaged catalog and a valid bundled orchestrator
doctrine, and `bundled: false` restores the strict workspace-only behavior), exercises the document
layer's filesystem fence directly (a symlinked `.dsh` cannot auto-create or duplicate outside the
workspace; with the default config, a configured absolute, workspace-relative, or symlink alias of
the packaged `agents/` directory still classifies as `bundled` and refuses save/delete, leaving the
packaged file unchanged; a bundled-soul duplicate still lands under `<workspace>/.dsh/agents`), then
dumps that fresh profile's composed config and asserts the shipped `tool-agent-team` row is disabled
by this bundle's own patch (the portable counterpart of a per-machine profile override), then asserts
the Lead catalog, soul spawn, persona composition, exact tool matrices, model routing, user-invocable
command execution, durable bindings, and an allowlisted child environment — **41 checks** in total.
The harness passed 41/41 from an isolated package copy on 2026-11-08 (a point-in-time result).
Its environment canaries are not deterministically seeded, so the checks do not prove every inherited
secret is removed. The command list was observed to contain `/orchestrate`, but the pass condition
asserts only `probe-cli`; `/orchestrate` absence would not fail the harness, and the mode is not
activated. The `bundledEditable` behavior is covered by the keyless `node:test`
module [`smoke/bundled-editable.test.mjs`](../smoke/bundled-editable.test.mjs), which runs against a
temp copy of the package tree: default-config read-only fencing and shadow/duplicate semantics,
editable package-owned save (including stale-hash `conflict`), delete/restore through the workspace
trash, create/duplicate staying in the workspace directories, symlink confinement, the inert
`bundled: false` combination, and the packaged-orchestrator target (in-place save, workspace
precedence, the mid-edit conflict refusal, and flag-off behavior). The **Use default agent souls**
toggle is covered by [`smoke/config-toggle.test.mjs`](../smoke/config-toggle.test.mjs): the
fifteen-endpoint/eleven-path route pair, GET's effective-flag report, POST persistence through the
plugin row, every POST refusal code, and the connection trust fence. Per-module counts live in
[`../smoke/README.md`](../smoke/README.md). On 2026-11-08 the focused results were 15/15
remediation cases, 16/16 bundled-editable cases with 222 counted assertions, and 8/8 config-toggle
cases with 129; both aggregate forms passed 39/39. The isolated smoke run passed 41/41 and the
canonical isolated remediation runtime passed 169/169.

The config-toggle client cases evaluate the real artifact with a minimal React/module-loader double
and assert registration and source strings. They do **not** execute hooks, DOM, fetch, timers, or
rendered interactions, and are not behavioral browser coverage. The baseline remediation run still
needs an archived `QAS_BASELINE_DIR`; the direct real-tree smoke run, current symlink-failure
reproduction, rendered-browser checks, real providers/model quality, orchestrator activation, and
other OS/Node combinations remain unrun. See [`../smoke/README.md`](../smoke/README.md) for the
historical 2026-11-07 symlink observation and full limits.

## Sharp edges

- **Two root resolvers.** `index.js#resolveRoot` (used for catalog, bindings, commands, tool roots)
  is: session committed working directory → `workingDirectory.defaultDirectory` → `process.cwd()`.
  The browser separately pins the workspace root from its own `props.sessionId` summary first, then
  the Session with a positive `retainedBy.mainView`, then a sole listed workspace; the Host
  authorizes it against live top-level/deployment candidates. Legacy rootless GUI calls still use
  the first candidate with a soul directory, so their no-pin fallback can differ.
- **Workspace-matched Lead.** `leadForGui` prefers the live Lead whose Session directory equals the
  GUI root, then falls back to the first Lead. Command status uses this Lead's command registry so
  multiple live Sessions do not produce false collisions; with no match the fallback can still be
  ambiguous.
- **Same-process model restore.** The runtime captures the previous Lead model only for a genuine
  first explicit enable. A reapply after a Host reload does not capture; disabling after a reload
  removes the doctrine/tool changes but leaves the orchestrator route. `dispose()` on unload does
  restore every captured model.
- **Session title needs the service and a prior title.** Rename/restore requires the optional
  `sessionTitle` service. Enable still succeeds when it is absent, or when the Session has no prior
  `session/title`; both are reported through `titleSkippedReason` (`'service-unavailable'` or
  `'no-prior-title'`), the activation block says the title is unchanged, and no `orchestrator` title
  is invented or leaked by a failed enable. Disable then has no captured title to restore. A rename
  rejection aborts enable with no registrations applied; a title-restore failure is logged and does
  not block disabling (a model-restore failure keeps the bundle for an off retry).
- **Replacement and rollback.** An active bundle is disposed just before the replacement registers
  (duplicate section names cannot coexist). A failure attempts to recreate the previous bundle and
  to restore the pre-attempt model selection if it changed: recreation success keeps the previous
  doctrine active (`previousStateRestored=true`), while a failure of both the replacement and the
  recreation leaves the mode inactive and the error reports `previousStateRestored=false`. Do not
  reorder these steps without preserving that invariant.
- **Command collisions are not retried while the desired set is unchanged.** The commands service
  rejects a duplicate scoped name; `index.js` installs the built-in `/orchestrate` first so that name
  can never be taken by a soul on a fresh Lead. The GUI reports `collision` by handler identity
  (never by name presence), and a soul command that lost its name stays absent. Deleting or renaming
  the colliding soul re-registers the rest without a Host reload; `commandPrefix` (bundle config,
  reload required) is the way to keep such a soul invocable, e.g. `/agent-orchestrate`.
- **The reserved identity is defense in depth.** The shared parser is the single source of the
  `lead` refusal, but spawn calls `requireSoul` again and the GUI's `previewCommand` classifies the
  name as `invalid-name`; do not add a path that bypasses both.
- **Orchestrator invalid documents are inert.** `readOrchestrator` still returns the fields/sections
  of an invalid file so it can be fixed, but `orchestratorSummary` reports `valid:false` with
  `modelResolved:null` and activation refuses it. Do not "repair" a contradictory file by writing
  the conflicting declaration back or by letting summary advertise a resolved route.
- **Tool-validation asymmetry.** `spawnTeamMember` rejects unavailable, Team, and Lead-only scoped
  tool names for a soul. The GUI save validator applies the same Lead-only rejection and, when the
  live tool catalog is nonempty, rejects unknown tools; an empty live catalog skips that unknown-name
  check. The orchestrator apply path probes and *skips* non-restrictable/unavailable names with a
  warning; only a restriction-service failure aborts. The three paths intentionally have different
  strictness because a soul runs later while an orchestrator definition may target a changing
  tool set.
- **The Team tool surface is installed in every member scope.** `spawn_teammate` and
  `interrupt_agent` are Lead-only by the Team service contract; `interrupt_agent` is only registered
  when `config.interrupt` is true. `list_agent_souls` is technically callable by a teammate even
  though it is Lead-facing. `manage_agent_souls` is installed only for the Lead.
- **Catalog budgets vs health.** The catalog keeps whole entries and may omit later entries; health
  measures the full rendered catalog with a very large budget so over-budget pressure is visible.
  `maxDefinitions` caps the valid definitions kept per root.
- **Session-log scan cost.** `modeOf` walks from sequence 0 to the current sequence on every
  reapply check. It is linear in the Session log length and intentionally simple; do not call it in
  a hot loop.
- **Pending spawn key.** The pending plan is keyed by the Lead's id + requested teammate name and is
  consumed on the child's creation. A duplicate in-flight key is refused before it can overwrite the
  winner, and cleanup is ownership-checked so one spawn cannot delete another spawn's plan.
- **Bindings are best-effort for persistence, fail-closed for admission.** Missing/corrupt state or
  an unreadable file degrades to an empty cached store for writing and listing, and a miss is not
  re-read; repair or another process's write may need a reload/fresh store. The resulting missing
  record can be labelled `missing-binding` even when unreadable input caused it. A roster teammate
  that cannot resolve a plan is still refused at creation/cold resume. The refusal is not silent: the
  plugin's `send_message` reports the Soul-specific cause, the Host logs it with code
  `SOUL_PLAN_UNAVAILABLE` and a `reason`, and `list_agent_souls` returns it with
  `source: "admission:<teammate>"`. The shared subagent lifecycle's generic `is unavailable` wrapper
  is unchanged. The 500-record cap can drop older cold-resume data; a pruned record blocks that
  resume until re-spawn. Writes are serialized per root and by canonical file across processes;
  a failed write logs and does not fail the spawn. At plugin activation, pre-existing live teammates
  without a plan are skipped with a warning
  and no Team tools rather than failing the whole plugin.
- **Fork history.** A fork teammate inherits the Lead's completed turns, which may mention tools the
  soul's matrix excludes. The restriction still prevents those calls, but the model sees the
  history.
- **No watcher.** Catalog changes appear on the next scan trigger. The GUI overview refreshes the
  catalog on every read; running teammates are never edited in place.
- **Orchestrator extras move.** Extras are composed after canonical sections; an unusual original
  layout can change placement on the first read/save. Document authors should use `###` for
  in-section sub-headings.
- **The catalog line and `commandPrefix`.** Catalog creation receives the configured prefix and
  renders `/<prefix><name>`, matching the command registry and GUI catalog lines. A collision on
  that exact prefixed name is still reported rather than retried.
- **Packaged rename collision under `bundledEditable`.** The GUI semantic validator rejects a rename
  that duplicates any other valid document, including a package-owned one. A direct document-layer
  save without an explicit `validate` callback and the Lead-only `manage_agent_souls` save do not run
  that GUI validator; the document-layer duplicate
  helper also skips package-owned rows, and catalog scanning silently drops the later packaged
  duplicate without a diagnostic. A direct packaged rename can therefore make one definition vanish
  from the live catalog. Keep packaged names unique, use the GUI for packaged renames, and inspect
  the resulting overview/catalog after any direct save. The validation and collision behavior here
  is source-derived; owner follow-up is required for a shared semantic guard and diagnostic.
- **Bundled doctrine text has current defects.** `defaults/orchestrator.md` says its frontmatter
  selects a provider/model/reasoning route, but the shipped file declares none; actual runtime
  behavior inherits the Lead route when no model is declared. Its State Tracking prose names a
  `Failed` task status, while the tool contract uses `pending`, `in_progress`, and `completed`
  (with `deleted` possible after the delete action and only the first three accepted by the list
  filter). Its unconditional correction-loop sentence conflicts with the strict/advisory/off gate
  rules and corrective-cycle budget; it is not an automatic retry driver. The executable prompt was
  deliberately not edited in this documentation assignment; the doctrine owner must reconcile these
  statements.
- **The model-facing context description is stale.** `lib/tools.js` describes omitted `context` as
  selected-Soul context, else `fresh`; actual precedence is explicit call argument → Soul `context`
  → `config.defaultContext`, which may be `fork`. Do not infer the default from the tool description
  string. That runtime string was not edited here and needs its interface owner to correct it.
- **No rendered visual or interaction test.** No test renders the browser artifact or validates
  real browser layout and interaction; those must be checked manually in a real browser. Static
  source-contract coverage of the artifact does exist (`smoke/config-toggle.test.mjs` loads the
  real `client.js` and asserts its registration/source contract — see
  [`../smoke/README.md`](../smoke/README.md) and [`GUI-INTERNALS.md`](GUI-INTERNALS.md)).

## Ownership and write scope

- [`../README.md`](../README.md) and this document are the user/maintainer prose owned by this
  documentation task.
- [`GUI-INTERNALS.md`](GUI-INTERNALS.md) is the authoritative GUI/API contract and is maintained
  separately; do not duplicate its route/payload detail here.
- [`../smoke/README.md`](../smoke/README.md) documents the end-to-end harness.
- Production code (`index.js`, `lib/`, `client.js`), `package.json`, `agents/`, `locale/`,
  and runtime `state/` are separate write scopes. Documentation changes must match the code; when
  they disagree, fix the documentation to the code and flag the discrepancy.
