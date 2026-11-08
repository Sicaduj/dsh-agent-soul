# Agent Soul — options reference

Every control you can edit in the plugin's Settings page, what it does, and when it takes effect.
This is the user-facing companion to [`GUI-INTERNALS.md`](GUI-INTERNALS.md) (route/payload contract)
and [`INTERNALS.md`](INTERNALS.md) (module architecture). The feature overview, install steps, and
authoring guidance live in [`../README.md`](../README.md).

The page is **Settings → Agent Soul** in the Harness Web GUI and has two tabs:

| Tab | What you edit | One file per… |
|---|---|---|
| **Souls** | A catalog of teammate definitions | teammate soul (packaged `agents/*.md`, or one file per soul in the configured workspace `dirs`) |
| **Orchestrator** | The single Lead orchestration definition | workspace (`<dirname(bindingsFile)>/orchestrator.md`); falls back to the bundled `defaults/orchestrator.md` |

Editing writes the Markdown file on disk. The **next spawn** (souls) or the **next
`/orchestrate` / reapply** (orchestrator) uses the new values; running teammates and an
already-running Orchestrator mode are never modified in place. Eight dictionaries localize the
plugin's UI chrome; Host diagnostics/messages and file content can appear untranslated.

Installations ship **bundled defaults**: the five packaged souls under `agents/` and the packaged
orchestrator doctrine under `defaults/orchestrator.md` are available in every workspace without
local files. By default the packaged souls are listed with a **Bundled** badge and are read-only in
place — use **Duplicate** to create an editable workspace copy. With **Use default agent souls**
on (config key `bundledEditable`, with `bundled: true`), the packaged souls open editable in place
instead and carry no badge. The orchestrator tab shows the bundled doctrine until a workspace file
overrides it.

What the package currently ships (0.4.0): the souls `adversarial-red-team-verifier`, `generalist`,
`researcher`, `scribe`, and `software-engineer`. All five declare no `model`/`provider` override
and **inherit the Lead's model** (their catalog line reads `model: inherit`). `generalist`, `researcher`, and `software-engineer` declare `context: fresh`;
`scribe` and `adversarial-red-team-verifier` declare no context. None is `user-invocable`. The
packaged orchestrator doctrine declares `plan-first: true`, `gate-mode: strict`, `max-retries: 10`,
`pause-on-fatal: true` and no model/provider/reasoning-effort, so the mode runs on the Lead's own
route.

---

## Page-level controls (both tabs)

| Control | What it does |
|---|---|
| **Souls / Orchestrator tabs** | Switch editors. Switching with unsaved edits asks to discard or keep editing (the same guard as closing a dialog). |
| **New soul** | Opens the create dialog: a `name` field and a template picker (Blank / Researcher / Code reviewer / Docs writer). Creates the file from the chosen template: the page composes the complete Markdown source (frontmatter + body) and sends it as the new file's initial content. (A create call without template source falls back to the server-side skeleton.) |
| **Refresh** | Re-fetches the overview (catalog scan, live tools/models, runtime health). Running teammates are unaffected. |
| **Paste Markdown** | Opens the import dialog: paste a complete soul file, **Parse** it (validates, writes nothing), then import the parsed fields into the current draft or create a new soul from it. |
| **Create default orchestrator** (Orchestrator tab) | Shown only when there is no effective definition at all — no workspace file and no bundled default (for example `bundled: false`). Writes a complete six-section definition composed in the page — `name: orchestrator`, no model, tools `*`, plan-first on, gate `strict`, **2** retries, pause-on-fatal on — then opens the editor on the saved file. These are not the values previewed before creation; see ["Where the default values come from"](#where-the-default-values-come-from). |
| **Search** | Filters list cards by name, description, `sourcePath`, label, file name, or absolute file path; it does not search the Markdown body. The placeholder in all eight dictionaries says "name, description, source path or file name". |
| **All / User-invocable / AI-only / Invalid** | List filters: every soul, only `user-invocable: true`, only AI-only, or only files that currently fail parsing. |
| **Sort: Name / Updated** | Sort cards by soul name or by file modification time (newest first). |
| **Clear filters** | Appears in the empty state when a search/filter hides every card; resets search and filters. |
| **Default Soul** (Souls tab) | Selects the Soul `spawn_teammate` uses when `agent_type` is omitted. The selector offers the bundled-default option, every valid Soul, and the persisted name marked `(not in catalog)` when it is stale. Choosing a Soul validates it against the live catalog and writes `<dirname(bindingsFile)>/preferences.json` atomically; choosing the bundled option clears the explicit selection, so the live catalog's `generalist` applies when present (normally the bundled definition; a workspace-only or shadowing definition also qualifies, including with `bundled: false`). The **Default** badge sits on the effective default (the selection, else that live `generalist`). A warning banner appears for a stale selection, no usable default, or a corrupt/malformed/unreadable preferences document. When the document itself is invalid, the page advertises no effective default and a default spawn fails with the reason instead of silently using `generalist`; an explicit `agent_type` is unaffected. |
| **Soul card** | Click to open that document in the editor dialog. The badges are read-only status (see ["List-card badges"](#list-card-badges-read-only-status)); delete/undo happens inside the dialog. |
| **Use default agent souls** (settings card switch and the Plugins page) | The packaged-defaults edit mode (config key `bundledEditable`, profile-wide). The same switch appears in the **Plugin settings & runtime** card and on the Plugins page: **Configure** on this bundle's `agent-soul-team` row opens the **Use Default Agent Souls** page, which carries the page description ("When on, the packaged default souls and orchestrator doctrine shipped with the plugin are the live definitions and open editable in Settings > Agent Soul. When off, they stay read-only defaults and you customize copies in the workspace.") and the switch labelled **Use default agent souls** (the bundle page's row summary reads "Edit the packaged default souls shipped with the plugin in place instead of copying them."). Status text: **On - packaged defaults are editable in place**, **Off - packaged defaults are read-only**, **Unavailable - bundled defaults are disabled (bundled: false)**, or **Unavailable - this profile cannot save this setting**; while saving it shows **Applying... the plugin reloads once**, then **Applied.** (a write failure shows **Could not update the plugin configuration.**, and an unconfirmed reload shows **Saved, but the reload was not confirmed. Reload the page to verify the new value.**). Flipping the switch writes `bundledEditable` into the profile patch's row config (all other row keys are preserved) and the plugin reloads once. Both mounted controls share one module-level state record: a write in either updates the other, a control mounted later reads the current state, and a settled write refreshes the overview, a clean Orchestrator draft, and a clean open document. Only a read that shows the written value reports **Applied.**; exhausted or mismatched polling (and a control that unmounts mid-write) reports **Saved, but the reload was not confirmed** (Unverified), so that label is honest rather than proof. The normal Host write path validates and reconciles the setting. The switch is disabled while loading, saving, or applying, when `bundled: false`, or when the profile cannot persist the setting. |

The page footer cards (**Plugin settings & runtime**, **Health**) are read-only reports apart from
the **Use default agent souls** switch — see ["Read-only cards"](#read-only-cards).

---

## Soul editor — writable controls

The dialog is resizable (drag the bottom-right handle, arrow keys when it has focus, Home resets;
the size is remembered) and has a **Form / Raw** mode switch.

### Identity group

| Field | Maps to | What it does |
|---|---|---|
| **Name** | frontmatter `name` | The identity used in `agent_type`, the Lead's catalog bullet, and the slash command name. Required, lower-kebab-case, at most 64 characters, unique within the catalog. `lead` is reserved for the Team Lead: a save or preview refuses it without writing and shows `name: "lead" is reserved for the Team Lead` on the name control; create and duplicate refuse it as an invalid name and create nothing. `leadership`, `lead-review`, and `lead-2` remain valid. The teammate's own name (`spawn_teammate({ name })`) is separate, chosen at spawn time, and also cannot be `lead` or an already-used roster name. |
| **Description** | frontmatter `description` | The **orchestration trigger**: the Lead reads this text to decide when to use the soul. Required, non-empty, at most 2000 characters; write it as one line (the parser does not enforce single-line, and the catalog collapses whitespace). It is also the catalog line shown in the Lead's prompt (truncated to 600 characters). Write "what it does + when to use it". |

### Routing group

| Field | Maps to | What it does |
|---|---|---|
| **Tools** chip picker | frontmatter `tools` | The teammate's **permission matrix** over inherited (preset/global) tools. Chips light up for names the live Lead's catalog reports. **Inherit every tool** (pressed) = allow every inherited tool (`tools:` omitted / `*`). Pressing it off leaves an empty list (`tools: []`) = hide every inherited tool. Selecting chips builds an explicit allow-list. Team tools are never listed: they are Agent-scoped, cannot be restricted, and stay available to every teammate. Lead-only `manage_agent_souls` is also excluded and rejected because it cannot be delegated. |
| **Tools (comma-separated)** (Advanced) | same `tools` | The raw form of the same value. `*` (what the field shows when the file omits `tools`) = inherit all; an empty value = deny all (composes `tools: []`); `a, b` = allow exactly `a` and `b`. Useful for tools the GUI text input accepts but the live catalog does not currently show. Stays in sync with the chips. Whenever a live Lead catalog is the source, an unknown name is rejected — including when that catalog has zero restrictable tools (the error says the Lead reports none). Only a missing catalog source skips the membership check; spawn remains the final boundary. |
| **Provider** / **Model** selects | frontmatter `provider`, `model` | Route this teammate's model. Empty = inherit the Lead's model. The provider list comes from the live `llm` catalog; the model list is filtered by the chosen provider. Picking a model auto-fills its provider when none is set. A configured route that is not in the live catalog stays selectable (marked "not in catalog") instead of being lost. A declared model that cannot be resolved makes the spawn fail, it does not invalidate the file — though the GUI save refuses an unresolvable declaration while a live catalog is available. |
| **Reasoning effort** | frontmatter `reasoning-effort` | Optional provider/model effort id (e.g. `high`). Validated against the model when the LLM catalog advertises efforts; otherwise used with a warning. Empty = provider default. Declare it **together with a model**: a soul carrying only `reasoning-effort` is refused at save and fails at spawn (the effort needs a model to validate against). This differs from the orchestrator definition, where an effort with no model/provider is valid and ignored — see below. |
| **Context** | frontmatter `context` | Starting context for the teammate. **Not specified** = no value in the file, so spawn resolution uses the call's `context` argument, then the plugin's `defaultContext` (`fresh` by default). **fresh** = clean session without the Lead's history (best for independent work; the default). **fork** = the teammate's session inherits the Lead's completed turns (shared continuity, larger prompt). No other value is accepted; a literal `none` is invalid in raw YAML. |
| **User-invocable** checkbox | frontmatter `user-invocable` | When checked, the Lead's session registers one slash command for this soul (`/researcher`), letting a person start the teammate directly. Default off (AI-only), and every bundled soul omits the key — set it and save to opt in. Command names can collide with existing commands; the card reports `Command collision`. The built-in `/orchestrate` is installed first on every Lead and always wins its name, so a soul named `orchestrate` needs `commandPrefix: agent-` to become `/agent-orchestrate` (a config change takes effect after the next Host/bundle reload). Deleting or renaming the colliding soul re-registers the remaining commands without a Host reload. |

### Markdown body group

Each section is plain Markdown, edited in its own textarea:

| Section | Role in the teammate prompt |
|---|---|
| **Role Definition** | Applied at the deployment-persona position (after a configured deployment prefix line): who the teammate is, its perspective, and its responsibility. |
| **Inputs You Will See** | What task message and workspace context the Lead is expected to pass. Sets expectations for the teammate. |
| **Hard Rules** | Non-negotiable constraints (always/never). Keep them concrete and checkable. |
| **Output Format** | The exact structure of the teammate's final reply. |
| **Extra markdown** | Body content outside the four sections: the text before the first canonical heading (the preamble), or the whole body when it has no canonical heading. It is emitted **before** the four canonical sections; other headings inside a section stay inside that section. |

The body must be non-empty; that is part of what makes a file valid.

### Advanced group

| Field | Maps to | What it does |
|---|---|---|
| **Tools (comma-separated)** | `tools` | Same value as the picker, editable as text (see Routing group). |
| **Model** / **Provider** text inputs | `model`, `provider` | Free-text route editing, for a route that is not in the live catalog or when editing while the catalog is unavailable. Keep the Provider select consistent; prefer the dropdowns for discoverability. |
| **Extra frontmatter** | unknown YAML keys | Preserves keys the plugin does not interpret, verbatim. The GUI shows them here so a save does not drop hand-authored metadata. They do not affect spawning. |

### Editor modes and actions

| Control | What it does |
|---|---|
| **Form / Raw** toggle | Form = the split editor above. Raw = the complete Markdown source in one textarea; Save validates it exactly like a form save. Use Raw for unusual YAML or to copy a whole file. |
| **What the teammate will receive** preview | Read-only live previews of the composed persona and the catalog line, plus the resolved model and the slash-command status. Nothing is written. Use it to check what the model will actually see before spawning. |
| **Save** | Validates the composed document, then writes the file atomically and re-scans the catalog. Errors appear inline (and in a summary) without writing. A stale draft that conflicts with an external edit answers a **conflict banner** with **Reload file** / **Overwrite**. With `bundledEditable` on, saving a packaged soul rewrites the package's `agents/` file in place. |
| **Revert** | Discards the in-page changes and restores the last loaded file content (asks before discarding when the guard fires). |
| **Duplicate** | Copies the document under a new name (default `<name>-copy`), preserving description, sections, and fields. Fails on an existing name or a bad name. |
| **Delete** | Two-step confirm, then moves the file into the plugin trash (`<bindings dir>/trash`) after fencing the state/trash path to the real workspace (or real shared-state directory). The status banner offers **Undo** only after a successful move, restoring the exact reported `trashedFile` to its original path. If the state path is unsafe (including a symlinked `.dsh`/`.dsh/agent-soul` leaving the workspace), trash creation fails, or the no-replace move fails, the file is left in place, the page reports an `unsafe-path`/`invalid-request` error naming the reason, `trashedFile` is omitted, and no Undo is offered; there is no hard-delete fallback or opt-in. Fix the path/symlink/permissions/device issue and retry. Packaged deletes still require `bundledEditable`. |
| **Close / Escape / backdrop** | Closes the dialog. With unsaved edits, the guard asks **Discard changes** or **Keep editing**. |
| **Reset size** (title row) | Restores the dialog's default size; the chosen size is remembered in `localStorage`. |

A recovered draft is offered when the page reloads with an unsaved draft in `localStorage`:
**Restore draft** or **Discard draft**. The per-file draft stores form fields/sections, the
Form/Raw mode, the raw source when that mode is dirty, and the base file hash; older form-only
records still restore as form drafts. It never overwrites the file. Orchestrator edits, New/Paste
inputs, and Undo state are not restored. A Session-root change no longer resets a dirty
Orchestrator draft.

---

## Orchestrator editor — writable controls

Opened from the Orchestrator tab (**Edit orchestrator**); same resizable dialog, no delete (the file
is optional). On a fresh install the tab shows the **Bundled** badge and the bundled-default hint:
editing loads the packaged doctrine, and by default saving writes the workspace override at the
path shown (with the `bundledEditable` bundle config on, saving instead rewrites
`defaults/orchestrator.md` in place, and a workspace file always wins). Delete that workspace file
to fall back to the bundled doctrine. Saving the definition does **not**
change a running mode — it is read the next time
`/orchestrate` enables the mode (or when an active mode is re-applied after a Host reload / Lead
creation).

### Configuration group

| Field | Maps to | What it does |
|---|---|---|
| **Name** | frontmatter `name` | Display identity of the definition (default `orchestrator`). Lower-kebab-case, ≤ 64 characters. |
| **Provider** / **Model** selects | `provider`, `model` | The Lead route used **while the mode is on**. Empty = keep the Lead's own route. Same live-catalog dropdowns as the soul editor (inherit option, out-of-catalog route retained). |
| **Reasoning effort** | `reasoning-effort` | Optional effort id for the Lead route while the mode is on. |
| **Tools** picker / text | `tools` | The Lead's permission matrix **while the mode is on**. Pressed **Inherit every tool** (`*`) = no restriction (`tools:` omitted); pressing it off, deselecting the last tool, or clearing the text leaves an empty value, which composes `tools: []` = deny every inherited tool; a selection list = allow exactly those inherited tools. Team tools stay visible; listing one is harmless (it is skipped) and is explained in the picker, not flagged as unknown. A name unavailable in the session is skipped with a warning rather than failing the whole mode. |
| **Gate mode** select | `gate-mode` | Substituted as `{{gateMode}}` into the doctrine: `strict`, `advisory`, or `off`. It changes what the prompt instructs the Lead to do; it does not mechanically block tools. An omitted field is read as `off`. |
| **Max retries** number | `max-retries` | Integer 0–10, substituted as `{{maxRetries}}`: the retry ceiling the doctrine tells the Lead to follow. It is not an automatic retry driver. An omitted field is read as `0`. |
| **Plan first** checkbox | `plan-first` | Boolean, substituted as `{{planFirst}}`: doctrine to publish a plan before executing. An omitted field is read as off; the starter documents enable it (see below). |
| **Pause on fatal** checkbox | `pause-on-fatal` | Boolean, substituted as `{{pauseOnFatal}}`: doctrine to stop and ask the human on unrecoverable failure. An omitted field is read as off; the starter documents enable it (see below). |

### Where the default values come from

There is no single default set for the orchestrator fields; three sources in the code each carry
their own values, and they do not agree:

| Source | `gate-mode` | `max-retries` | `plan-first` | `pause-on-fatal` |
|---|---|---|---|---|
| A saved file with the fields omitted (parser defaults) | `off` | `0` | off | off |
| The editor's pre-creation preview (the Host skeleton shown while the file does not exist) | `advisory` | `3` | on | on |
| **Create default orchestrator** (composed in the page and written to disk) | `strict` | `2` | on | on |

All three use `name: orchestrator` and tools `*` (inherit every tool) unless a field is set. Note
the mismatch: the editor previews `advisory` / `3` before creation, but **Create default
orchestrator** writes `strict` / `2`. Check the fields after creating.

While the mode is on, the **Identity & Boundaries** section is registered at the
deployment-persona position (after a configured prefix line), the other five sections become prompt
sections around the Team policy, the declared model is selected
(restored on `/orchestrate off` when it was captured in the same process), and the tools list
becomes the Lead's inherited-tool matrix. The built-in team policy and soul catalog stay in
place.

**Route values are validated before any save.** The editor (form and raw) and the Lead's
`save_orchestrator` action refuse a route that contradicts itself — a full `provider/model` plus a
different `provider`, a provider without a model, or an empty model id after the slash — and, when
a live LLM catalog is available and a model is declared, a well-formed route (or reasoning effort)
this deployment cannot serve. A `reasoning-effort` with no `model`/`provider` is valid and ignored
at enable because the Lead route is inherited, matching activation. The refusal names the field (`model`, `provider`, or `reasoningEffort`),
writes nothing, and leaves the previous file intact. Without an LLM service a complete
`provider/model` route is still saved; enable succeeds only when deployment selection can serve it
and fails otherwise.
An existing invalid file shows **Invalid** and no resolved model, and cannot enable.

### Sections and extras

| Field | Maps to | What it does |
|---|---|---|
| **Identity & Boundaries** | section | The Lead's role, authority, and what it must not do itself. Applied at the deployment-persona position while the mode is on. |
| **Plan Generation** | section | How to decompose the goal, what a plan contains, when to publish/revise it. |
| **Delegation & Context Minimization** | section | How to match steps to souls/tools and what context to pass. |
| **State Tracking** | section | How to use the Team task board as the durable ledger. |
| **Quality Verification** | section | The gates a completed sub-task must pass before advancing. |
| **Exception & Recovery** | section | Retry policy, fatal-error handling, human escalation. |
| **Extra markdown** | extras | Content before the first canonical heading, after an explicit `<!-- orchestrator:extra -->` marker, or under any other `#`/`##` heading. It is preserved but appended after the canonical sections on save, so use `###` for sub-headings that must stay inside a section. |

Template variables available in every section and in extras: `{{maxRetries}}`, `{{gateMode}}`,
`{{planFirst}}`, `{{pauseOnFatal}}`, and `{{catalog}}` (the Lead's soul catalog text from the last
cached scan). An explicit `/orchestrate` enable does not rescan external Soul edits; Refresh or
trigger a catalog scan first when the substituted catalog must be current. Unknown variables stay
literal.

### Orchestrator actions

| Control | What it does |
|---|---|
| **Create default orchestrator** | Composes a complete six-section definition in the page and writes it immediately, then opens the editor on the saved file: `name: orchestrator`, no model, tools `*`, plan-first on, gate `strict`, 2 retries, pause-on-fatal on, with starter prose in every section. Its values differ from the pre-creation preview and from the omitted-field defaults (see ["Where the default values come from"](#where-the-default-values-come-from)). |
| **Edit orchestrator** | Opens the dialog described above. |
| **Save / Revert / close** | Same validation, dirty guard, and dialog behavior as the soul editor. The file is single, so there are no duplicate/delete actions. Ordinary saves do not use the Soul `expectedHash` conflict banner/overwrite flow and are last-write-wins; for external-edit conflicts, the specific guard is a workspace-appearance 400 response when `bundledEditable` packaged editing races a new workspace file. Orchestrator drafts are not restored after a refresh, so save before reloading; a Session-root change no longer replaces a dirty draft. |
| **Edit while the mode is on** | Safe but not hot-applied. Re-run `/orchestrate` (or reload the Host / re-create the Lead) to apply the new definition. Ordinary failed re-enables attempt rollback and report `previousStateRestored`; queue-failure recovery is best-effort and reports the observed state (reverted, kept, explicit fallback, inactive, or unconfirmed), with `/orchestrate off` as the model-restore retry. The handler tests use an in-memory Agent double, not a full real Host lifecycle. If live/durable state disagrees, retry `/orchestrate off` and inspect the Host log; see [`../README.md`](../README.md#known-limitations). |
| **Bundled default** | When the tab shows the bundled doctrine (no workspace file), **Edit** loads it and **Save** creates a workspace override at the path shown. With `bundledEditable` on there is no **Bundled** badge: the shown path is the packaged file and **Save** rewrites it in place (a workspace file that appears while the dialog is open makes the save fail with a conflict instead of being clobbered). The dialog has no delete action for the packaged asset; delete the workspace file to fall back to the bundled default. |

---

## List-card badges (read-only status)

These summarize a file; they are not editable.

| Badge | Meaning |
|---|---|
| **Valid** / **Invalid** | Whether the file parses and validates. Invalid files stay listed and editable; the catalog and spawning skip them. |
| **Bundled** | This soul comes from the plugin package (`agents/`) rather than a workspace directory. By default it is read-only in place: the editor disables **Save** and **Delete**, and **Duplicate** creates an editable workspace copy under the configured `dirs` (created on demand). With `bundledEditable` on, the packaged souls open editable in place (Save rewrites the package file; Delete moves it to the workspace trash with Undo only after a successful move, while a failed move preserves the source and reports the error with no Undo), report no badge, and keep package-relative labels. A local soul with the same name shadows the packaged card either way; a packaged file may not be renamed onto another packaged file's name. |
| `N tools` / `No tools` / `All tools` | The permission matrix: an allow-list of that size, an empty list (deny every inherited tool), or no list (inherit every inherited tool). |
| **Model: …** | The resolved `provider/model` when it resolves, otherwise the raw declaration. The badge is absent when the soul inherits the Lead's model. |
| **Context: fresh/fork** | The declared spawn context. Absent when the soul does not specify one. |
| **/command** chip | The soul's registered slash command. The chip appears only when the workspace Lead's command registry resolves that command to this soul's own handler (the **Registered** status); AI-only, invalid-name, collision, and no-live-Lead rows show no chip. |
| **Command collision** | The workspace Lead's command registry does not resolve that command to this soul's own handler: another command owns the name (the built-in `/orchestrate` always wins), or registration failed. Fix by renaming the soul or setting `commandPrefix` (bundle config, reload needed); deleting or renaming the colliding soul clears it without a Host reload. (No live Lead to check against is its own **No live Lead** status, not a collision.) |
| **N saved · last used …** | Retained durable bindings for this soul in the current workspace: how many are stored now (the store keeps only the newest 500 bindings per bindings document, so this is not an all-time count; workspaces sharing an absolute file share its keyspace and retention) and when the newest retained one was written. `never used` when none are retained. |
| **in use by {names}** | Live teammates currently bound to this soul in this workspace. |
| **AI-only** | Command-status badge meaning the soul is not `user-invocable`, so it has no slash command; the Lead can still spawn it with `agent_type`. All bundled souls start here until you opt in. |
| **Default** | This is the effective default Soul: the explicit selection, or the live catalog's `generalist` when no explicit selection exists. It is normally bundled, but a workspace-only or shadowing `generalist` also qualifies, including with `bundled: false`. Only one card carries it. |
| **Registered / Invalid name / No live Lead** | The other command-status badges: the workspace Lead's registry resolves the slash command to this soul's handler; the name cannot be a command (bad syntax, or the reserved `lead`); or no live Lead exists to check against. |

## Read-only cards

- **Plugin settings & runtime** — one combined card: plugin name and version, workspace root,
  configured soul directories (resolved), the **Use default agent souls** switch (the card's one
  live control — the toggle described under
  ["Page-level controls"](#page-level-controls-both-tabs)), bindings path with the stored-bindings
  count, advertised
  providers (or "The Host reports no providers."), command prefix (or "none"), default context,
  spawn providers (`fresh` / `fork`), definition/catalog budgets, the active scan time (or
  "never"), the live Teams and their registered soul commands (with member counts), and the
  delegation hint with its `spawn_teammate({ …, agent_type: "<name>" })` example. The footer note
  states that souls are plain Markdown with no separate database. This is where you confirm which
  workspace and files the page is editing. The live model catalog feeds the editor's Provider/Model
  dropdowns; it is not listed in this card.
- **Health** — definition count vs `maxDefinitions`, catalog character usage vs `maxPromptChars`
  (measured on the full catalog so over-budget pressure is visible), duplicate names, invalid
  files, scan diagnostics, and the **Team tool surface** composition. The composition warning
  appears only when the shipped `tool-agent-team` row is still active next to this bundle's row; it
  carries the one-line profile patch, and `manage_agent_souls({ action: "repair_team_tools" })` (or
  `claimTeamToolRow`) applies that override. On a profile where the Agent Teams bundle layer comes
  after this bundle (common when that bundle is added later), the bundled patch cannot disable the
  row; the persisted override is then the effective replacement — keep it while the bundle is
  installed. Clicking a scan diagnostic opens the named file in the
  editor when it matches a catalog document.

---

## Current limitations and safe recovery

- **Delete fails safe:** the trash path is fenced to the real workspace (or the real shared-state
  directory for an absolute `bindingsFile`) before any move. If the state path is unsafe (for
  example a symlinked `.dsh`/`.dsh/agent-soul` leaving the workspace), trash creation fails, or the
  no-replace move fails, the file is left in place, the operation reports `unsafe-path` or
  `invalid-request` naming the reason, and no `trashedFile`/Undo exists. There is no hard-delete
  fallback or opt-in; fix the path/symlink/permissions/device problem and retry. Packaged deletes
  still require `bundledEditable`.
- **Binding storage is fail-closed and repairable:** a missing document is an empty store. Every
  `get`/`list`/`size` re-reads the durable document, so an unreadable, corrupt, unsupported,
  unsafe-path, or partially malformed document is not answered without a re-read, even after an
  earlier healthy read. `get` refuses the whole document (partial malformed included); `list`/`size`
  reject a document-level failure and, for a partially malformed document, return the valid
  records/count with a warning. The only in-memory exception is this process's unpersisted local
  `set`/`delete` for that child in `get`; it is not durable, and `list`/`size` still reject an
  unusable document. `set`/`delete` refuse to rewrite untrusted bytes and preserve unrelated
  records/pending mutations; a malformed snapshot is refused with `E_BINDING_INVALID_RECORD`.
  Repair or replace the document externally and retry; the same store re-reads it without a Host
  restart. A typed admission reason names the case. A pruned binding still blocks that cold resume
  until re-spawn (newest 500 records per bindings document).
- **State paths:** a workspace-relative `bindingsFile` and its trash/restore paths must resolve
  inside the **real** workspace, not merely lexically; activation rejects an escaping `../` path, and
  reads/writes/deletes/restores refuse a symlinked `.dsh`, symlinked `.dsh/agent-soul`, dangling
  link, or document symlink that leaves it. Use an absolute path for intentional shared state, whose
  real state directory is the trash/document boundary and which shares its child-id keyspace and
  newest-500 retention. Migrate existing relative escapes—and escaping symlinked state paths—before
  activation. The real-path check and the following I/O are not one atomic operation; a racing
  replacement has the same TOCTOU class as the preferences/orchestrator fences.
- **Packaged names are guarded:** the shared document layer refuses a packaged save/create/
  duplicate/restore that would take another packaged document's name, across the GUI and
  `manage_agent_souls`; local-over-bundled shadowing remains valid. A genuinely duplicated packaged
  name is reported by the catalog diagnostic (one definition retained), not silently dropped. Clean
  up the extra packaged file if the diagnostic appears.
- **The bundled doctrine is prompt guidance:** it inherits the Lead's route when no
  `model`/`provider` is declared, lists only `pending`/`in_progress`/`completed`/`deleted` task
  states, and scopes its correction loop to `strict` with the configured `max-retries`; `advisory`
  and `off` report and continue. These are prompt instructions — no automatic retry driver or
  mechanical gate.
- **Orchestrator queue-failure recovery is best-effort:** the command reports the observed live
  state (reverted, kept, explicit fallback, inactive, or unconfirmed) and `/orchestrate off` retries
  a captured model restore. The handler-level tests use an in-memory Agent double, not a full real
  Host lifecycle; inspect the effective mode, doctrine, and route after a compound failure.
- **Verification scope:** no automated check renders the browser page or runs a full real
  orchestrator lifecycle; real providers/model quality and other OS/Node versions are unrun.
  Localization covers plugin chrome, not raw Host diagnostics/messages or file content. Baseline
  remediation needs an archived `QAS_BASELINE_DIR`. See
  [`../README.md`](../README.md#known-limitations).

## File mapping cheat sheet

| Editor location | Soul file | Orchestrator file |
|---|---|---|
| Identity → Name | `name` | `name` |
| Identity → Description | `description` | — |
| Routing → Tools | `tools` | `tools` |
| Routing → Provider / Model / Reasoning effort | `provider`, `model`, `reasoning-effort` | same |
| Routing → Context | `context` | — |
| Routing → User-invocable | `user-invocable` | — |
| Routing → Plan first / Gate mode / Max retries / Pause on fatal | — | `plan-first`, `gate-mode`, `max-retries`, `pause-on-fatal` |
| Body sections | `# Role Definition`, … | six canonical orchestrator sections |
| Advanced → Extra frontmatter | unknown YAML keys | — |
| Extra markdown | preamble body content (before the first canonical heading; the whole body when there is none) | extras: preamble, marker tail, noncanonical headings (moved after the canonical sections on save) |
| Bundled vs workspace | `agents/` in the package (read-only by default; editable in place with `bundledEditable`) vs the configured workspace `dirs` | `defaults/orchestrator.md` in the package (read-only by default; editable in place with `bundledEditable`) vs the workspace `<dirname(bindingsFile)>/orchestrator.md` |

## When an edit takes effect

| Edit | Effect |
|---|---|
| Soul field/section saved | Next `spawn_teammate` using that `agent_type`; also next `/command` invocation. Running teammates are not changed. |
| Bundled content (package upgrade) | The packaged souls (`agents/`) and doctrine (`defaults/orchestrator.md`) are read from the installed package; updating or reinstalling the bundle replaces them for workspaces using that package installation/profile — discarding any `bundledEditable` in-place edits — while local files still shadow the packaged copies. |
| Default Soul changed | Next `spawn_teammate` that omits `agent_type`; the page re-reads the overview so the **Default** badge and warning move immediately. A selection that is not in the live catalog makes the next default spawn fail with an actionable error — it never silently falls back to `generalist`. A malformed or corrupt preferences document likewise advertises no effective default and fails the default spawn with its diagnostic; fix or clear it in the selector, or pass an explicit `agent_type`. |
| Soul renamed | Old name stops resolving for spawn; the old file must be renamed or the new file saved under the new name (delete the old one via the dialog if needed). A command collision clears on the next catalog reconciliation (no Host reload). |
| Colliding soul deleted or renamed | The stale/failed command entry is dropped and reconciliation reinstalls remaining commands when their command signature (command name, Soul name, or description) changed; an unchanged signature skips reinstall. The page reconciles on the next overview or mutation, and command invocation refreshes the catalog; no Host reload is needed. |
| Soul marked invalid (`name: "lead"`, a bad field) | The file stays visible and editable, but it leaves the catalog, cannot spawn, and (if it was invocable) loses its command. Fix the named field and save. |
| Command prefix / dirs / bindings config changed | After a Host/bundle reload (the page shows the active values read-only). `bundled` follows the same rule; changing it changes whether the packaged catalog and doctrine apply in every workspace. |
| Orchestrator definition saved | Next `/orchestrate` enable or re-apply; not an already-running mode. A refused save writes nothing and leaves the previous definition in effect. |
| `/orchestrate` | A successful enable answers with the **ORCHESTRATOR MODE ACTIVE** block. A failed enable answers with the error. A failure before any state is touched leaves the mode unchanged; ordinary replacement failures attempt rollback and report `previousStateRestored`. Queue-failure recovery is best-effort and reports the observed live state (see the queue-failure row below). A pending enable counts as on in the normal durable fold, while `settledOnly` ignores it; if that first run later errors, the durable read is off. A successful enable renames the Session to `orchestrator` only when the profile provides a session-title service and the Session has a prior title to restore. Otherwise the block reports the title as unchanged, with the reason (`session-title service unavailable` or `no prior Session title to restore`). |
| `/orchestrate off` | The captured Lead model is restored first when it was captured in the same process (a restore failure leaves the mode active for an off retry), then the captured Session title is restored only while it is still exactly `orchestrator`, and then the doctrine sections and tool restriction are removed. After a Host reload, with no prior title, or when the profile has no session-title service, there is no captured title to restore. |
| `/orchestrate <task>` queue failure | A first enable is reverted when possible; a failed model restore stays live and reports `active=true, modelRestored=false` with the durable log folding off and `/orchestrate off` as the retry. An already-active mode reports an exact restore, a previous doctrine on the new route, an explicit fallback, an inactive result, or an unconfirmed result. These paths are best-effort and exercised with an in-memory Agent double, not full real-runtime integration. Retry `/orchestrate off`, inspect the Host log, and verify the effective state before continuing. |

For validation codes and their fixes see
[`../README.md`](../README.md#validation-and-fixes); for the route/payload contract see
[`GUI-INTERNALS.md`](GUI-INTERNALS.md).
