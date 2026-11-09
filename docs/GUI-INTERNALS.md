# Agent Soul — GUI and API module contract (maintainers)

This is the implementation contract for the plugin's Settings GUI, its authenticated HTTP API, and
the shared document/orchestrator layers behind both the browser and the Lead's agent tool. It is the
authoritative reference for maintainers changing those surfaces; end-user onboarding lives in
[`../README.md`](../README.md), the control-by-control option reference in
[`SOUL-OPTIONS.md`](SOUL-OPTIONS.md), and the module-by-module architecture in
[`INTERNALS.md`](INTERNALS.md).

**Reading order for a newcomer:** the module map below → the workspace-root rules → the route
inventory → the phase that owns the surface you are touching (P0–P4 sections are append-only
history; earlier phases are still live) → the hard rules. The executable verification lives in
the `smoke/` harness (invocation and scope: [`../smoke/README.md`](../smoke/README.md)): the
keyless `smoke/run-smoke.mjs` run covers host-side spawn/command/binding behavior end to end,
and the focused `node:test` suites add direct coverage of these surfaces —
`smoke/config-toggle.test.mjs` drives the real `lib/gui-host.js` route handlers and evaluates the
real `client.js` artifact only for registration/locale/source contracts (no hooks, DOM, fetch,
timers, or rendered interaction), `smoke/bundled-editable.test.mjs` covers the packaged-editable document
layer plus the GUI save conflict mapping, `smoke/remediation-admin.test.mjs` covers the
agent-tool output schema, `smoke/gui-fixes.test.mjs` covers the client artifact contracts and
live-route validation/recovery fixes, and `smoke/windows-shell-alias.test.mjs` covers the portable
`bash`/`pwsh` shell-name resolution through the real spawn, apply, orchestrator, and GUI-route
modules. Route and payload shapes below are still derived from the source handlers in
`lib/gui-host.js` and should be checked against them when in doubt.

### Module map

| Module | Role |
|---|---|
| `lib/soul.js` | parse/validate one soul Markdown document (frontmatter + body), catalog scanning and prompt text |
| `lib/tools.js` | ported Team tools (`spawn_teammate`, messaging, task board) + `team:policy`, `team:identity`, `team:agent-souls` prompt sections |
| `lib/composition.js` | live Loader inspection of the replaced `tool-agent-team` row (Plugin Manager listing fallback when the Web profile does not expose the Loader), Plugin Manager repair, opt-in `claimTeamToolRow` guard |
| `lib/apply.js` | applies a soul to a spawned or cold-resumed teammate: fail-closed plan resolution (pending plan, then durable binding), persona section at the deployment-persona order, sections, tool matrix, model route, binding record |
| `lib/commands.js` | registers one Lead-scoped slash command per user-invocable soul |
| `lib/admin.js` | GUI/agent-tool document layer: split/compose/validate, directory scanning, path safety, atomic writes, trash |
| `lib/gui-host.js` | authenticated JSON routes + overview assembly; workspace-root selection; command/usage/health status |
| `lib/bindings.js` | durable teammate binding store at the resolved `bindingsFile` itself (default `<workspace>/.dsh/agent-soul/bindings.json`) used for cold resume and GUI usage data |
| `lib/preferences.js` | plugin-owned default-Soul preference document (`preferences.json`): atomic read/write, real-path fence, default resolution (selection → any live catalog definition named `generalist` → failure) |
| `lib/orchestrator.js` | single orchestrator definition: parse/validate/compose, `/orchestrate` command, session-scoped mode runtime (prompt sections, model/tool overrides, rollback) |
| `lib/orchestrator-mode.js` | shared pure durable-mode fold + Host session projection definition (`agentSoulOrchestrator`); the only place off-words and command-log settlement semantics live |
| `lib/tool-names.js` | frozen portable shell-name resolver: `SHELL_TOOL_ALIAS_PAIRS` (`bash` ↔ `pwsh`), `shellCounterpart`, `resolveToolName`, `toolNameKnown`, `resolveRestrictableNames` |
| `lib/admin-tool.js` | Lead tool `manage_agent_souls` (document + orchestrator actions) over the same layers |
| `client.js` | classic browser artifact: Settings → "Agent Soul" page (Souls + Orchestrator tabs, dialogs), the Plugins-page row-config contribution ("Use Default Agent Souls" toggle), and the Session-header Orchestrator-mode badge |
| `index.js` | Cordis wiring: deps, creation fence, per-agent install (tools/commands/catalog/tool/orchestrator reapply), GUI install |
| `locale/` | package-level display metadata (en, zh); the eight in-page browser dictionaries live only in `client.js` |

### What shipped

| Phase | Surface | Summary |
|---|---|---|
| P0 | integrity + first run | content hashes and optimistic concurrency (409 + `currentHash`), semantic save validation with `fieldErrors`, live tool/model catalogs, drafts, unsaved-changes guard, search/filter/sort, root-aware empty state, skeletons |
| P1 | editing power | parse/preview (no writes), raw mode, create-with-source + templates, duplicate, recoverable trash delete + Undo/restore, tools picker, model cascade, teammate-prompt preview, paste/import |
| P2 | runtime insight | binding usage, command-status chips, catalog line, prompt/definition budgets (`health`), live Teams awareness, clickable scan diagnostics, eight locales |
| P3 | dialog layout | full-width page + centered resizable editor dialog (persisted size), responsive label-above fields, sticky dialog footer |
| P4 | orchestrator | single optional orchestrator definition, `/orchestrate` session mode (prompt doctrine + model/tool overrides), Orchestrator GUI tab, GET/POST routes, agent-tool actions |
| RC | release remediation | reserved `lead` identity on every save/create/duplicate/spawn path; built-in-first command priority with handler-identity status (`registered` vs `collision`) and a `reason` on preview command status; orchestrator route validation (declaration layer plus live catalog) on every save path; actionable cold-resume refusals |
| BE | bundled-editable authoring (**0.4.0**, merged to main 2026-11-08 UTC) | opt-in `bundledEditable` mode: the packaged souls and packaged orchestrator doctrine become editable in place while keeping their packaged identity (see the phase entry at the end of this history) |

**Release status (2026-11-08 UTC).** There are no git tags; "released" here means merged to the default
branch `main`. Everything through P4 plus the selectable default Soul (preferences route, state
document, and Souls-tab selector), the soul-only delegation fences, and the durable-mode
Session-header badge is released there — see "Default Soul preference and soul-only delegation"
below. The BE phase is released as of 2026-11-08 UTC (PRs #4–#6): the opt-in `bundledEditable` authoring
mode, its `GET`/`POST /agent-soul/config` route pair, the Plugins-page "Use Default Agent Souls"
contribution, the `0.4.0` version bump, and the `smoke/bundled-editable.test.mjs` /
`smoke/config-toggle.test.mjs` suites are all merged to `main` (the newest phase entry, at the end
of this history) and are 0.4.0 additions absent in 0.3.0. With the flag off (the default) the
packaged souls and the packaged doctrine keep the 0.3.0 read-only authoring behavior (no in-place
editing; the documented editing fences hold) — other 0.4.0 changes, such as the bundled-soul
route-inheritance change from PR #5, still apply and are not reverted by leaving the flag off.

**Working-tree fixes.** The D01–D18 review fixes (including D15b) and their focused suites are
present in the current working tree, not in that release history. Behavior described in the sections
below may therefore differ from a published 0.4.0 installation.

**0.4.1 working tree (portable shell names).** On branch `feat/windows-pwsh-shell-aliases` the
manifest is `0.4.1` and the GUI tool catalog advertises the missing `bash`/`pwsh` spelling as one
marked portable-alias entry (`portableAliasOf`); the save validator and preview accept either
spelling, and the spawn, apply, and orchestrator paths resolve it to the live one. This change and
its suite are not in the 2026-11-08 UTC release history. See "Portable shell names (0.4.1, working
tree)" at the end of this document.

### Handler terms

| Term | Meaning here |
|---|---|
| **Overview** | the single `GET /agent-soul/overview` snapshot the page renders: catalogs, document rows, settings, runtime health, the orchestrator summary, and the default-Soul preference block |
| **Document** | one soul file (`DocumentSummary` in a listing, `DocumentDetail` when loaded/saved, with `source`) |
| **Catalog** | the scanned, validated set of every `*.md` under the configured soul directories, plus the packaged `agents/` catalog when `bundled` is enabled (the default) |
| **Binding** | plugin-owned durable record in the resolved `bindingsFile` itself (default `<workspace>/.dsh/agent-soul/bindings.json`) mapping a teammate's child Session to the soul that shaped it (persona, tools, model, context) |
| **Preferences** | plugin-owned `preferences.json` beside the bindings file: the explicit default-Soul selection plus the effective default, its source, validity, and warning |
| **Draft / baseline** | A Soul draft persisted in browser localStorage: form fields/sections, Form/Raw mode, raw source, and the base file hash, plus the in-memory file state the editor loaded; Orchestrator, New/Paste, and Undo state are not persisted |
| **`expectedHash`** | optimistic-concurrency token: the hash the editor believes is on disk; a mismatch answers `409 conflict` with `currentHash`/`currentModifiedAt` |
| **`expectedMissing`** | explicit no-replace precondition for recreating a file that was absent at conflict time; a newly appeared target answers `409 conflict` instead of being overwritten |
| **Command status** | live check of the soul's slash command against the workspace-matched Lead: `registered`, `ai-only`, `invalid-name`, `collision`, `no-live-lead`. With a per-Lead registration record, `registered` means this soul's own handler is the effective one; `collision` means the name is invocable but another handler owns it (the built-in `/orchestrate`) or registration failed. |
| **Health** | catalog-wide budgets and scan findings: definition count, catalog characters, duplicate names, invalid files, diagnostics |
| **Orchestrator mode** | per-session mode turned on with `/orchestrate`; applies the effective orchestrator doctrine (the workspace `<dirname(bindingsFile)>/orchestrator.md` when present, else the packaged `defaults/orchestrator.md` when `bundled` is on), model, and tool matrix to that session's Lead, announces activation, and renames the Session title when the optional service is available and a prior title exists |
| **Trash** | recoverable delete directory beside the bindings file (`<dirname bindingsFile>/trash`), real-path fenced to the real workspace (or the real shared-state directory for an absolute bindings file) before any move; when `trashedFile` is returned, Undo restores that exact entry to its original path. An unsafe state path or a trash creation/move failure preserves the source and returns `unsafe-path`/`invalid-request`; there is no hard-delete fallback, so no `trashedFile`/Undo exists for a failed delete |

`index.js` wires both halves: the document layer and parser serve both the GUI and the agent tool
(the "one operation, two callers" practice). Their save contracts are not identical: the GUI adds
live semantic validation and optimistic concurrency, while the agent tool uses raw-source,
last-write-wins saves without the GUI semantic validator.

## Hard rules

- ESM JavaScript, **no dependencies, no bare imports** (`node:` builtins and relative paths only),
  JSDoc, no TypeScript syntax. `node --check <file>` must pass.
- The browser half runs as a classic artifact: it must call
  `window.__ModuleLoader__.load({ id, factory(require) { ... } })` exactly like the decoration
  template, take React from `require('react')`, and declare `dsh.client` in `package.json`.
- Do not touch files outside your write scope. Do not install packages, do not modify `~/.dsh`,
  and do not run `plugin_manager`.
- Tests are `node:test` and use temp dirs under `os.tmpdir()`; never the real workspace `.dsh`.
  (There is no `tests/` directory; the executable checks are `node --check`, the focused
  `node --test smoke/*.test.mjs` suites, and the keyless `smoke/run-smoke.mjs` harness —
  invocation and scope live in [`../smoke/README.md`](../smoke/README.md).)
- Writes are atomic: replacement uses a same-directory temp file + `rename`; no-replace creation
  uses a temp file + hard link (`EEXIST` refuses to clobber). All paths must resolve inside a
  configured soul directory — or the packaged `agents/` directory when `bundledEditable` is on
  (packaged files are read-only targets otherwise).

## Which workspace the GUI edits (lib/gui-host.js)

The browser derives the current main Session's committed working directory and pins that root for
the Soul editor session (a later Session switch does not move those unsaved edits). The Orchestrator
load is tied to the tab and its load function, not to `sessionRoot`; a Session-root association
adopted while the root is still unpinned re-reads the definition only when the draft is clean, so a
dirty Orchestrator draft is never replaced. See the current persistence limits below. The page reads
the root through
`props.useSessions(...)`: the page's own `props.sessionId` summary first, then the Session summary
whose `retainedBy.mainView` count is positive. Every overview/document GET carries `?root=`, and
every POST body carries `root`; a sole listed workspace is the compatibility fallback when no
main-view association exists.

The Host authorizes each requested root against current candidates: live top-level Session working
directories (teammates are skipped), the deployment root captured at activation, then
`workingDirectory.defaultDirectory` / `process.cwd()`. Candidates must be real directories, and an
unknown root answers 403 `unsafe-root`. A request without `root` retains the legacy behavior: the
first candidate whose configured soul directories exist wins, with the deployment directory as the
fallback. One authorized root is pinned for all validation and mutation work in that request, so a
roster change cannot move an in-flight save to another workspace.

## Host routes (lib/gui-host.js)

Fifteen endpoints, registered as eleven exact paths (the web server rejects duplicate
`(kind, path)` registrations, so `GET` and `POST /agent-soul/document` share one registration
with method dispatch, as do `GET`/`POST /agent-soul/orchestrator`,
`GET`/`POST /agent-soul/preferences`, and `GET`/`POST /agent-soul/config`). P1 adds the parse,
preview, duplicate, and restore endpoints; P4 adds the orchestrator document endpoints; the
default-Soul release adds the preference endpoints; the packaged-defaults config toggle pair is
part of 0.4.0 (see "Release status (2026-11-08 UTC)"). Each is registered on
`ctx.webServer.register({ kind: 'exact', path, handler })` with the absolute paths below.
Every handler first consults the composition's trust fence and answers 401/403 when it rejects:

```js
const rejection = ctx.connection.requestRejection(req) // 401 | 403 | undefined
if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
```

`res` is a Node `ServerResponse`; `req` is an `IncomingMessage`. JSON responses set
`content-type: application/json; charset=utf-8` and `cache-control: no-store`. Unknown methods get
405 with `allow`. Request bodies are `application/json`, bounded to 1 MiB; a malformed or oversized
body answers 400 `{ ok: false, code: 'invalid-request', message }`.

Route names and payloads (the browser half addresses them without the leading slash).

### Endpoint inventory

| Method | Path | Purpose | Detailed shape |
|---|---|---|---|
| GET | `/agent-soul/overview` | page snapshot (catalogs, documents, settings, runtime, orchestrator summary, preferences) | below |
| GET | `/agent-soul/document?file=` | load one document (fields, sections, source, hash) | below |
| POST | `/agent-soul/document` | save one document (fields/sections or raw source; `expectedHash`) | below + P0 |
| POST | `/agent-soul/create` | create a document from a name (Host skeleton, or the posted template `source`) | below |
| POST | `/agent-soul/delete` | move one document into the trash | below + P1 |
| POST | `/agent-soul/parse` | parse pasted Markdown, write nothing | P1 |
| POST | `/agent-soul/preview` | teammate-prompt preview for a draft, write nothing | P1 |
| POST | `/agent-soul/duplicate` | copy a document under a new name | P1 |
| POST | `/agent-soul/restore` | restore one trashed document | P1 |
| GET | `/agent-soul/orchestrator` | load the effective orchestrator definition (bundled default when the workspace file is absent and `bundled` is on; skeleton only when both are absent; with `bundledEditable` on, the packaged file is the editable effective document) | P4 |
| POST | `/agent-soul/orchestrator` | save the orchestrator definition (with `bundledEditable` on and no workspace file, the packaged doctrine is rewritten in place; a workspace file that appears meanwhile answers `conflict`) | P4 |
| GET | `/agent-soul/preferences` | load the default-Soul selection and the effective default | below |
| POST | `/agent-soul/preferences` | validate and atomically persist the default-Soul selection (`name`, or null to clear) | below |
| GET | `/agent-soul/config` | read the packaged-defaults mode (`bundledEditable`, `bundled`, `configurable`); plugin-wide, no `root` | below |
| POST | `/agent-soul/config` | persist `bundledEditable` on the plugin's Loader row (profile patch; the plugin reloads once) | below |

### `GET /agent-soul/overview`

200 body (example values are illustrative; `plugin.version` is read from the real manifest —
`0.4.1` at this revision (the working-tree bump on `feat/windows-pwsh-shell-aliases`; 0.4.0
manifests report `0.4.0`, 0.3.0 manifests report `0.3.0`, and earlier manifests report their own
versions and predate the authoring mode). The no-`pluginMeta` fallback constant
`PLUGIN_META_DEFAULTS` in `lib/gui-host.js` reports `0.4.1`; it is used only when the Host
passes no plugin metadata):

```jsonc
{
  "plugin": { "name": "@local/dsh-agent-soul", "version": "0.4.1", "root": "/abs/workspace" },
  "settings": {
    "dirs": [".dsh/agents"],
    "resolvedDirs": ["/abs/workspace/.dsh/agents"],
    "bundled": true,                                 // package catalog/docs fallback enabled
    "bundledEditable": false,                        // effective in-place authoring mode (true only with bundled on + the flag)
    "bundledDir": "/abs/profile/node_modules/@local/dsh-agent-soul/agents",
    "bindingsFile": ".dsh/agent-soul/bindings.json",
    "bindingsPath": "/abs/workspace/.dsh/agent-soul/bindings.json",
    "commandPrefix": "", "defaultContext": "fresh",
    "freshProvider": "spawn", "forkProvider": "fork", "interrupt": true,
    "maxDefinitions": 64, "maxPromptChars": 12000,
    "providers": [{ "id": "deepseek-official", "name": "DeepSeek" }]
  },
  "runtime": {
    "scannedAt": 1793461007624,            // null before the first scan
    "validCount": 3, "invalidCount": 0,
    "bindingsCount": 2,                    // null when the binding store cannot be read
    "liveTeams": [{ "lead": "lead", "commands": [{ "name": "researcher", "description": "…" }], "memberCount": 2 }],
    "health": {                            // P2: budgets + scan findings
      "definitions": { "used": 3, "max": 64 },
      "catalogChars": { "used": 1051, "max": 12000 },
      "duplicates": [], "invalidFiles": 0,
      "diagnostics": 1,
      "teamTools": {                       // replaced Team-tool row composition
        "available": true, "status": "replaced", "ok": true,
        "rows": [{ "id": "tool-agent-team", "disabled": true, "enabled": false }],
        "message": "the shipped Team tool row is disabled, so agent-soul-team owns the Team tool surface",
        "fix": "- id: tool-agent-team\n  disabled: true"
      }
    }
  },
  "documents": [DocumentSummary],
  "orchestrator": {                        // P4: effective definition summary
    "path": "/abs/workspace/.dsh/agent-soul/orchestrator.md",   // writable workspace target
    "configured": true, "bundled": true,   // bundled: packaged default is in effect
    // (with bundledEditable and no workspace file: path/sourcePath are the packaged file, bundled: false)
    "sourcePath": "/abs/profile/node_modules/@local/dsh-agent-soul/defaults/orchestrator.md",
    "valid": true, "name": "orchestrator",
    "model": "", "modelResolved": null,
    "tools": null, "planFirst": true,
    "gateMode": "strict", "maxRetries": 10, "pauseOnFatal": true, "diagnostics": []
  },
  "preferences": {                         // default-Soul selector state
    "path": "/abs/workspace/.dsh/agent-soul/preferences.json",
    "selected": null,                      // persisted explicit selection, null = none
    "effective": "generalist",             // resolved default; null when none is usable or the document is invalid
    "source": "builtin",                   // "selection" | "builtin" | "none"
    "valid": true,                         // false when the document is malformed/invalid or no default is usable
    "warning": null,                       // non-null for a stale selection, unusable default, or invalid/unreadable document
    "available": ["generalist", "researcher"]
  },
  "diagnostics": [{ "source": "path", "message": "…" }]
}
```

`GET/POST /agent-soul/preferences` answer `{ ok: true, preferences }` with that block. The POST body
also accepts an optional `root` and requires `name` (a soul name, or `null`/empty to clear). An
unknown name answers 400 `{ ok: false, code: 'unknown-soul', message, available }` and writes
nothing; an invalid wire value answers 400 `invalid-request`. The selection is stored at
`<dirname(resolved bindingsFile)>/preferences.json` (default
`<workspace>/.dsh/agent-soul/preferences.json`) with
the same real-path/symlink fence and temp-file-plus-`rename` atomic replacement as the orchestrator
document. A missing file means no explicit selection. A corrupt, malformed, or unsupported document
is reported through `warning` with `valid: false`, `effective: null`, and `source: 'none'`; that
matches the spawn path's fail-closed behavior, so a default spawn fails until the document is fixed
or cleared. An explicit `agent_type` does not read the preferences document.

`DocumentSummary`:

```jsonc
{
  "file": "/abs/workspace/.dsh/agents/researcher.md",             // absolute
  "label": ".dsh/agents/researcher.md",                            // root-relative (packaged: file name)
  "name": "researcher", "description": "Researches …",                // null when unparseable
  "valid": true,
  "bundled": false,                                               // true: packaged soul read-only in place (the default)
  "packageOwned": false,                                          // true: the file lives in the packaged agents/ catalog
  "tools": ["web_search", "web_fetch"],                // null = inherits every tool
  "model": "deepseek-flash",                                          // raw frontmatter model or null
  "modelResolved": "deepseek-official/deepseek-flash",                // null when unresolvable/inherited
  "userInvocable": true, "context": "fresh",                           // context null when absent
  "command": "/researcher",                                           // null unless the command is registered to this soul's handler
  "sourcePath": "/abs/…",                                             // file path for diagnostics
  "hash": "…",                                                        // SHA-256 hex of the file text
  "modifiedAt": 1793461007624,
  "diagnostics": [{ "message": "…" }],                                // empty for a valid document
  "commandStatus": { "name": "researcher", "status": "registered", "message": "…" }, // P2: live registration check
  "usage": { "storedCount": 1, "lastUsedAt": 1793461007624, "activeMembers": ["alpha"] }, // P2
  "catalogLine": "- researcher — Researches … (tools: …; model: …; command: /researcher)" // P2; '' for invalid rows
}
```

`commandStatus.message` carries the reason for `collision`/`no-live-lead` when one is known, and the
check uses the Lead of the workspace the page edits (see "Which workspace the GUI edits"). The
`researcher` values in these payload examples illustrate the shape; the bundled `researcher` ships
AI-only (`userInvocable: false`, no command) until a person opts in. Status is computed by handler
identity when the per-Lead registration record is available: `registered` only when this plugin's
accepted handler is the registry's effective definition, otherwise `collision` (the name may be
owned by the built-in `/orchestrate`, or registration failed). With no record (an older Live Lead or
a composition without the sync service) the documented name-presence fallback is used. The overview
reconciles the workspace Lead's soul slash commands with the refreshed catalog before computing
these rows, and each soul-document mutation route does the same after its scan (`deps.syncSouls`),
so a newly created/renamed/deleted invocable soul needs no Host reload. Preference, orchestrator,
and plugin-config mutations do not share that rescan/command-sync path.

### `GET /agent-soul/document?file=<absolute-path>`

200 `{ "document": DocumentDetail }`; 404 `{ ok: false, code: 'not-found', message }` when the file
does not exist; 400 `{ ok: false, code: 'unsafe-path', message }` when it resolves outside every
readable soul directory (or is not a `.md` file). The packaged bundled catalog is readable through
this route and, with `bundledEditable` off (the default), reports `bundled: true` and refuses
writes; with the flag on, a packaged document reports `bundled: false` + `packageOwned: true` and
is writable in place.

```jsonc
// DocumentDetail
{
  "file": "/abs/…/researcher.md",
  "label": ".dsh/agents/researcher.md",
  "bundled": false,                               // true: packaged soul, read-only in place (the default)
  "packageOwned": false,                          // true: file lives in the packaged agents/ catalog
  "sourcePath": "/abs/…/researcher.md",
  "source": "---\nname: researcher\n…",          // complete current file text
  "hash": "…",                                    // SHA-256 hex of `source`
  "modifiedAt": 1793461007624,                    // file mtime; 0 for a not-yet-written suggestion
  "fields": {
    "name": "researcher", "description": "Researches …",
    "tools": "web_search, web_fetch",             // '*' = inherit all, '' = deny all inherited
    "model": "deepseek-flash", "provider": "", "reasoningEffort": "",
    "context": "fresh",                            // '' when absent
    "userInvocable": true,
    "extraFrontmatter": ""                         // raw YAML lines for unknown keys, preserved verbatim
  },
  "sections": {
    "role": "…", "inputs": "…", "rules": "…", "output": "…",
    "extraMarkdown": ""                            // body content not in the four canonical sections
  },
  "valid": true,
  "diagnostics": [{ "message": "…" }]
}
```

### `POST /agent-soul/document`

Body `{ "file": "<absolute path>", "fields": {…}, "sections": {…}, "expectedHash"?: "…",
"expectedMissing"?: true, "root"?: "…" }` (same field/section shapes as DocumentDetail; a raw
`source` may replace `fields`+`sections` — the raw-mode save path; `file` may be absent for a
not-yet-created suggestion and then the first configured directory + `name.md` is used).
`expectedHash` (any string, including `''`) is the optimistic-concurrency token: when it is
present, the target is re-read under its mutation lock and a vanished or changed file answers 409
`conflict`. Omitting `expectedHash` (or sending `null`) leaves the save unguarded (last-write-wins);
any other non-string value is rejected up front with 400 `invalid-request`
(`expectedHash must be a string`) and no save occurs. `expectedMissing: true` is the guarded
no-replace recreation precondition: the target must still be absent and is published with no-replace
semantics (a target that appeared in the meantime answers 409); it cannot be combined with a
non-empty `expectedHash`, and an empty `expectedHash` never substitutes for it. The handler
composes the markdown, validates it with the plugin's own parser, refuses invalid documents, writes
atomically, rescans the catalog, and answers:

- 200 `{ "ok": true, "document": DocumentDetail }`
- 400 `{ "ok": false, "code": "invalid" | "unsafe-path" | "exists", "message": "…", "diagnostics": [{ "message": "…", "field": "…" }], "fieldErrors": { "name": "…", "description": "…", "tools": "…", "model": "…", "provider": "…", "reasoningEffort": "…", "context": "…", "body": "…" } }`
  — a wire-level malformed body instead answers 400 `{ ok: false, code: "invalid-request", message }`
  (no diagnostics). `fieldErrors` is always present for `code: "invalid"` (an empty object when no
  diagnostic names a form field); a parser diagnostic that carries `field` (for example the reserved
  `name: "lead" is reserved for the Team Lead`) is mirrored into `fieldErrors[field]` so the editor
  focuses that control. Nothing is written for an `invalid` save.

With `bundledEditable` off (the default), a write aimed at a packaged bundled soul is refused as
`unsafe-path` with a message telling the caller to duplicate the soul into a workspace soul
directory (the GUI disables Save for such a document and offers **Duplicate** instead). With
`bundledEditable` on, a package-owned target is a valid save target and the write lands in the
package's `agents/` directory (the same atomic temp-file + `rename` as any other save);
`create`/`duplicate` still write the configured workspace directories.

### `POST /agent-soul/create`

Body `{ "name": "researcher", "source": "…" }` (`source` optional) → 200
`{ "ok": true, "document": DocumentDetail }` after creating `<first dir>/<name>.md`. When no
configured directory exists yet, the first **workspace-relative** directory is created on demand
only after its real nearest existing ancestor resolves inside the real workspace, and the created
directory is canonically re-checked; a symlinked `.dsh` that leaves the workspace therefore answers
`no-dirs` instead of writing outside. This keeps a fresh workspace able to create its first soul
without a manual `mkdir`. Without `source` the file starts as the Host canonical skeleton
(`canonicalSkeleton`; valid by construction, placeholder body text); with `source` the validated
template text is written instead (the browser's New-soul dialog composes its own template
client-side and always sends `source`).
400 codes: `invalid-name` (not lower-kebab-case, >64 chars, or the reserved `lead`), `exists`
(`<name>.md` already exists in a configured directory), `no-dirs` (no writable workspace-relative
soul directory is configured), and
`invalid` (the source template does not parse); an `invalid` response includes `fieldErrors`.

### `POST /agent-soul/delete`

Body `{ "file": "<absolute path>" }` → 200 `{ "ok": true, "trashedFile": "…" }` (`trashedFile` is
the trash path the browser's Undo uses), or 400
`{ "ok": false, "code": "unsafe-path" | "not-found" | "invalid-request", "message": "…" }`.
The trash/state path is fenced to the real workspace (or real shared-state directory) before any
move, so a symlinked `.dsh`/`.dsh/agent-soul`, a dangling link, or a trash-directory symlink that
leaves that boundary answers `unsafe-path` and the source is untouched. A trash creation or
no-replace move failure is `400 invalid-request` naming the trash location and stating the document
was not deleted; the source stays byte-identical, no `trashedFile` is returned, and there is no
hard-delete fallback.

### `GET/POST /agent-soul/config`

The packaged-defaults toggle's route pair. It is **plugin-wide** — the setting lives in the
profile's Loader row config — so the requests carry no `root` and apply to every workspace.

`GET` answers 200:

```jsonc
{ "ok": true, "config": { "bundledEditable": false, "bundled": true, "configurable": true } }
```

`bundledEditable` is the effective flag and `bundled` says whether the packaged catalog is enabled
at all. `configurable` is true only when the Host exposes a `configEditor` service with an `edit`
function **and** that editor lists this plugin's `agent-soul-team` row; both are required before this
composition can persist a change.

`POST` body `{ "bundledEditable": true }` persists the flag through the Host `configEditor` into
the plugin's Loader row config — the profile patch's `agent-soul-team` row, every other row key
preserved — and the Loader reloads the plugin once. Success answers
`200 { "ok": true, "config": { "bundledEditable": true, "bundled": true, "configurable": true } }`.
Failures:

- `400 { ok: false, code: "invalid-request", message }` — malformed body, or `bundledEditable`
  not a boolean.
- `409 { ok: false, code: "bundled-disabled", message }` — `config.bundled` is `false`, so the
  packaged catalog is disabled and there is nothing to toggle.
- `409 { ok: false, code: "not-configurable", message }` — the `configEditor` service or its
  `edit` function is missing, or row `agent-soul-team` is not in the active profile; set
  `bundledEditable` in the profile
  patch instead.
- `409 { ok: false, code: "overridden", message }` — the config editor refused the edit (for
  example a home patch or CLI overlay that overrides the profile row).

## Document layer (lib/admin.js)

Exports the operations the routes call, plus path helpers used by `index.js`:

```js
// Absolute soul directories for one workspace root; entries may be absolute, ~/…, or relative.
export function resolveSoulDirs(config, root)

// The workspace root the GUI edits: workingDirectory.defaultDirectory, else process.cwd().
export function resolveGuiRoot(ctx)

// Split one Markdown document into editable parts. Never throws; a malformed frontmatter or
// missing body is reported through `diagnostics`, while best-effort fields stay editable.
export function splitDocument(source, meta) // -> { fields, sections, valid, diagnostics }

// Compose + validate one document. `input` carries { fields, sections } as in DocumentDetail.
export function composeDocument(input) // -> { source, valid, diagnostics }
  // fields: { name, description, tools, model, provider, reasoningEffort, context,
  //           userInvocable, extraFrontmatter }
  // sections: { role, inputs, rules, output, extraMarkdown }

// Scan every configured directory for *.md (valid or not), sorted by label.
export async function listDocuments({ config, root, logger }) // -> { dirs, documents: DocumentSummary[], diagnostics, scannedAt }

export async function readDocument({ config, root, file })          // -> { ok, document?, code?, message? }
export async function saveDocument({ config, root, file, fields, sections,
  expectedHash, expectedMissing, validate }) // -> { ok, document?, code?, message?, diagnostics? }
export async function saveDocumentSource({ config, root, file, source,
  expectedHash, expectedMissing, validate }) // raw-markdown save; -> { ok, file, diagnostics, document? }
export async function createDocument({ config, root, name, source, validate }) // source/validate optional; -> { ok, document?, code?, message? }
export async function duplicateDocument({ config, root, file, name, validate }) // -> { ok, document?, code?, message? }
export async function deleteDocument({ config, root, file })        // -> { ok, file, trashedFile?, code?, message? }
export async function restoreDocument({ config, root, trashedFile, file }) // -> { ok, document?, code?, message? }
```

`documentHash`, `canonicalSkeleton`, `bundledSoulsDir`, and `bundledEditableEnabled` are
exported too (referenced by the P0 and BE sections).

Composition rules (must round-trip):
- Frontmatter canonical order: `name`, `description`, `tools`, `model`, `provider`,
  `reasoning-effort`, `context`, `user-invocable` (only when true), then `extraFrontmatter`
  verbatim. Scalars are plain when safe, otherwise double-quoted JSON strings (valid YAML).
  `tools` omitted when inherit-all (`*`), `tools: []` when deny-all, otherwise a block list.
- Body: `extraMarkdown` is the preamble (before the canonical sections), then
  `## Role Definition`, `## Inputs You Will See`, `## Hard Rules`, `## Output Format` blocks in
  that order, each only when its section is non-empty. Only those four canonical headings
  (`#` or `##`) delimit sections; any other heading stays content of the section it appears in (this is what
  round-trips the bundled agents, whose Output Format sections contain their own `##` headings).
  Sections are plain Markdown text.
- Validation before writing: `parseSoulMarkdown` from `./soul.js` must produce a definition
  with no diagnostics; a missing body, bad name, bad tools list, or bad `user-invocable` is a 400.
- A save responds with the re-read document (composed state), so the browser renders exactly what
  the next scan will see. `saveDocumentSource` returns the re-read `document` alongside
  `{ ok, file, diagnostics }` for the Lead tool.
- Path safety: a target must be a `.md` file whose resolved path is inside one of the resolved
  soul directories; for existing files, `realpath(dirname)` must also stay inside (no symlink
  escapes). Reject `..` traversal and non-`.md` targets. The packaged `agents/` directory keeps its
  packaged identity under every alias spelling (the canonical ownership check runs first): it is
  writable only when `bundledEditable` is on, and read-only otherwise.

## Browser half (client.js)

Format (copy the shipped template exactly):

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-agent-soul',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // …components…
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.locale.register(NS, { en, zh, ja, de, fr, es, ru, pt })
        ctx.slots.inject('settings.section', () => ctx.slots.register({ … }, Page))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ … }, Badge))
      },
    }
  },
})
```

Registration:

```js
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'agent-soul',          // fresh id → added beside shipped sections
  order: 30,                    // after agent-presets (20)
  label: () => ctx.locale.bind(NS)('nav'),
  locale: NS,
}, Page))
```

`NS = 'settings.agentSoul'`; register the locale dictionaries with
`ctx.locale.register(NS, { en, zh, ja, de, fr, es, ru, pt })` (the base page starts with `en` and
`zh`; P2 adds the remaining six)
inside `apply` (automatic cleanup with the plugin). The page component consumes the bound `t`
translate function plus `props.useSessions(...)` and `props.sessionId` (workspace-root pinning);
the settings shell's `close` callback is passed to the section but currently unused.

**Reload/HMR.** The browser artifact does not update merely because `client.js` changed. Run
`pnpm run dev:web` in the DSH source checkout to rebuild client-plugin bundles while that watcher is
active; otherwise rebuild the affected Web artifacts and refresh/reload the page. No watcher or
automatic-update guarantee applies when that command is not running.

**Localization evidence and boundary.** The `locale/*.json` files are package metadata, not these
page dictionaries. On 2026-11-08, a static artifact check confirmed eight in-page dictionaries with
354 keys each, matching key sets, nonempty values, and placeholder parity. That check does not
translate raw Host messages/diagnostics/file content and is not rendered-browser evidence.

### Session-header Orchestrator badge

The same `apply` registers a second slot, `conversation.session.header.actions` (a session-scoped
additive list). Its existing occupants order `agent-team` -20, `agent-preset` (Creator mode) -10,
`subagent-catalog` 10, and `job-list` 20; the badge uses the fresh id `agent-soul-orchestrator` at
order -5, so it follows Creator mode.

```js
ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
  name: 'conversation.session.header.actions',
  id: 'agent-soul-orchestrator',
  order: -5,
  locale: NS,
}, OrchestratorModeBadge))
```

The component reads `props.useProjection('agentSoulOrchestrator')` (the Host projection key owned by
`lib/orchestrator-mode.js`) and `props.useSession(snapshot => snapshot.subagent)`. Both hooks are
unconditional; it returns `null` unless the folded value is exactly `'on'` and `snapshot.subagent`
is `null`, so teammate and other child Sessions never show the Lead's mode. Copy keys are
`orchestratorBadgeLabel` ("Orchestrator mode on"), `orchestratorBadgeTitle`, and
`orchestratorBadgeAria` in all eight dictionaries; the title and aria-label say the mode is on and
that `/orchestrate off` exits. The badge is a noninteractive `<span role="status">` with a success
status dot and a visible label. Its styles are an inline `style` object using only
`--dsw-alias-*` / `--dsw-radius-*` tokens, so the page keeps exactly one `<style>` element and no
literal colors.

### Plugins-page row configuration (`plugins.row.config`)

The same `apply` registers a third slot, `plugins.row.config`, keyed
`'@local/dsh-agent-soul#agent-soul-team'` (`<package name>#<row id>`, matching the row the
bundle's own patch declares), so the dsh-agent-soul bundle page's `agent-soul-team` row gains a
**Configure** control that opens this contribution:

```js
ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
  name: 'plugins.row.config',
  key: '@local/dsh-agent-soul#agent-soul-team',
  locale: NS,
}, DefaultSoulsConfigEntry))
```

The entry draws the page titled exactly **Use Default Agent Souls** — its own title, because the
Plugins page shows the row's name above the contribution — with the page description ("When on,
the packaged default souls and orchestrator doctrine shipped with the plugin are the live
definitions and open editable in Settings > Agent Soul. When off, they stay read-only defaults and
you customize copies in the workspace.") and a switch labelled **Use default agent souls**. The
`summary` view returns the one-line row summary (quoted below); the branch is hook-free so the two
views never share a hook order.

> Row summary copy (verbatim): "Edit the packaged default souls shipped with the plugin in place instead of copying them."

The page ships its own token-only stylesheet (`CONFIG_STYLES`, `--dsw-alias-*` /
`--dsw-radius-*` tokens only) because the Agent Soul page is not mounted there.

Both the Plugins page and the Settings card share the `useDefaultSoulsConfig` hook implementation
over `GET`/`POST agent-soul/config` (see the route pair above) and one module-level state record.
Every mounted control subscribes to that record, so a write started in one updates the other and no
control can show a value another has already replaced; a control that mounts later reads the current
record on mount. A settled write — verified or not — notifies the page, which re-reads the overview,
the Orchestrator definition only when that tab was opened and its draft is clean, and the open
document only when it is clean, without stealing an in-flight operation. The switch is disabled
while loading, saving, applying, or when the mode is unavailable (`bundled: false`) or not
configurable. Status copy (all eight dictionaries): `statusOn` ("On - packaged defaults are
editable in place"), `statusOff` ("Off - packaged defaults are read-only"), `statusUnavailable`
("Unavailable - bundled defaults are disabled (bundled: false)"), `statusNotConfigurable`
("Unavailable - this profile cannot save this setting"), `statusApplying` ("Applying... the plugin
reloads once"), `statusApplied` ("Applied."), `statusUnverified` ("Saved, but the reload was not
confirmed. Reload the page to verify the new value."), and `statusError` ("Could not update the
plugin configuration."). A normal successful `configEditor.edit` validates and reconciles the
write. The hook then polls GET (six attempts, 1200 ms apart) for the one Loader reload. A poll only
reports `applied` after a read shows the requested value; exhaustion, a failed read, or a mismatch
reports `unknown` (the localized unverified status) and still notifies the page, and a control that
unmounts mid-write leaves that honest unknown state. Timers and late answers are dropped on unmount.

Required UI (Settings → "Agent Soul"):
- Header: title + one-sentence intro (what a soul is, that saving is live for the next spawn).
- Toolbar: "New soul" button, "Refresh" button, and a status line (last scan/valid/invalid counts).
- Left list of soul cards (or rows): name, description (clamped), badges for model,
  user-invocable command, valid/invalid; selecting one loads it into the editor.
- Editor form for the selected document with grouped fields; **each Markdown section is its own
  textarea** so the user can copy/paste content per section:
  - Identity: Name, Description (textarea).
  - Routing & permissions: Tools (comma separated; placeholder explains `*` = all, empty = none),
    Model, Provider, Reasoning effort, Context (not specified/fresh/fork), User-invocable (checkbox).
  - Markdown sections: Role Definition, Inputs You Will See, Hard Rules, Output Format,
    Extra markdown (textarea each).
  - Advanced: Extra frontmatter (raw YAML lines textarea).
- Actions: Save (validates; shows returned diagnostics without losing edits), Delete (two-step
  inline confirm), dirty-state hint; success/error status line.
- "Plugin settings & runtime" info card (one combined card): plugin name/version, workspace root,
  resolved soul directories, the **Use default agent souls** switch row (the same
  `useDefaultSoulsConfig` control as the Plugins page), bindings file + count, providers, command
  prefix, default context, spawn providers, definition/catalog limits, scan time, live Team
  commands; plus the delegation hint (`spawn_teammate({ …, agent_type: "<name>" })`) and a note
  that souls are plain Markdown with no separate database.
- Error/empty/loading states: no Host route (fetch failure) → readable error card; no souls →
  empty state with "New soul"; nothing selected → placeholder.
- UI chrome copy goes through `t(...)`; raw Host messages, diagnostics, and file content can remain
  untranslated. Accessible labels use `label` + `aria-label` on controls, `role="status"` for the
  status line, and real `<button>` elements.

P3 supersedes this section's inline list + editor pane layout: the list stays on the page and the
editor opens in the resizable centered dialog described there (all listed fields and behavior are
kept inside the dialog).

Style: match the shipped Settings pages. Use only `--dsw-alias-*` / `--dsw-radius-*` tokens
(copy patterns from `packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css` and
`packages/client/ui-settings-models/src/client/ModelsSection.module.css`). Render the page as a
`<style>` element returned inside the component tree (removed on unmount). No literal colors.
Container: `display:flex; flex-direction:column; gap:12px; max-width:100%;
color: var(--dsw-alias-label-primary)` (the earlier `max-width: 860px` cap is superseded by P3,
which makes the page full-width). Cards use
`border: 0.5px solid var(--dsw-alias-settings-card-stroke); background: var(--dsw-alias-settings-card-fill);
border-radius: var(--dsw-radius-xl)`. Primary button `--dsw-alias-button-primary-fill` with
`--dsw-alias-label-primary-foreground`, secondary `--dsw-alias-border-l3` + hover
`--dsw-alias-interactive-bg-hover`, danger text `--dsw-alias-state-error-primary`. Inputs:
`0.5px solid var(--dsw-alias-border-l2)`, background `var(--dsw-alias-bg-layer-2)`, text
`--dsw-alias-label-primary`, focus ring `0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary))`.
Muted copy `--dsw-alias-label-tertiary`; section headings 12–13px uppercase for group heads.

State handling: many small focused state atoms grouped by concern (overview + loading/error,
selected/draft/baseline, status, busy token, and the transient UI flags for
create/delete/conflict/draft/preview banners).
Fetch with plain `fetch('agent-soul/overview')`, `fetch('agent-soul/document?file=' + encodeURIComponent(file))`,
`fetch('agent-soul/document', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })`,
`fetch('agent-soul/create', …)`, `fetch('agent-soul/delete', …)`. Treat
`response.ok === false` as a typed `{ ok:false, code, message, diagnostics?, fieldErrors? }` payload;
`fieldErrors` maps a form field to one message string and drives inline errors plus first-field
focus (the saved and previewed paths both carry it).

### Current persistence and response-shape limits

Two browser-state categories persist: a Soul draft under
`dsh.agent-soul.draft:<absolute file>` (form fields/sections, Form/Raw mode, raw source, and the
base file hash; older form-only records remain readable), and dialog size under
`dsh.agent-soul.editor-size`. Orchestrator edits, New/Paste inputs, and Undo state are memory-only,
so save or copy unfinished work before reload; after a delete, retain the returned `trashedFile`
and original `file` if later API recovery may be needed rather than relying on the transient Undo
banner.

Opening the Orchestrator tab calls `loadOrchestrator`, which replaces its draft and baseline. That
effect is keyed to the active tab, not to `sessionRoot`; the one root-adoption effect re-reads the
definition for a newly pinned root only when the Orchestrator draft is clean, so a Session-root
change cannot reset dirty edits. Ordinary Orchestrator saves remain last-write-wins.

A successful overview response is validated before it replaces the rendered state: `documents`
must be an array and `plugin`, `settings`, and `runtime` must be objects (the catalog blocks are
also summarized as `catalogs`). A malformed 200 answer (including one where `readJson` returns
`null`) becomes a typed `invalid-response` error card with the localized headline; it never falls
through to the empty-catalog or loading view, and the last good rows stay visible when one existed.
These boundaries are source- and route-test evidence, not a rendered-browser reproduction.

## Agent tool (index.js / lib/admin-tool.js)

`manage_agent_souls` — Lead-only, registered in the Lead member scope next to the soul
commands. Actions: `list`, `get` (`file`), `save` (`file`, `source` raw markdown), `create`
(`name`), `delete` (`file`), `diagnose` (live Lead/command-registry snapshot plus the
`teamTools` composition block for support), `repair_team_tools` (persists the shipped-row disable
through the Plugin Manager and reports the manual fix when that service is unavailable),
`get_orchestrator` and `save_orchestrator` (`source` raw markdown) for the P4 definition.
`get_orchestrator` answers the **effective** document: when the workspace file is absent and
`bundled` is enabled, it reports the packaged default (`bundled: true` plus `sourcePath`, with a
message saying a save writes the workspace target) while `bundledEditable` is off, or the packaged
file itself as the editable effective document (`path` = `sourcePath`) when it is on. The
`save_orchestrator` write target depends on the same flag: **off** (the default and the 0.3
behavior) writes the workspace definition at `<dirname(bindingsFile)>/orchestrator.md`; **on** with
no workspace file yet rewrites the **packaged** `defaults/orchestrator.md` in place — a shared,
upgrade-fragile package-state write — while an existing workspace file always wins.
Its output schema is canonical JSON Schema (object-level `required`
arrays, never author-style per-property `required: true`), because the tools registry validates it
at registration. `save_orchestrator` runs the same two validation layers as the GUI save — the
document analysis (`analyzeOrchestrator`) plus `orchestratorRouteDiagnostics(definition,
deps.resolveModel)` — so a contradictory or unresolvable route is refused with no write. It calls the same document layer functions (`listDocuments`,
`readDocument` with raw source, `saveDocumentSource` for raw-markdown saves, `createDocument`,
`deleteDocument`) with `root = deps.rootOf(agent)`, so both callers share parsing and storage.
The agent save does not supply the GUI's semantic tool/model validator, but it still goes through
the shared document layer's packaged-name collision guard: a packaged save/create/duplicate/restore
cannot take another packaged document's name (local-over-bundled shadowing stays legal), and a
genuine duplicate packaged name is reported by the catalog diagnostic instead of being silently
dropped. See [`INTERNALS.md`](INTERNALS.md).
`save` accepts **raw markdown** (`source`) instead of the split form: parse and validate it, then
write; return `{ ok, file, diagnostics }`.

---

# Enhancement phases

The GUI evolved in four ordered phases (P0 → P1 → P2 → P3), with P4 adding the orchestrator
surface. Each phase keeps the rule that every soul mutation goes through `lib/admin.js` (the
orchestrator through `lib/orchestrator.js`), and that every new Host surface is authenticated and
documented here. The browser half stays dependency-free plain JavaScript with
token-only styles. Phases are history: everything in the P0–P4 sections is still live behavior.

## P0 — robustness and first-run clarity

### Host: document integrity and semantic validation (`lib/admin.js`, `lib/gui-host.js`)

- `export function documentHash(source)` — SHA-256 hex of the file text (`node:crypto`).
  `readDocument`/`saveDocument`/`saveDocumentSource`/`createDocument` documents include
  `hash` and `modifiedAt` (file mtime, `0` for a not-yet-written skeleton). `listDocuments` rows
  include `hash` too.
- `saveDocument({ ..., expectedHash })` and `saveDocumentSource({ ..., expectedHash })`:
  when `expectedHash` is a string, re-read the current file first; a missing file or a different
  hash returns `{ ok: false, code: 'conflict', message, currentHash, currentModifiedAt }` and writes
  nothing. `expectedHash` omitted keeps last-write-wins behavior (the agent tool's path).
- Both saves accept an optional `validate(definition)` callback supplied by the caller. After the
  compose/parse succeeds, the callback returns `{ diagnostics?: { message, field? }[] }`; a
  non-empty list returns `{ ok: false, code: 'invalid', message, diagnostics }` and writes nothing.
  Diagnostics with `field` set are additionally mirrored into a `fieldErrors` object in the route
  response: `{ fieldErrors: { name?, description?, tools?, model?, provider?, reasoningEffort?, context?, body? } }`.
- The GUI routes build that validator from live state: tool names must be outside
  `TEAM_TOOL_NAMES` and, whenever `catalogs.source === 'live-lead'`, inside that Lead's restrictable
  catalog. A live-but-empty catalog therefore rejects every non-Team name with the explanation that
  the Lead reports no restrictable tools; only a missing catalog (`source: 'none'`) skips the
  membership check. The catalog carries the portable alias of the session's shell tool, so `bash` and
  `pwsh` both validate on either platform without a special case. Team and Lead-only names are always
  rejected, a non-empty `model`/`provider`/`reasoning-effort` declaration must resolve through
  `deps.resolveModel`, and a `name` already used by another valid document in the same catalog is a
  duplicate. Spawn-time validation remains the final boundary; it resolves the same shell pair (an
  exact registration wins), so a saved either-spelling list is accepted there too.

### Host: overview catalogs

`GET /agent-soul/overview` adds one top-level `catalogs` object:

```jsonc
{
  "source": "live-lead" | "none",
  "tools": [
    { "name": "bash", "description": "Execute a bash command…" },
    { "name": "pwsh",                       // portable alias: advertised, not registered here
      "description": "Portable shell alias: this session registers its shell as \"bash\"; naming \"pwsh\" resolves to it.",
      "portableAliasOf": "bash" }
  ],
  "models": [{ "provider": "deepseek-official", "model": "deepseek-flash", "name": "DeepSeek-V4.1-Flash" }],
  "teamTools": ["interrupt_agent", "spawn_teammate", "team_task_update"]
}
```

Tools are the visible, restrictable tool definitions of the Lead that speaks for the workspace the
page edits (the same workspace-matched Lead the command-status check uses, with the first live
Lead as fallback; visible tools minus `TEAM_TOOL_NAMES` and the Lead-only `manage_agent_souls`,
descriptions truncated to 200 chars), `source` is `'none'` with empty arrays when no live Lead
exists or the tools service is unavailable. Models come from `llm.listProviders()` +
`llm.listModels(provider)` with every rejection degrading to an empty list. `teamTools` is the
sorted `TEAM_TOOL_NAMES` list: those tools are Agent-scoped and never restrictable, so a teammate
soul must not name them; the orchestrator matrix *may* name them, and the browser uses this list
to explain them as always-available instead of flagging them as unknown.

The shell tool is one portable capability, so the catalog gains one synthetic entry per live shell
spelling whose counterpart is absent (`bash` on POSIX, `pwsh` on Windows; the pair is the frozen
`lib/tool-names.js` list). That entry carries the exact description
`Portable shell alias: this session registers its shell as "<live>"; naming "<counterpart>" resolves to it.`
and `portableAliasOf: "<live>"`; entries are sorted by name, `source` stays `'live-lead'`, a catalog
containing both spellings or neither gains no alias, and no non-shell name is ever aliased. The
browser chips, the preview diagnostics, and the save validator all read this catalog, so both
spellings are known names and either can be saved on either platform.

The browser validates the whole overview payload before rendering it: `documents` must be an
array and `plugin`, `settings`, and `runtime` must be objects (`catalogs` is read from the same
snapshot). A 200 answer with malformed JSON (where `readJson` yields `null`) or a missing required
block becomes a typed `invalid-response` error card, not an empty catalog or a loading skeleton; the
last good rows stay visible when one exists. The route's own 200 payload satisfies this contract, so
the validation only rejects a Host/transport mismatch.

### Routes: conflict status and field errors

`POST /agent-soul/document` accepts `expectedHash` and answers **409** for a conflict:

```jsonc
// 409
{ "ok": false, "code": "conflict", "message": "…", "currentHash": "…", "currentModifiedAt": 1 }
```

A semantic-validation refusal stays **400** with `code: "invalid"` and the added `fieldErrors`.
No new route is introduced in P0.

### Browser: P0 behaviors

- Unsaved-changes guard: switching the selected document, refreshing, starting a new soul, or
  unloading the page while dirty asks for confirmation in-page (a small inline banner with
  **Discard changes / Keep editing**, never `window.confirm`); `beforeunload` also warns.
- Draft recovery: a dirty Soul draft is saved to `localStorage` (key
  `dsh.agent-soul.draft:<file>`) as form fields and sections, the Form/Raw mode, the raw source when
  that mode is dirty, and the base file hash. Older form-only records restore as form drafts. A
  raw-only draft (the form snapshot is unchanged) is still offered and restores into Raw mode.
  Reopening the document offers **Restore draft / Discard draft** when the stored draft differs from
  the file and was saved after it (an older draft is suppressed). Saving or deleting clears the
  entry.
- Conflict recovery: a 409 shows an inline banner with **Reload file** (re-open, discarding edits)
  and **Overwrite** (save again with the server's `currentHash` as `expectedHash`; when the file was
  removed and `currentHash` is null the page sends `expectedMissing: true` with no `expectedHash`,
  so Overwrite recreates the file with no-replace semantics — a target that appeared in the meantime
  answers 409 again instead of being clobbered).
- Inline validation: save-time 400/`fieldErrors` render under the matching control with an error
  summary above the form that focuses the first invalid field; every save diagnostic also stays
  listed in the existing diagnostics block.
- Search and filters above the list: free-text match on name, description, `sourcePath`, label, and
  file name/absolute path — not the Markdown body; the placeholder in all eight dictionaries says so;
  filter chips **All / User-invocable / AI-only / Invalid**; sort toggle **Name / Updated**.
- Sticky action bar in the editor (Save / Revert / Delete + dirty badge) that stays visible while
  the form scrolls; **Revert** restores the last loaded file content.
- Empty-state now names the scan root and resolved directories, with copy buttons, so a wrong root
  or an empty folder is self-explanatory.
- Skeleton placeholders while the overview or a document loads.
- Every new string is added to the `en` and `zh` dictionaries; the documented route paths are
  four at this phase (five method-endpoints), growing to eight paths / nine endpoints at P1,
  nine/eleven at P4, ten/thirteen at the default-Soul release, and eleven/fifteen with the
  0.4.0 config pair.

## P1 — editing power

Builds on P0. The GUI adds discoverable pickers, a no-write preview of exactly what the teammate
will receive, a raw Markdown mode, paste-import, templates, duplication, and a recoverable delete.
Every mutation still goes through `lib/admin.js` and the same authenticated routes.

### Host data layer (`lib/admin.js`)

- `createDocument({ config, root, name, source? })`: when `source` is provided (validated Markdown),
  write that text instead of the canonical skeleton; same path safety and `exists`/`invalid-name`
  codes. Returned document carries `hash`/`modifiedAt` as in P0.
- `duplicateDocument({ config, root, file, name })`: read the source, split it, replace the `name`
  field, compose+validate, write `<first dir>/<name>.md`, return `{ ok, document }` with the same
  400 codes as create plus `not-found` for a missing source.
- `deleteDocument` becomes recoverable: fence the state/trash path to the real workspace (or
  real shared-state directory) before any move, then move the file into the trash directory and
  return `{ ok: true, file, trashedFile }`. Trash location: the directory beside the configured
  bindings file (`<dirname(bindingsFile)>/trash`; the default config yields
  `<root>/.dsh/agent-soul/trash/`), filename `<timestamp>-<original basename>`; create it on demand.
  An escaping symlinked state path returns `{ ok: false, code: 'unsafe-path', message }`; a trash
  creation or no-replace move failure returns `{ ok: false, code: 'invalid-request', message }`
  naming the trash location. Both leave the source byte-identical; there is never a hard-delete
  fallback, so no `trashedFile`/Undo entry exists for that attempt. Fix the path/symlink/
  permissions/device issue and retry.
- `restoreDocument({ config, root, trashedFile, file })`: the state/trash path is first
  real-path fenced to the real workspace (or real shared-state directory); then both paths must pass
  the existing path safety (trashed file inside the trash directory, target inside a configured soul
  directory); move the file back. `{ ok, document }` or `not-found`/`unsafe-path`/`exists`.

### Host routes (`lib/gui-host.js`)

Four new endpoints (still exact registrations, trust fence first, JSON, no-store):

- **`POST /agent-soul/parse`** — `{ source }` → `{ ok: true, fields, sections, valid, diagnostics }`
  where fields/sections are the editable split of the text (same shapes as the document GET) and
  nothing is written. Malformed bodies are 400 `invalid-request`.
- **`POST /agent-soul/preview`** — `{ fields?, sections?, source?, file? }` → no write:
  ```jsonc
  {
    "ok": true,
    "valid": true,
    "diagnostics": [{ "message": "…", "field": "tools" }],
    "fieldErrors": { "tools": "…" },
    "composedSource": "---\nname: …",
    "persona": "You are the delegated teammate \"…\".\n\n…",
    "catalogLine": "- researcher — Researches … (tools: web_search, web_fetch; model: deepseek-flash; command: /researcher)",
    "resolvedModel": { "provider": "deepseek-official", "model": "deepseek-flash" },
    "effectiveTools": ["web_search", "web_fetch", "read"],
    "command": { "name": "researcher", "registered": true, "status": "registered" }
  }
  ```
  The body is composed from `fields`/`sections` (or `source` directly), parsed, and validated with
  the P0 semantic validators; `preview` never fails on invalid content — it returns `ok:true,
  valid:false` with diagnostics so the client can render live feedback. `resolvedModel` is null when
  the model is inherited or unresolvable; `effectiveTools` is the composed allow-list (`null` when
  the soul inherits every tool); `command.status` is one of `registered`, `ai-only`,
  `invalid-name`, `collision`, `no-live-lead`. `command.reason` is present only for `collision` when
  the per-Lead registration record captured one (for example `command "orchestrate" is already
  registered`, or `the command name is owned by another handler or registration failed`); it is the
  handler-identity evidence behind the chip. `catalogLine` is the soul's own bullet rendered by the
  prompt-catalog formatter with the configured `commandPrefix` (`''` when the composed definition is
  invalid); a user-invocable soul shows `command: /<prefix><name>`, an AI-only soul `command: AI only`.
- `POST /agent-soul/document` also accepts **`source`** instead of `fields`+`sections`: the raw
  text is validated (parse + semantic validators) and written, with the same `expectedHash`/409/400
  behavior. This is the raw-mode save path.
- `POST /agent-soul/create` accepts optional `source` (template content).
- `POST /agent-soul/duplicate` — `{ file, name }` → 200 `{ ok, document }`; 400 codes
  `invalid-name`, `exists`, `not-found`, `invalid`, `unsafe-path`, `no-dirs` (an `invalid` response
  carries diagnostics and `fieldErrors`; the reserved `lead` name is an `invalid-name`).
- `POST /agent-soul/delete` response gains `trashedFile`; new
  **`POST /agent-soul/restore`** — `{ trashedFile, file }` → `{ ok, document }`.
- `manage_agent_souls` keeps `delete` (now trashing) and reports the trashed path in its message;
  new mutations stay GUI-only in P1 except delete's recoverability.

### Browser (`client.js`)

- **Tools picker** — chips built from `overview.catalogs.tools`; clicking toggles the tool in the
  draft's `tools` list; an "Inherit every tool" state maps to `*`; unknown names already present are
  shown as removable warning chips. The catalog's portable shell-alias entry is an ordinary chip:
  both `bash` and `pwsh` are in the known-name list, so neither is shown as an unknown warning chip,
  and the alias description is the chip tooltip (the save validator derives availability from the
  same catalog, so both spellings save). The comma-separated text field remains for advanced use and
  the two views stay in sync.
- **Model picker** — cascading selects: provider (from `catalogs.models` providers; "Inherit from the
  Lead" empty option), model (options for the chosen provider), with the free-text model/provider
  fields kept under Advanced. The resolved route from the preview response is shown beneath.
- **Effective-prompt preview** — collapsible "What the teammate will receive" panel that calls
  `POST /agent-soul/preview` (debounced ~500 ms while the draft is dirty). Shows the persona
  (linked to Role/Inputs/Hard Rules/Output order), the resolved model, the tool matrix, the command
  status, and the exact prompt-catalog bullet (`catalogLine`); Copy buttons for persona and catalog
  line; invalid content shows diagnostics instead.
- **Raw Markdown mode** — a Form / Raw toggle in the editor. Raw mode edits the full file text and
  saves through `POST /agent-soul/document` with `source` + `expectedHash`; switching modes while
  dirty goes through the P0 discard guard. The draft record persists the selected mode, the raw
  source when that mode is dirty, and the base file hash, so reopening offers a raw draft when it is
  newer than the file and restores it into Raw mode. Older form-only draft records still restore as
  form drafts.
- **Paste / import Markdown** — "Paste Markdown" opens a panel; `POST /agent-soul/parse` fills the
  draft fields/sections (dirty) when a document is selected, or the parsed content is offered as the
  starting source for a new soul (create with `source`).
- **Templates** — the New-soul dialog offers Blank / Researcher / Code reviewer / Docs writer;
  the chosen template is composed client-side with the chosen name and sent as `create` `source`.
- **Duplicate** — toolbar action with an inline name field; `POST /agent-soul/duplicate`, then the
  new document opens.
- **Recoverable delete** — after delete the status banner offers **Undo**, calling
  `POST /agent-soul/restore` with the returned `trashedFile`/`file`; copy mentions the trash flow.
- New strings in `en` + `zh`; token-only styles; still one inline `<style>`; the documented
  relative paths at the time: eight paths / nine endpoints; P4 brought it to nine paths / eleven
  endpoints, and the default-Soul release to ten paths / thirteen endpoints.

## P2 — runtime insight and polish

Builds on P0/P1. No new mutation routes: the overview grows runtime metadata that the page renders,
plus full locale coverage.

### Host (`lib/bindings.js`, `lib/gui-host.js`)

- `createBindingStore` gains `async list(root)` → `Array<{ childId, name, tools, model, context, sourceLabel, savedAt }>`
  (detached copies of every retained binding for that root, newest first). Each call re-reads the
  durable document; unreadable/corrupt/unsupported/unsafe documents reject with their typed error,
  and a partially malformed document lists its valid rows with a warning (see
  [`INTERNALS.md`](INTERNALS.md)).
- `GET /agent-soul/overview` documents gain:
  - `usage: { storedCount: number, lastUsedAt: number | null, activeMembers: string[] }` — retained
    bindings whose record `name` equals the soul name (the store keeps only the newest 500 records
    per bindings document, including a shared absolute file's shared keyspace, so `storedCount` is
    not an all-time count); `lastUsedAt` is the newest retained
    `savedAt`;
    `activeMembers` lists live Team member names (via `ctx.agents.list()` +
    `agentTeams.tryMembership`) whose Session id has a binding for this soul.
  - `commandStatus: { name: string, status: 'registered' | 'ai-only' | 'invalid-name' | 'collision' | 'no-live-lead', message?: string }`
    reusing the P1 preview command-status computation. With a per-Lead registration record,
    `registered` means this soul's own accepted handler is the registry's effective definition and
    `collision` means the invocable name is owned by another handler (for example the built-in
    `/orchestrate`, which is installed before soul commands) or its registration failed; without a
    record the documented name-presence fallback applies (the union of the command-list and
    definition-lookup views). `message` carries the next-step explanation when one is known. The
    Lead used for this check is the live Lead whose Session directory equals the page's resolved
    workspace root, because several Sessions from different workspaces can be live at once and only
    the matching Lead sees this workspace's soul commands (a mismatched Lead would report a false
    collision).
  - `catalogLine: string` — the soul's prompt-catalog bullet from the same single-definition
    snapshot used by the preview route (`''` for invalid rows).
- `runtime.health: { duplicates: string[], invalidFiles: number, definitions: { used: number, max: number }, catalogChars: { used: number, max: number }, diagnostics: number, teamTools: { available: boolean, status: 'replaced' | 'conflict' | 'absent' | 'unknown', ok: boolean | null, rows: { id: string, disabled: boolean, enabled: boolean }[], message: string, fix: string } }`
  — duplicate soul names, invalid-file count, the `maxDefinitions` / `maxPromptChars` budgets
  against the full catalog prompt text length (measured with a budget large enough to include
  every entry, so the over-budget state is reachable), the scan diagnostic count, and the live
  Team-tool row composition (`status: 'conflict'` makes the health card render `teamTools.message`
  plus the one-line `teamTools.fix`; `unknown` means the Loader service is unavailable).
- `runtime.liveTeams` entries gain `memberCount: number | null` (`agentTeams.listMembers(lead).length`
  when available, else null). Their `commands` list is the union of the command-list and
  definition-lookup registry views (P3 fix), so a scoped command hidden from the list view still
  appears when the lookup resolves it.

### Browser (`client.js`)

- List rows show a compact **usage line** (`N saved · last used …` with `activeMembers` names when
  live) and a **command-status chip** (registered / AI-only / invalid name / collision / no live
  Lead).
- Editor header/info shows the same command status plus the resolved command name, and the preview
  panel exposes the `catalogLine` ("how the Lead sees it") with its Copy button.
- New **Health** card: definition-budget and catalog-character budget as labelled progress bars,
  duplicate-name warnings, invalid-file count, scan diagnostic count; scan diagnostics that name a
  file open that document in the editor.
- **Team awareness** inside the settings card: each live Team Lead with its member count, and the
  note that edits affect the next spawn, not running teammates.
- **Locales**: `ctx.locale.register` now ships `en, zh, ja, de, fr, es, ru, pt` dictionaries with
  identical key sets (same keys as the current en dictionary, translated).
- Token-only styles throughout; no new dependencies; no imports; the same relative routes.

## P3 — dialog editor layout

The settings content column is narrower than the editor needs, so the inline master–detail layout
squashed the form (character-wrapped command names, unreadable textareas). P3 replaces the inline
editor with a centered, resizable dialog while keeping every earlier-phase behavior intact (P4 keeps
all of it inside the same shell).

### Browser (`client.js`)

- The page is a **single full-width column**: header/intro, toolbar, scan line, the soul list
  (search/filters/sort as today), and the settings/runtime and health cards below it. The former
  right-hand editor pane is gone; selecting a soul opens the dialog instead.
- **Edit dialog**: clicking a soul card opens a modal overlay (`position: fixed` backdrop over
  the settings panel). The panel is centered, uses `var(--dsw-alias-bg-layer-1)`, a
  `0.5px solid var(--dsw-alias-border-l2)` border, `var(--dsw-radius-xl)`, and a dim token-derived
  backdrop (`color-mix` over `var(--dsw-alias-bg-overlay)`); no literal colors.
- **Resizable**: the panel has a pointer-draggable corner handle (and keyboard-resizable via the
  handle with arrow keys, `aria-label`). Sizes are clamped (min ~520×420, max ~96vw×92vh) and the
  chosen size persists in `localStorage` under `dsh.agent-soul.editor-size`. A "reset size"
  affordance restores the default (min(1100px, 94vw) × 86vh).
- **Dialog soul**: title row (soul name, valid badge, ellipsized absolute path with `title`,
  close button), a scrollable body, and a **sticky footer** action bar (dirty badge, Save, Revert,
  Duplicate, Delete with the two-step inline confirm). `Escape` closes through the existing
  unsaved-changes guard; clicking the backdrop also closes through it. Focus moves into the dialog
  on open and returns to the originating card on close.
- The dialog body keeps every existing feature: mode toggle (Form/Raw), the grouped fields, the
  runtime meta strip (command status + catalog line), the effective-prompt preview, paste/import,
  diagnostics, drafts, conflict banner, and the advanced fields.
- **Responsive field layout**: fields are label-above-control and full width by default, grouped in
  responsive grids (`repeat(auto-fit, minmax(240px, 1fr))`) that collapse to one column; all
  textareas span their full group width with generous min-height; the runtime meta strip renders as
  stacked rows (heading, full-width value, wrapping message) so no value is squeezed into a
  character-wide column; long paths/values use ellipsis + `title`.
- **New soul** and **Paste Markdown** open the same dialog (create mode / import mode) instead of
  inline forms. Closing a dirty create/import dialog goes through the same guard.
- The list, empty state (root/dirs copy), skeletons, locales (all eight), token-only styles, one
  inline `<style>`, no imports/dependencies, and the documented relative fetch paths are unchanged
  (eight paths / nine endpoints at that phase; P4 brings nine/eleven, the default-Soul release
  ten/thirteen, and the 0.4.0 config pair eleven/fifteen).

## P4 — Orchestrator soul (session-scoped, command-activated)

A single optional **orchestrator definition** describes the Lead's orchestration doctrine and
overrides its model/tools — but only after a human activates Orchestrator mode in that session with
the `/orchestrate` chat command. Sub-agent souls keep driving downstream delegation unchanged.

### Definition file

The **effective** definition comes from the workspace file
`<dirname(resolved bindingsFile)>/orchestrator.md` when it exists. When it is absent and `bundled`
is enabled (the default), the packaged [`defaults/orchestrator.md`](../defaults/orchestrator.md) is
the effective document — so `/orchestrate` works in every workspace right after installation. The
GET route returns the bundled source with `configured: true`, `bundled: true`, `sourcePath` set to
the package file, and `path` still the writable workspace target; a Save therefore creates the
workspace override. Deleting that file falls back to the bundled default again. With
`bundled: false`, an absent workspace file keeps `configured: false` (the skeleton) and mode cannot
be enabled; the command explains how to create it.

Frontmatter (strict YAML subset via `lib/soul.js` `parseFrontmatter`):
`name` (optional, default `orchestrator`), `model`, `provider`, `reasoning-effort`,
`tools` (same normalization as souls: omitted/`*` = unrestricted; list = Lead's inherited-tool
allow-list; `[]` = deny every inherited tool), `plan-first` (bool), `gate-mode`
(`strict|advisory|off`), `max-retries` (integer 0–10), `pause-on-fatal` (bool).

Body: six canonical sections (heading level `#`/`##`, case-insensitive aliases) in canonical order:
**Identity & Boundaries**, **Plan Generation**, **Delegation & Context Minimization**,
**State Tracking**, **Quality Verification**, **Exception & Recovery**. Content before the first
canonical heading, content after an explicit `<!-- orchestrator:extra -->` marker, and any other
`#`/`##` heading (with the lines that follow it, until a canonical heading resumes the sections)
are preserved as extra markdown. The composer writes extras after the canonical sections, so such
content is never lost but its placement can change on the next read; use `###` or deeper for
sub-headings that must stay inside a canonical section. Template variables substituted at apply time:
`{{maxRetries}}`, `{{gateMode}}`, `{{planFirst}}`, `{{pauseOnFatal}}`, `{{catalog}}` (the Lead's
soul catalog text; unknown variables stay literal).

### Mode and application (`lib/orchestrator.js`)

- `installOrchestratorCommand(agent, agentCtx, deps, runtime)` registers the Lead-scoped
  `orchestrate` command. `invocation.rawInput` empty → enable; trimmed `off|exit|stop|disable` →
  disable; anything else → enable, then `agent.followup(…)` queues the trimmed text as the next
  ordinary user message (`{ id: randomUUID(), role: 'user', content: [{ type: 'text', text }],
  source: { kind: 'user' } }`). A queue failure reports the queue error plus the state the handler
  observed. A first enable is reverted by disabling it (reported as `the mode was reverted`); if
  that disable's model restore also fails, the error reports `active=true, modelRestored=false`, the durable log folding
  off, and `/orchestrate off` as the retry. A disable with an inactive or unconfirmed result reports
  `active=false` or `active=unknown`. When the mode was already active (live bundle, or durable
  state after a reload), the command restores its pre-invocation snapshot and reports an exact kept
  mode, the previous doctrine on the newly applied route (with the available model-capture
  recovery), an explicit fallback to the freshly applied bundle, an inactive result, or an
  unconfirmed result. A durably active mode with no live bundle has no snapshot and keeps the fresh
  bundle, reported as such. The handler-level fault tests use an in-memory Agent double, not a full
  real Host lifecycle, and these paths remain best-effort; inspect/repair actual live state after a
  compound failure. Missing/invalid definition → error result, mode unchanged. See
  [`INTERNALS.md`](INTERNALS.md) for the complete rollback contract.
- Durable mode: `modeOf(agent)` folds `agent.session` events via `eventAt(seq)`: every
  `command/run` whose `data.name === 'orchestrate'` records `data.args` in order (off-words ⇒ off,
  every other argument form — bare command or a `<task>` — ⇒ on); a run whose paired `command/done`
  settled as `kind: 'error'` is skipped, so the mode is the last qualifying run's value. Unreadable
  log ⇒ off. A pending first enable therefore reads `on` in a normal read, `off` in the handler's
  `settledOnly` pre-invocation read, and `off` again after that run settles as an error when no
  earlier qualifying run was on.
- Enable (live Lead scope, via a per-agent `agent.ctx.effect` bundle):
  - register at the persona order a fixed runtime identity followed by the
  **Identity & Boundaries** text: the fixed wording names the orchestrator role and the soul-only
  delegation rule, so editing (or emptying) the document cannot remove the runtime identity;
  - register sections `orchestrator:plan` (order `TEAM_POLICY − 100`), `orchestrator:delegation`
    (`+10`), `orchestrator:state` (`+20`), `orchestrator:verification` (`+30`),
    `orchestrator:recovery` (`+40`), extra sections after them; empty sections are skipped;
  - when a model/provider is declared, remember `agent.model.current()` and
    `agent.model.select(resolvedRoute)` (resolution via `deps.resolveModel`; failure = enable error);
  - when `tools` is a list, probe restrictable names like the teammate applier and
    `agent.ctx.tools.restrict({ allow: restrictable })` (own-scope Team tools stay visible);
    non-restrictable or unavailable names are skipped with a warning, and only a restriction-service
    failure aborts enable (before any state is touched);
  - the built-in team-tool runtime policy and catalog section stay in place.
- Enable answers with a deterministic `orchestratorActivationAnnouncement(enabled)` block
  (`ORCHESTRATOR MODE ACTIVE`, identity, path, model, gate, retries, title outcome), which the
  `/orchestrate` command places at the top of every success result.
- Session title: a genuine first explicit enable captures the current `session/title` snapshot and
  renames the Session to `orchestrator` through the optional `sessionTitle` service **only when that
  prior title exists**. The rename happens after all fallible resolution and before the live bundle
  is replaced, so a rename failure aborts enable with no registrations applied. A skipped rename
  still succeeds and returns `titleSkipped: true` with `titleSkippedReason` set to
  `service-unavailable` (no `sessionTitle` service) or `no-prior-title` (the Session has no prior
  title to capture); the announcement records the corresponding `title: unchanged (…)` reason, and
  a later disable has no captured title to restore. A failed bundle creation restores the captured
  title when this was the first enable. Reapply never renames or re-captures.
- `team:identity` and the model-facing `list_agents` roster mark the Lead as the orchestrator while
  the mode is active (`orchestrator: true` on the Lead row); the internal Team target stays `lead`.
- Disable: restore the remembered model selection first when one was captured (a restore failure
  answers with the error and leaves the bundle active for an off retry), then restore the captured
  title only while it is still exactly `orchestrator`, then dispose the effect bundle (sections +
  restrictions). A title restore failure is a warning; a human rename is preserved. Reapply-if-active
  on plugin activation / Lead creation uses the same application path but never re-captures the
  previous selection or title.
- The runtime object disposes per-agent bindings on `agent/disposed` and everything on unload.

### Host routes and overview (`lib/gui-host.js`)

- `GET /agent-soul/orchestrator` → 200
  `{ ok:true, orchestrator:{ path, configured, source, valid, diagnostics:[{message,field?}],
  fields:{ name, model, provider, reasoningEffort, tools, planFirst, gateMode, maxRetries, pauseOnFatal },
  sections:{ identity, plan, delegation, state, verification, recovery, extraMarkdown } } }`
  (`configured:false` with a skeleton source/fields when the file is absent).
- Three different default sets exist on this surface and each governs its own path (do not present
  one of them as *the* default): the parser's omitted-field defaults are `gateMode: 'off'`,
  `maxRetries: 0`, `planFirst`/`pauseOnFatal` `false` (`defaultFields`); the missing-file skeleton
  above is `gateMode: 'advisory'`, `maxRetries: 3`, both booleans `true`
  (`canonicalOrchestratorSkeleton`); the browser's **Create default orchestrator** posts
  `ORCHESTRATOR_DEFAULT_FIELDS` with `gateMode: 'strict'`, `maxRetries: 2`, both booleans `true`
  (`client.js`). A file created by the button therefore differs from the pre-creation skeleton
  preview.
- `POST /agent-soul/orchestrator` — body `{ source }` **or** `{ fields, sections }`; composes,
  validates, writes atomically, creates parent dirs; 200 `{ ok:true, orchestrator }`, 400
  `{ ok:false, code:'invalid'|'unsafe-path'|'invalid-request'|'conflict', message, diagnostics?,
  fieldErrors? }`. `conflict` is the specific bundled-editable guard when a workspace definition
  appears during a packaged-target save; ordinary saves otherwise have no `expectedHash` guard.
  Every save path runs the declaration-level route validation and, when `deps.resolveModel` is
  available, the live-route validator (see "Release-candidate validation contracts"); `code:'invalid'`
  carries `diagnostics` and a `fieldErrors` object (`model`, `provider`, `reasoningEffort`, …) and
  writes nothing.
- `GET /agent-soul/overview` gains a top-level `orchestrator` block with
  `{ path, configured, valid, name, model, modelResolved, tools, planFirst, gateMode, maxRetries, pauseOnFatal, diagnostics }`.
- `manage_agent_souls` gains actions `get_orchestrator` (returns raw source) and
  `save_orchestrator` (`source` raw markdown; validates/writes).

### Browser (`client.js`)

- The page gets two tabs: **Souls** (current page content) and **Orchestrator**.
- Orchestrator tab: definition card (path, valid badge, name/model/tools/gate/retry/plan badges,
  diagnostics), a hint that it applies only after `/orchestrate` in chat (`/orchestrate off` exits,
  mode is remembered per session), and actions **Edit orchestrator** / **Create default
  orchestrator**. **Edit orchestrator** opens the resizable dialog in orchestrator mode, with six
  section textareas, config fields (name/reasoning effort/tools picker/plan-first/gate-mode/max-retries/
  pause-on-fatal, plus **Provider** and **Model** dropdowns built from the same live provider/model
  catalogs as the soul editor — with an inherit option first and out-of-catalog routes kept
  selectable), Save, dirty guard, and validation errors; no delete. Ordinary saves are
  last-write-wins: this editor sends no Soul-style `expectedHash` and has no general conflict banner.
  The bundled-editable workspace-appearance guard below is the specific `400 conflict` exception.
  **Create default orchestrator** (shown only while unconfigured) does not open the dialog first:
  it composes `ORCHESTRATOR_DEFAULT_FIELDS` plus the English starter section prose
  (`ORCHESTRATOR_TEMPLATE_CONTENT`) client-side, POSTs them as `{ fields, sections }`, and then
  opens the dialog on the saved result (see the default-set note above). The
  orchestrator tools picker treats `catalogs.teamTools` names as always-available (explained, never
  shown as unknown), because Team tools cannot be restricted but may be listed in this matrix. A
  `bash`/`pwsh` name is also not treated as unavailable: the apply path resolves it to the live
  spelling (an exact registration wins) instead of skipping it.
- UI chrome copy lives in the eight locale dictionaries; raw Host messages, diagnostics, and file
  content can remain untranslated. Token-only styles; no new fetch hosts; the same relative fetch
  style for the two orchestrator routes.

## Default Soul preference and soul-only delegation

- `lib/preferences.js` owns `<dirname(bindingsFile)>/preferences.json`
  (`{ version: 1, selected: string | null }`), its real-path fence, atomic write, pure
  `resolveDefaultSoul`/`describePreferences` helpers, and the per-root store shared by the spawn
  path and the GUI routes.
- Resolution order for a spawn without `agent_type`: require a usable preferences document, then
  persisted selection → any live catalog definition named `generalist` → actionable failure. The
  fallback can be a configured-directory/local definition, including one that shadows the packaged
  copy or appears with `bundled: false`; `source: 'builtin'` does not establish package origin. A
  stale explicit selection fails; it never silently falls back. A corrupt, malformed, or unsupported
  preferences document is a warning that makes the block `valid: false` with `effective: null`; the
  default spawn fails with
  that reason (an explicit `agent_type` does not read the document). A path/read failure fails the
  spawn with the document path.
- `lib/apply.js` is fail-closed at plan resolution: a new or cold-resumed roster teammate must
  resolve a pending spawn plan or a durable binding before any effect is admitted. Missing, pruned,
  corrupt, or unreadable plans throw `SoulPlanUnavailableError`, which is the root installer's one
  admission veto through the serial `agent/created` listener. Cancellation, Agent disposal, plugin
  teardown, and unexpected post-plan apply failures instead resolve as logged skips after every
  partial registration is unwound; the shared installation task is observed internally so abandoned
  callers cannot leak an unhandled rejection. At plugin activation, a pre-existing live teammate
  without a plan is skipped with a warning and its partial registrations (including the Team tools)
  are unwound.
- `lib/tools.js` installs two scoped fences in every Team member scope: a `restrict({ deny: [...] })`
  for whichever of `subagent` / `subagent_fork` are visible, and a `tools.guard()` that denies both
  names even after the visible set changes. The restriction is reconciled on `tools/change`, probing
  the live registry so a tool provider that mounts either name after the member was prepared is
  hidden too (and a previously hidden name stays denied while it remains registered). Scoped Team
  tools are unaffected.
- `index.js` registers an `agent/created` fence (`assertSoulOnlyTeamChild`): when the new Agent's
  `session.header.parentSession` names a live Team member, the child must resolve as a roster
  teammate or be a seeded host fork (independent lineage). Any other provider-owned child
  (`header.origin === 'subagent'`, or an unclassifiable direct child) throws, which vetoes
  publication. That covers children created through the generic subagent seam as well as a direct
  `subagent` call — for example a workflow run's `agent()` children, which start with the calling
  Agent as parent. During activation, pre-existing non-roster children and pre-existing roster
  teammates without a usable Soul plan are skipped with a warning (and no Team tools) rather than
  failing the whole plugin; new and cold-resumed teammates without a usable plan are vetoed instead.
- Browser: the Souls tab default selector POSTs the preference route, renders the effective default
  as a **Default** badge, keeps a stale persisted name visible as `<name> (not in catalog)` so it can
  be cleared, and shows the Host's `preferences.warning` banner (stale/unusable default, or a
  corrupt/malformed/unreadable preferences document). When the document is invalid the block has
  `valid: false` and `effective: null`, so no card carries the **Default** badge and a default spawn
  fails until the selection is fixed or cleared.

## Release-candidate validation contracts (RB-01/RB-02/RB-03/RA-01/RA-02)

The sidebar and route contracts above keep their payload shapes; this section pins the release
remediation behavior that spans the document layer, the routes, and the browser.

### RB-01 — the reserved `lead` identity at the GUI boundary

The shared parser (`lib/soul.js`) refuses the exact name `lead` with the name-tagged diagnostic
`name: "lead" is reserved for the Team Lead`; the create/duplicate target-name guard enforces the
same reserved identity. The GUI inherits one uniform behavior:

- `POST /agent-soul/document` with a `file` (raw `source` and `fields`/`sections`) returns **400**
  `{ ok:false, code:'invalid', message:'the soul document is invalid and was not saved', diagnostics:[{ message, field:'name' }], fieldErrors:{ name: 'name: "lead" is reserved for the Team Lead' } }`
  and writes nothing; an existing file stays byte-identical.
- `POST /agent-soul/document` **without** a `file` (a not-yet-created suggestion) hits the
  target-name guard before the parser: it returns **400** `invalid` with
  `message: 'the soul name is not a valid teammate name'` plus the same name-tagged
  `diagnostics`/`fieldErrors.name` (reserved identity or name syntax), and creates nothing. Both
  refusals keep the name reserved on every save path.
- `POST /agent-soul/create` and `POST /agent-soul/duplicate` return **400** `invalid-name`
  (`name must be lower-kebab-case, at most 64 characters, and not "lead"`) and create nothing.
- `POST /agent-soul/preview` returns **200** `{ ok:true, valid:false }` with the same
  `fieldErrors.name`, so the editor shows the reserved-name error and focuses the name control. The
  browser's first-field focus order starts with `name`.
- A `name: lead` file written directly to disk stays in `GET /agent-soul/overview` as an invalid
  row with that diagnostic (it can be fixed in place) but is absent from the scan's valid
  definitions and from every catalog/spawn resolution; `previewCommand` reports the command status
  `invalid-name` for it.
- Only the exact name is reserved: `leadership`, `lead-review`, and `lead-2` save normally.
- The reserved rule is consistent with DOC-01: a teammate *name* is separately validated by the
  spawn path (lower-kebab-case, at most 64, not `lead`), so neither the soul name nor the teammate
  name can become the Team Lead's identity.

### RB-02 / RA-02 — command collisions and handler-identity status

- `index.js` installs the built-in `/orchestrate` command **before** the soul-command reconciler on
  every Lead. A user-invocable soul whose prefixed command is `orchestrate` therefore loses its
  registration (warned `soul command "orchestrate" could not be registered: …`); the built-in stays
  functional, the soul file stays valid, and other soul commands register normally.
- `previewCommand` and the overview's `commandStatusOf` use the per-Lead registration record through
  `soulCommandRegistrationState`: `registered` only when the registry's effective handler for the
  name is this plugin's accepted handler; `collision` when the name is invocable but the record has
  no accepted handler (with `reason` on the preview `command` object, and a `message` on the
  overview `commandStatus`). A colliding row's `command` field is `null`, so the page never displays
  `/orchestrate` as if the soul owned it.
- `/orchestrate off`, `exit`, `stop`, and `disable` disable the built-in mode and never start a
  teammate. `commandPrefix: 'agent-'` registers the soul command as `/agent-orchestrate` (catalog
  line and preview agree); the prefix is bundle config, so changing it needs a reload.
- Deleting or renaming the colliding soul changes the desired command set; the next reconciliation
  (`rescan()` after a mutation, or the overview read) drops the failure and re-registers the
  remaining commands **without a Host reload**. An unchanged desired set reuses the record, so the
  failed name is not retried in a loop.
- Compositions with no registration record (an older Live Lead) keep the documented name-presence
  fallback for status; that fallback cannot distinguish the built-in from a soul handler, which is
  why the record exists.

### RB-03 — orchestrator route validation through the GUI

`POST /agent-soul/orchestrator` runs both layers before any write:

1. `analyzeOrchestrator` (declaration logic, no LLM service required) rejects a full
   `provider/model` conflicting with a different `provider`, provider without model, and an empty
   model id after the slash. Diagnostics are field-tagged (`model`, `provider`). A
   `reasoning-effort` with no `model`/`provider` is **not** a conflict: activation inherits the Lead
   route and ignores the effort, so the declaration stays valid (agreeing with activation).
2. When `deps.resolveModel` exists, `orchestratorRouteDiagnostics(definition, deps.resolveModel)`
   rejects a well-formed route this deployment's catalog cannot serve (resolver message under the
   `model`, `provider`, or `reasoningEffort` field, the last only when a model is declared).
   Without a resolver a complete `provider/model` route remains a valid file.

A refusal is **400** `{ ok:false, code:'invalid', message:'the orchestrator definition is invalid and was not saved', diagnostics:[…], fieldErrors:{ model?, provider?, reasoningEffort?, … } }`
and writes nothing (it runs before the path check, so even an unsafe target is untouched). The same
answer shape applies to the raw-source and `fields`/`sections` bodies.

`GET /agent-soul/overview`'s `orchestrator` block reports an existing contradictory file as
`valid:false` with the same diagnostics and `modelResolved:null`; it never advertises a resolved
route for an invalid definition. Activation keeps its fail-closed conflict error and rollback
attempt (the P4 mode section qualifies the rollback outcome), so a
document that somehow reached disk still cannot enable.

### RA-01 — cold-resume refusal diagnostics

The GUI does not own admission, and `GET /agent-soul/overview` does not add admission entries to its
`diagnostics` list (those are model-facing). The Lead reaches them through the `list_agent_souls`
tool, which appends the plugin's bounded cold-resume refusal sink:

```jsonc
"diagnostics": [
  { "source": "admission:<teammate>", "message": "teammate \"<name>\" has no pending or durable Agent Soul plan; refusing to admit a Soul-less teammate" }
]
```

The cause is typed rather than collapsed into "missing": a durable binding read distinguishes
`missing-binding`, `unreadable-binding`, `corrupt-binding`, `unsupported-binding`, and
`unsafe-binding-path` (see [`INTERNALS.md`](INTERNALS.md)). Every `get`/`list`/`size` re-reads the
durable document, so a plan read before it became corrupt, unreadable, unsupported, unsafe, or
partially malformed is not served; `get` refuses the whole document (partial malformed included).
`list`/`size` reject a document-level failure and, for a partially malformed document, return the
valid rows/count with the warning. The only in-memory exception is this process's unpersisted local
`set`/`delete` for that child; it is not durable and `list`/`size` still reject an unusable
document. A mutation never rewrites the untrusted bytes, a malformed snapshot is refused with
`E_BINDING_INVALID_RECORD`, and an external repair is observed on the next call without a new store.
The plugin's `send_message` error text and the Host
log line (`… cold resume refused for teammate "<name>": … (code SOUL_PLAN_UNAVAILABLE, reason …)`)
carry the same cause. The shared subagent lifecycle's generic `NOT_RESUMABLE` wrapper message is not
changed by the plugin; admission stays fail-closed.

## Bundled-editable authoring (`bundledEditable`, 0.4.0)

Opt-in authoring mode for the packaged defaults, merged to `main` 2026-11-08 UTC as part of 0.4.0
(see "Release status (2026-11-08 UTC)"); with the flag off (the default) the packaged souls and the
packaged doctrine keep the 0.3.0 read-only authoring behavior (no in-place editing), while other
0.4.0 changes — such as the bundled-soul route-inheritance change from PR #5 — still apply.

- **Config (`index.js`):** boolean `bundledEditable`, default `false`, validated with the other
  keys. It is inert while `bundled` is false (the packaged catalog is not scanned), and activation
  logs a one-time warning for that combination.
- **Host (`lib/admin.js`):** package ownership is separated from read-only status. `resolveTarget`
  computes canonical `packageOwned` and derives `bundled = packageOwned && !editable`; a
  package-owned target is a valid write target when the flag is on. `DocumentSummary` and
  `DocumentDetail` carry `packageOwned`; package-owned rows keep package-relative labels and
  same-name shadowing by workspace souls. A package-owned target may not take another packaged
  document's name: the shared document layer refuses that save/create/duplicate/restore while a
  workspace soul may still shadow a packaged name. With the flag on, save/delete/restore accept
  package targets (delete trashes into the workspace trash; Undo/restore exists only after a
  successful move, and a trash failure preserves the source and returns an error with no Undo),
  `create`/`duplicate` still write the configured workspace directories, and symlink aliases of the
  package directory keep their packaged identity.
- **Host (`lib/orchestrator.js`):** with the flag on and no workspace `orchestrator.md`,
  `readOrchestrator` reports the packaged `defaults/orchestrator.md` as the editable effective
  document (`path` = `sourcePath` = the packaged file, `bundled: false`), and `saveOrchestrator`
  rewrites that file atomically instead of creating a workspace override. A workspace file always
  wins; one that appears while the save is in flight is re-checked just before the write and the
  save answers `400 conflict` ("a workspace orchestrator definition appeared at …; reload and save
  again") instead of clobbering it. A dedicated packaged-target path check (the exact packaged
  path, real parent equal to the package's real `defaults/` directory, no symlink escape) replaces
  the state-directory fence for that one target; every other target keeps the existing fence.
- **Host (`lib/gui-host.js`):** the plugin-wide `GET`/`POST /agent-soul/config` pair reads and
  persists `bundledEditable` through the Host `configEditor` into the plugin's Loader row config
  (row `agent-soul-team`, profile patch, all other row keys preserved), and the Loader reloads the
  plugin once (`400 invalid-request`; `409 bundled-disabled` / `not-configurable` / `overridden`).
  The overview's `settings.bundledEditable` remains a read-only report of the effective flag.
- **Browser (`client.js`):** a `plugins.row.config` contribution keyed
  `@local/dsh-agent-soul#agent-soul-team` opens the **Use Default Agent Souls** page (switch
  labelled **Use default agent souls**), and the "Plugin settings & runtime" card carries the same
  switch row; both share one module-level state record over the config route, so a write in either
  control updates the other. A settled write refreshes the overview and clean editor views, and an
  unverified result is labeled as such. Polling reports **Applied** only after a read shows the
  requested value; exhaustion/mismatch/unmount reports the unverified state. Refresh/reopen the
  affected view if an unverified result needs confirmation.
- **Risks (deliberate):** in-place edits land in the installed package directory and are lost if
  the package is reinstalled or updated; the packaged catalog and doctrine are shared by every
  workspace in the profile while bindings and trash stay per workspace; the packaged doctrine
  becomes globally edited.

## Portable shell names (0.4.1, working tree)

The shell tool has one model-facing name per platform: DSH registers `bash` on POSIX and `pwsh` on
Windows compositions (the one-shot and persistent variants share the name per family). A soul is
platform-neutral, so `lib/tool-names.js` freezes the pair (`SHELL_TOOL_ALIAS_PAIRS`) and exposes
`shellCounterpart`, `resolveToolName`, `toolNameKnown`, and `resolveRestrictableNames`. The rules
are uniform across the surfaces below:

- an exact registration always wins;
- a declared shell name whose counterpart is live resolves to the counterpart;
- only `bash` ↔ `pwsh` aliases — every other name stays exact;
- the declared spelling is preserved in the durable binding, and resolution happens when the soul
  is applied.

**Host paths.** Spawn validation accepts a declared shell name when either spelling is visible
(`toolNameKnown`), while Team tools, the Lead-only `manage_agent_souls`, and genuinely unknown names
keep their existing refusals. The teammate tool matrix (`lib/apply.js`) probes each requested name
exactly and then through its counterpart, then installs one final `restrict({ allow })` naming the
resolved tools in request order with duplicates deduped; only unresolved names warn. The
orchestrator probe (`lib/orchestrator.js`) uses the same resolver, so a doctrine `bash` list applies
on a `pwsh` session instead of being skipped.

**GUI.** `toolsCatalogOf` adds the missing counterpart of every live shell spelling as one synthetic
catalog entry `{ name, description: 'Portable shell alias: this session registers its shell as "<live>"; naming "<counterpart>" resolves to it.', portableAliasOf: "<live>" }`;
`source` remains `'live-lead'` and the list is sorted by name. The tool chips and preview read that
catalog, and `saveValidator` derives tool membership from it, so both spellings preview clean and
save on either platform. Team-tool/Lead-only rejections, the live-but-empty catalog behavior, and
the empty/no-Lead degradations are unchanged, and `client.js` needed no change. The specification
suite is `smoke/windows-shell-alias.test.mjs` (14 cases); the optional
`smoke/run-windows-parity.mjs` probe (14/14 on 2026-11-09) boots a real headless profile with
`tool-bash` disabled and a test-only stand-in `pwsh` tool — simulated Windows evidence, not a live
Windows/PowerShell certification.
