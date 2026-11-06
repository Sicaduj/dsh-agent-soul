# Agent Soul — GUI and API module contract (maintainers)

This is the implementation contract for the plugin's Settings GUI, its authenticated HTTP API, and
the shared document/orchestrator layers behind both the browser and the Lead's agent tool. It is the
authoritative reference for maintainers changing those surfaces; end-user onboarding lives in
[`../README.md`](../README.md), the control-by-control option reference in
[`SOUL-OPTIONS.md`](SOUL-OPTIONS.md), and the module-by-module architecture in
[`INTERNALS.md`](INTERNALS.md).

**Reading order for a newcomer:** the module map below → the workspace-root rules → the route
inventory → the phase that owns the surface you are touching (P0–P4 sections are append-only
history; earlier phases are still live) → the hard rules. This tree ships **no unit-test suite**;
the executable verification is the `smoke/` harness (host-side spawn/command/binding behavior —
it does not cover these routes), so every route and payload below is derived from the source
handlers in `lib/gui-host.js` and must be checked against them.

### Module map

| Module | Role |
|---|---|
| `lib/soul.js` | parse/validate one soul Markdown document (frontmatter + body), catalog scanning and prompt text |
| `lib/tools.js` | ported Team tools (`spawn_teammate`, messaging, task board) + `team:policy`, `team:identity`, `team:agent-souls` prompt sections |
| `lib/composition.js` | live Loader inspection of the replaced `tool-agent-team` row (Plugin Manager listing fallback when the Web profile does not expose the Loader), Plugin Manager repair, opt-in `claimTeamToolRow` guard |
| `lib/apply.js` | applies a soul to a spawned or cold-resumed teammate: fail-closed plan resolution (pending plan, then durable binding), persona shadow, sections, tool matrix, model route, binding record |
| `lib/commands.js` | registers one Lead-scoped slash command per user-invocable soul |
| `lib/admin.js` | GUI/agent-tool document layer: split/compose/validate, directory scanning, path safety, atomic writes, trash |
| `lib/gui-host.js` | authenticated JSON routes + overview assembly; workspace-root selection; command/usage/health status |
| `lib/bindings.js` | durable teammate binding store (`state/bindings.json`) used for cold resume and GUI usage data |
| `lib/preferences.js` | plugin-owned default-Soul preference document (`preferences.json`): atomic read/write, real-path fence, default resolution (selection → bundled `generalist` → failure) |
| `lib/orchestrator.js` | single orchestrator definition: parse/validate/compose, `/orchestrate` command, session-scoped mode runtime (prompt sections, model/tool overrides, rollback) |
| `lib/orchestrator-mode.js` | shared pure durable-mode fold + Host session projection definition (`agentSoulOrchestrator`); the only place off-words and command-log settlement semantics live |
| `lib/admin-tool.js` | Lead tool `manage_agent_souls` (document + orchestrator actions) over the same layers |
| `client.js` | classic browser artifact: Settings → "Agent Soul" page (Souls + Orchestrator tabs, dialogs) plus the Session-header Orchestrator-mode badge |
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

The current release builds on P4 with the selectable default Soul (preferences route, state document,
and Souls-tab selector), the soul-only delegation fences, and the durable-mode Session-header badge;
see "Default Soul preference and soul-only delegation" below.

### Handler terms

| Term | Meaning here |
|---|---|
| **Overview** | the single `GET /agent-soul/overview` snapshot the page renders: catalogs, document rows, settings, runtime health, the orchestrator summary, and the default-Soul preference block |
| **Document** | one soul file (`DocumentSummary` in a listing, `DocumentDetail` when loaded/saved, with `source`) |
| **Catalog** | the scanned, validated set of every `*.md` under the configured soul directories |
| **Binding** | plugin-owned durable record in `state/bindings.json` mapping a teammate's child Session to the soul that shaped it (persona, tools, model, context) |
| **Preferences** | plugin-owned `preferences.json` beside the bindings file: the explicit default-Soul selection plus the effective default, its source, validity, and warning |
| **Draft / baseline** | browser-only localStorage copy of unsaved edits and the file state the editor loaded |
| **`expectedHash`** | optimistic-concurrency token: the hash the editor believes is on disk; a mismatch answers `409 conflict` with `currentHash`/`currentModifiedAt` |
| **`expectedMissing`** | explicit no-replace precondition for recreating a file that was absent at conflict time; a newly appeared target answers `409 conflict` instead of being overwritten |
| **Command status** | live check of the soul's slash command against the workspace-matched Lead: `registered`, `ai-only`, `invalid-name`, `collision`, `no-live-lead`. With a per-Lead registration record, `registered` means this soul's own handler is the effective one; `collision` means the name is invocable but another handler owns it (the built-in `/orchestrate`) or registration failed. |
| **Health** | catalog-wide budgets and scan findings: definition count, catalog characters, duplicate names, invalid files, diagnostics |
| **Orchestrator mode** | per-session mode turned on with `/orchestrate`; applies the single orchestrator doctrine (`<dirname(bindingsFile)>/orchestrator.md`; `state/orchestrator.md` in this project), model, and tool matrix to that session's Lead, announces activation, and renames the Session title when the optional service is available and a prior title exists |
| **Trash** | recoverable delete directory beside the bindings file (`<dirname bindingsFile>/trash`); Undo moves the newest entry back |

`index.js` wires both halves: the document layer is also used by an agent tool, so the same
operation serves the GUI and the agent (the "one operation, two callers" practice).

## Hard rules

- ESM JavaScript, **no dependencies, no bare imports** (`node:` builtins and relative paths only),
  JSDoc, no TypeScript syntax. `node --check <file>` must pass.
- The browser half runs as a classic artifact: it must call
  `window.__ModuleLoader__.load({ id, factory(require) { ... } })` exactly like the decoration
  template, take React from `require('react')`, and declare `dsh.client` in `package.json`.
- Do not touch files outside your write scope. Do not install packages, do not modify `~/.dsh`,
  and do not run `plugin_manager`.
- Tests, when present, are `node:test` and use temp dirs under `os.tmpdir()`; never the real
  workspace `.dsh`. (This tree currently ships no `tests/` directory; the executable checks are
  `node --check` plus the keyless `smoke/run-smoke.mjs` harness.)
- Writes are atomic: replacement uses a same-directory temp file + `rename`; no-replace creation
  uses a temp file + hard link (`EEXIST` refuses to clobber). All paths must resolve inside a
  configured soul directory.

## Which workspace the GUI edits (lib/gui-host.js)

The browser derives the current main Session's committed working directory from the Session summary
whose `retainedBy.mainView` count is positive, then pins that root for the editor session. Every
overview/document GET carries `?root=`, and every POST body carries `root`; a sole listed workspace
is the compatibility fallback when no main-view association exists.

The Host authorizes each requested root against current candidates: live top-level Session working
directories (teammates are skipped), the deployment root captured at activation, then
`workingDirectory.defaultDirectory` / `process.cwd()`. Candidates must be real directories, and an
unknown root answers 403 `unsafe-root`. A request without `root` retains the legacy behavior: the
first candidate whose configured soul directories exist wins, with the deployment directory as the
fallback. One authorized root is pinned for all validation and mutation work in that request, so a
roster change cannot move an in-flight save to another workspace.

## Host routes (lib/gui-host.js)

Thirteen endpoints, registered as ten exact paths (the web server rejects duplicate
`(kind, path)` registrations, so `GET` and `POST /agent-soul/document` share one registration
with method dispatch, as do `GET`/`POST /agent-soul/orchestrator` and
`GET`/`POST /agent-soul/preferences`). P1 adds the parse, preview, duplicate, and restore
endpoints; P4 adds the orchestrator document endpoints; the current release adds the default-Soul
preference endpoints. Each is registered on
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
| GET | `/agent-soul/orchestrator` | load the orchestrator definition (skeleton when absent) | P4 |
| POST | `/agent-soul/orchestrator` | save the orchestrator definition | P4 |
| GET | `/agent-soul/preferences` | load the default-Soul selection and the effective default | below |
| POST | `/agent-soul/preferences` | validate and atomically persist the default-Soul selection (`name`, or null to clear) | below |

### `GET /agent-soul/overview`

200 body (example values are illustrative; `plugin.version` is read from the real manifest —
`0.2.1` at this revision — and the no-`pluginMeta` fallback constant `PLUGIN_META_DEFAULTS` in
`lib/gui-host.js` matches it):

```jsonc
{
  "plugin": { "name": "@local/dsh-agent-soul", "version": "0.2.1", "root": "/abs/workspace" },
  "settings": {
    "dirs": ["agents"],
    "resolvedDirs": ["/abs/workspace/agents"],
    "bindingsFile": "state/bindings.json",
    "bindingsPath": "/abs/workspace/state/bindings.json",
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
  "orchestrator": {                        // P4: single definition summary
    "path": "/abs/workspace/state/orchestrator.md",
    "configured": true, "valid": true, "name": "orchestrator",
    "model": "deepseek-v4-pro", "modelResolved": "deepseek-official/deepseek-v4-pro",
    "tools": ["spawn_teammate", "send_message", "read"], "planFirst": true,
    "gateMode": "strict", "maxRetries": 3, "pauseOnFatal": true, "diagnostics": []
  },
  "preferences": {                         // default-Soul selector state
    "path": "/abs/workspace/state/preferences.json",
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
`<dirname(resolved bindingsFile)>/preferences.json` (`state/preferences.json` in this project) with
the same real-path/symlink fence and temp-file-plus-`rename` atomic replacement as the orchestrator
document. A missing file means no explicit selection. A corrupt, malformed, or unsupported document
is reported through `warning` with `valid: false`, `effective: null`, and `source: 'none'`; that
matches the spawn path's fail-closed behavior, so a default spawn fails until the document is fixed
or cleared. An explicit `agent_type` does not read the preferences document.

`DocumentSummary`:

```jsonc
{
  "file": "/abs/workspace/agents/researcher.md",                  // absolute
  "label": "agents/researcher.md",                                // root-relative when inside root
  "name": "researcher", "description": "Researches …",                // null when unparseable
  "valid": true, "tools": ["web_search", "web_fetch"],                // null = inherits every tool
  "model": "deepseek-flash",                                          // raw frontmatter model or null
  "modelResolved": "deepseek-official/deepseek-flash",                // null when unresolvable/inherited
  "userInvocable": true, "context": "fresh",                           // context null when absent
  "command": "/researcher",                                           // null unless the command is registered to this soul's handler
  "sourcePath": "/abs/…",                                             // file path for diagnostics
  "hash": "…",                                                        // SHA-256 hex of the file text
  "modifiedAt": 1793461007624,
  "diagnostics": [{ "message": "…" }],                                // empty for a valid document
  "commandStatus": { "name": "researcher", "status": "registered", "message": "…" }, // P2: live registration check
  "usage": { "storedCount": 1, "lastUsedAt": 1793461007624, "activeMembers": ["alpha"] } // P2
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
these rows, and every mutation route does the same after its scan (`deps.syncSouls`), so a newly
created/renamed/deleted invocable soul needs no Host reload.

### `GET /agent-soul/document?file=<absolute-path>`

200 `{ "document": DocumentDetail }`; 404 `{ ok: false, code: 'not-found', message }` when the file
does not exist; 400 `{ ok: false, code: 'unsafe-path', message }` when it resolves outside every
configured soul directory (or is not a `.md` file).

```jsonc
// DocumentDetail
{
  "file": "/abs/…/researcher.md",
  "label": "agents/researcher.md",
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

### `POST /agent-soul/create`

Body `{ "name": "researcher", "source": "…" }` (`source` optional) → 200
`{ "ok": true, "document": DocumentDetail }` after creating `<first dir>/<name>.md`. Without
`source` the file starts as the Host canonical skeleton (`canonicalSkeleton`; valid by
construction, placeholder body text); with `source` the validated template text is written instead
(the browser's New-soul dialog composes its own template client-side and always sends `source`).
400 codes: `invalid-name` (not lower-kebab-case, >64 chars, or the reserved `lead`), `exists`
(`<name>.md` already exists in a configured directory), `no-dirs` (no soul directory exists), and
`invalid` (the source template does not parse); an `invalid` response includes `fieldErrors`.

### `POST /agent-soul/delete`

Body `{ "file": "<absolute path>" }` → 200 `{ "ok": true, "trashedFile": "…" }` (`trashedFile` is
the trash path the browser's Undo uses; it is omitted when the trash move failed and the file was
hard-deleted), or 400
`{ "ok": false, "code": "unsafe-path" | "not-found" | "invalid-request", "message": "…" }`.

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
export async function listDocuments({ config, root }) // -> { dirs, documents: DocumentSummary[], diagnostics, scannedAt }

export async function readDocument({ config, root, file })          // -> { ok, document? , code?, message? }
export async function saveDocument({ config, root, file, fields, sections }) // -> { ok, document?, code?, message?, diagnostics? }
export async function createDocument({ config, root, name })        // -> { ok, document?, code?, message? }
export async function deleteDocument({ config, root, file })        // -> { ok, code?, message? }
```

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
  escapes). Reject `..` traversal and non-`.md` targets.

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
inside `apply` (automatic cleanup with the plugin). The page component receives `t` (the bound
translate function) and `close` props.

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
  resolved soul directories, bindings file + count, providers, command prefix, default context,
  spawn providers, definition/catalog limits, scan time, live Team commands; plus the
  delegation hint (`spawn_teammate({ …, agent_type: "<name>" })`) and a note that souls are plain
  Markdown with no separate database.
- Error/empty/loading states: no Host route (fetch failure) → readable error card; no souls →
  empty state with "New soul"; nothing selected → placeholder.
- All copy through `t(...)`; accessible labels (`label` + `aria-label` on controls, `role="status"`
  for the status line, buttons are real `<button>` elements).

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

## Agent tool (index.js / lib/admin-tool.js)

`manage_agent_souls` — Lead-only, registered in the Lead member scope next to the soul
commands. Actions: `list`, `get` (`file`), `save` (`file`, `source` raw markdown), `create`
(`name`), `delete` (`file`), `diagnose` (live Lead/command-registry snapshot plus the
`teamTools` composition block for support), `repair_team_tools` (persists the shipped-row disable
through the Plugin Manager and reports the manual fix when that service is unavailable),
`get_orchestrator` and `save_orchestrator` (`source` raw markdown) for the P4 definition. Its output schema is canonical JSON Schema (object-level `required`
arrays, never author-style per-property `required: true`), because the tools registry validates it
at registration. `save_orchestrator` runs the same two validation layers as the GUI save — the
document analysis (`analyzeOrchestrator`) plus `orchestratorRouteDiagnostics(definition,
deps.resolveModel)` — so a contradictory or unresolvable route is refused with no write. It calls the same document layer functions (`listDocuments`,
`readDocument` with raw source, `saveDocumentSource` for raw-markdown saves, `createDocument`,
`deleteDocument`) with `root = deps.rootOf(agent)`, so the tool and the GUI cannot diverge.
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
  `TEAM_TOOL_NAMES` and inside the live Lead's restrictable catalog when one is available; a
  non-empty `model`/`provider`/`reasoning-effort` declaration must resolve through
  `deps.resolveModel`; a `name` already used by another valid document in the same catalog is a
  duplicate.

### Host: overview catalogs

`GET /agent-soul/overview` adds one top-level `catalogs` object:

```jsonc
{
  "source": "live-lead" | "none",
  "tools": [{ "name": "bash", "description": "Execute a bash command…" }],
  "models": [{ "provider": "deepseek-official", "model": "deepseek-flash", "name": "DeepSeek-V4.1-Flash" }],
  "teamTools": ["interrupt_agent", "spawn_teammate", "team_task_update"]
}
```

Tools are the first live Team Lead's visible, restrictable tool definitions (visible tools minus
`TEAM_TOOL_NAMES`, descriptions truncated to 200 chars), `source` is `'none'` with empty arrays when
no live Lead exists or the tools service is unavailable. Models come from `llm.listProviders()` +
`llm.listModels(provider)` with every rejection degrading to an empty list. `teamTools` is the
sorted `TEAM_TOOL_NAMES` list: those tools are Agent-scoped and never restrictable, so a teammate
soul must not name them; the orchestrator matrix *may* name them, and the browser uses this list
to explain them as always-available instead of flagging them as unknown.

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
- Draft recovery: the dirty draft is saved to `localStorage` (key
  `dsh.agent-soul.draft:<file>`) as fields+sections; reopening the document offers
  **Restore draft / Discard draft** in the editor when the stored draft differs from the file and
  was saved after it (an older draft is suppressed).
  Saving or deleting clears the entry.
- Conflict recovery: a 409 shows an inline banner with **Reload file** (re-open, discarding edits)
  and **Overwrite** (save again with the server's `currentHash` as `expectedHash`; when the file was
  removed and `currentHash` is null the page sends `expectedMissing: true` with no `expectedHash`,
  so Overwrite recreates the file with no-replace semantics — a target that appeared in the meantime
  answers 409 again instead of being clobbered).
- Inline validation: save-time 400/`fieldErrors` render under the matching control with an error
  summary above the form that focuses the first invalid field; every save diagnostic also stays
  listed in the existing diagnostics block.
- Search and filters above the list: free-text match on name/description/source; filter chips
  **All / User-invocable / AI-only / Invalid**; sort toggle **Name / Updated**.
- Sticky action bar in the editor (Save / Revert / Delete + dirty badge) that stays visible while
  the form scrolls; **Revert** restores the last loaded file content.
- Empty-state now names the scan root and resolved directories, with copy buttons, so a wrong root
  or an empty folder is self-explanatory.
- Skeleton placeholders while the overview or a document loads.
- Every new string is added to the `en` and `zh` dictionaries; the documented relative paths are
  nine at this phase (the default-Soul release adds the tenth).

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
- `deleteDocument` becomes recoverable: move the file into a trash directory and return
  `{ ok: true, file, trashedFile }`. Trash location: the directory beside the configured bindings
  file (`<dirname(bindingsFile)>/trash`; the default config yields
  `<root>/.dsh/agent-soul/trash/`), filename
  `<timestamp>-<original basename>`; create it on demand. A trash failure falls back to the current
  hard delete and still answers `{ ok: true }` (no `trashedFile` in that case).
- `restoreDocument({ config, root, trashedFile, file })`: both paths must pass the existing path
  safety (trashed file inside the trash directory, target inside a configured soul directory);
  move the file back. `{ ok, document }` or `not-found`/`unsafe-path`/`exists`.

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
  shown as removable warning chips. The comma-separated text field remains for advanced use and the
  two views stay in sync.
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
  dirty goes through the P0 discard guard.
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
  (detached copies of every retained binding for that root, newest first; loading/corruption rules
  unchanged).
- `GET /agent-soul/overview` documents gain:
  - `usage: { storedCount: number, lastUsedAt: number | null, activeMembers: string[] }` — retained
    bindings whose record `name` equals the soul name (the store keeps only the newest 500 records
    per root, so `storedCount` is not an all-time count); `lastUsedAt` is the newest retained
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
  (nine paths at that phase; the default-Soul release adds the tenth).

## P4 — Orchestrator soul (session-scoped, command-activated)

A single optional **orchestrator definition** describes the Lead's orchestration doctrine and
overrides its model/tools — but only after a human activates Orchestrator mode in that session with
the `/orchestrate` chat command. Sub-agent souls keep driving downstream delegation unchanged.

### Definition file

Path derives from the bindings file: `<dirname(resolved bindingsFile)>/orchestrator.md`
(this project: `dsh-agent-soul/state/orchestrator.md`). Optional; when absent, mode cannot be
enabled (the command explains how to create it).

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
  source: { kind: 'user' } }`). Queue failure after a first enable reverts the mode and answers an
  error. When the mode was already active before the invocation (live bundle, or durable state after
  a reload), the command does not revert it: for a live bundle it snapshots the bundle and title and
  restores the exact pre-invocation state when the snapshot can be recreated; if recreation fails,
  the freshly applied bundle is kept instead when possible, and only if both restorations fail is
  the mode left inactive. A durably active mode with no live bundle has nothing to snapshot, so the
  freshly applied bundle is kept. Either way it answers
  the queue error. Missing/invalid definition → error result, mode unchanged.
- Durable mode: `modeOf(agent)` folds `agent.session` events via `eventAt(seq)`: every
  `command/run` whose `data.name === 'orchestrate'` records `data.args` in order (off-words ⇒ off,
  every other argument form — bare command or a `<task>` — ⇒ on); a run whose paired `command/done`
  settled as `kind: 'error'` is skipped, so the mode is the last qualifying run's value. Unreadable
  log ⇒ off.
- Enable (live Lead scope, via a per-agent `agent.ctx.effect` bundle):
  - shadow `deployment:persona-prefix` (persona order) with a fixed runtime identity followed by the
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
  `{ ok:false, code:'invalid'|'unsafe-path'|'invalid-request', message, diagnostics?, fieldErrors? }`.
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
  selectable), Save, dirty guard, conflict-free (single file) and validation errors; no delete.
  **Create default orchestrator** (shown only while unconfigured) does not open the dialog first:
  it composes `ORCHESTRATOR_DEFAULT_FIELDS` plus the English starter section prose
  (`ORCHESTRATOR_TEMPLATE_CONTENT`) client-side, POSTs them as `{ fields, sections }`, and then
  opens the dialog on the saved result (see the default-set note above). The
  orchestrator tools picker treats `catalogs.teamTools` names as always-available (explained, never
  shown as unknown), because Team tools cannot be restricted but may be listed in this matrix.
- All copy in the eight locale dictionaries; token-only styles; no new fetch hosts; the same
  relative fetch style for the two orchestrator routes.

## Default Soul preference and soul-only delegation

- `lib/preferences.js` owns `<dirname(bindingsFile)>/preferences.json`
  (`{ version: 1, selected: string | null }`), its real-path fence, atomic write, pure
  `resolveDefaultSoul`/`describePreferences` helpers, and the per-root store shared by the spawn
  path and the GUI routes.
- Resolution order for a spawn without `agent_type`: require a usable preferences document, then
  persisted selection → bundled `generalist` → actionable failure. A stale explicit selection fails;
  it never silently falls back. A corrupt, malformed, or unsupported preferences document is a
  warning that makes the block `valid: false` with `effective: null`; the default spawn fails with
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

(and the matching unreadable-binding message). The plugin's `send_message` error text and the Host
log line (`… cold resume refused for teammate "<name>": … (code SOUL_PLAN_UNAVAILABLE, reason …)`)
carry the same cause. The shared subagent lifecycle's generic `NOT_RESUMABLE` wrapper message is not
changed by the plugin; admission stays fail-closed. See [`INTERNALS.md`](INTERNALS.md) for the
module-level behavior.
