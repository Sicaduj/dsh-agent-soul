---
description: "Give every Agent Teams teammate a Markdown-defined soul — persona, tool permission matrix, routed model, and an optional user-invocable slash command — with soul-only delegation and a selectable default Soul, plus an optional session-scoped orchestrator doctrine. Both are editable in Settings → Agent Soul."
kind: "package-bundle"
---

# @local/dsh-agent-soul

An **Agent Soul** is one Markdown file with YAML frontmatter that tells DSH everything about a
delegated teammate: its identity, what it is for, what tools it may use, which model runs it, and
whether a human may invoke it directly. The body is the operating contract the teammate runs under.

This bundle is a soul-aware layer on top of the DSH 0.2.2 Agent Teams rows: the shipped
`tool-agent-team` row stays enabled and owns the task board/policy, while this package adds a
Team-only `spawn_teammate` plus the Lead's soul catalog. **Every** teammate it spawns runs a
defined Agent Soul:
`spawn_teammate({ ..., agent_type: "researcher" })` picks one explicitly, and omitting
`agent_type` uses the configured default Soul (the live catalog's `generalist`—normally the bundled
definition—unless another Soul is selected in **Settings → Agent Soul**). There is no plain
no-Soul `spawn_teammate` path: generic `subagent` / `subagent_fork` calls are denied for Team
members and their children are rejected at creation (a strict soul `tools:` list also hides them). A
**Settings → Agent Soul** page edits the Markdown definitions section by section, and an optional
**orchestrator definition** can give the Lead a stricter planning/delegation doctrine — but only in
a session where a human turns it on with `/orchestrate` (optionally as `/orchestrate <task>`, which
enables the mode and submits that task as the next message).

> **Tool surface in DSH 0.2.2-rc.3.** The base harness delegates with `subagent` (fresh context)
> and `subagent_fork` (inherited context); stock DSH has no `spawn_teammate`. This package adds
> `spawn_teammate` and `list_agent_souls` **only for a Team-enabled Lead**, because that is the
> only path that can bind a child to a defined Agent Soul. In a session where those tools are
> absent (Team mode off, or the plugin is not mounted), the stock `subagent`/`subagent_fork`
> tools are the valid delegation path; children started that way are ordinary Soul-less DSH
> subagents. Do not assume `spawn_teammate` exists merely because a soul document mentions it.

```
Agent Team (Lead, optionally the orchestrator)
├─ spawn_teammate({ ..., agent_type: "<name>" })                  ← explicit Soul teammate (plugin, Team mode on)
├─ spawn_teammate({ name, description, prompt })                  ← default-Soul teammate (plugin, Team mode on)
│    ├─ persona      body is added at the deployment-persona position (after a configured prefix line)
│    ├─ tools        `tools:` becomes a hard permission matrix for inherited tools
│    ├─ model        `model:` becomes the child's routed LLM model
│    ├─ context      `context:` picks fresh or fork as the default
│    └─ binding      persisted so a cold-resumed teammate keeps its soul
├─ subagent / subagent_fork                                       ← stock DSH 0.2.2 delegation; Soul-less
│                                                                    (denied + creation-fenced under this plugin's Team mode)
└─ /orchestrate [<task>] (optional)                               ← Lead doctrine, model, tool matrix, title
```

## Why use it

- **Consistent specialists.** A reviewer, researcher, or writer behaves the same way every time
  instead of becoming a vague copy of the Lead.
- **Real permissions.** `tools:` is enforced through DSH's scoped tool restriction, not just
  suggested in a prompt.
- **Platform-neutral tools.** A soul may name its shell tool as `bash` or `pwsh`. DSH registers one
  spelling per platform and the plugin resolves the declaration to the registered counterpart, so
  the same `tools:` list can be reused on a POSIX and a Windows session.
- **Right model per job.** Run cheap/fast models for routine work and a larger model for the work
  that needs it.
- **Optional human shortcuts.** A soul with `user-invocable: true` also becomes a slash command
  such as `/researcher`. The bundled souls are AI-only unless you opt in, so the default surface
  is the model alone.
- **Durable and inspectable.** Files are plain Markdown; the same page previews exactly what the
  teammate will receive, and bindings let a resumed teammate recover its soul.
- **Lead-level orchestration.** One optional orchestrator definition adds plan-first, gating, state
  tracking, verification, and recovery doctrine to the Lead — opt-in per session.
- **Works from any workspace.** The package ships its own soul catalog (`agents/`) and orchestrator
  doctrine (`defaults/orchestrator.md`). With the default `bundled: true`, a fresh installation
  already lists the bundled souls and `/orchestrate` works in every Lead session, in whichever
  workspace that session was opened; a local soul or workspace `orchestrator.md` shadows the
  bundled copy without extra configuration.
- **No soul-less delegation in Team mode.** The default Soul makes an unmatched task still run
  under a reviewable persona and tool matrix; every new or cold-resumed Team child must resolve a
  Soul plan or be refused, and generic `subagent` and `subagent_fork` calls are denied to Team
  members. Outside Team mode those stock tools remain ordinary DSH delegation and carry no Soul.
- **Visible activation.** A successful enable answers with an **ORCHESTRATOR MODE ACTIVE** block;
  a failed enable answers with the error. A failure before any state is touched leaves the mode
  unchanged (a failed first enable leaves it off). Ordinary replacement failures attempt to restore
  the previous doctrine and report `previousStateRestored`; queue-failure recovery reports the
  observed live state (reverted, kept, explicit fallback, inactive, or unconfirmed) and the
  `/orchestrate off` retry that restores a captured model. It is best-effort, not a guarantee of
  live/durable agreement; see [Turn it on and off](#turn-it-on-and-off) and
  [Known limitations](#known-limitations). A successful enable also
  renames the Session to `orchestrator` when the profile provides a session-title service and
  the Session has a prior title to restore; `/orchestrate off` restores the title you had before
  orchestration (unless you renamed the Session yourself). While the mode is on, the Session header
  carries an **Orchestrator mode on** badge whose title names `/orchestrate off`, so the active mode
  is visible outside the command transcript.

> **Upgrading from 0.1.** This release makes delegation soul-only, adds a selectable default Soul,
> and makes orchestrator activation explicit:
>
> - **No plain spawn.** A `spawn_teammate` call without `agent_type` now runs the configured default
>   Soul (the live catalog's `generalist`, normally bundled, unless another Soul is selected) and fails with an actionable
>   error when no default is usable. The selection is plugin state in
>   `<dirname(bindingsFile)>/preferences.json`, created on the first change; there is nothing to
>   migrate. A stale or malformed preference fails rather than silently using `generalist` — fix or
>   clear the selection in the page, or pass an explicit `agent_type`.
> - **Roster admission fails closed.** A new or cold-resumed roster teammate with no pending spawn
>   plan and no durable binding is refused rather than admitted with the deployment persona. At
>   plugin activation, a pre-existing live teammate in that state is skipped with a warning and gets
>   no Team tools; its publication already happened and cannot be vetoed.
> - **Generic children are closed.** Team members' `subagent` / `subagent_fork` calls are guarded
>   and children without a Soul plan are vetoed at creation; a strict soul `tools:` list also hides
>   both tools. A provider that mounts either tool later is denied by the same live guard. The
>   creation fence also vetoes provider-owned children that
>   other tools start through the same subagent seam — for example a workflow run's `agent()`
>   children — so generic child orchestration cannot run under a Team member; delegate with
>   `spawn_teammate` and a defined Soul instead. Non-roster children that are already live when the
>   bundle reloads are skipped rather than retrofitted; the veto applies to new creation.
> - **Orchestrator identity and title.** A successful `/orchestrate` now always answers with the
>   **ORCHESTRATOR MODE ACTIVE** block, prepends a fixed runtime identity to the definition's
>   **Identity & Boundaries** text, and renames the Session to `orchestrator` when the profile
>   mounts a session-title service and a prior title exists to restore. With no prior title the
>   runtime does not invent one; the block says so and the activation identity is still visible.
>   Existing definitions stay valid: their identity section can add boundaries but cannot remove the
>   runtime orchestrator role. `/orchestrate off` restores the prior title while it is still
>   exactly `orchestrator`; the internal Team target stays `lead`.
> - **The Team Lead's identity is reserved.** `lead` is no longer a valid Agent Soul name: the shared
>   parser rejects it with `name: "lead" is reserved for the Team Lead`, so a file with that name is
>   invalid and excluded from the catalog, and agent-tool save, GUI save, and spawn all refuse it
>   without writing or starting anything. `leadership`, `lead-review`, and `lead-2` remain valid.
> - **Built-in commands win name collisions.** `/orchestrate` is installed before soul commands on
>   every Lead, so a user-invocable soul named `orchestrate` cannot shadow it; the collision is
>   contained and reported by handler identity. Orchestrator definition saves also reject route
>   declarations that contradict themselves, and (when a live catalog exists) routes this deployment
>   cannot serve.

> **Upgrading from 0.2.** The bundled patch no longer sets workspace-relative `dirs`/`bindingsFile`;
> an installation is portable and uses the defaults documented under
> [Configuration](#configuration). `/orchestrate` now falls back to the packaged
> `defaults/orchestrator.md`, and the packaged `agents/` catalog is always scanned — opt out with
> `bundled: false`. Plugin-owned state moves from `<workspace>/state/` (used by the old bundled
> patch) to `<workspace>/.dsh/agent-soul/`; copy `state/bindings.json` there to keep existing
> cold-resume bindings, or restate the old paths in a profile patch.

> **Upgrading from 0.3.** 0.4.0 adds the opt-in `bundledEditable` authoring mode and changes
> nothing by default: the packaged souls and packaged orchestrator doctrine stay read-only unless
> you turn the mode on. The no-YAML way is the GUI toggle — the **Use default agent souls** switch
> in the **Plugin settings & runtime** card (Settings → Agent Soul), or the Plugins page
> (**Configure** on this bundle's `agent-soul-team` row → the **Use Default Agent Souls** page).
> The toggle writes the profile patch's row config (all other row keys preserved) and reloads the
> plugin once. To set the key in YAML instead, note that a profile patch that restates a row's
> `config` **replaces the whole config object** rather than merging into it, so when you add
> `bundledEditable: true` restate every key the row relies on — the shipped `freshProvider`
> and `forkProvider` values included — as in this complete row:

```yaml
- id: agent-soul-team
  name: '@local/dsh-agent-soul'
  config:
    freshProvider: spawn
    forkProvider: fork
    bundledEditable: true
```

Leave `bundledEditable` out (or set it `false`) to keep the 0.3 read-only behavior. See
[Configuration](#configuration) for the flag's scope and its risks.

**Release status (2026-11-08 UTC).** This authoring mode and its GUI controls — the **Use default agent
souls** switch, the Plugins-page **Use Default Agent Souls** page, and in-place editing of the
packaged catalog and doctrine — are merged to `main` and are part of 0.4.0 (PRs #4–#6, merged
2026-11-08 UTC; there are no git tags, so "released" means merged to the default branch). This date
refers to those merged feature changes, not to subsequent documentation edits. On a
0.3.0-or-earlier installation, the packaged souls and `defaults/orchestrator.md` are always
read-only and those controls do not exist — skip the `bundledEditable` paragraphs in this README.

**Working-tree scope (0.5.0).** This README documents the working tree whose manifest is `0.5.0`:
the DSH `0.2.2-rc.3` Agent Teams port. The plugin is now a soul-aware layer over the shipped
subagent-based Team tools rather than a replacement for the shipped Team row.

## Requirements and install

### Requirements

- **DSH `0.2.2-rc.3` or newer.** The plugin uses `ctx.subagents.startActivation`,
  `ctx.subagents.rootOf`/`namesOf`/`listDescendants`, and the base `tool-agent-team` row. The
  pre-0.2.2 roster API (`tryMembership`, `spawnTeammate`, `listMembers`) is gone and is not
  supported.
- The base **`@deepseek-ai/dsh-base`** composition in the same profile. It contains the
  `agent-team`, `tool-agent-team`, `subagent-spawn-in-process`, `subagent-fork-in-process`,
  and `tool-subagent-control` rows this plugin builds on. The old
  `@deepseek-ai/dsh-experimental-agent-team-profile` bundle no longer exists.
- The `agents`, `agentTeams`, `subagents`, `tools`, `systemPrompt`, and
  `sessionProjections` services. If `sessionProjections` registration fails, the failure is
  logged and the rest of the plugin still activates.
- The **Web** profile for Settings → Agent Soul. The Host tools work in headless profiles; only
  the page is absent. The Web profile also provides `connection` and its nested
  `connection.authentication` verifier; the GUI child injects both and uses
  `connection.admit({ headers, method, url })` for the exact-route trust fence (the pre-0.2.2
  `requestRejection` method is only a fallback).
- Node.js **>= 24.9.0**. The plugin has no dependencies and imports only `node:` builtins and
  its own relative files.

All five bundled souls currently inherit the Lead's route, so the bundled catalog needs no
additional provider:

| Soul | Route |
|---|---|
| `generalist` | No explicit route; inherits the Lead (bundled default Soul) |
| `researcher` | No explicit route; inherits the Lead |
| `adversarial-red-team-verifier` | No explicit route; inherits the Lead |
| `software-engineer` | No explicit route; inherits the Lead |
| `scribe` | No explicit route; inherits the Lead |

An unavailable explicitly configured provider/model makes only the affected spawn fail. Configure
the route in the destination profile or remove its `model`/`provider`/`reasoning-effort` fields
to inherit the Lead.

### Install and enable

This checkout is a **bundle**, not a separately running service. Installing it adds a self-contained
plugin: the bundled souls under `agents/` and the bundled orchestrator doctrine under
`defaults/` travel with the package, so an installation works from **whichever workspace** the
person happens to use.

```js
plugin_manager({
  action: "install_bundle",
  target: "/path/to/dsh-agent-soul",
})
```

The bundle's [`cordis.patch.yml`](cordis.patch.yml) **inserts** `agent-soul-team` and leaves the
shipped `tool-agent-team` row enabled. The base row owns `team_task_*` and the shared Team policy;
this plugin adds `spawn_teammate`, `list_agent_souls`, the Lead catalog, the soul-only guard, and
one user-invocable slash command per soul. Do not add a `tool-agent-team: disabled` override.

**Agent Teams mode is opt-in in DSH 0.2.2.** A new root Session starts with Team mode off unless the
profile sets `agent-team.defaultEnabled: true`. With Team mode off, `spawn_teammate` and
`list_agent_souls` are hidden, generic `subagent` tools work normally, and a soul slash command
fails with an actionable "Enable Use Agent Teams" message. Turn Team mode on in the Session model
menu before delegating.

**Upgrading from 0.4.x:**

- Remove the old `@deepseek-ai/dsh-experimental-agent-team-profile` bundle and the obsolete
  `interrupt`/`claimTeamToolRow` row keys. The new plugin accepts those keys with a warning and
  ignores them, but the profile should be cleaned up.
- Remove any legacy `- id: tool-agent-team` `disabled: true` override. The plugin reports it at
  activation; `manage_agent_souls({ action: "repair_team_tools" })` re-enables the row through the
  Plugin Manager, or remove the override from the profile patch manually.
- Existing bindings remain valid: they are keyed by the child Session id, which the new spawn path
  reserves and records unchanged.

After enabling or reinstalling, refresh the Settings page so the browser half loads. The Host half
(the tools, commands, and routes) activates with the bundle; the browser page is a client artifact
loaded by the Web shell. When working in the DSH source checkout, `pnpm run dev:web` is the watcher
that rebuilds client-plugin bundles; keep it running there for HMR. This package does not supply a
watcher, and none is assumed to be running. Without it, refresh after `client.js` changes. Changes to
the Host half need a profile/bundle reload; changes to the Web shell or plain packages need their
normal rebuild and page refresh.

### Project layout

Every folder this project owns sits inside the package directory. Nothing below `agents/` or
`defaults/` is required to live in a Session workspace: those two are the **bundled defaults** and
apply in every workspace. User content and plugin-owned runtime state live in the workspace instead.

```
dsh-agent-soul/                  ← the package (can live anywhere; no fixed workspace name)
├─ agents/                       ← bundled soul catalog (one Markdown file per soul)
│  ├─ generalist.md              · default general-purpose teammate (bundled default Soul), AI-only
│  ├─ researcher.md              · web research analyst, AI-only (/researcher after opt-in)
│  ├─ software-engineer.md       · implementation and debugging, AI-only (/software-engineer after opt-in)
│  ├─ adversarial-red-team-verifier.md · independent verification, AI-only
│  └─ scribe.md                  · documentation writer, AI-only
├─ defaults/
│  └─ orchestrator.md            ← bundled Lead orchestration doctrine used when a workspace has none
├─ lib/                          ← Host modules (see docs/INTERNALS.md)
├─ client.js                     ← Settings → "Agent Soul" page + Orchestrator header badge
├─ smoke/                        ← keyless end-to-end verification harness
├─ docs/                         ← maintainer contracts
├─ locale/                       ← package locale metadata (en, zh)
├─ cordis.patch.yml              ← profile patch (portable row config)
├─ index.js                      ← Cordis plugin entry
├─ package.json
└─ README.md

<workspace>/                     ← whichever workspace a Session was opened in
├─ .dsh/agents/                  ← optional local soul overrides (default `dirs`)
└─ .dsh/agent-soul/
   ├─ bindings.json              ← durable soul bindings for cold resume (plugin-owned)
   ├─ orchestrator.md            ← optional local Lead doctrine (overrides defaults/orchestrator.md)
   ├─ preferences.json           ← default-Soul selection (created on first change; plugin-owned)
   └─ trash/                     ← deleted files moved by a successful trash move; a failed move leaves the source in place
```

Local content wins: a workspace soul with the same name shadows the bundled copy, and a workspace
`<dirname(bindingsFile)>/orchestrator.md` overrides `defaults/orchestrator.md`. Configure different
soul directories with `dirs` — absolute, `~/…`, or relative to each workspace root — or a different
state anchor with `bindingsFile` — absolute or workspace-relative, with no `~` expansion (use an
absolute path or a path under each workspace). A workspace-relative state path and its `trash/` are
real-path fenced to the workspace, so a symlinked `.dsh` or `.dsh/agent-soul` cannot move state
outside it. See [Configuration](#configuration).

## Quick start

1. **Open the page.** In the Web GUI, open **Settings → Agent Soul**. You should see the bundled
   `generalist`, `researcher`, `software-engineer`, `adversarial-red-team-verifier`, and `scribe`
   cards, with `generalist` marked as the default while no explicit selection exists. Every bundled
   soul is AI-only, so the cards show the **AI-only** command status until you turn on
   **User-invocable** for one. Cards that come from the package rather than the workspace carry a
   **Bundled** badge and are read-only in place by default: use **Duplicate** to create an editable
   workspace copy (the configured `.dsh/agents` directory is created on demand). With the
   **Use default agent souls** switch on (config key `bundledEditable` — see
   [Configuration](#configuration)) the packaged cards open editable in place instead and carry no
   badge.
2. **Inspect one, then customize a copy.** Click `researcher`. The editor dialog shows each Markdown
   section separately, the tool matrix, the model route, and a live **"What the teammate will
   receive"** preview. By default the packaged documents are read-only, so **Save** is disabled on
   them (with **Use default agent souls** on they save back to the package instead — see
   [Configuration](#configuration)): click **Duplicate** to create an editable workspace copy (for
   example `researcher-copy`), which opens
   the saved copy in the editor. Edit it and click **Save**; the next spawn uses the file on disk.
   (You can also start from **New soul**.)
3. **Let the Lead delegate.** In a chat with an Agent Team, ask the Lead to research a question, or
   call the tool directly:

   ```js
   spawn_teammate({
     name: "research-release",
     description: "Research the current Harness release guidance.",
     prompt: "Research the current DSH release guidance. Return a cited briefing and state any uncertainty.",
     agent_type: "researcher",
   })
   ```

   The tool returns the member row plus `soul: { name, tools, model }`. When no Soul matches the
   task, omit `agent_type`; the configured default Soul is used. If no default is usable the spawn
   fails with an actionable error — it never starts a generic child.
4. **Opt in to a slash command (optional).** The bundled souls ship AI-only: none of `researcher`,
   `software-engineer`, `adversarial-red-team-verifier`, `scribe`, or `generalist` declares
   `user-invocable`. To invoke one yourself, duplicate it as described above, then turn on
   **User-invocable** (frontmatter `user-invocable: true`) on the workspace copy and save. The
   command is the copy's name, so a copy of `researcher` named `researcher-copy` registers
   `/researcher-copy` in the Lead session, for example:

   ```text
   /researcher-copy Find the current official DSH plugin compatibility requirements and cite the sources.
   /software-engineer-copy Fix the failing import and run the focused tests.
   ```

   The text after the command is the task. The teammate name is derived from the soul name and
   made unique against the roster (`researcher-copy`, `researcher-copy-2`, …). The command registers
   immediately; no Host reload is needed. An AI-only soul is still available to the Lead through
   `spawn_teammate({ ..., agent_type: "<name>" })`.
5. **Choose the default Soul.** In the **Souls** tab, pick a Soul in the **Default Soul** selector.
   The choice is stored atomically in `<dirname(bindingsFile)>/preferences.json`, validated against
   the live catalog, and shown as a **Default** badge. Selecting the bundled option clears the
   explicit choice, so the live catalog's `generalist` applies again when present (normally the bundled
   definition; a workspace-only definition also qualifies).
6. **Try orchestrator mode.** Open the **Orchestrator** tab and review the supplied doctrine — a
   fresh install shows the bundled default with a **Bundled** badge, so there is no file to create
   first (with **Use default agent souls** on the packaged doctrine is editable in place and
   carries no badge). Type `/orchestrate` in that session — or `/orchestrate <task>` to
   enable the mode and submit the task as the next message in one step. A successful enable answers
   with the **ORCHESTRATOR MODE ACTIVE** block; a failed enable answers with the error. A failure
   before any state is touched leaves the mode unchanged (a failed first enable leaves it off), and
   ordinary replacement failures attempt restoration and report `previousStateRestored`; queue-failure
   recovery is best-effort and reports the observed live state. See
   [Turn it on and off](#turn-it-on-and-off) and [Known limitations](#known-limitations). Type
   `/orchestrate off` to leave; the prior Session title
   is restored when the title service is available, the Session had a prior title, and you have not
   renamed it yourself.

## Core concepts

| Term | Meaning |
|---|---|
| **Lead** | The top-level Team agent that plans, delegates, and reports back. It is the only member that can start teammates. |
| **Teammate** | A delegated child agent. Every teammate runs one defined Agent Soul — explicit or the configured default — and no generic child is permitted. |
| **Soul** | One Markdown file under a configured soul directory: YAML frontmatter plus a body that becomes the teammate's system-prompt persona. |
| **Catalog** | The scanned, validated set of every `*.md` in the configured directories, plus the package's bundled `agents/` catalog when `bundled` is enabled (the default). The Lead sees a prompt catalog describing it; the GUI lists it. |
| **Binding** | A durable record in the resolved `bindingsFile` itself (default `<workspace>/.dsh/agent-soul/bindings.json`) associating a teammate's Session with the soul that shaped it. Preferences, orchestrator doctrine, and trash are siblings of that document. Used to re-apply the soul on cold resume (admission fails closed without one) and to show usage in the GUI. |
| **Default Soul** | The Soul used when `spawn_teammate` omits `agent_type`. Persisted in `<dirname(bindingsFile)>/preferences.json`; the live catalog's `generalist` is used when no explicit selection exists. This is normally the bundled definition, but a workspace-only or shadowing definition named `generalist` also qualifies, including with `bundled: false`; provenance is not required. A persisted selection must exist in the live catalog, or the default spawn fails; a corrupt, malformed, or unsupported preferences document is reported as a warning and invalidates the default — the default spawn fails rather than using `generalist`, while an explicit `agent_type` still works. |
| **Prompt section** | A named, ordered piece of the system prompt. A soul's persona is registered at the deployment-persona order, after the harness's configured deployment persona-prefix line; the Lead catalog and orchestrator doctrine are ordinary prompt sections. |
| **Permission matrix** | The soul's `tools` list, applied as a tool restriction to inherited (preset/global) tools. Team tools stay visible. |
| **fresh / fork context** | `fresh` starts the teammate without the Lead's history; `fork` starts it with the Lead's completed turns. The soul picks the default; an explicit tool argument wins. |
| **Route** | A concrete provider + model (+ optional reasoning effort), e.g. `deepseek-official/deepseek-flash`. A bare `model:` is resolved against the live provider catalogs. |
| **Orchestrator mode** | A session-scoped mode turned on with `/orchestrate` (or `/orchestrate <task>`, which enables the mode and queues that task as the next message); it applies the effective orchestrator doctrine — the workspace definition when present, else the packaged `defaults/orchestrator.md` — and its optional model/tool overrides to that session's Lead. |
| **Diagnostic** | A validation or scan message. Invalid soul files stay visible in the GUI with diagnostics; they are skipped by the catalog. |

## The Settings page

The plugin registers one Settings section, **Agent Soul** (`agent-soul`, order 30, after
Agent presets), with two tabs: **Souls** and **Orchestrator**. Every change is a direct file
write through the Host; there is no separate database. The page uses the Harness theme tokens and
ships eight locale dictionaries (`en`, `zh`, `ja`, `de`, `fr`, `es`, `ru`, `pt`). They localize the
plugin's UI chrome; Host diagnostics/messages and file content can remain untranslated.

### Souls tab

**Toolbar and list.** The toolbar has **New soul**, **Refresh**, **Paste Markdown**, and a scan line
(last scan, valid count, invalid count). The **Default Soul** selector sits above the list, with its
hint and warning banner. It offers a bundled-default option plus every valid Soul; a persisted
selection that is no longer in the catalog stays visible as `<name> (not in catalog)` so it can be
cleared. Choosing an option validates it against the live catalog, persists it through the
authenticated preference route, and re-reads the overview. The list supports free-text search over
name, description, source path, file name or absolute path, and label (not the Markdown body; the
placeholder says so in all eight dictionaries), filter chips (**All / User-invocable / AI-only /
Invalid**), and
**Name / Updated** sorting. Invalid files stay listed so they can be fixed in place. The warning
banner shows the Host's preference warning — a stale or unusable default, or a corrupt, malformed,
or unreadable preferences document. Until the document is fixed, no effective default is advertised
and a default spawn fails instead of starting a generic child; an explicit `agent_type` still works.

**Default Soul resolution.** A spawn resolves an explicit `agent_type` first, and that path does not
read the preferences document. Without `agent_type` the preferences document decides the default: a
persisted selection is used only when that name exists in the live catalog — a stale selection fails
the spawn and never falls back to `generalist` — while no explicit selection (a missing document, or
one cleared by selecting the bundled option) uses the live catalog's `generalist` when present. This
is normally the bundled definition, but any live catalog definition named `generalist` can supply it,
including a workspace-only or shadowing definition with `bundled: false`; provenance is not required.
When neither a selection nor a live `generalist` is usable, the default spawn fails with an actionable
error — there is no generic fallback. A corrupt, malformed, or unsupported preferences document is
reported as a warning and fails the default spawn with the reason; a document (or state directory)
that cannot be read at all fails the spawn with its path.

Each card can show:

| Badge / line | Meaning |
|---|---|
| **Valid / Invalid** | Whether the file parses and validates as a soul. |
| **Default** | The Soul `spawn_teammate` uses when `agent_type` is omitted (explicit selection, else the live catalog's `generalist`, normally bundled). |
| **N tools / All tools / No tools** | The permission matrix: `N` selected, `*` (inherit all), or `[]` (deny all inherited). |
| **Model: …** | The resolved route when it resolves, otherwise the raw `model:` value; the badge is absent when the soul inherits the Lead's model. |
| **Context: fresh/fork** | The soul's default spawn context. |
| **/name** | The registered slash command (only when the soul is user-invocable and this soul's own handler is registered; a name owned by another command shows **Command collision** instead). |
| **N saved · last used … · in use by …** | Durable bindings for this soul name, the newest binding time, and live teammates whose Session has a binding for it. |
| **Command status** | `Registered`, `AI-only`, `Invalid name`, `Command collision`, or `No live Lead` — see below. |

**Command status.** The status is a live check against the Lead for the workspace the page is
editing:

| Status | Meaning | What to do |
|---|---|---|
| **Registered** | The Lead's command scope resolves the command to this soul's own handler. | Nothing. |
| **AI-only** | The soul is valid but `user-invocable` is not `true`. | Set `user-invocable: true` and save if humans should invoke it. |
| **Invalid name** | The soul name or the prefixed command name cannot be a command. Soul names must be lower-kebab-case and cannot be the reserved `lead`; a command name may also contain `_` and `-`, but must start with a lowercase letter. | Rename the soul or remove the bad `commandPrefix`. |
| **Command collision** | The soul is invocable and a live Lead exists, but this soul's handler is not the registered one. Another command/global already uses the name (notably the built-in `/orchestrate`), or registration failed. | Rename the soul, or set a `commandPrefix` (for example `agent-`) so the command becomes `/agent-researcher`; a config change takes effect after the next Host/bundle reload. Deleting or renaming the colliding soul re-registers the remaining commands without a reload. |
| **No live Lead** | No live Team Lead / command service can confirm registration. | Open a Team chat in the workspace you are editing, then refresh. |

The status deliberately checks the Lead whose Session working directory matches the page's resolved
workspace root, so several live Sessions from different workspaces do not cause a false collision.
It is computed from handler identity, not from the name merely existing in the registry: a
user-invocable soul named `orchestrate` keeps its file valid, but the built-in `/orchestrate` is
installed first on every Lead and keeps the name, so the card reports **Command collision**. The
built-in `/orchestrate off` (also `exit`, `stop`, `disable`) requests a disable and never
starts a teammate; a failed disable (for example a model-restore failure) can leave the mode active
and reports the error. Set `commandPrefix: agent-` to make the soul command `/agent-orchestrate` while
`/orchestrate` stays built-in.

**Editor dialog.** Clicking a card opens a centered, resizable dialog (drag the corner handle; the
size is remembered per browser, with **Reset size**). It contains:

- **Identity:** name, description.
- **Routing & permissions:** tools picker built from the live tool catalog (or a comma-separated
  list under Advanced), model cascade (provider → model) from the live catalog, raw provider/model
  fields under Advanced, reasoning effort, context, and the user-invocable toggle.
- **Markdown sections:** Role Definition, Inputs You Will See, Hard Rules, Output Format, and Extra
  markdown, each in its own full-width textarea.
- **Advanced:** extra frontmatter lines, preserved verbatim.
- **Form / Raw:** switch between the form and the complete Markdown file. Raw mode validates the
  whole file before saving.
- **Preview:** a debounced, no-write **"What the teammate will receive"** panel showing the composed
  persona, resolved route, tool matrix, command status, and the exact prompt-catalog bullet, with
  copy buttons.
- **Paste / import:** paste a complete soul file, preview the parse, then import it into the
  draft or create a new soul.
- **New soul:** Blank, Researcher, Code reviewer, and Docs writer templates; the template is
  composed in the browser with the chosen name.
- **Duplicate:** copy the saved file under a new lower-kebab-case name.
- **Delete:** two-step confirm; the file is moved to the trash, and the status banner offers
  **Undo delete** only when that move succeeds. If the trash cannot be written or the move fails, the
  source file is left in place and the page reports the trash error; there is no hard-delete fallback
  or hard-delete opt-in. Fix the trash path, permissions, or device problem and retry.
- **Save / Revert:** Save validates first; Revert restores the last loaded file content. The sticky
  footer keeps all actions within reach while the form scrolls.

**Drafts and conflicts.** Unsaved edits are guarded in-page (Discard changes / Keep editing). A
Soul draft is stored in `localStorage` under `dsh.agent-soul.draft:<file>` with its form fields and
sections, the Form/Raw mode, the raw source when that mode is dirty, and the file hash the draft was
based on. Reopening offers **Restore draft / Discard draft** when the draft is newer than the file and
restores a raw draft into Raw mode; records written by older versions still restore as form drafts.
Orchestrator edits, New/Paste inputs, and Undo state are not restored. A Session-root change no
longer reloads or resets a dirty Orchestrator draft. Soul save sends the hash it loaded;
if the file changed on disk, the page shows a conflict banner with **Reload file** or **Overwrite**
instead of silently clobbering it. Field-level save errors appear under the matching control and in
the diagnostics block; the first invalid field is focused.

**Health card.** The runtime health block shows the definition budget (`maxDefinitions`), the
catalog-character budget (`maxPromptChars`, measured against the full rendered catalog), duplicate
soul names, invalid file count, scan diagnostics, and the **Team tool surface** composition. The
last one reports when the shipped `tool-agent-team` row is disabled, failed, or absent, because
DSH 0.2.2 needs that row for `team_task_*` and the base Team policy; it shows the one-line repair
(`manage_agent_souls({ action: "repair_team_tools" })` or removal of the legacy override). An
enabled row is the healthy state. Bars turn red past the limit; a scan diagnostic that names a file
opens it in the editor. Health is informative: it does not block saving.

**Plugin settings & runtime card.** Shows the workspace root being edited, resolved soul
directories, the **Use default agent souls** switch (status **On - packaged defaults are editable
in place**, **Off - packaged defaults are read-only**, or an unavailable status when `bundled:
false` or the profile cannot save the setting), bindings file and count, LLM providers, command
prefix, default context, spawn providers, scan limits, last scan time, live Team Leads with member
counts and their registered soul commands, and the delegation example. Everything but the switch
is read-only; changing the other values is a bundle configuration change. The switch is the
packaged-defaults edit mode (config key `bundledEditable`); the same toggle lives on the Plugins
page (**Configure** on this bundle's `agent-soul-team` row → the **Use Default Agent Souls** page),
and flipping it rewrites the profile patch's row config and reloads the plugin once. Both mounted
controls share one module-level state record: flipping either one updates the other, and a settled
write (verified or unverified) refreshes the overview, a clean Orchestrator draft, and a clean open
document; unsaved drafts and in-flight operations are never replaced. A control mounted later reads
the current state on mount. Only a read that shows the written value reports **Applied.**; polling
that ends without one reports **Saved, but the reload was not confirmed** (Unverified), so that label
is always an observation, not a promise. The normal Host write path validates and reconciles the
configuration; refresh or reopen a stale view after an unverified result.

### Orchestrator tab

The **Orchestrator** tab shows the single orchestrator definition:

- **Definition card:** file path, configured/not-created state, valid/invalid badge, a **Bundled**
  badge when the packaged `defaults/orchestrator.md` is the effective definition (with a hint that
  explains the fallback and that saving writes a workspace override — unless **Use default agent
  souls** is on, which edits the packaged file in place), and when
  configured: name, model, tools, plan-first, gate mode, max retries, and pause-on-fatal badges,
  plus diagnostics.
- **Activation hint:** applies only after `/orchestrate` (or `/orchestrate <task>`, which also
  submits the task) in chat; `/orchestrate off` exits; the mode is remembered per session. A
  successful activation always answers with the **ORCHESTRATOR MODE ACTIVE** block and renames the
  Session to `orchestrator` when the optional session-title service is available and a prior title
  exists.
- **Edit orchestrator** opens the same resizable dialog in orchestrator mode: six section textareas
  plus name/reasoning-effort/tools/plan-first/gate-mode/max-retries/pause-on-fatal fields and
  **Provider**/**Model** dropdowns fed by the live catalog (the same pickers as the soul editor,
  with an explicit *inherit* option that keeps the Lead's own route). Team tools in the tools list
  are called out as **always available and non-restrictable**, not flagged as unknown. There is no
  delete; the file is optional. By default, editing a bundled default and saving creates the
  workspace override at the shown path — the packaged asset itself is never modified; delete the
  workspace file to fall back to the bundled doctrine. With **Use default agent souls** on
  (`bundledEditable: true`) saving instead rewrites the packaged doctrine in place (a workspace
  file still wins — see [Configuration](#configuration)).
- **Create default orchestrator** composes a new definition in the browser and saves it, valid by
  construction. It appears only when there is no effective definition at all — no workspace file and
  no bundled default (for example with `bundled: false`). Three different sources of defaults exist
  in the code and they disagree, so the
  created file does **not** match the draft the editor showed beforehand:
  - the button itself writes `gate-mode: strict`, `max-retries: 2`, `plan-first: true`,
    `pause-on-fatal: true`, and `tools: *`, with its own English section prose;
  - the **Host skeleton** — the draft the **Edit orchestrator** dialog shows for a not-yet-created
    file — uses `gate-mode: advisory`, `max-retries: 3`, `plan-first: true`, `pause-on-fatal: true`,
    and `tools: *`, with different section prose;
  - a file that simply omits frontmatter keys parses to the omitted-field defaults listed in the
    **Orchestrator frontmatter** table below: `gate-mode: off`, `max-retries: 0`,
    `plan-first: false`, `pause-on-fatal: false`.

  Check the created file's `gate-mode` and `max-retries` afterwards and edit them if you want other
  values.

Saving the definition does not apply it to a currently active mode. It is read the next time the
mode is enabled (or re-applied after a Host reload / Lead creation). Ordinary Orchestrator saves do
not use the Soul editor's `expectedHash` conflict banner/overwrite flow; concurrent ordinary saves
are last-write-wins. The specific exception is packaged editing with `bundledEditable`: if a
workspace definition appears before publication, the save returns a 400 conflict and does not
overwrite the packaged file.

On a fresh installation the tab shows the packaged doctrine with a **Bundled** badge, so
`/orchestrate` works in any workspace without creating files. By default, save to copy it into the
workspace first if you want to customize it; delete the workspace file to return to the packaged
default. With **Use default agent souls** on (`bundledEditable: true`) the tab instead shows the
packaged file as the editable definition (no **Bundled** badge) and **Save** rewrites
`defaults/orchestrator.md` in place; a workspace `orchestrator.md` of your own always wins.

### Which workspace does the page edit?

The page edits one workspace at a time. The Web GUI pins one Session's workspace — the Session
currently in view, or the sole listed one in a single-workspace installation: the browser sends its
committed working directory, and the Host accepts it only when it is one of the live candidates
below. Without such a pin the Host chooses, most specific first:

1. a live top-level Session's committed working directory (teammates are skipped);
2. the deployment root captured at plugin activation;
3. `workingDirectory.defaultDirectory`, then `process.cwd()`.

Without a pin, the first candidate whose configured soul directories **exist** wins, falling back to
the first candidate — with no live Session, the deployment directory; a pinned root is used as-is.
The chosen root is shown in the settings card. This is
why a Harness process launched from an unrelated folder does not hide the files in the workspace you
are actually editing. Soul directories are resolved per workspace: a Team in another workspace
sees its own catalog until you make `dirs` absolute.

## Writing souls

Create one Markdown file per soul. The filename is irrelevant; `name` is the identity. The abridged
example below opts in to a `/code-reviewer` command through `user-invocable: true`; remove that key
to keep a soul AI-only (as every bundled soul is). For a complete bundled definition see
[`agents/researcher.md`](agents/researcher.md).

```markdown
---
name: code-reviewer
description: Reviews a diff and returns prioritized, actionable findings. Use when code has been written or modified and needs an independent correctness and risk review before it is reported done.
tools:
  - read
  - glob
  - grep
  - bash
model: deepseek-flash
provider: deepseek-official
context: fresh
user-invocable: true
---

## Role Definition

You are the Team's independent code reviewer. You report findings; you do not fix them.

## Inputs You Will See

The Lead's task message contains the change under review, the acceptance criteria, and optionally
surrounding system context. Work from the actual files and diff, not from the description alone.

## Hard Rules

- Do not modify source files, configuration, or tracked files.
- Every finding must name the exact file and line range and describe the failure mode.

## Output Format

Reply with `## Verdict`, `## Findings`, and `## Verified`.
```

### Frontmatter reference

The frontmatter parser is a strict YAML **subset**, not a full YAML implementation. It supports a
flat mapping of keys to plain/quoted scalars, booleans, numbers, flow lists (`[a, b]`), and block
lists (`- a`). It does **not** support block scalars (`|`, `>`), nested mappings, inline mappings
(`{}`), tabs for indentation, or multi-line plain scalars. Unknown keys are ignored by the catalog
and preserved by the GUI as extra frontmatter.

| Field | Required | Default | Rules and meaning |
|---|---|---|---|
| `name` | yes | — | Strict identity. Lower-kebab-case (`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`), at most 64 characters, unique per catalog. `lead` is reserved for the Team Lead: the parser rejects it with `name: "lead" is reserved for the Team Lead`, so such a file is invalid and excluded from the catalog, every save/create/duplicate path refuses it without writing, and spawn rejects it before any roster or binding change. `leadership`, `lead-review`, and `lead-2` remain valid. |
| `description` | yes | — | The orchestration trigger. Non-empty, at most 2000 characters, written as one YAML line. Keep it to "what it does + when to use it"; the Lead matches tasks by this text, and the catalog bullet truncates it to 600 characters on one line. |
| `tools` | no | inherit all | Permission matrix for inherited tools. Omit or `*` = inherit everything; a list (or comma-separated string) = allow exactly those inherited tools; `[]` = hide every inherited tool except the base Team collaboration/task tools, which are always kept. Names are tool names visible in the session, e.g. `read`, `grep`, `bash`, `web_search`. The shell tool is the one portable name: DSH registers it as `bash` on POSIX and `pwsh` on Windows, and a soul may name either spelling — an exact registration wins and the other spelling of the pair resolves to it, so the same list works on both platforms (every other name stays exact). **Do not list Team tools:** `send_message`, `list_agents`, `wait_agent`, `team_task_*`, and `interrupt_agent` (when enabled) are kept automatically; `spawn_teammate`, `list_agent_souls`, and `manage_agent_souls` are Lead-only/scoped and cannot be delegated. The GUI save validator and spawn both reject them. Generic `subagent`/`subagent_fork` are denied to Team members and also rejected in a soul list. |
| `model` | no | inherit Lead | A model id (`deepseek-flash`), a full route (`deepseek-official/deepseek-flash`), or an id resolved against the providers' advertised catalogs. Omitted = inherit the Lead's model. An unresolvable declaration makes the spawn fail; it does not make the file invalid. |
| `provider` | no | — | Provider route when `model` has no `provider/` prefix. If `model` already has a prefix, a different `provider` is a configuration error. |
| `reasoning-effort` | no | provider default | A provider/model reasoning effort id. Validated against the model when the LLM catalog advertises efforts; if it cannot be verified, a warning is logged and the route is used. Declare it **together with a model**: a soul carrying only `reasoning-effort` (no model) is refused at GUI save and fails at spawn; unlike the orchestrator definition, where effort-without-model is valid and ignored. |
| `user-invocable` | no | `false` | `true` also registers one human slash command for this soul on the Lead's session. The bundled souls omit this key, so they are AI-only until you opt in. |
| `context` | no | `defaultContext` (`fresh`) | Spawn context: `fresh` (clean context) or `fork` (inherits the Lead's completed turns). The fallback order is an explicit `context` argument to `spawn_teammate`, then this key, then the `defaultContext` config key. The GUI's "Not specified" maps to omitted. These are the only two runtime values — the editor offers "Not specified", `fresh`, and `fork`, and never writes a literal `none`. |

YAML tips:

- Quote values that start with `[`, `{`, `|`, `>`, `*`, or contain ` #`; otherwise the parser or
  comment stripper may read them differently.
- A blank key (`tools:`, `model:`) means "not set", not an empty string. Use `tools: []` to deny all
  inherited tools.
- Unknown keys do not make a file invalid; they are metadata only and never affect spawning or other
  behavior. GUI preservation in extra frontmatter does not make them behavioral. Use the known keys
  for behavior.
- Write `description` as one line — a recommendation, not a parser rule: the parser does not
  enforce single-line (a double-quoted scalar may contain escaped newlines) and the catalog
  collapses whitespace, while the YAML subset cannot express a multi-line plain scalar. Split long
  prose into a shorter trigger sentence here and put the detail in the body.

### Authoring tips

- **Name** is a public identifier: it appears in `agent_type`, the catalog, and the slash command.
  Keep it a stable lower-kebab-case noun (`code-reviewer`, `researcher`) rather than a task name.
- **Description** is the Lead's search key, not marketing copy. Lead with the trigger: what the
  soul does and the concrete situation in which to use it. Move instructions into the body.
- **Tools** should be the smallest set that lets the soul do its job. Do not list Team tools
  (the GUI rejects them); use the GUI picker so unknown names are caught before a spawn. The
  Lead-only `manage_agent_souls` is not part of a teammate's tool set either. Use `[]` for a
  soul that should reason and report but not touch the workspace.
- **Model** is optional. Omit it to inherit the Lead. Use a full `provider/model` route when the
  same model id is advertised by more than one provider or when the LLM service might be absent.
  Only set `reasoning-effort` to an effort the provider advertises.
- **Context**: prefer `fresh` for independent work; use `fork` only when the teammate genuinely
  needs the Lead's prior turns. `fork` history can contain tools the soul itself cannot call.

### Windows and PowerShell

DSH's shipped composition registers one shell spelling per platform: `bash` on POSIX compositions
and `pwsh` on Windows compositions. The one-shot and persistent variants of each family share that
model-facing name. An Agent Soul is platform-neutral, so its `tools:` list may name either spelling:

- an exact registration always wins — a session that registers `bash` gives a `bash` declaration
  the `bash` tool;
- when the declared spelling is absent, the plugin substitutes the registered counterpart, so
  `tools: [pwsh, read]` on a POSIX session grants `bash` and `read`;
- only this pair is aliased. Any other name is matched exactly, so a typo is still a typo.

The declared spelling is kept in the durable binding (the record stays platform-neutral and the
resolution happens when the soul is applied), and the teammate permission matrix and the
orchestrator tool matrix both restrict to the resolved live name — a `bash` declaration on a
Windows session becomes the `pwsh` tool. Spawn validation accepts a declared shell name whose
counterpart is live; genuinely unknown names, Team tools, and the Lead-only `manage_agent_souls`
are still rejected with the same messages.

In the GUI, when a live Lead catalog is available, the tool catalog advertises the missing
counterpart as a marked portable alias (an extra `{ name, description, portableAliasOf }` entry — see
[the catalog shape](docs/GUI-INTERNALS.md#host-overview-catalogs)), so both spellings appear as
normal chips, neither is flagged as unknown in the preview, and both save on either platform. No
bundled soul file changed for this: the definitions that declare a tool matrix keep `bash`, which
now resolves on a Windows session; `generalist` and `software-engineer` declare none and inherit
every tool.

The repeatable local verification is the optional `smoke/run-windows-parity.mjs` probe: on a
POSIX host it boots a real headless DSH profile with the `tool-bash` row disabled and a test-only
stand-in `pwsh` tool, then spawns a `bash`-declaring soul and asserts the child inherits `pwsh`. A
live Windows 11 Pro run on 2026-11-09 also exercised the path directly — on a session whose live
catalog exposed `pwsh` and no `bash`, all three reduced-matrix souls spawned and their children's
in-program bindings carried `pwsh` with no `bash` key — see
[Development and testing](#development-and-testing) for the evidence and for what the Windows run
did not cover.

### Body sections

The body is the teammate's operating contract. The four conventional sections are:

- **Role Definition** — the persona anchor: who the teammate is, what it owns, and what it does not
  do. It is applied at the deployment-persona position, after a configured deployment prefix line, so make it self-contained and authoritative.
- **Inputs You Will See** — what the Lead must pass in the task prompt (the question, the diff, the
  file paths, the acceptance criteria), and what to do when an input is missing.
- **Hard Rules** — concrete, checkable negative constraints and focus rules (what not to touch,
  what never to invent, when to stop).
- **Output Format** — the deterministic schema of the reply. Nested headings such as
  `## Findings` are fine inside this section.

The document layer recognizes `#` or `##` for these headings, case-insensitively; the GUI composes
`##`. Only the four canonical titles delimit sections. Any other heading remains content of the
current section (so output templates with their own `##` headings survive a save). Text before the
first canonical heading is the body preamble and appears as **Extra markdown** in the editor; the
composer writes it before the canonical sections. Sections are plain Markdown and may be empty.

The headings are a recommendation, not a validation requirement: a file with only a free-form body
is still a valid soul, and the whole body becomes Extra markdown in the GUI. Use the four sections
anyway — they keep the operating contract legible to both the model and the person editing it.

### Validation and fixes

A file is valid when it has a complete frontmatter block, `name` and `description`, a non-empty
body, and no YAML/type errors. Invalid files are skipped by the catalog but stay visible in the GUI.
Common messages and fixes:

| Message (shape) | Cause | Fix |
|---|---|---|
| `missing YAML frontmatter` | No opening `---` at the top. | Start the file with `---`; close it with `---`. |
| `missing closing "---"` | The frontmatter is never closed. | Add the second `---` before the body. |
| `body: missing markdown body` | Nothing after the frontmatter. | Add the operating contract, even a short one. |
| `name: must be kebab-case` | Uppercase, spaces, underscores, or a leading digit. | Use lower-kebab-case. |
| `name: "lead" is reserved for the Team Lead` | The file uses the Team Lead's reserved identity. | Choose another lower-kebab-case name; `leadership`, `lead-review`, and `lead-2` are valid. A file left on disk stays visible as invalid, is excluded from the catalog, and cannot spawn. |
| `description: missing required field` / `must be at most 2000 characters` | Missing or too long. | Add one trigger sentence; move detail into the body. |
| `tools: ...` | A list item is not a string, `*` is mixed with names, or a name is malformed. | Use a plain list of tool names, or `*`, or `[]`. |
| `context: must be "fresh" or "fork"` | Unsupported value (including `none` in raw YAML). | Use `fresh`/`fork`, or omit the key. |
| `user-invocable: must be true or false` | Quoted or otherwise non-boolean. | Use the bare YAML booleans `true` / `false`. |
| `duplicate soul name "x"` | Another file in the catalog already uses the name. Configured directories are scanned in their configured order, then the bundled catalog; files are sorted within each directory. The first definition wins, while a local same-name bundled shadow is intentional and silent. | Rename one file's `name`, or remove the duplicate. |
| `duplicate packaged soul name "x"` | Two files in the packaged `agents/` catalog declare the same name (for example a copied file). | Remove or rename the extra packaged file; packaged-target saves that would create this collision are refused. |
| `ignoring N soul definition(s) beyond maxDefinitions` | The catalog is over its configured limit. | Raise `maxDefinitions` or remove files. |
| Model or tool errors at spawn time | The file parses, but the model route or a tool name is not available in this session. | Fix the route/tool, or use the GUI preview and `list_agent_souls`, which show resolution. |

The GUI's save-time validator additionally rejects Team tools and the Lead-only `manage_agent_souls`
tool, unknown tools whenever the live Lead catalog is the source, duplicate names, and unresolvable
model declarations, so a fix made in the page does not wait until the next spawn to fail. A
live-but-empty catalog rejects every non-Team name; only a missing catalog (no live Lead, source
`none`) skips the unknown-tool membership check. The portable shell pair needs no special case: the
live catalog advertises the counterpart of the session's shell tool as a marked alias entry, so
both `bash` and `pwsh` are known names on either platform. Spawn remains the authoritative
validation boundary.

## Orchestrator mode

The Lead runs the profile's agent preset by default. An optional single **orchestrator definition**
can add an orchestration doctrine to the Lead and override its model and inherited tool matrix — but
only in a session where a human turns the mode on. It is never on by default, and it applies to that
session's Lead only; teammates continue to come from their own souls.

### Turn it on and off

```text
/orchestrate          # enable for this session (effective definition: workspace file or bundled default)
/orchestrate <task>   # enable and submit <task> as the next message
/orchestrate off      # disable (exit, stop, and disable also work)
```

The command is lowercase and registered only in a Lead's session. With no input it enables; a
trimmed off-word disables; any other input enables the mode and queues that text as the Lead's next
ordinary user message, so `/orchestrate <task>` starts the work in one step and records the task in
the session like any prompt you type. Every successful enable answer starts with a deterministic
**ORCHESTRATOR MODE ACTIVE** block naming the identity, definition path, resolved model (or
`inherit`), gate mode, retry budget, and title outcome. The Session title becomes exactly
`orchestrator` only when the profile mounts a session-title service **and** the Session already has
a title to capture; when the service is present but there is no prior title, the runtime does not
invent one, and the block reports `title: unchanged (no prior Session title to restore)`. Without
the optional service the enable still succeeds and the block reports
`title: unchanged (session-title service unavailable)`.
`/orchestrate off` restores the captured prior title only while the title is still
`orchestrator`, so a rename you make during the mode is left untouched. The Lead's displayed
identity changes to the session orchestrator, but the internal Team target remains `lead`. The task
is queued only after the doctrine, model, and tool matrix apply. If the queue fails, the command
reports the queue error plus the state it actually observed, and its recovery differs by path:

- A **first enable** is reverted when the disable succeeds: the error says `the mode was reverted`.
  If the model restore also fails, the live bundle and its model capture stay active (so
  `/orchestrate off` can retry) while the command settles as an error and the durable log reads off.
  The error then says `active=true, modelRestored=false`, states the live/durable disagreement, and
  names `/orchestrate off` as the recovery. If disable leaves the mode inactive, the error says
  `active=false`; if the live state cannot be confirmed it says `active=unknown` and asks you to
  inspect the Session before running `/orchestrate off`.
- An **already-active mode** is restored from a pre-invocation snapshot when possible. The error
  distinguishes an exact restore (`the already-active mode was kept`), a previous doctrine restored
  on the newly applied route (`active=true, modelRestored=false`, with the model-capture recovery
  that actually exists), a failed snapshot recreation that keeps the freshly applied doctrine/model
  as an explicit fallback (`fallback=true`), and no restorable state (`active=false`, naming the
  durable log and any model left on the new route). A Session title changed by the invocation is
  restored on each path when it still can be.
- A durably active mode with no live bundle (for example after a Host reload) had nothing to
  snapshot, so the newly applied definition is kept and reported as such.

These are best-effort recovery paths, not a guarantee that live and durable state agree. The
handler-level fault tests exercise them with an in-memory Agent double, not a full real Host
orchestrator lifecycle, so verify the effective doctrine, route, and mode after an unusual failure.
A failed enable before any state is touched — a missing or invalid definition (reported with the file
path), an unresolvable model route, or a failed tools probe — leaves the mode unchanged (a failed
first enable leaves it off). For an ordinary failure while replacing an active doctrine, the handler
rolls back to the previous doctrine when rollback succeeds (`previousStateRestored=true`), including
the model change attempted by the failed apply; if that rollback itself fails on this path, the mode
ends inactive (`previousStateRestored=false`) and the error says so. Queue-failure recovery is the
separate best-effort path described above.

The mode is durable through the **session command log**, so it survives a page reload, a Host
reload, or a resumed session. The normal fold walks runs in invocation order: a pending enable
counts as on, while a run that later settles as an error no longer counts (so a first enable then
reads off). The `settledOnly` pre-invocation read ignores pending runs and counts only successful
settlements. Consequently, a crash or reload during a pending enable can reapply the enable, and a
subsequent error can change the durable read; the command's reported live/durable state and the off
retry are the recovery evidence. It is not a profile default and does not affect any other Session.

While the mode is on, the Session header shows a compact noninteractive **Orchestrator mode on**
badge with a success dot; its title and accessible label say the mode is on and that
`/orchestrate off` exits. The badge is hidden in teammate and other child Sessions, and appears or
disappears as soon as the command log changes. It reads the Host's `agentSoulOrchestrator` session
projection, which is folded by the same pure logic as the durable runtime read in
[`lib/orchestrator-mode.js`](lib/orchestrator-mode.js), so the badge and the durable `/orchestrate`
mode read cannot disagree with each other. Neither alone proves the live bundle state after a
rollback failure; the command's rollback report is the evidence for that. If projection registration
fails, the plugin logs a warning and keeps the command and every other capability; only the badge is
absent.

### The definition file

There is exactly one writable workspace file, derived from the configured bindings file:

```text
<dirname(bindingsFile)>/orchestrator.md
```

With the default configuration that is `<workspace>/.dsh/agent-soul/orchestrator.md`. The workspace
file is optional. When it is absent and `bundled` is enabled (the default), the packaged doctrine
[`defaults/orchestrator.md`](defaults/orchestrator.md) is the effective definition — so `/orchestrate`
works immediately after installation, in any workspace. The GUI's Orchestrator tab shows that
doctrine with a **Bundled** badge and a hint; **Edit** loads it and by default saving writes the
workspace override at the path above (with **Use default agent souls** on — `bundledEditable: true`
— saving instead rewrites the packaged doctrine in place; a workspace file still wins). Delete the
workspace file to fall back to
the bundled default. Set `bundled: false` to require a workspace-owned file: `/orchestrate` then
reports the missing path
instead of enabling. The definition is read when the mode is enabled (or re-applied after a Host
reload / Lead creation); saving it from the GUI does not hot-apply it to an already-running mode.

```markdown
---
name: orchestrator
model: deepseek-v4-pro
provider: deepseek-official
reasoning-effort: high
tools:
  - spawn_teammate
  - send_message
  - list_agents
  - wait_agent
  - team_task_create
  - team_task_list
  - team_task_get
  - team_task_update
  - list_agent_souls
  - read
  - grep
plan-first: true
gate-mode: strict
max-retries: 3
pause-on-fatal: true
---

## Identity & Boundaries

Act as the central coordinator, planner, and routing engine. Do not execute domain tasks directly
when a capable teammate or tool exists.

## Plan Generation

Decompose the goal into ordered, verifiable steps; mark parallel versus dependent work; publish the
plan before the first execution step.

## Delegation & Context Minimization

Map every step to the soul or tool best suited to it. Pass only the inputs and upstream results
that step needs; never forward the whole history. Available souls:

{{catalog}}

## State Tracking

Keep the ledger on the Team task board (Pending / In Progress / Completed) and aggregate successful
outputs for later phases. Record failure evidence in the task description rather than inventing a
task status the board does not have.

## Quality Verification

Gate every completed sub-task against its success criteria before advancing. On failure, block the
workflow and start a correction loop.

## Exception & Recovery

Retry a failed sub-task at most {{maxRetries}} times with the error and refined context. On a fatal
error or exhausted retries, stop and ask the human.
```

The bundled doctrine is a valid starting point: it states that a declared `model`/`provider` route
is applied and that the shipped default (which declares none) inherits the Lead's selection; its
State Tracking section lists only the task board's `pending`, `in_progress`, `completed`, and
`deleted` statuses; and its strict-gate correction loop is scoped to `strict` gating and the
configured retry budget, with `advisory` and `off` reporting rather than blocking. These are prompt
instructions, not mechanical enforcement.

### Orchestrator frontmatter

| Field | Required | Default | Rules and meaning |
|---|---|---|---|
| `name` | no | `orchestrator` | Lower-kebab-case, at most 64 characters. Display identity. |
| `model` | no | inherit Lead | Same route rules as a soul. Omitted (with no `provider`) leaves the Lead's route untouched. A full route plus a different `provider`, or an empty model id after the slash, is rejected at save. |
| `provider` | no | — | Provider route when `model` has no prefix. A provider without a model is rejected at save and cannot be resolved at enable. |
| `reasoning-effort` | no | provider default | Optional effort id, passed to the route when a `model`/`provider` is declared. With both `model` and `provider` omitted the Lead's route is inherited and the effort is ignored — matching activation — so an effort-only inherited declaration stays valid. |
| `tools` | no | unrestricted | `tools:` omitted or `*` = leave the Lead's inherited tool set unchanged. A list = allow exactly those inherited tools. `[]` = deny every inherited tool. Registered Team tools stay visible; listing one is harmless (it is treated as non-restrictable), and a name that is unavailable in this session is skipped with a warning rather than failing the whole mode. |
| `plan-first` | no | `false` | Boolean; substituted into `{{planFirst}}` as doctrine. Does not mechanically force a plan. |
| `gate-mode` | no | `off` | `strict`, `advisory`, or `off`; substituted into `{{gateMode}}` as doctrine. |
| `max-retries` | no | `0` | Integer 0–10; substituted into `{{maxRetries}}`. This is a doctrine value, not a retry driver. |
| `pause-on-fatal` | no | `false` | Boolean; substituted into `{{pauseOnFatal}}`. |

The body is required and non-empty. All six sections are optional individually — empty sections are
skipped when applying — but the default skeleton includes all six. The file must be a regular `.md`
file in the state directory; a symlink that escapes that directory is refused.

**Save-time route validation.** Every save path — both GUI forms and
`manage_agent_souls({ action: "save_orchestrator" })` — validates the declaration before writing, and
a refusal writes nothing:

- a full `provider/model` route conflicts with a different `provider`
  (`model: soul model "provider/model" conflicts with provider "…"`);
- `provider` without `model` (`provider: soul "provider" requires "model"`);
- an empty model id after the slash (`model: soul model "provider/" has an empty model id`).

A `reasoning-effort` with **no** `model`/`provider` is not a save-time error: activation inherits the
Lead's route and ignores the hint, so long-lived inherited-route documents that only carried an effort
stay valid. Declare a model/provider to have the effort validated (live catalog) and applied.

When a live LLM catalog is available, the GUI and the agent tool add a second layer and also refuse a
well-formed route this deployment cannot serve, with the resolver's message. Without an LLM service a
complete `provider/model` declaration is still saved; enable succeeds only when deployment selection
can serve that route, and fails otherwise. An invalid existing file reports `valid: false` in the
Orchestrator tab and in the overview summary, which never
advertises a resolved model (`modelResolved: null`); activation keeps its fail-closed conflict error
and rollback.

### The six sections

Each canonical section is its own prompt section (except Identity, which is registered at the
deployment-persona order, after a configured prefix line). Write the doctrine as instructions to
the Lead; the variables are substituted at apply time.

| Section | What to put there |
|---|---|
| **Identity & Boundaries** | The Lead's role, authority, and what it must not do itself. It is applied at the deployment-persona position, after a configured prefix line, so be explicit about delegation and final ownership. |
| **Plan Generation** | How to decompose a goal, what a complete plan contains, when to publish it, and when to revise it. Use `{{planFirst}}` in the prose if the flag should alter the instruction. |
| **Delegation & Context Minimization** | How to match work to souls/tools, what context to pass, what to withhold, and how to use `{{catalog}}`. Prefer self-contained task messages. |
| **State Tracking** | How to use the shared task board: statuses, revisions, blockers, write scopes, and the compact result buffer. |
| **Quality Verification** | The gates a sub-task must pass before advancing; what evidence counts; what to do when a gate fails. Reference `{{gateMode}}`. |
| **Exception & Recovery** | Retry policy, fatal-error handling, when to stop and ask the human. Reference `{{maxRetries}}` and `{{pauseOnFatal}}`. |

### Template variables

| Variable | Substituted with |
|---|---|
| `{{maxRetries}}` | The parsed `max-retries` number. |
| `{{gateMode}}` | `strict`, `advisory`, or `off`. |
| `{{planFirst}}` | `true` or `false`. |
| `{{pauseOnFatal}}` | `true` or `false`. |
| `{{catalog}}` | The Lead's soul catalog prompt text from the last cached scan (empty when there are no valid souls). An explicit `/orchestrate` enable does not rescan external Soul edits; refresh/trigger a catalog scan first when that text must be current. |

Unknown `{{tokens}}` stay literal. A known variable whose value is missing/empty becomes an empty
string. Variables are substituted in all six sections and in extra markdown, not in the frontmatter.

### Extra markdown and headings

Content before the first canonical heading, content after an explicit `<!-- orchestrator:extra -->`
marker, and any other `#`/`##` heading (with the lines that follow it until a canonical heading
resumes) are preserved as **extra markdown**. The composer writes extras after the canonical
sections, so content is never lost, but its placement can change on the next read/save. Use `###` or
deeper for sub-headings that must stay inside a canonical section. The canonical titles accept
case-insensitive aliases such as `Identity and Boundaries`, `Planning`, `Delegation`, `State`,
`Verification`, and `Recovery`.

### What changes while the mode is on

| Area | Effect |
|---|---|
| Persona | The fixed runtime identity ("You are the ORCHESTRATOR of this session…") is always first; the edited **Identity & Boundaries** text is appended after it. Editing or emptying that section can add boundaries but cannot remove the runtime role or the delegation rule. The fixed delegation sentence follows the tools actually visible: `spawn_teammate` when the Agent Soul layer is active in Team mode, otherwise the stock `subagent`/`subagent_fork` path with no Soul binding. |
| Session title | Renamed to exactly `orchestrator` on a successful explicit enable when the optional session-title service is mounted and a prior title exists to restore; otherwise the title is left unchanged and the announcement says which reason applies. |
| Team identity / roster | `subagent:identity` (from `tool-subagent-control`) names the Lead and its peers. The Lead's model-facing tree name remains `lead`; the plugin does not add an orchestrator-specific roster row. |
| Prompt sections | Plan Generation (`TEAM_POLICY − 100`), Delegation (`+10`), State (`+20`), Quality Verification (`+30`), Exception & Recovery (`+40`), extras (`+50`). Empty sections are not registered. |
| Model | When `model`/`provider` is declared and resolves, the Lead's model is selected for the session. |
| Tools | When `tools` is a list, the Lead's inherited tools are restricted to the restrictable names in the list. The base Team collaboration/task tools are always kept, and the plugin's own scoped tools stay visible. |
| Team policy / catalog | The base task board stays enabled; this plugin's scoped `team:policy` shadow adds the soul-only rule, and the Lead-only soul catalog stays in place. |
| Teammates | Unchanged: each spawned teammate still gets its own soul, catalog bullet, permission matrix, and route. |

Plan-first, gating, retry counts, and pause-on-fatal are **prompt-level doctrine**: the model follows
them using the task board, `wait_agent`, and the other Team primitives. The plugin does not run an
automatic retry driver. Model selection and tool restriction are **enforced by the Harness**.

### Turning it off

`/orchestrate off` disposes the doctrine sections, extra sections, and the tool restriction, and
restores the model selection captured by the first explicit enable **in the same process**. It also
restores the captured Session title when the current title is still exactly `orchestrator`; a title
you changed yourself is preserved. With no prior title, enable never renamed the Session, so there
is no captured title to restore and no false title is left behind. If the profile mounts no
session-title service, there is likewise no captured title; a failed title restore is only a
warning and the mode still turns off (a failed **model** restore keeps the mode active for an off
retry). If the session was already in orchestrator mode after a Host
reload, the runtime did not capture the original route or title; disabling leaves them in place and
only removes the doctrine and tool restriction. This is a documented limitation, not a silent
promise.

## How prompting works

### Lead composition

When a Team Lead is active, its system prompt is assembled from these pieces, in order:

1. **Deployment persona prefix** — the harness's configured deployment persona line (for shipped
   profiles, for example "You are an AI agent powered by DeepSeek Harness."). While orchestrator
   mode is on, the fixed runtime orchestrator identity plus the definition's **Identity & Boundaries**
   text are added at that same persona position; they follow the deployment line rather than
   deleting it.
2. **Preset plugin sections** — the profile's normal agent preset (including its persona and other
   sections).
3. **Team policy** — `team:policy`, section order `TEAM_POLICY` (read from the Harness prompt
   service at registration time; 600 in the current Harness). In a Team member's scope this plugin
   registers the same section name, which shadows the base section: it keeps the shared
   filesystem/task-board guidance and adds the soul-only delegation rule. With Team mode off the
   scoped text is empty.
4. **Soul catalog** — `team:agent-souls`, order `TEAM_POLICY + 20` (620), Lead only and
   Team-enabled only. It is registered with a text function that reads the last cached catalog scan,
   so the next model step sees a saved change after the next scan without a restart. With no valid
   souls the text is empty.
5. **Team identity context** — `subagent:identity` from `tool-subagent-control`, required; names
   the Lead, each teammate, and how to address peers. The root's internal name remains `lead`.

While orchestrator mode is on, the five doctrine sections join this list at the orders described
above. The catalog and team policy remain.

The catalog is a plain prompt section, not a tool schema. Each entry is one bullet:

```text
- code-reviewer — Reviews a diff and returns prioritized, actionable findings. (tools: read, glob, grep, bash; model: deepseek-flash; command: /code-reviewer)
```

The `command:` value is `/<commandPrefix><name>` when the soul is user-invocable and `AI only`
otherwise. Entries are sorted by name and kept **whole**: `maxPromptChars` (default 12000) bounds
the section, and when entries do not fit the text ends with
`- (N more souls; call list_agent_souls)`. If no whole entry fits, the section is empty.
`maxDefinitions` (default 64) bounds how many valid definitions the catalog retains. The Lead is
told to match by `description` and never to invent a soul name.

### Teammate composition

A teammate's soul persona is registered at the deployment-persona position (a configured deployment prefix line is still emitted first):

```text
You are the delegated teammate "<name>".

<description>

The Agent Soul below is your system-level operating contract for this session. It is your
authoritative role definition: where it conflicts with the deployment persona or other generic
guidance, follow the Agent Soul, including its Hard Rules and Output Format.

<body>
```

The shared Team policy and Team identity context are still registered. The teammate's inherited
tools are restricted to the soul's matrix when one is declared (the Team tools remain visible
because they are own-scope registrations), and its model is selected from the resolved route. A
teammate sees no soul catalog section of its own. Every teammate also carries the soul-only tool
fence: `subagent` and `subagent_fork` are denied by a scoped guard, and a declared soul `tools:`
list also hides them from that teammate's inherited tool set. The guard follows the live tool
registry, so a provider that mounts either tool after the teammate was prepared is denied too.
There is no intentional no-Soul spawn path: a new or
cold-resumed roster teammate must resolve a pending spawn plan or a durable binding, and admission
is rejected (creation vetoed) when neither exists or the binding cannot be read.

The plugin's `agent/created` fence backs those layers: any child created beneath a Team member that
does not resolve as a roster teammate (and is not a seeded host fork) is vetoed before it can run.
That covers children created through the generic subagent seam as well as direct `subagent` calls,
so a tool that internally fans out generic children — a workflow run's `agent()` calls, for
example — cannot publish them under the Lead or a teammate; the child start fails, so that
`agent()` call rejects instead of returning a child.

### Slash commands

For every `user-invocable: true` soul, the plugin registers one command in the Lead's command
scope:

- Command name: `<commandPrefix><name>` (default prefix is empty, so `/researcher`).
- Description: `Start a "<name>" teammate: <first 120 chars of description>`.
- Input hint: `task for the <name> teammate`.
- Handler: spawns a teammate with that soul, using the text after the command as the task. It
  re-reads the catalog first, so a deleted or no-longer-invocable soul fails with a clear error.
  The teammate name is derived from the soul name and made unique against the roster.

Commands are scoped to the Lead: they shadow globals only for that agent and disappear with it.
After a soul-document mutation from the Settings page (or with `manage_agent_souls`), the plugin
reconciles that Lead's commands. Reconciliation reinstalls them when the command signature — command
name, Soul name, or description — changes; an unchanged signature skips reinstall. Each command
invocation also refreshes the catalog, so **no Host reload is needed for a new slash command to
appear** after reconciliation. A name collision is contained to that one command (the other commands
stay registered) and is reported as `Command collision` in the page.

Built-in commands are installed before soul commands on every Lead, so a user-invocable soul cannot
shadow `/orchestrate`: a soul named `orchestrate` keeps its file valid but loses the command name to
the built-in, and the page reports `Command collision` — computed from which handler owns the name,
not from the name merely existing in the registry. `/orchestrate off` (like `exit`, `stop`, and
`disable`) requests a disable and never starts a teammate; a failed disable (for example a
model-restore failure) can leave the mode active and reports the error. Deleting or renaming the colliding
soul clears the collision and re-registers the remaining commands without a Host reload; setting
`commandPrefix: agent-` moves the soul command to `/agent-orchestrate` and leaves `/orchestrate`
built-in (a config change takes effect after the next Host/bundle reload).

## Team tools

DSH 0.2.2 registers the base Team tool surface through `tool-agent-team` and
`tool-subagent-control`. This plugin no longer copies or replaces those tools; it adds only the
soul-aware delegation gate and catalog:

| Tool | Registered for | Purpose | Key parameters |
|---|---|---|---|
| `spawn_teammate` | Team-enabled Lead only | Create one durable teammate through `ctx.subagents.startActivation`. `agent_type` selects a soul explicitly; omitting it uses the configured default Soul and fails clearly when none is usable. The requested name must be unused among the Lead's direct children and not the reserved `lead`. | `name` (1-32 lower-kebab, starts with a letter), `description`, `prompt`, `context` (`fresh`/`fork`), optional `agent_type`. Returns `{ teammate: { name, id, description }, soul: { name, tools, model } }`. |
| `list_agent_souls` | Team-enabled Lead only | List every valid soul plus diagnostics (including cold-resume admission refusals with `source: "admission:<name>"`); `include_body` returns the full operating contract. | `include_body` (default false). |
| `manage_agent_souls` | Lead only (Team mode not required) | Manage the same Markdown files as the GUI. Actions: `list`, `get`, `save`, `create`, `delete`, `diagnose` (command registry, Team mode, and base-row status), `repair_team_tools` (re-enable a legacy disabled `tool-agent-team` row), `get_orchestrator`, `save_orchestrator`. | `action`, `file`, `name`, `source`. |

The stock DSH 0.2.2-rc.3 delegation tools are `subagent` (fresh child context; parameters
`description`, `prompt`, optional `cwd`, `name`, `provider`, `model`, `reasoning_effort`, and
`agent_preset` when configured) and `subagent_fork` (same shape, child inherits completed turns).
This plugin does not register either name. They remain the valid path when Team mode is off; a child
started with them is an ordinary DSH subagent and does **not** run a defined Agent Soul.

The base collaboration tools remain the model's coordination surface:
`send_message({ agent, message })` (agent name), `list_agents()` (no arguments),
`wait_agent({ timeout_ms })`, and the `team_task_*` compare-and-set board.
`interrupt_agent({ agent })` is present only when the base `tool-subagent-control` row enables it.
The plugin's soul permission matrix always keeps the base collaboration/task tools, even when a
soul's `tools:` list is a strict allow-list; the GUI explains them as kept tools.

Generic `subagent` and `subagent_fork` are not Team tools. A Team-enabled Lead or any soul
teammate is denied at the tool guard, and the plugin's `agent/created` fence rejects a local child
without a pending or durable Soul plan. A strict soul `tools:` list also hides the generic tools for
that child. Generic subagents under a non-Team root are ordinary DSH delegation and are allowed.

Registration is scoped: `spawn_teammate` and `list_agent_souls` are Lead-only and require Team
mode; `manage_agent_souls`, `/orchestrate`, and soul slash commands are installed on every root.
A soul command executed with Team mode off fails with an actionable message rather than starting a
child.

## Configuration

The bundled patch configures only what must match the Agent Teams setup and leaves every path at its
portable default:

```yaml
- id: agent-soul-team
  name: '@local/dsh-agent-soul'
  config:
    freshProvider: spawn
    forkProvider: fork
```

To deploy workspace-specific or shared content, restate `config` in a profile patch (or edit the
bundle patch) with the keys below; the row may also set `dirs`, `bindingsFile`, and the optional
limits explicitly. A profile patch's `config` for the row **replaces the whole config object**
rather than merging into it, so restate every key you rely on (including the shipped
`freshProvider` and `forkProvider` values):

```yaml
- id: agent-soul-team
  name: '@local/dsh-agent-soul'
  config:
    freshProvider: spawn
    forkProvider: fork
    bundled: true
    bundledEditable: false
    dirs:
      - .dsh/agents
    bindingsFile: .dsh/agent-soul/bindings.json
```

| Key | Default | Accepted values | Meaning |
|---|---|---|---|
| `bundled` | `true` | Boolean | Ship the package's own `agents/` catalog and `defaults/orchestrator.md` doctrine into every workspace. When true, a workspace with no local definition still lists the bundled souls and `/orchestrate` enables anywhere right after installation, without setup. Set `false` for strictly workspace-scoped content: the catalog then contains only configured directories, and `/orchestrate` refuses when the workspace file is absent. |
| `bundledEditable` | `false` | Boolean | Opt-in authoring mode for the packaged defaults. Requires `bundled: true`; with `bundled: false` the flag is inert and activation logs a warning. When `true`, the packaged `agents/` souls open editable in **Settings → Agent Soul**: **Save** rewrites the package's Markdown atomically, **Delete** moves the file to the workspace trash (Undo/restore work only after a successful move; a trash/move failure leaves the source in place and reports the error, with no hard-delete fallback), and labels stay package-relative; a workspace soul with the same name still shadows the packaged row (local-over-bundled shadowing remains valid, while a packaged target may not take another packaged soul's name), and new/duplicated souls still land in the configured `dirs`. The **Orchestrator** tab likewise edits the packaged `defaults/orchestrator.md` in place when the workspace has no `orchestrator.md` of its own (a workspace file always wins, and one that appears mid-edit makes the save fail with a conflict instead of clobbering it). The GUI toggles this key through the plugin's Loader row config: the **Use default agent souls** switch in the Agent Soul settings card and on the Plugins page (**Configure** on this bundle's `agent-soul-team` row → **Use Default Agent Souls**) writes the profile patch's row config (all other row keys preserved) and reloads the plugin once; the switch is disabled when `bundled` is `false` or the profile cannot save the setting. **Risks:** in-place edits land in the installed package directory and are lost if the package is reinstalled or updated; the packaged catalog and doctrine are shared by workspaces using that package installation/profile while bindings and trash stay per workspace. |
| `dirs` | `['.dsh/agents']` | Non-empty array of non-empty strings; absolute, `~/…`, or workspace-relative | Local soul directories per workspace. Missing directories are fine, and the GUI creates the first workspace-relative one on demand when saving a new soul. When `bundled` is on, the package catalog is appended after these directories and a local name shadows the bundled one. |
| `commandPrefix` | `''` | `/^[a-z0-9_-]*$/` | Prefix for human commands. `agent-` gives `/agent-researcher`. |
| `maxDefinitions` | `64` | Integer 1–1000 | Maximum valid definitions kept per root; extra valid files become a diagnostic. |
| `maxPromptChars` | `12000` | Integer 1000–200000 | Budget for the Lead's catalog section; entries are kept whole until the budget runs out. |
| `bindingsFile` | `.dsh/agent-soul/bindings.json` | Non-empty string; absolute or workspace-relative; no `~` expansion | Durable bindings are read from this resolved file itself; its directory anchors the trash directory, `orchestrator.md`, and `preferences.json`. A workspace-relative path is fenced to the **real** workspace root before any read or write: activation rejects a lexical `../…` escape with a `TypeError`, and the binding store/trash/restore resolve existing ancestors so a symlinked `.dsh` or `.dsh/agent-soul`, a dangling link, or a document symlink cannot move state outside the workspace. An absolute path is intentional shared state used verbatim for every workspace, with its real state directory as the boundary, sharing its child-id keyspace and newest-500 retention. **Migration:** an existing relative `bindingsFile` containing `../` must become a root-contained relative path or an absolute shared path before activation; a symlinked state path that escapes its real workspace must be replaced or pointed inside it. |
| `freshProvider` | `spawn` | Non-empty string | Registered `ctx.subagents` provider for fresh spawns (the shipped in-process provider is named `spawn`). |
| `forkProvider` | `fork` | Non-empty string | Registered `ctx.subagents` provider for fork spawns (the shipped in-process provider is named `fork`). |
| `defaultContext` | `fresh` | `fresh` or `fork` | Spawn context when neither the tool call nor the soul picks one. |

The obsolete `interrupt` and `claimTeamToolRow` keys are accepted for upgrade compatibility, logged
as obsolete, and ignored. The base `tool-subagent-control` row owns the interrupt tool, and the base
`tool-agent-team` row stays enabled.

The default-Soul selection is not a configuration key: it is user-editable plugin state in
`<dirname(bindingsFile)>/preferences.json`, written atomically by the Settings page or the
`POST /agent-soul/preferences` route and validated against the live catalog. With the default
configuration that is `<workspace>/.dsh/agent-soul/preferences.json`.

Unknown keys log a warning and are ignored; the two legacy keys above log an obsolete-key warning.
Invalid values fail activation with a message naming the key; there is no half-applied configuration. The Settings page shows the active values read-only
(except the **Use default agent souls** switch) because the plugin is plain JavaScript without an
interactive config schema. Change the row in
[`cordis.patch.yml`](cordis.patch.yml) (or restate its `config` from your profile's patch) and reload
the profile bundle. These values apply to all workspaces in that profile; relative paths resolve
against each workspace root.

## Durability and recovery

| Event | What happens |
|---|---|
| **Save a soul** | The file is written atomically, the catalog is rescanned, and the next `spawn_teammate` / command / list sees it. Running teammates are not changed. |
| **Catalog scan** | Runs at plugin activation for a Lead, when a Lead is created, on every soul spawn, `list_agent_souls`, command invocation, GUI overview, and GUI mutation. There is no filesystem watcher. `{{catalog}}` in an orchestrator definition uses the last cached scan; an explicit `/orchestrate` enable does not rescan external Soul edits. |
| **Cold resume** | The teammate's applied snapshot is read from the resolved `bindingsFile` itself (default `<workspace>/.dsh/agent-soul/bindings.json`) and its persona, tool matrix, and model are re-applied. Admission is fail-closed: a resumed roster teammate with no durable binding, or whose binding cannot be read, is refused rather than resumed Soul-less. The base `send_message` reports the shared lifecycle's generic `NOT_RESUMABLE` wrapper; the plugin makes the cause actionable elsewhere: the Host log records `agent-soul: cold resume refused for teammate "<name>": … (code SOUL_PLAN_UNAVAILABLE, reason …)`, and `list_agent_souls` returns the same cause under `diagnostics` with `source: "admission:<name>"`. The shared subagent lifecycle's generic `is unavailable` wrapper itself is unchanged. Every `get`/`list`/`size` re-reads the durable document, so a document that became unreadable, corrupt, unsupported, unsafe, or partially malformed after an earlier healthy read rejects with its typed reason instead of resuming the stale plan. `get` is the admission path and refuses a partially malformed document outright; `list`/`size` reject a document-level failure and, for a partially malformed document, return the valid records/count with the warning. The only in-memory value served while the document is unusable is this process's unpersisted local `set`/`delete` for that child; it is not durable. The store retains the newest 500 bindings per bindings document (workspaces sharing an absolute file share its keyspace and retention); a pruned record blocks that resume (re-spawn the teammate). A snapshot that cannot be represented as a valid record is refused with `E_BINDING_INVALID_RECORD` instead of poisoning the document. |
| **Plugin activation** | A pre-existing live teammate with no pending or durable Soul plan is skipped with a warning and gets no soul surface; its creation already happened, so it cannot be vetoed. The warning carries the Soul-specific reason, and the refusal is also recorded for `list_agent_souls` diagnostics. New teammates and cold resumes are vetoed in `agent/created` instead. |
| **Member installation failure / host safety** | Only plan resolution (`SoulPlanUnavailableError`) vetoes creation. Agent disposal, creation cancellation, plugin teardown, and unexpected post-plan apply failures are logged skips after every partial registration (soul surface included) is unwound. The shared installation task is internally observed, so an abandoned caller cannot turn a failure into a process-fatal unhandled rejection. A skipped teammate can be re-spawned to repair it. |
| **Default Soul** | Persisted in `<dirname(bindingsFile)>/preferences.json`. A missing document means no explicit selection (the live catalog's `generalist`, normally bundled, applies when present); a stale selection, or a corrupt/malformed/unsupported document, invalidates the default and fails the next default spawn with the reason. A document (or state directory) that cannot be read at all also fails the spawn with its path. Explicit `agent_type` bypasses the preference document. |
| **Orchestrator title** | The Session title is durable in the Session log (`session/title`). Enable renames it to `orchestrator` only when the session-title service is available and a prior title exists to restore; off restores the captured title only while it is still exactly `orchestrator`. With no prior title nothing is renamed and nothing is restored. |
| **Host reload / bundle toggle** | The plugin is re-created; the catalog and preferences are read from disk again; active orchestrator mode is re-applied from the session log without re-capturing the previous model or Session title. |
| **Page refresh** | The browser artifact reloads. A Soul draft persists its form fields/sections, Form/Raw mode, raw source, and base file hash; dialog size also persists. Orchestrator edits, New/Paste inputs, and Undo state are not restored, so save those before reloading. A later Session-root association no longer replaces a dirty Orchestrator draft. |
| **Delete a soul** | The file moves to `<dirname(bindingsFile)>/trash/<YYYYMMDDTHHMMSSmmmZ>-<original filename>` (a `<pid>.<counter>-` suffix is added on a name collision); **Undo delete** moves it back. The trash path is fenced to the real workspace (or the real shared-state directory for an absolute `bindingsFile`) before any move, so a symlinked state path cannot place a deleted soul outside that boundary. If the trash directory cannot be created, the move fails, or the state path is unsafe, the source file is left in place and `deleteDocument` returns an `invalid-request`/`unsafe-path` failure naming the reason; no `trashedFile` is reported, no Undo is offered, and there is no hard-delete fallback. |
| **Switch workspace** | Soul directories, bindings, and the writable orchestrator definition resolve per workspace. The GUI edits one workspace at a time and shows which root it chose. The packaged catalog and doctrine are the same in every workspace unless `bundled: false`; local files shadow them per workspace, and with `bundledEditable: true` an in-place edit of a packaged file is shared by every workspace in the profile (bindings and trash stay per workspace). |
| **Orchestrator mode** | Derived from the session command log, so it survives a page/Host reload and is reapplied when the session's Lead is created. A pending enable counts as on in the normal fold but is excluded from the `settledOnly` pre-invocation read; a later error can make a first enable read off. It is never a profile default. See [Turn it on and off](#turn-it-on-and-off) for crash/reload behavior and the best-effort queue-failure recovery report. |

The GUI keeps these browser-only values: a Soul draft under `dsh.agent-soul.draft:<file>` (form
fields/sections, Form/Raw mode, raw source, base hash) and the editor size under
`dsh.agent-soul.editor-size`. Orchestrator edits, New/Paste inputs, and Undo state are not restored.
They are not shared with other browsers.

## Troubleshooting

| Symptom | Check | Fix |
|---|---|---|
| **Settings → Agent Soul is missing** | Is the profile a Web profile? Is the bundle enabled? Did the page load after enabling? | Enable the bundle on the Plugins page, then refresh the page. In headless/SDK/ACP profiles the page is intentionally absent; the agent tools still work. |
| **The page loads but lists no souls** | The workspace root shown in the settings card; the `bundled` config value; resolved `dirs`; whether one exists in that workspace. | With `bundled: true` (the default) the five packaged souls always appear (possibly shadowed by local files). If the list is empty, `bundled` was set to `false` and no `dirs` entry exists for this workspace — create the configured directory, point `dirs` at absolute paths, or re-enable bundled defaults. Press **Refresh**. |
| **A file is valid but the Lead never chooses it** | Its `description`; the Lead's catalog budget; whether the Lead is in a different workspace. | Write "what + when" in the first sentence. Check `maxPromptChars` / `maxDefinitions` and the health card. Use absolute `dirs` if workspaces differ. |
| **Spawn says `unknown agent soul`** | The exact `name`; catalog scan diagnostics; duplicate names. | Use a name from `list_agent_souls`. Fix the file's diagnostics. Rename one of the duplicates. |
| **A soul file is invalid with `name: "lead" is reserved for the Team Lead`** | The file uses the Team Lead's reserved identity. | Rename the file and its frontmatter `name`; `leadership`, `lead-review`, and `lead-2` are valid. An invalid file on disk stays visible in the page but is excluded from the catalog and cannot spawn. |
| **Command status is `Command collision`** | Whether another command already uses the prefixed name — notably the built-in `/orchestrate`, which always wins — the live Lead for this workspace, and the registration reason returned as `command.reason` by the preview. | Rename the soul or set `commandPrefix` (e.g. `agent-`) and reload; deleting or renaming the colliding soul clears it without a Host reload. The Lead can run `manage_agent_souls({ action: "diagnose" })` for the registry view. |
| **Command is missing or says AI-only** | `user-invocable`; the command-name syntax; whether a live Lead exists; the page's command status. | If the soul is a packaged default (read-only unless **Use default agent souls** is on), **Duplicate** it first; then set `user-invocable: true` on the workspace copy, use a lower-kebab-case name/prefix, open a Team session, refresh. |
| **`/orchestrate` is not found** | You are in a Lead session (not a teammate); the plugin is active; the command is lowercase. | Use `/orchestrate` in the Team's chat. Teammates do not receive the command. |
| **`/orchestrate` says no definition** | The path shown; the settings card's `bundled` value and bindings file; whether the package's `defaults/orchestrator.md` was installed. | With the default `bundled: true` this should not happen in a complete install: the packaged default is used. If it does, the package asset is missing (reinstall the bundle) or `bundled` is `false` — create the file at the shown path from the Orchestrator tab, restore the bundled asset, or re-enable bundled defaults. |
| **The Orchestrator tab shows a Bundled badge** | That is expected on a fresh install: the effective doctrine is the package default (with **Use default agent souls** on there is no badge and the packaged file itself is the editable path). | By default, save from the editor to create a workspace override at the shown path; delete that file (or the plugin's saved copy) to fall back to the bundled doctrine. With **Use default agent souls** on (`bundledEditable: true`), **Save** rewrites the packaged doctrine in place. |
| **A soul card shows a Bundled badge and the editor will not save** | By default (**Use default agent souls** off, `bundledEditable: false`) packaged souls are read-only package assets. | Use **Duplicate** in the editor to create an editable copy under the configured workspace `dirs` (created on demand). To edit packaged souls in place instead, turn on **Use default agent souls** — the switch in the Agent Soul settings card, or the Plugins page (**Configure** on this bundle's `agent-soul-team` row → **Use Default Agent Souls**) — or set `bundledEditable: true` (with `bundled: true`) in the row config and reload; see [Configuration](#configuration) for the package-directory and shared-catalog risks. A local soul with the same name shadows the bundled card. |
| **`/orchestrate <task>` enabled the mode but no task ran** | The command result text and Host log; queue-failure recovery is best-effort and reports the observed live state (reverted, kept, explicit fallback, inactive, or unconfirmed). The handler-level fault tests use an in-memory Agent double, not a full real Host lifecycle. | Send the task as a normal message after `/orchestrate`. If the error reports `active=true` or `active=unknown`, retry `/orchestrate off` to restore a captured model and inspect the Host log; reload/reopen only if the state remains unclear, then verify effective mode, doctrine, and route. |
| **Orchestrator definition is invalid** | Diagnostics in the Orchestrator tab: gate mode, retries, booleans, model/provider (a conflicting route, provider without model, an empty model id), body. A `reasoning-effort` alone is ignored at enable and is not an error. | Fix the named field. Invalid saves write nothing; the mode stays off or keeps its previous state. |
| **Model is unresolved** | The raw model/provider and the live providers; whether the `llm` service is available. | Use a model id the providers advertise, or write the full `provider/model` route. A different `provider` plus a prefixed model is an error. |
| **A tool is not allowed / tools list is rejected** | The name is visible in the live Lead's catalog; it is not a Team tool. | Use the GUI picker or `list_agent_souls`; remove Team tool names from soul `tools`; use `*` or `[]` deliberately. |
| **YAML errors in the editor** | Tabs, block scalars, nested mappings, inline mappings (`{}`), malformed flow lists, a description wrapped across plain lines (the subset has no multi-line plain scalars). | Use the supported YAML subset; quote tricky scalars; keep the description on one line (recommended, not enforced). |
| **A new file does not appear** | There is no filesystem watcher. | Press **Refresh** in the page, or trigger a spawn/list/command (each rescans). |
| **The page shows an unexpected-payload error card** | The Host overview response and Host log; a stale Web artifact. | Refresh/retry. A 200 overview missing the documented blocks is reported as an `invalid-response` error card (with the last good rows kept), never as an empty catalog or a stuck skeleton. Rebuild/refresh the Web artifact if it persists. |
| **Delete reports "cannot move the document to the trash directory" or `unsafe-path`** | The trash path under `<dirname(bindingsFile)>/trash`, its permissions, free space, whether the workspace and trash are on different devices, and whether the state path is a symlink that leaves the real workspace. | The source file is still there and was not deleted. Fix the path, permissions, device, or symlink problem and retry the delete; there is no hard-delete opt-in. |
| **Activation fails with `config.bindingsFile must be an absolute path or a workspace-relative path that does not escape the workspace`** | The row config's `bindingsFile`. | Change the relative path to stay inside each workspace root, or make it absolute for intentional shared state, then reload/restart. A symlinked `.dsh`/`.dsh/agent-soul` that leaves the real workspace is refused at read/write/delete/restore time; point it inside the workspace or use an absolute shared path. |
| **Soul save conflict (409)** | The file changed on disk since it was loaded. | **Reload file** to discard local edits, or **Overwrite** to save with the current server hash. |
| **Orchestrator save conflicts** | Ordinary Orchestrator saves have no Soul-style `expectedHash` banner/overwrite flow and are last-write-wins. With `bundledEditable`, a workspace file appearing while the packaged file is edited returns a 400 conflict instead of clobbering it. | Refresh/reload the Orchestrator definition and save deliberately; do not expect the Soul conflict dialog for ordinary Orchestrator saves. |
| **`/orchestrate off` did not restore the model or title** | The mode was already on after a Host reload, so the runtime has no captured original route/title; the Session had no prior title at enable; you renamed the Session during the mode; or the profile mounts no session-title service. | Expected limitation: select the model again, or rename the Session. The pre-reload route cannot be recovered, a human rename is deliberately preserved, and with no prior title or no title service nothing was renamed to restore. |
| **`spawn_teammate` fails with "no usable default Agent Soul"** | The Souls tab warning; the Default Soul selector; whether the selected Soul file still exists and is valid. | Select a valid default, create `generalist.md` in the configured soul directory (default `<workspace>/.dsh/agents/generalist.md`), or pass an explicit valid `agent_type`. The spawn refuses to start a generic child. |
| **`spawn_teammate` fails with "selected default Agent Soul … is not in the live catalog"** | The stored selection vs. the current catalog. | Pick an existing Soul in the Default Soul selector; a stale explicit selection never silently falls back to `generalist`. |
| **`spawn_teammate` fails with "the preferences document is invalid"** | The warning in the Souls tab and the malformed selection/shape in `<dirname(bindingsFile)>/preferences.json` (default `<workspace>/.dsh/agent-soul/preferences.json`; for example `selected: 42`, a non-kebab-case name, or a missing `selected` key). | Fix or clear the selection in the Default Soul selector, or pass an explicit `agent_type`; a malformed document is never reinterpreted as `generalist`. |
| **`spawn_teammate` fails with a duplicate-name error** | `ctx.subagents.startActivation` refuses a name already used among the Lead's direct children; direct spawn never renames on your behalf. | Choose a fresh 1-32 character lower-kebab-case name. Slash commands derive a free name automatically (`<soul>`, `<soul>-2`, …). |
| **`spawn_teammate` fails with `a soul spawn for this Lead and teammate name is already pending`** | A spawn for the same Lead and requested name is still in flight; the plugin refuses the duplicate before it reaches the Team service. | Wait for the first spawn to settle, or choose a different name. |
| **A cold-resumed teammate fails with the generic "subagent … is unavailable" (`NOT_RESUMABLE`)** | The resolved `bindingsFile` itself (default `<workspace>/.dsh/agent-soul/bindings.json`) and its newest-500-per-document cap; whether the teammate was created through `spawn_teammate`; the Host log line containing `SOUL_PLAN_UNAVAILABLE`; `list_agent_souls` diagnostics with `source: "admission:<name>"`. | Re-spawn the teammate with `spawn_teammate`; cold-resume admission is fail-closed rather than Soul-less. The base `send_message` reports the shared lifecycle's generic wrapper, so read the plugin log or `list_agent_souls` for the typed cause (`missing-binding`, `unreadable-binding`, `corrupt-binding`, `unsupported-binding`, `unsafe-binding-path`). Every `get`/`list`/`size` re-reads the durable document; `get` rejects a partially malformed document, while `list`/`size` return valid records with a warning. Repair or replace the document externally (or fix the path), then retry. |
| **The log says member installation was `SKIPPED after an unexpected failure` or `cancelled`** | The error and teammate identity in the warning. Partial soul-surface and Soul registrations were unwound; the host stays alive, but this teammate may be running without its Soul effects. | Re-spawn the teammate. For a cancellation, retrying creation or resume is enough. For an unexpected apply failure, preserve and report the warning line if it recurs. Only a missing/unreadable Soul plan is an intentional creation veto. |
| **A `subagent` / `subagent_fork` call is denied** | The caller is a Team-enabled Lead or a soul teammate, so the soul-only guard denies the call; the tools may still be visible when the soul inherits all tools. | Use `spawn_teammate` with a valid `agent_type`, or omit it to use the default Soul. Generic children are rejected at creation even if the tools are invoked indirectly. |
| **A workflow run's `agent()` calls fail inside a Team session** | The `agent/created` fence: provider-owned children under a Team member are vetoed, so the child start fails. | Delegate with `spawn_teammate`; generic child orchestration (workflow children included) does not run inside a Team session. |
| **`spawn_teammate` and `list_agent_souls` are missing** | Whether Team mode is on in the Session model menu; whether this package is mounted; `manage_agent_souls({ action: "diagnose" })`. Stock DSH 0.2.2 has no `spawn_teammate` at all; the plugin adds it only to a Team-enabled Lead. | If you need a defined Soul, turn on **Use Agent Teams** in the Session model menu and retry. If you only need ordinary delegation, use the stock `subagent` (fresh) or `subagent_fork` (inherited) tool; its child will not run a defined Agent Soul. |
| **The health card warns that the base Team row is disabled** | `manage_agent_souls({ action: "diagnose" })` and any legacy `- id: tool-agent-team` `disabled: true` override. The base row owns `team_task_*` and the shared Team policy, not the plugin's spawn tool. | Run `manage_agent_souls({ action: "repair_team_tools" })` or remove the override from the profile patch and reload. Do not disable the base row to "make room" for this plugin. |
| **Config change has no effect** | The profile still has the old row; the page shows read-only active values. The two `bundledEditable` switches share one state record, and a settled write refreshes the overview and clean editor views. Polling reports **Applied.** only after a read shows the written value; otherwise it reports an unverified result. | Edit the bundle/profile row and reload the bundle; restart if the profile manager keeps the old row. If the switch reports an unverified result, reload the page or reopen the view and inspect the effective flag; that status is not success. |

## Known limitations

- **The base Team row must stay enabled.** This plugin no longer disables or replaces
  `tool-agent-team`. A profile upgraded from 0.4.x may still carry the old
  `- id: tool-agent-team` / `disabled: true` override; activation warns, the health card reports it,
  and `manage_agent_souls({ action: "repair_team_tools" })` re-enables it through the Plugin Manager.
  Compositions without the Plugin Manager can only report the manual profile fix.
- **Team mode is opt-in.** A new root Session has Team mode off unless the profile sets
  `agent-team.defaultEnabled: true`. With Team mode off, the plugin's spawn/catalog tools are hidden
  and soul commands fail with an actionable message; generic subagent delegation works normally.
- **Generic tools may be visible but are denied.** For a soul with an inherit-all `tools:` list the
  base `subagent`/`subagent_fork` schemas can remain visible; the guard denies their execution and
  the creation fence rejects a local child without a plan. A strict soul allow-list hides them. An
  external subagent backend that does not create a local Agent is outside the local creation fence;
  the caller-side guard remains the enforcement point.
- **The soul policy is a scoped shadow.** The plugin registers `team:policy` in each Team member's
  scope, preserving the DSH 0.2.2 task-board guidance and adding the soul-only rule. If a future DSH
  release changes its base policy text, this plugin's shadow must be updated to stay aligned.
- **Base Team tools cannot be removed from a soul.** `send_message`, `list_agents`, `wait_agent`,
  `team_task_*`, and `interrupt_agent` (when enabled) are global DSH tools; the plugin keeps them in
  every soul allow-list so a teammate can still report and use the task board. The GUI and spawn
  reject a Team-tool name in a soul `tools` list. The Lead-only `manage_agent_souls` tool is not
  delegable.
- **Soul directories are per workspace.** Workspace-relative paths resolve against the workspace
  root; a Team in another workspace sees its own resolution until `dirs` is made absolute.
- **Cold resume fails closed without its binding.** Admission requires a pending spawn plan or a
  durable binding. A missing, pruned, unreadable, corrupt, unsupported, unsafe-path, or partially
  malformed binding refuses the resume rather than running a Soul-less teammate. The base
  `send_message` reports the shared lifecycle's generic `NOT_RESUMABLE` wrapper; the typed reason
  (`missing-binding`, `unreadable-binding`, `corrupt-binding`, `unsupported-binding`,
  `unsafe-binding-path`) is in the Host log line (`SOUL_PLAN_UNAVAILABLE`) and
  `list_agent_souls` diagnostics with
  `source: "admission:<name>"`. Every `get`/`list`/`size` re-reads the durable document, so a
  previously healthy plan is not served after the document becomes corrupt or unreadable; `get`
  additionally refuses a partially malformed document. The only in-memory value served while the
  document is unusable is this process's unpersisted local `set`/`delete` for that child, and it
  is not durable. `list`/`size` still reject a document-level failure; for a partially malformed
  document they return the valid records with the warning (only `get` refuses the whole document).
  A malformed snapshot is refused with `E_BINDING_INVALID_RECORD` before it is written. The store
  retains the newest 500 records per bindings document, so a pruned record blocks that resume until
  the teammate is re-spawned. Repair or replace an unreadable/corrupt document externally and retry;
  the same store re-reads it without a new process. At plugin activation, a pre-existing live
  teammate without a plan is skipped with a warning and gets no soul surface (creation already
  happened and cannot be vetoed).
- **Plugin state paths follow one real-path rule.** A workspace-relative `bindingsFile`, its
  `trash/`, restores, and its sibling state documents must resolve inside the **real** workspace
  root. Activation rejects a lexical `../` escape, and I/O additionally resolves existing ancestors
  so symlinked `.dsh`/`.dsh/agent-soul`, dangling links, or a document symlink cannot move state
  outside the workspace; delete/restore refuse rather than move a soul out. An absolute
  `bindingsFile` is intentional shared state shared by every workspace using that profile, with its
  real state directory as the boundary, including its child-id keyspace and newest-500 retention.
  Migrate existing relative escapes—and escaping symlinked state paths—to a root-contained relative
  path or an absolute shared path before activation. The real-path check and the subsequent I/O are
  not one atomic operation; a racing replacement retains the same TOCTOU class as the preferences
  and orchestrator fences.
- **The Team Lead's identity is reserved.** `lead` cannot be an Agent Soul name: the parser rejects
  it with `name: "lead" is reserved for the Team Lead`, so a file with that name is invalid,
  excluded from the catalog, refused by the GUI and agent tool, and rejected by spawn before any
  subagent catalog or binding change. Only the exact name is reserved; `leadership`, `lead-review`, and
  `lead-2` are valid.
- **Delete fails safe when the trash is unavailable.** If the state/trash path is unsafe (for
  example a symlinked `.dsh`/`.dsh/agent-soul` leaving the real workspace), the trash directory
  cannot be created, or the no-replace move fails, the source remains in place and the operation
  returns an `unsafe-path`/`invalid-request` failure naming the reason; no `trashedFile` or Undo
  entry is created, and there is no hard-delete opt-in. Fix the path/symlink/permissions/device
  problem and retry. Packaged deletes still require `bundledEditable`.
- **Session title ownership is cooperative.** The rename is an ordinary `session/title` append, not
  an exclusive lock. A title changed by another tool during activation can be overwritten by the
  activation rename; off preserves any title that is no longer exactly `orchestrator`.
- **The session-title service and a prior title are both required for a rename.** Without the
  profile's `sessionTitle` service (some headless compositions), `/orchestrate` still enables fully
  and the announcement reports `title: unchanged (session-title service unavailable)`. With the
  service but no prior Session title, enable does not invent one: the announcement reports
  `title: unchanged (no prior Session title to restore)`, `/orchestrate off` has nothing to restore,
  and a failed enable cannot leave a false `orchestrator` title. A failed title restore is only a
  warning and does not block turning the mode off; a failed model restore keeps the mode active for
  a retry.
- **Generic child orchestration is unavailable inside a Team session.** The creation fence vetoes
  provider-owned children of Team members, so tools that internally start generic subagents — a
  workflow run's `agent()` calls, for example — cannot publish children under the Lead or a
  teammate. The child start fails, so the workflow's `agent()` promise rejects (and the run reports
  the error unless the script catches it) instead of producing a Soul-less teammate; use
  `spawn_teammate` for delegation.
- **The GUI edits one workspace at a time.** It prefers a live Session workspace and falls back to
  the deployment root; it does not merge catalogs from several workspaces.
- **Browser recovery is narrow.** A Soul draft persists its form fields/sections, Form/Raw mode, raw
  source, and base file hash; dialog size also persists. Orchestrator edits, New/Paste inputs, and
  Undo state are not restored, so save those before refreshing. A Session-root change no longer
  reloads or resets a dirty Orchestrator draft. Ordinary Orchestrator saves are last-write-wins
  rather than using the Soul `expectedHash` conflict flow; packaged `bundledEditable` saves have only
  the specific workspace-appearance 400 conflict guard.
- **Model routing needs the LLM catalog** to resolve a bare model id. Without the `llm` service,
  write the full `provider/model` route; it is accepted without catalog verification, and spawn/enable
  succeeds only if deployment selection can serve it.
- **Command collisions are not retried while the catalog is unchanged.** The command may be missing;
  the GUI reports `Command collision` from handler identity. The built-in `/orchestrate` always
  keeps its name, so a soul named `orchestrate` needs `commandPrefix: agent-` to be invocable.
  Renaming or deleting the colliding soul re-registers the remaining commands without a Host reload;
  changing `commandPrefix` is a bundle-config change and needs the usual reload.
- **No filesystem watching.** New or externally edited files appear on the next scan trigger, not
  mid-turn. The page always rescans before listing.
- **Fork context inherits the Lead's completed turns.** The soul's hard rules and tool matrix
  still apply, but the inherited history may mention tools the soul no longer allows; the
  teammate cannot call them.
- **Soul tool names must be visible in the live session.** The spawn validates the list against
  the Lead's restrictable catalog; an unknown name fails before a teammate is created. The portable
  shell pair is the one exception: a declared `bash`/`pwsh` resolves to the registered counterpart
  (an exact registration wins), and no other name is aliased.
- **Windows evidence is partial.** Maintainer-run Windows 11 Pro sessions on 2026-11-09 verified
  installation and the spawn/apply shell-alias path: `researcher`, `scribe`, and
  `adversarial-red-team-verifier` spawned from their bundled `bash` declarations, and each child's
  in-program bindings were exactly the soul's seven declared tools with `pwsh` substituted for
  `bash` (plus the ten Team tools), with no `bash` key, no warnings, and empty `list_agent_souls`
  diagnostics. An earlier Windows run the same day exercised the full-matrix `software-engineer`
  path and shell execution. The GUI catalog alias (chips/preview/save), the orchestrator `tools`
  matrix, and cold-resume binding persistence have **not** been exercised on Windows; the POSIX
  suites remain their evidence. The Windows session did not print the package version, but a
  `bash` declaration spawning successfully where only `pwsh` is registered is 0.4.1 behavior —
  0.4.0 rejected that declaration.
- **Orchestrator mode is per session and command-activated.** It is off by default. The model
  override is session-scoped, not a profile default. The previous model is restored only when it
  was captured in the same process; after a reload there is no captured original.
- **Orchestrator queue-failure recovery is best-effort.** A queue failure after a first enable, or
  while a mode was already active, reports the observed live state (reverted, kept, explicit
  fallback, inactive, or unconfirmed) and relies on `/orchestrate off` to retry a captured model
  restore. The handler-level fault tests use an in-memory Agent double, not a full real Host
  lifecycle, so a compound failure can still leave live and durable state disagreeing; the command
  says so and names the off retry. Inspect the effective mode, doctrine, and route before continuing.
- **Orchestrator doctrine is prompt-level.** Plan-first, gating, retry counts, and pause-on-fatal
  are instructions the model follows with the task board and Team tools; there is no automatic
  retry driver. Model/tool overrides are enforced by the Harness.
- **Orchestrator tool names are best-effort.** A name that is not currently restrictable (including
  a Team tool) is skipped with a warning; it does not fail the mode. The shell pair resolves to the
  registered spelling first, so a `bash`/`pwsh` declaration is applied instead of skipped. A failure
  of the tool restriction service itself aborts the enable and is reported as a failed enable (see
  **Turn it on and off** for what state a failure leaves behind).
- **Catalog budgets are per root.** Over-limit entries are omitted (with a diagnostic) and the
  health card shows the pressure; the full catalog text can exceed the prompt budget.
- **Multiple live Sessions** can coexist. Command status uses the Lead whose Session directory
  matches the workspace being edited, falling back to the first Lead; a mismatch can still make a
  check ambiguous.
- **Localization covers UI chrome, not raw Host content.** Eight dictionaries localize plugin
  controls and statuses; Host diagnostics/messages, file content, and raw error text can appear in
  their source language. That boundary is intentional, not a rendered-browser claim.
- **Verification has a fixed scope.** The focused suites and the keyless harness cover module and
  host-side behavior; no automated check renders the browser page (native interaction and layout
  must be checked in a real browser, and `client.js` is not rendered in CI), activates Orchestrator
  mode end to end, uses a real provider/model, or runs on other OS/Node versions. Baseline
  remediation needs an archived `QAS_BASELINE_DIR`, and the full DSH suite is outside this package.
  See [`smoke/README.md`](smoke/README.md).

## Development and testing

The plugin is plain ESM JavaScript with **zero dependencies**, no bare imports, and one classic
inline-style browser artifact. `node --check` must pass for `index.js`, every `lib/*.js`, and
`client.js`.

Run the checks from the package project root with Node.js **>= 24.9.0**. The end-to-end harness also
requires an existing DSH source checkout with its workspace dependencies and `tsx` installed; it
launches the CLI from that checkout. No plugin build or `npm test` is required; use the checks below
rather than treating either as a verification substitute.

There is no `tests/` directory: `node --test tests/*.test.mjs` matches nothing and exits 0 without
running a single test — an exit code of 0 from that command is not verification. The verification
that exists is syntax checking, the focused keyless module suites under `smoke/` (run with
`node --test`; per-suite coverage and assertion counts live in [`smoke/README.md`](smoke/README.md),
the testing authority), and the end-to-end smoke harness.

The end-to-end harness is safe to run directly from this package tree: its document write-refusal
probes run against a run-owned package copy, and the real `agents/generalist.md` is only snapshotted
before and after and never restored. A concurrent legitimate edit is preserved and reported. A
disposable package copy remains optional; see [`smoke/README.md`](smoke/README.md).

```sh
node --check index.js
for f in lib/*.js; do node --check "$f" || exit 1; done
node --check client.js

# focused module suites (keyless; temporary directories only), 110 tests
node --test smoke/

# end-to-end harness (safe directly; 58 checks)
node smoke/run-smoke.mjs
```

On 2026-11-13, `node --test smoke/` passed **110/110** focused tests, including the 14 cases in
`smoke/windows-shell-alias.test.mjs` and the 10 DSH 0.2.2 adapter/surface/spawn/team-row cases in
`smoke/team-runtime.test.mjs`.
End-to-end verification boots a real `dsh --profile headless` process from a DSH source checkout
with a temporary `DSH_HOME`, a scripted LLM adapter, and this bundle selected through its real
manifest and `cordis.patch.yml`. It asserts the workspace-independent bundled defaults (an empty
workspace sees the packaged catalog and doctrine, and `bundled: false` restores strict
workspace-only behavior), the Lead catalog, `spawn_teammate({ agent_type })`, persona composition,
exact tool matrices, model routing, user-invocable slash command execution, durable bindings,
symlinked-workspace and isolated packaged-catalog write-fence refusals, seeded credential/proxy/
loader canaries removed from the child environment, and an explicit `/orchestrate` registration
assertion. The child environment is allowlisted by construction, so the seeded canaries are a real
removal proof for those variables (not proof about every possible inherited secret).

```sh
node smoke/run-smoke.mjs
# when the checkout is elsewhere:
DSH_CHECKOUT=/path/to/deepseek-harness node smoke/run-smoke.mjs
```

The harness runs **58 checks** and passed **58/58** on 2026-11-13 — a dated point-in-time result on
macOS arm64 with Node 26.13.0, re-runnable directly with `node smoke/run-smoke.mjs` — starting with
a composed fresh profile whose `--dump-config` proves the shipped `tool-agent-team` row stays
enabled and the plugin adds only `agent-soul-team`. The command-spawned probe soul declares the shell spelling this POSIX session
does not register (`pwsh`); the harness asserts the child inherits `bash`, never advertises `pwsh`,
and keeps the declared `["pwsh","read"]` list in the durable binding. The command list is asserted: a
malformed or missing `/orchestrate` registration now fails the harness, though the mode itself is
still not activated end-to-end. The bundled doctrine resolution that makes it available in any
workspace is verified directly by the harness. The default checkout path is
`/Users/zosyn/LLM/deepseek-harness`. The fixtures are designed
to use no credentials or network access; network syscalls were not independently monitored. See
[`smoke/README.md`](smoke/README.md).

The optional `node smoke/run-windows-parity.mjs` probe covers the inverted composition. On
2026-11-13 it passed **14/14** checks: it boots a real headless DSH profile with the `tool-bash` row
disabled and a test-only plugin that registers a stand-in `pwsh` tool, publishes a
`bash`-declaring soul, and asserts the child inherits `pwsh` and never advertises `bash`, while the
durable binding keeps the declared `bash` spelling. This is the repeatable simulated-Windows
evidence on a POSIX host; the live Windows run described next covers the same spawn/apply path in
the real environment.

### Live Windows verification (2026-11-09)

A maintainer-run Windows 11 Pro session (`session-d5aa7840-4427-4a86-82f0-621835b3f5dc`, DSH Web
profile whose live catalog exposed `pwsh` and no `bash`) exercised the portable alias through real
spawns, not the stand-in probe: the Lead spawned one teammate per reduced-matrix soul and had each
run `console.log(JSON.stringify(Object.keys(tools).sort()))` inside its `run_code` program. The
exact sorted binding lists were:

| Soul | Declared shell | Bound shell | Declared non-Team tools | Bindings |
|---|---|---|---|---|
| `researcher` | `bash` | `pwsh` | `web_search`, `web_fetch`, `read`, `glob`, `grep`, `skill` | 17 = 7 + 10 Team tools |
| `scribe` | `bash` | `pwsh` | `read`, `glob`, `grep`, `write`, `edit`, `skill` | 17 = 7 + 10 Team tools |
| `adversarial-red-team-verifier` | `bash` | `pwsh` | `read`, `glob`, `grep`, `read_image`, `working_directory`, `skill` | 17 = 7 + 10 Team tools |

All three spawns were accepted with empty `member.diagnostics`; every list contained the ten Team
tools and exactly that soul's declared non-Team tools, with `pwsh` in place of `bash` and no extra
or missing name; no child list contained a `bash` key; no `non-restrictable`, "not a tool visible",
or runtime error text appeared; and `list_agent_souls` diagnostics stayed `[]`. The preceding
Windows 11 Pro tool-surface run the same day had already exercised installation, the full-matrix
`software-engineer` soul (40 bindings including `pwsh`), and shell execution across the 30 tested
tools with zero failures.

Not covered by the Windows runs: the GUI catalog alias (chips, preview diagnostics, save), the
orchestrator `tools` matrix, cold-resume binding persistence, and rendered-browser interaction.
`smoke/run-windows-parity.mjs` remains the repeatable simulated check for the spawn/apply path.

The focused remediation runtime is separate from the smoke harness. On 2026-11-13,
`node smoke/remediation-runtime.mjs --target candidate --only all` passed **179/179** with **2/2
suites** on a disposable `QAS_RUN_ROOT`. Its `summary.json`
reports `status`, `complete`, `incompleteSuites`, `unexecutedSuites`, `runnerChecks`,
`adapterAssertions`, suite counts, and per-check rows, so an interrupted run cannot read as a full
pass; readiness barriers are published atomically and readers retry a partial document. The baseline
mode is obsolete on DSH 0.2.2 and is rejected by the runner. See
[`smoke/README.md`](smoke/README.md).

The isolated Web GUI harness (`node smoke/run-web-gui.mjs`) boots a temporary `dsh web` profile
with the scripted adapter and prints the authenticated URL for Computer Use. It verifies the real
Settings → Agent Soul page, the live Team count, soul editing, the orchestrator tab, and the
base-row health status without touching the live profile.

For a Host change: reload the bundle from the profile (or restart the Harness). For a browser change,
run `pnpm run dev:web` in the DSH source checkout to rebuild client-plugin bundles for HMR; otherwise
refresh the Settings page after client changes. This package supplies no watcher and none is assumed
to be running. Web shell/plain-package changes need their normal rebuild and page refresh. A page
refresh is always safe and reloads the dictionaries and client module.

## File map

| Path | What it is |
|---|---|
| [`agents/`](agents/) | Bundled soul catalog: five packaged definitions, including the `generalist` default. Shipped with the bundle and available in every workspace; all five are AI-only until a soul opts in to `user-invocable`. |
| [`defaults/orchestrator.md`](defaults/orchestrator.md) | Bundled Lead doctrine, used when a workspace has no `orchestrator.md`; edit this file to change the packaged default for workspaces using that package installation/profile. |
| `<workspace>/.dsh/agents/` | Optional local soul overrides (default `dirs`); created on demand by the GUI. |
| `<workspace>/.dsh/agent-soul/bindings.json` | Durable teammate bindings (plugin-owned runtime state, created on first spawn; gitignored in this repository). |
| `<workspace>/.dsh/agent-soul/preferences.json` | Plugin-owned default-Soul selection (created on first change). |
| `<workspace>/.dsh/agent-soul/orchestrator.md` | Optional workspace Lead doctrine; overrides the bundled default. |
| `<workspace>/.dsh/agent-soul/trash/` | Deleted files moved by a successful trash move (created on first delete); a failed move leaves the source in place and reports the error, with no Undo. |
| [`locale/en.json`](locale/en.json) | Package locale metadata for the Settings entry (English). |
| [`locale/zh.json`](locale/zh.json) | Package locale metadata for the Settings entry (Chinese); the eight in-page dictionaries live in `client.js`. |
| [`icon.svg`](icon.svg) | Bundle icon shown by the profile/bundle listings. |
| [`package.json`](package.json) | Package manifest: bundle patch, `dsh.client` browser registration, exports. |
| [`index.js`](index.js) | Cordis plugin entry. |
| [`lib/soul.js`](lib/soul.js) | Parser, validation, catalog, prompt text. |
| [`lib/tools.js`](lib/tools.js) | Soul surface: policy shadow, Lead catalog, generic-tool guard, `spawn_teammate`, `list_agent_souls`. |
| [`lib/spawn.js`](lib/spawn.js) | Spawn orchestration shared by the tool and commands; default-Soul resolution, reserved child id, model routing, binding write. |
| [`lib/preferences.js`](lib/preferences.js) | Atomic default-Soul preference store and resolution/validation. |
| [`lib/apply.js`](lib/apply.js) | Applies a Soul to a teammate; fail-closed plan resolution (pending plan, then durable binding) and pending-spawn handoff. |
| [`lib/commands.js`](lib/commands.js) | User-invocable slash commands. |
| [`lib/model.js`](lib/model.js) | Model-route resolution. |
| [`lib/tool-names.js`](lib/tool-names.js) | Frozen portable shell-name resolver (`bash` ↔ `pwsh`) shared by spawn validation, the teammate tool matrix, the orchestrator probe, and the GUI tool catalog. |
| [`lib/team.js`](lib/team.js) | Subagent-tree adapter: roles, names, descendants, Team size. |
| [`lib/team-tools.js`](lib/team-tools.js) | Base/plugin tool-name sets and always-kept Team tools. |
| [`lib/team-row.js`](lib/team-row.js) | Base `tool-agent-team` row inspection and explicit re-enable. |
| [`lib/bindings.js`](lib/bindings.js) | Typed durable binding store (fail-closed reads, transactional refusal of untrusted documents). |
| [`lib/admin.js`](lib/admin.js) | Document layer: split/compose/validate, scan, path safety, trash. |
| [`lib/gui-host.js`](lib/gui-host.js) | Authenticated Host JSON routes and overview. |
| [`lib/orchestrator.js`](lib/orchestrator.js) | Orchestrator document, `/orchestrate`, mode runtime. |
| [`lib/orchestrator-mode.js`](lib/orchestrator-mode.js) | Shared durable orchestrator-mode fold: the pure command-log state machine read by both `/orchestrate` and the session projection behind the header badge. |
| [`lib/admin-tool.js`](lib/admin-tool.js) | `manage_agent_souls` Lead tool. |
| [`client.js`](client.js) | Settings → Agent Soul browser artifact. |
| [`cordis.patch.yml`](cordis.patch.yml) | Profile patch and row config. |
| [`smoke/`](smoke/) | Keyless end-to-end harness, focused `node:test` suites, scripted adapters, and the isolated Web GUI harness. |
| [`docs/INTERNALS.md`](docs/INTERNALS.md) | Module architecture and maintainer invariants. |
| [`docs/SOUL-OPTIONS.md`](docs/SOUL-OPTIONS.md) | Control-by-control reference for every editable option in both editors. |
| [`docs/GUI-INTERNALS.md`](docs/GUI-INTERNALS.md) | GUI/API contract (routes, payloads, browser artifact rules). |

The control-by-control user reference is
[`docs/SOUL-OPTIONS.md`](docs/SOUL-OPTIONS.md); the maintainer contract for the Agent
Teams/runtime modules is [`docs/INTERNALS.md`](docs/INTERNALS.md); the GUI/API contract is
[`docs/GUI-INTERNALS.md`](docs/GUI-INTERNALS.md); the end-to-end harness is
[`smoke/README.md`](smoke/README.md).
