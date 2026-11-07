/** Agent Soul GUI host routes: the authenticated JSON endpoints the browser half calls.
 *
 * Ten exact paths cover thirteen method-endpoints (the document and
 * orchestrator paths answer GET and POST, and the preferences path answers GET
 * and POST; the web server refuses duplicate `(kind, path)` registrations):
 *
 * - `GET  /agent-soul/overview`
 * - `GET  /agent-soul/document`
 * - `POST /agent-soul/document` (fields/sections, or raw `source`)
 * - `POST /agent-soul/create`
 * - `POST /agent-soul/duplicate`
 * - `POST /agent-soul/delete`
 * - `POST /agent-soul/restore`
 * - `POST /agent-soul/parse`
 * - `POST /agent-soul/preview`
 * - `GET  /agent-soul/orchestrator`
 * - `POST /agent-soul/orchestrator` (raw `source`, or `fields`/`sections`)
 * - `GET  /agent-soul/preferences`
 * - `POST /agent-soul/preferences` (`name`: soul name or null)
 *
 * Every handler first asks the composition's `connection` service for a rejection
 * (`requestRejection`) and answers 401/403 when it rejects; the composition's
 * Host/Origin fence and login-token authentication therefore gate every read and
 * write. JSON responses are `no-store`; request bodies must be `application/json`
 * and are bounded to 1 MiB. Handlers touch only `req.method`/`req.url`/
 * `req.headers`/async iteration of `req` and `res.setHeader`/`res.writeHead`/
 * `res.end`, so tests drive them with plain fakes.
 *
 * P0 additions on top of the original contract: the overview carries a
 * `catalogs` object (first live Lead's restrictable tools + llm models), the
 * document GET passes through the document layer's `hash`/`modifiedAt`, and the
 * document POST accepts `expectedHash` and `expectedMissing` (409 `conflict`
 * on a stale/missing or unexpectedly present file) and answers semantic refusals
 * with 400 `invalid` + `fieldErrors`. Every route accepts an optional root,
 * authorized against current candidates and pinned for the whole request.
 *
 * P1 additions: `parse` (no-write split of pasted Markdown), `preview` (no-write
 * persona / catalog bullet / model / command status for the draft), raw-source
 * document saves, `create` from template source, `duplicate`, and recoverable
 * delete/restore through the document layer's trash directory.
 *
 * P2 additions (overview only, still no new route): every document row carries
 * `usage` (durable bindings grouped by soul name plus live teammate
 * correlation), `commandStatus` (the P1 preview status recomputed for the
 * scanned document), and `catalogLine` (the preview's single-definition catalog
 * bullet). `runtime` gains `health` (duplicate names, invalid files,
 * `maxDefinitions`/`maxPromptChars` budgets, scan diagnostic count) and every
 * `liveTeams` row carries its `memberCount`. Each lookup degrades to a safe
 * default instead of failing the page.
 *
 * P4 additions: the orchestrator definition document gets its own GET/POST path
 * (the same authenticated, no-store, bounded-body contract as every other route)
 * and the overview gains a top-level `orchestrator` block.
 *
 * Default-Soul additions: the plugin-owned preference gets a GET/POST path
 * and a top-level overview `preferences` block. Both validate the selection
 * against the live soul catalog; the write stays atomic in the state directory
 * shared with the bindings document.
 *
 * @module @local/dsh-agent-soul/gui-host
 */

import { statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import {
  bundledSoulsDir,
  composeDocument,
  createDocument,
  deleteDocument,
  duplicateDocument,
  listDocuments,
  readDocument,
  resolveSoulDirs,
  resolveGuiRoot,
  restoreDocument,
  saveDocument,
  saveDocumentSource,
  splitDocument,
} from './admin.js'
import { catalogPromptText, composePersona, parseSoulMarkdown } from './soul.js'
import { inspectTeamToolSurface } from './composition.js'
import { soulCommandRegistrationState } from './commands.js'
import { orchestratorRouteDiagnostics, orchestratorSummary, readOrchestrator, saveOrchestrator } from './orchestrator.js'
import { describePreferences, preferencesPathOf } from './preferences.js'
import { TEAM_TOOL_NAMES } from './tools.js'

/** Absolute route paths (the browser addresses them without the leading slash). */
const ROUTE_PATHS = Object.freeze({
  overview: '/agent-soul/overview',
  document: '/agent-soul/document',
  create: '/agent-soul/create',
  duplicate: '/agent-soul/duplicate',
  remove: '/agent-soul/delete',
  restore: '/agent-soul/restore',
  parse: '/agent-soul/parse',
  preview: '/agent-soul/preview',
  orchestrator: '/agent-soul/orchestrator',
  preferences: '/agent-soul/preferences',
})

/** Request bodies are bounded; anything larger is hostile. */
const MAX_BODY_BYTES = 1024 * 1024

/** Maximum characters of one tool description exposed to the browser catalog. */
const MAX_TOOL_DESCRIPTION_CHARS = 200

/** Team tools every teammate keeps; a soul cannot restrict them. */
const TEAM_TOOL_NAME_SET = new Set(TEAM_TOOL_NAMES)
/** Lead-only scoped tools are visible to the Lead but can never be delegated. */
const LEAD_SCOPED_TOOL_NAME_SET = new Set(['manage_agent_souls'])

/** Valid teammate name (mirrors the document layer). */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
/** Maximum teammate name length (mirrors the document layer). */
const MAX_NAME_CHARS = 64
/** Reserved Team role name (mirrors the document layer). */
const RESERVED_NAME = 'lead'
/** Slash-command names accepted by the commands service (mirrors `lib/commands.js`). */
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

/** Defaults mirrored from the plugin's normalized config. */
const CONFIG_DEFAULTS = Object.freeze({
  bundled: true,
  commandPrefix: '',
  defaultContext: 'fresh',
  freshProvider: 'spawn',
  forkProvider: 'fork',
  interrupt: true,
  maxDefinitions: 64,
  maxPromptChars: 12000,
  bindingsFile: join('.dsh', 'agent-soul', 'bindings.json'),
})

/** Plugin identity used when the host does not pass `pluginMeta`. */
const PLUGIN_META_DEFAULTS = Object.freeze({ name: '@local/dsh-agent-soul', version: '0.3.0' })

/**
 * Human-readable message for one arbitrary thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Log one warning through the plugin logger, swallowing logger failures.
 * @param {object} deps
 * @param {string} message
 * @returns {void}
 */
function warn(deps, message) {
  try {
    if (typeof deps?.logger?.warn === 'function') deps.logger.warn(`agent-soul: ${message}`)
  } catch {
    // Logging must never break a route.
  }
}

/**
 * Resolve a service from the context without letting a missing `get` throw.
 * @param {object} ctx
 * @param {string} name
 * @returns {unknown}
 */
function serviceOf(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * Candidate workspace roots for the GUI, most specific first.
 *
 * A live top-level Session's committed directory is the workspace the person is
 * actually working in. The deployment working directory is only a fallback: the
 * harness process may run from an unrelated folder (for example the DSH checkout
 * that launched it), so its `dirs` often hold no soul files.
 *
 * @param {{ root?: unknown, ctx?: object }} deps
 * @returns {string[]} deduplicated absolute candidate roots.
 */
function rootCandidates(deps) {
  const candidates = []
  const push = (value) => {
    if (typeof value !== 'string' || value.trim() === '') return
    const candidate = resolve(value)
    if (candidates.includes(candidate)) return
    try {
      // A file (or a stale, missing Session directory) is never a selectable root.
      if (!statSync(candidate).isDirectory()) return
    } catch {
      return
    }
    candidates.push(candidate)
  }
  try {
    const agents = typeof deps?.ctx?.agents?.list === 'function' ? deps.ctx.agents.list() : []
    const workingDirectory = serviceOf(deps?.ctx, 'workingDirectory')
    for (const agent of agents) {
      const session = agent?.session
      // Teammates share their Lead's directory; only top-level Sessions name a workspace.
      if (session === undefined || session?.header?.parentSession !== undefined) continue
      try {
        push(workingDirectory?.get?.(session))
      } catch {
        // An unpublished Session has no committed directory yet.
      }
    }
  } catch {
    // No live Agent service; fall through to the deployment defaults.
  }
  push(deps?.root)
  push(resolveGuiRoot(deps?.ctx))
  if (candidates.length === 0) push(process.cwd())
  return candidates
}

/** Whether one candidate root holds at least one existing configured soul directory. */
function hasSoulDir(deps, root) {
  try {
    return resolveSoulDirs(deps?.config, root).some(dir => {
      try { return statSync(dir).isDirectory() } catch { return false }
    })
  } catch {
    return false
  }
}

/**
 * The workspace root every route edits: the first candidate whose configured
 * soul directories exist (a live Session workspace first), then the first
 * candidate as a fallback so the page always shows its resolved settings.
 * @param {{ root?: unknown, ctx?: object, config?: object }} deps
 * @returns {string}
 */
function rootOf(deps) {
  // A handler pins the root once; every catalog, validator, and mutation in that
  // request then uses the same authorized workspace even if the live roster changes.
  if (typeof deps?.pinnedRoot === 'string') return deps.pinnedRoot
  const candidates = rootCandidates(deps)
  for (const candidate of candidates) {
    if (hasSoulDir(deps, candidate)) return candidate
  }
  return candidates[0] ?? resolveGuiRoot(deps?.ctx)
}

/**
 * Authorize an optional request root against a fresh candidate list. Arbitrary
 * filesystem paths are never accepted, even when they are directories.
 */
function requestScope(deps, requestedRoot, res) {
  let root
  if (requestedRoot === undefined || requestedRoot === null || requestedRoot === '') {
    root = rootOf(deps)
  } else if (typeof requestedRoot === 'string') {
    const candidate = resolve(requestedRoot)
    root = rootCandidates(deps).find(value => value === candidate)
  }
  if (root === undefined) {
    sendJson(res, 403, { ok: false, code: 'unsafe-root', message: 'root is not a current live workspace candidate' })
    return null
  }
  return { ...deps, pinnedRoot: root }
}

/** Read one query parameter without letting a malformed URL fail the route. */
function queryParameter(req, name) {
  try { return new URL(String(req.url ?? ''), 'http://localhost').searchParams.get(name) } catch { return null }
}

/**
 * Set JSON response headers (shared by every JSON body).
 * @param {{ setHeader(name: string, value: string): void }} res
 * @returns {void}
 */
function setJsonHeaders(res) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
}

/**
 * Send one JSON response.
 * @param {{ setHeader(name: string, value: string): void, writeHead(status: number): void, end(body?: string): void }} res
 * @param {number} status
 * @param {unknown} payload
 * @returns {void}
 */
function sendJson(res, status, payload) {
  setJsonHeaders(res)
  res.writeHead(status)
  res.end(JSON.stringify(payload))
}

/**
 * Answer 405 with the methods this route supports.
 * @param {object} res
 * @param {string} allow
 * @returns {void}
 */
function sendMethodNotAllowed(res, allow) {
  res.setHeader('allow', allow)
  res.writeHead(405)
  res.end()
}

/**
 * Consult the composition's trust fence; true when the request was rejected.
 *
 * Fails closed (403) when the connection service is absent: without the fence
 * there is no way to distinguish a real browser from a cross-site caller, and
 * these routes can rewrite the user's soul files.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {boolean}
 */
function rejected(deps, req, res) {
  const connection = deps?.ctx?.connection
  /** @type {unknown} */
  let rejection
  try {
    rejection = typeof connection?.requestRejection === 'function'
      ? connection.requestRejection(req)
      : 403
  } catch (error) {
    warn(deps, `trust fence failed: ${messageOf(error)}`)
    rejection = 403
  }
  if (rejection === undefined) return false
  const status = rejection === 401 || rejection === 403 ? rejection : 403
  res.writeHead(status)
  res.end()
  return true
}

/**
 * Collect and parse one bounded JSON request body.
 *
 * The wire format is enforced at the boundary: exactly `application/json`, at
 * most {@link MAX_BODY_BYTES}, and a top-level JSON object. Every failure is a
 * typed `invalid-request` message for the browser.
 *
 * @param {object} req
 * @returns {Promise<{ ok: true, value: Record<string, unknown> } | { ok: false, message: string }>}
 */
async function readJsonBody(req) {
  const headers = req?.headers ?? {}
  const essence = String(headers['content-type'] ?? '').split(';', 1).at(0)?.trim().toLowerCase()
  if (essence !== 'application/json') return { ok: false, message: 'content-type must be application/json' }
  /** @type {Buffer[]} */
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk ?? '')
      size += buffer.byteLength
      if (size > MAX_BODY_BYTES) return { ok: false, message: 'request body is too large' }
      chunks.push(buffer)
    }
  } catch (error) {
    return { ok: false, message: `request body unreadable: ${messageOf(error)}` }
  }
  const text = Buffer.concat(chunks, size).toString('utf8')
  /** @type {unknown} */
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, message: 'request body must be valid JSON' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'request body must be a JSON object' }
  }
  return { ok: true, value }
}

/**
 * Whether one value is a plain (non-array) object.
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Re-read the catalog after a mutation so the next spawn sees the save.
 * Failures are logged and never turn a successful write into an error response.
 * @param {object} deps
 * @param {string} root
 * @returns {Promise<void>}
 */
async function rescan(deps, root) {
  try {
    await deps?.catalog?.refresh?.(root)
  } catch (error) {
    warn(deps, `soul scan after a GUI save failed: ${messageOf(error)}`)
  }
  // A created/renamed/deleted user-invocable soul must register (or drop) its
  // slash command immediately; users should not need a Host reload for that.
  try {
    await deps?.syncSouls?.()
  } catch (error) {
    warn(deps, `soul command sync after a GUI save failed: ${messageOf(error)}`)
  }
}

/**
 * Refresh the catalog for one root and return its definitions.
 *
 * A missing or failing catalog scan yields an empty list: the preferences block
 * then reports that no default is usable instead of failing the route.
 *
 * @param {object} deps
 * @param {string} root
 * @returns {Promise<object[]>}
 */
async function catalogDefinitionsOf(deps, root) {
  try {
    const snapshot = await deps?.catalog?.refresh?.(root)
    if (isRecord(snapshot) && Array.isArray(snapshot.definitions)) return snapshot.definitions
  } catch (error) {
    warn(deps, `cannot scan the soul catalog for preferences: ${messageOf(error)}`)
  }
  return []
}

/**
 * The GUI-facing default-Soul preference block, resolved against the live
 * catalog. A preferences document that cannot be read stays visible through
 * `warning` rather than silently looking unconfigured.
 *
 * @param {object} deps
 * @param {string} root
 * @param {object[]} definitions - live validated definitions.
 * @returns {Promise<object>}
 */
async function preferencesBlockOf(deps, root, definitions) {
  const fallbackPath = preferencesPathOf(deps?.config, root)
  /** @type {{ ok: boolean, preferences?: object, code?: string, message?: string }} */
  let read
  try {
    read = typeof deps?.preferences?.get === 'function'
      ? await deps.preferences.get(root)
      : { ok: true, preferences: { path: fallbackPath, selected: null, warning: null } }
  } catch (error) {
    read = { ok: false, code: 'invalid-request', message: `cannot read the Agent Soul preferences: ${messageOf(error)}` }
  }
  if (read?.ok !== true) {
    return describePreferences({
      path: fallbackPath,
      selected: null,
      definitions,
      warning: String(read?.message ?? 'cannot read the Agent Soul preferences'),
    })
  }
  const stored = isRecord(read.preferences) ? read.preferences : {}
  return describePreferences({
    path: typeof stored.path === 'string' && stored.path !== '' ? stored.path : fallbackPath,
    selected: typeof stored.selected === 'string' ? stored.selected : null,
    definitions,
    warning: typeof stored.warning === 'string' ? stored.warning : null,
  })
}

/**
 * One live Team Lead row with the soul slash commands registered for it.
 * @typedef {{ lead: string, commands: { name: string, description: string }[],
 *   memberCount: number | null }} LiveTeam
 */

/**
 * The live Team roster size for one Lead.
 *
 * A missing or throwing `agentTeams.listMembers` (or a non-array result) is
 * reported as null: the settings card still renders the Lead and its commands,
 * it simply cannot show how many members are live.
 *
 * @param {object} ctx
 * @param {object} agent - the live Lead agent.
 * @returns {number | null}
 */
function memberCountOf(ctx, agent) {
  let members
  try {
    if (typeof ctx?.agentTeams?.listMembers !== 'function') return null
    members = ctx.agentTeams.listMembers(agent)
  } catch {
    return null
  }
  return Array.isArray(members) ? members.length : null
}

/**
 * Enumerate live Leads and the soul commands each has registered.
 *
 * Command names are intersected with the names the current catalog would
 * register (prefix + soul name), so unrelated composer commands never leak
 * into the runtime card. When the reconciler's per-Lead registration record is
 * available, a name is reported only when THIS plugin's handler is the
 * effective one; a colliding soul command loses its name to the built-in
 * `/orchestrate` and must not be presented as a live soul command. A missing
 * service or record degrades to no rows / the legacy name-only view instead of
 * a failed overview.
 *
 * @param {object} ctx
 * @param {Map<string, string>} expectedCommands - registered command name -> soul name.
 * @param {object} [deps] - shared GUI deps (for `commandRegistration`).
 * @returns {LiveTeam[]}
 */
function liveTeams(ctx, expectedCommands, deps = {}) {
  /** @type {LiveTeam[]} */
  const teams = []
  /** @type {unknown[]} */
  let agents = []
  try {
    const listed = ctx?.agents?.list?.()
    if (Array.isArray(listed)) agents = listed
  } catch (error) {
    // A roster read failure means there is nothing live to report.
    agents = []
  }
  const teamService = ctx?.agentTeams
  const commands = serviceOf(ctx, 'commands')
  for (const agent of agents) {
    /** @type {{ role?: unknown, name?: unknown } | undefined} */
    let membership
    try {
      membership = typeof teamService?.tryMembership === 'function' ? teamService.tryMembership(agent) : undefined
    } catch {
      membership = undefined
    }
    if (!isRecord(membership) || membership.role !== 'lead') continue
    const record = typeof deps?.commandRegistration === 'function' ? deps.commandRegistration(agent) : undefined
    /** Handler-identity filter; without a record keep the legacy name view. */
    const isSoulRegistered = (commandName) => {
      const state = soulCommandRegistrationState(commands, agent, commandName, record)
      return state.known ? state.registered : true
    }
    /** @type {{ name: string, description: string }[]} */
    const registered = []
    const registeredNames = new Set()
    if (commands !== undefined && typeof commands.list === 'function') {
      /** @type {unknown[]} */
      let descriptors = []
      try {
        const listed = commands.list(agent)
        if (Array.isArray(listed)) descriptors = listed
      } catch {
        descriptors = []
      }
      for (const descriptor of descriptors) {
        const commandName = typeof descriptor?.name === 'string' ? descriptor.name : ''
        if (commandName === '' || !expectedCommands.has(commandName)) continue
        if (!isSoulRegistered(commandName)) continue
        registeredNames.add(commandName)
        registered.push({
          // The browser adds `settings.commandPrefix` when rendering, so expose
          // the soul name rather than the already-prefixed command name.
          name: expectedCommands.get(commandName),
          description: typeof descriptor.description === 'string' ? descriptor.description : '',
        })
      }
    } else if (commands !== undefined && typeof commands.find === 'function') {
      // Some compositions expose only the definition lookup; registration status
      // is still real, the description is simply unavailable.
      for (const [commandName, soulName] of expectedCommands) {
        /** @type {unknown} */
        let found
        try {
          found = commands.find(agent, commandName)
        } catch {
          found = undefined
        }
        if (found === undefined) continue
        if (!isSoulRegistered(commandName)) continue
        registeredNames.add(commandName)
        registered.push({
          name: soulName,
          description: isRecord(found) && typeof found.description === 'string' ? found.description : '',
        })
      }
    }
    // A list view can omit a scoped command that the definition lookup still
    // resolves; report the union so the runtime card never hides a registration.
    if (commands !== undefined && typeof commands.find === 'function') {
      for (const [commandName, soulName] of expectedCommands) {
        if (registeredNames.has(commandName)) continue
        /** @type {unknown} */
        let found
        try {
          found = commands.find(agent, commandName)
        } catch {
          found = undefined
        }
        if (found === undefined) continue
        if (!isSoulRegistered(commandName)) continue
        registeredNames.add(commandName)
        registered.push({
          name: soulName,
          description: isRecord(found) && typeof found.description === 'string' ? found.description : '',
        })
      }
    }
    teams.push({
      lead: typeof membership.name === 'string' && membership.name !== '' ? membership.name : 'lead',
      commands: registered,
      memberCount: memberCountOf(ctx, agent),
    })
  }
  return teams
}

/**
 * The registered LLM providers for the settings card.
 * @param {object} ctx
 * @returns {{ id: string, name: string }[]}
 */
function providersOf(ctx) {
  const llm = serviceOf(ctx, 'llm')
  if (llm === undefined || typeof llm.listProviders !== 'function') return []
  try {
    const listed = llm.listProviders()
    if (!Array.isArray(listed)) return []
    return listed
      .filter(provider => provider !== null && typeof provider === 'object' && typeof provider.id === 'string')
      .map(provider => ({
        id: provider.id,
        name: typeof provider.name === 'string' && provider.name !== '' ? provider.name : provider.id,
      }))
  } catch {
    return []
  }
}

/**
 * Collapse one description to one line, bounded by `MAX_TOOL_DESCRIPTION_CHARS`.
 * @param {unknown} value
 * @returns {string}
 */
function oneLineDescription(value) {
  const text = (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))
    .replace(/\s+/gu, ' ')
    .trim()
  if (text.length <= MAX_TOOL_DESCRIPTION_CHARS) return text
  return `${text.slice(0, MAX_TOOL_DESCRIPTION_CHARS - 1).trimEnd()}…`
}

/**
 * The committed working directory of one live Agent, or undefined.
 * @param {object} ctx
 * @param {object} agent
 * @returns {string | undefined}
 */
function sessionRootOf(ctx, agent) {
  const workingDirectory = serviceOf(ctx, 'workingDirectory')
  if (!isRecord(workingDirectory) || typeof workingDirectory.get !== 'function') return undefined
  try {
    const dir = workingDirectory.get(agent?.session)
    return typeof dir === 'string' && dir !== '' ? dir : undefined
  } catch {
    return undefined
  }
}

/**
 * Every live Team Lead with its workspace root, in roster order.
 * @param {object} ctx
 * @returns {{ agent: object, root: string | undefined }[]}
 */
function liveLeads(ctx) {
  /** @type {unknown[]} */
  let agents = []
  try {
    const listed = ctx?.agents?.list?.()
    if (Array.isArray(listed)) agents = listed
  } catch {
    return []
  }
  const leads = []
  for (const agent of agents) {
    /** @type {unknown} */
    let membership
    try {
      membership = typeof ctx?.agentTeams?.tryMembership === 'function' ? ctx.agentTeams.tryMembership(agent) : undefined
    } catch {
      membership = undefined
    }
    if (isRecord(membership) && membership.role === 'lead') leads.push({ agent, root: sessionRootOf(ctx, agent) })
  }
  return leads
}

/**
 * The live Lead that speaks for the workspace the GUI edits.
 *
 * Several Sessions from different workspaces can be live at once. Only the
 * Lead of the workspace whose soul directories the page is editing sees that
 * workspace's command registrations, so picking the roster's first Lead can
 * report a false "command collision". Prefer the Lead whose Session directory
 * equals the GUI's resolved root; fall back to the first Lead.
 *
 * @param {{ ctx?: object, root?: unknown, config?: object }} deps
 * @returns {object | undefined}
 */
function leadForGui(deps) {
  const leads = liveLeads(deps?.ctx)
  if (leads.length === 0) return undefined
  let guiRoot
  try {
    guiRoot = rootOf(deps)
  } catch {
    guiRoot = undefined
  }
  if (typeof guiRoot === 'string') {
    for (const candidate of leads) {
      if (candidate.root === guiRoot) return candidate.agent
    }
  }
  return leads[0].agent
}

/**
 * The first live Team Lead in the roster, or undefined when there is none.
 *
 * Catalogs (and the save validator) describe what a Lead can actually see in
 * this session; a missing roster, membership service, or failed lookup simply
 * degrades to "no live Lead".
 *
 * @param {object} ctx
 * @returns {object | undefined}
 */
function firstLiveLead(ctx) {
  /** @type {unknown[]} */
  let agents = []
  try {
    const listed = ctx?.agents?.list?.()
    if (Array.isArray(listed)) agents = listed
  } catch {
    return undefined
  }
  for (const agent of agents) {
    /** @type {unknown} */
    let membership
    try {
      membership = typeof ctx?.agentTeams?.tryMembership === 'function' ? ctx.agentTeams.tryMembership(agent) : undefined
    } catch {
      membership = undefined
    }
    if (isRecord(membership) && membership.role === 'lead') return agent
  }
  return undefined
}

/**
 * The overview catalog of restrictable tools: the first live Lead's visible
 * definitions minus the Team tools every teammate keeps, deduplicated by name,
 * sorted, with one-line descriptions.
 *
 * `source` is `'live-lead'` only when a Lead and the `tools` service are both
 * available; every failure degrades to an empty tool list (the browser then
 * skips unknown-tool validation rather than blocking saves).
 *
 * @param {object} ctx
 * @returns {{ source: 'live-lead' | 'none', tools: { name: string, description: string }[] }}
 */
function toolsCatalogOf(deps) {
  const ctx = deps?.ctx
  const lead = leadForGui(deps)
  if (lead === undefined) return { source: 'none', tools: [] }
  const toolsService = serviceOf(ctx, 'tools')
  if (!isRecord(toolsService) || typeof toolsService.definitions !== 'function') {
    return { source: 'none', tools: [] }
  }
  /** @type {unknown[]} */
  let definitions
  try {
    const listed = toolsService.definitions(lead)
    if (!Array.isArray(listed)) return { source: 'none', tools: [] }
    definitions = listed
  } catch (error) {
    return { source: 'none', tools: [] }
  }
  /** @type {{ name: string, description: string }[]} */
  const tools = []
  const seen = new Set()
  for (const definition of definitions) {
    const name = isRecord(definition) && typeof definition.name === 'string' ? definition.name.trim() : ''
    if (name === '' || TEAM_TOOL_NAME_SET.has(name) || LEAD_SCOPED_TOOL_NAME_SET.has(name) || seen.has(name)) continue
    seen.add(name)
    tools.push({ name, description: oneLineDescription(definition.description) })
  }
  tools.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  return { source: 'live-lead', tools }
}

/**
 * The overview catalog of routable models: every registered provider's
 * advertised model list. A provider whose catalog cannot be read contributes
 * nothing, and a missing `llm` service degrades to an empty list.
 *
 * @param {object} ctx
 * @returns {Promise<{ provider: string, model: string, name: string }[]>}
 */
async function modelsCatalogOf(ctx) {
  const llm = serviceOf(ctx, 'llm')
  if (!isRecord(llm) || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return []
  /** @type {unknown[]} */
  let providers
  try {
    const listed = llm.listProviders()
    if (!Array.isArray(listed)) return []
    providers = listed
  } catch {
    return []
  }
  /** @type {{ provider: string, model: string, name: string }[]} */
  const models = []
  const seen = new Set()
  for (const provider of providers) {
    const providerId = isRecord(provider) && typeof provider.id === 'string' ? provider.id.trim() : ''
    if (providerId === '') continue
    /** @type {unknown[]} */
    let listed
    try {
      const catalog = await llm.listModels(providerId)
      if (!Array.isArray(catalog)) continue
      listed = catalog
    } catch {
      continue
    }
    for (const model of listed) {
      const modelId = typeof model === 'string'
        ? model.trim()
        : isRecord(model) && typeof model.id === 'string' ? model.id.trim() : ''
      if (modelId === '') continue
      const key = `${providerId}\u0000${modelId}`
      if (seen.has(key)) continue
      seen.add(key)
      const name = isRecord(model) && typeof model.name === 'string' && model.name.trim() !== ''
        ? model.name.trim()
        : modelId
      models.push({ provider: providerId, model: modelId, name })
    }
  }
  return models
}

/**
 * The overview's first-run catalogs (tools + models); every failure degrades.
 * @param {object} deps
 * @returns {Promise<{ source: 'live-lead' | 'none',
 *   tools: { name: string, description: string }[],
 *   models: { provider: string, model: string, name: string }[] }>}
 */
async function catalogsOf(deps) {
  const { source, tools } = toolsCatalogOf(deps)
  /** @type {{ provider: string, model: string, name: string }[]} */
  let models = []
  try {
    models = await modelsCatalogOf(deps?.ctx)
  } catch (error) {
    warn(deps, `cannot read the LLM model catalog: ${messageOf(error)}`)
  }
  // Team tools are deliberately absent from `tools` (they are not restrictable),
  // but the browser needs their names to explain them instead of flagging them
  // as unknown in the orchestrator matrix (P4), where listing them is allowed.
  return { source, tools, models, teamTools: [...TEAM_TOOL_NAMES].sort() }
}

/**
 * Build the route-visible `fieldErrors` object from semantic diagnostics.
 *
 * The browser renders `fieldErrors[field]` under the matching control, so each
 * field maps to one message string; several diagnostics for the same field are
 * joined with `'; '`.
 *
 * @param {unknown} diagnostics
 * @returns {Record<string, string>}
 */
function fieldErrorsOf(diagnostics) {
  /** @type {Record<string, string>} */
  const fieldErrors = {}
  if (!Array.isArray(diagnostics)) return fieldErrors
  for (const diagnostic of diagnostics) {
    if (!isRecord(diagnostic)) continue
    const field = typeof diagnostic.field === 'string' ? diagnostic.field.trim() : ''
    const message = typeof diagnostic.message === 'string' ? diagnostic.message.trim() : ''
    if (field === '' || message === '') continue
    fieldErrors[field] = fieldErrors[field] === undefined ? message : `${fieldErrors[field]}; ${message}`
  }
  return fieldErrors
}

/**
 * Build the semantic validator the GUI's save route hands `saveDocument`.
 *
 * The checks are the P0 host-side equivalents of what a teammate spawn would
 * reject later anyway:
 *
 * - tool names must not be Team tools every teammate keeps, and when the live
 *   Lead advertises a tool catalog every name must exist there;
 * - a non-empty `model`/`provider`/`reasoning-effort` declaration must resolve
 *   through `deps.resolveModel` (a bad reasoning effort is reported against the
 *   reasoning-effort field when the route itself resolves);
 * - a name already used by another valid document in the same catalog is a
 *   duplicate (`name` field), excluding the file being saved.
 *
 * @param {object} deps
 * @param {string} root
 * @param {string | undefined} savedFile - the path being saved (excluded from duplicate detection).
 * @returns {(definition: object) => Promise<{ diagnostics: { field: string, message: string }[] }>}
 */
function saveValidator(deps, root, savedFile) {
  const savedTarget = typeof savedFile === 'string' && savedFile.trim() !== ''
    ? isAbsolute(savedFile) ? resolve(savedFile) : resolve(root, savedFile.trim())
    : null
  return async (definition) => {
    /** @type {{ field: string, message: string }[]} */
    const diagnostics = []

    const available = new Set((await catalogsOf(deps)).tools.map(tool => tool.name))
    if (Array.isArray(definition?.tools)) {
      for (const rawName of definition.tools) {
        const name = typeof rawName === 'string' ? rawName.trim() : ''
        if (name === '') continue
        if (LEAD_SCOPED_TOOL_NAME_SET.has(name)) {
          diagnostics.push({
            field: 'tools',
            message: `"${name}" is a Lead-only scoped tool and cannot be delegated to a teammate`,
          })
        } else if (TEAM_TOOL_NAME_SET.has(name)) {
          diagnostics.push({
            field: 'tools',
            message: `"${name}" is a Team tool every teammate keeps and cannot be restricted`,
          })
        } else if (available.size > 0 && !available.has(name)) {
          const shown = [...available].slice(0, 40).join(', ')
          diagnostics.push({
            field: 'tools',
            message: `"${name}" is not a tool visible in this session; restrictable tools: ${shown}${available.size > 40 ? ', …' : ''}`,
          })
        }
      }
    }

    if (typeof deps?.resolveModel === 'function') {
      const model = typeof definition?.model === 'string' ? definition.model : ''
      const provider = typeof definition?.provider === 'string' ? definition.provider : ''
      const reasoningEffort = typeof definition?.reasoningEffort === 'string' ? definition.reasoningEffort : ''
      if (model !== '' || provider !== '') {
        /** @type {{ model?: string, provider?: string }} */
        const raw = {}
        if (model !== '') raw.model = model
        if (provider !== '') raw.provider = provider
        let modelResolved = true
        try {
          const resolved = await deps.resolveModel(raw)
          if (resolved === null || resolved === undefined) {
            throw new Error('the model declaration could not be resolved to a registered route')
          }
        } catch (error) {
          modelResolved = false
          diagnostics.push({ field: model !== '' ? 'model' : 'provider', message: messageOf(error) })
        }
        // Only check the effort against a model that already resolved; otherwise
        // the model diagnostic above is the actionable one.
        if (modelResolved && reasoningEffort !== '') {
          try {
            await deps.resolveModel({ ...raw, reasoningEffort })
          } catch (error) {
            diagnostics.push({ field: 'reasoningEffort', message: messageOf(error) })
          }
        }
      } else if (reasoningEffort !== '') {
        // No model is declared: the resolver cannot verify the effort, so only a
        // hard rejection is reported (against the reasoning-effort field).
        try {
          await deps.resolveModel({ reasoningEffort })
        } catch (error) {
          diagnostics.push({ field: 'reasoningEffort', message: messageOf(error) })
        }
      }
    }

    const name = typeof definition?.name === 'string' ? definition.name : ''
    if (name !== '') {
      try {
        const listed = await listDocuments({ config: deps?.config, root })
        const duplicate = listed.documents.find((row) => {
          if (row.valid !== true || row.name !== name) return false
          if (savedTarget === null) return true
          return resolve(row.file) !== savedTarget
        })
        if (duplicate !== undefined) {
          diagnostics.push({
            field: 'name',
            message: `another soul named "${name}" already exists: ${duplicate.label}`,
          })
        }
      } catch (error) {
        warn(deps, `cannot check for duplicate soul names: ${messageOf(error)}`)
      }
    }
    return { diagnostics }
  }
}

/**
 * The prompt-catalog bullet for exactly one definition.
 *
 * The catalog formatter renders the header plus one bullet per definition; the
 * preview shows only this soul's own bullet ("how the Lead sees it"), so the
 * header is discarded and the first `- ` line is returned. '' when the formatter
 * yields nothing (which cannot happen for a normal valid definition).
 *
 * @param {object | undefined} definition
 * @param {string} [commandPrefix]
 * @returns {string}
 */
function catalogLineOf(definition, commandPrefix = '') {
  if (!isRecord(definition) || typeof definition.name !== 'string' || definition.name === '') return ''
  const text = catalogPromptText({ definitions: [definition] }, { commandPrefix })
  for (const line of text.split('\n')) if (line.startsWith('- ')) return line
  return ''
}

/**
 * Resolve one preview's declared model route.
 *
 * A document that inherits the Lead's model (no `model`/`provider` declaration)
 * reports null without asking the resolver. A declaration the resolver rejects,
 * or a malformed resolver result, also degrades to null: the preview can never
 * fail because of a model lookup.
 *
 * @param {object} deps
 * @param {object | undefined} definition
 * @returns {Promise<{ provider: string, model: string } | null>}
 */
async function previewResolvedModel(deps, definition) {
  if (!isRecord(definition) || typeof deps?.resolveModel !== 'function') return null
  const model = typeof definition.model === 'string' ? definition.model.trim() : ''
  const provider = typeof definition.provider === 'string' ? definition.provider.trim() : ''
  if (model === '' && provider === '') return null
  /** @type {{ model?: string, provider?: string, reasoningEffort?: string }} */
  const raw = {}
  if (model !== '') raw.model = model
  if (provider !== '') raw.provider = provider
  const reasoningEffort = typeof definition.reasoningEffort === 'string' ? definition.reasoningEffort.trim() : ''
  if (reasoningEffort !== '') raw.reasoningEffort = reasoningEffort
  try {
    const resolved = await deps.resolveModel(raw)
    if (!isRecord(resolved)) return null
    if (typeof resolved.provider !== 'string' || typeof resolved.model !== 'string') return null
    return { provider: resolved.provider, model: resolved.model }
  } catch {
    return null
  }
}

/**
 * The slash-command registration status for one draft.
 *
 * - `invalid-name`: the soul name (or the prefixed command name) could never
 *   be registered by the commands service, so no command exists;
 * - `ai-only`: the soul is valid but not `user-invocable`;
 * - `no-live-lead`: no live Team Lead / commands service can answer whether it
 *   is registered;
 * - `registered`: the live Lead's command list contains the prefixed name;
 * - `collision`: the name is invocable and a Lead exists, but the command is not
 *   registered — the soul's command lost its name to an existing/global
 *   command (or registration failed), matching the plugin's "use commandPrefix
 *   or rename" limitation.
 *
 * @param {object} deps
 * @param {{ name?: unknown, userInvocable?: unknown }} soul
 * @returns {{ name: string, registered: boolean, status: string }}
 */
function previewCommand(deps, soul) {
  const prefix = typeof deps?.config?.commandPrefix === 'string' ? deps.config.commandPrefix : ''
  const soulName = typeof soul?.name === 'string' ? soul.name.trim() : ''
  const name = soulName === '' ? '' : `${prefix}${soulName}`
  if (
    soulName === ''
    || !NAME_PATTERN.test(soulName)
    || soulName.length > MAX_NAME_CHARS
    || soulName === RESERVED_NAME
    || !COMMAND_NAME_PATTERN.test(name)
  ) {
    return { name, registered: false, status: 'invalid-name' }
  }
  if (soul?.userInvocable !== true) return { name, registered: false, status: 'ai-only' }
  const lead = leadForGui(deps)
  const commands = serviceOf(deps?.ctx, 'commands')
  if (lead === undefined || !isRecord(commands)) return { name, registered: false, status: 'no-live-lead' }
  // Handler identity first: the reconciler's per-Lead record knows whether THIS
  // soul's handler was registered. A name can be present in the registry while
  // belonging to another owner (the built-in `/orchestrate`), which raw
  // name-presence lookups would misreport as `registered`.
  const record = typeof deps?.commandRegistration === 'function' ? deps.commandRegistration(lead) : undefined
  const recordState = soulCommandRegistrationState(commands, lead, name, record)
  if (recordState.known) {
    return {
      name,
      registered: recordState.registered,
      status: recordState.registered ? 'registered' : 'collision',
      ...typeof recordState.reason === 'string' && recordState.reason !== '' ? { reason: recordState.reason } : {},
    }
  }
  if (typeof commands.list !== 'function' && typeof commands.find !== 'function') {
    return { name, registered: false, status: 'no-live-lead' }
  }
  // Fallback for compositions with no soul-registration record (an older Live
  // Lead): name presence is the only evidence available. Documented limitation.
  // Both lookups answer the same question from different paths of the command
  // registry; accept either as evidence so a list view that omits a scoped
  // command cannot report a false collision.
  /** @type {boolean} */
  let registered = false
  if (typeof commands.list === 'function') {
    try {
      const listed = commands.list(lead)
      if (Array.isArray(listed)) registered = listed.some(entry => isRecord(entry) && entry.name === name)
    } catch {
      registered = false
    }
  }
  if (!registered && typeof commands.find === 'function') {
    try {
      registered = commands.find(lead, name) !== undefined
    } catch {
      registered = false
    }
  }
  return { name, registered, status: registered ? 'registered' : 'collision' }
}

/** The soul's declared inherited-tool matrix: null = inherit, [] = deny all. */
function effectiveToolsOf(definition) {
  if (!isRecord(definition) || !Array.isArray(definition.tools)) return null
  return definition.tools
}

/**
 * The last-resort preview payload: always `ok: true`, never throws.
 * @param {unknown} error
 * @returns {object}
 */
function previewFailure(error) {
  return {
    ok: true,
    valid: false,
    diagnostics: [{ message: `cannot preview the soul document: ${messageOf(error)}` }],
    fieldErrors: {},
    composedSource: '',
    persona: '',
    catalogLine: '',
    resolvedModel: null,
    effectiveTools: null,
    command: { name: '', registered: false, status: 'invalid-name' },
  }
}

/**
 * Build the no-write preview of one draft.
 *
 * The draft is either `fields`/`sections` (composed exactly like a save) or a
 * raw `source` (used verbatim), then parsed and run through the same P0
 * semantic validator a save uses. Duplicate-name errors caused by the file being
 * previewed are excluded by passing its path to the validator. Invalid content
 * is not an error: the response is still `ok: true` with `valid: false` and the
 * diagnostics/fieldErrors the editor renders.
 *
 * `persona`, `catalogLine`, `resolvedModel`, and `effectiveTools` describe the
 * parsed definition and are ''/null when the composed document has no valid definition.
 *
 * @param {object} deps
 * @param {Record<string, unknown>} payload
 * @returns {Promise<object>}
 */
async function buildPreview(deps, payload) {
  try {
    const root = rootOf(deps)
    /** @type {string} */
    let composedSource
    if (typeof payload.source === 'string') {
      composedSource = payload.source
    } else {
      const fields = isRecord(payload.fields) ? payload.fields : {}
      const sections = isRecord(payload.sections) ? payload.sections : {}
      composedSource = composeDocument({ fields, sections }).source
    }
    const split = splitDocument(composedSource)
    const parsed = parseSoulMarkdown(composedSource)
    const definition = parsed.definition
    // Parser diagnostics can name the frontmatter field they belong to (for
    // example the reserved `name: lead` refusal); keep the tag so the editor
    // can focus the matching control instead of showing a generic banner.
    /** @type {{ message: string, field?: string }[]} */
    let diagnostics = parsed.diagnostics.map(diagnostic => ({
      message: diagnostic.message,
      ...typeof diagnostic.field === 'string' ? { field: diagnostic.field } : {},
    }))
    const file = typeof payload.file === 'string' && payload.file.trim() !== ''
      ? isAbsolute(payload.file) ? payload.file : resolve(root, payload.file.trim())
      : undefined
    if (definition !== undefined) {
      const semantic = await saveValidator(deps, root, file)(definition)
      diagnostics = [...diagnostics, ...semantic.diagnostics]
    }
    return {
      ok: true,
      valid: definition !== undefined && diagnostics.length === 0,
      diagnostics,
      fieldErrors: fieldErrorsOf(diagnostics),
      composedSource,
      persona: definition === undefined ? '' : composePersona(definition),
      catalogLine: definition === undefined ? '' : catalogLineOf(definition, deps?.config?.commandPrefix),
      resolvedModel: await previewResolvedModel(deps, definition),
      effectiveTools: effectiveToolsOf(definition),
      command: previewCommand(deps, definition ?? split.fields),
    }
  } catch (error) {
    warn(deps, `soul preview failed: ${messageOf(error)}`)
    return previewFailure(error)
  }
}

/**
 * The absolute bindings document path for one workspace root.
 * @param {object} deps
 * @param {string} root
 * @returns {string}
 */
function bindingsPathOf(deps, root) {
  const spec = typeof deps?.config?.bindingsFile === 'string' && deps.config.bindingsFile.trim() !== ''
    ? deps.config.bindingsFile
    : CONFIG_DEFAULTS.bindingsFile
  try {
    if (typeof deps?.bindings?.filePath === 'function') {
      const path = deps.bindings.filePath(root)
      if (typeof path === 'string' && path !== '') return path
    }
  } catch {
    // Fall through to the local resolution.
  }
  return isAbsolute(spec) ? spec : join(root, spec)
}

/**
 * Resolve one document's `modelResolved` for the overview.
 *
 * The raw `model` value alone may be ambiguous (a bare model shared by several
 * providers); the document detail supplies the frontmatter `provider` and
 * `reasoning-effort` too. Any resolution failure degrades to null, matching a
 * document that inherits or cannot resolve a model.
 *
 * @param {object} deps
 * @param {string} root
 * @param {object} row - one DocumentSummary.
 * @returns {Promise<string | null>}
 */
async function resolveRowModel(deps, root, row) {
  if (typeof row?.model !== 'string' || row.model === '' || typeof deps?.resolveModel !== 'function') return null
  /** @type {{ provider?: string, reasoningEffort?: string }} */
  let raw = {}
  try {
    const detail = await readDocument({ config: deps.config, root, file: row.file })
    if (detail.ok) {
      const fields = detail.document.fields
      if (typeof fields.provider === 'string' && fields.provider !== '') raw.provider = fields.provider
      if (typeof fields.reasoningEffort === 'string' && fields.reasoningEffort !== '') raw.reasoningEffort = fields.reasoningEffort
    }
  } catch {
    // The raw model still resolves through the deps resolver's own fallbacks.
  }
  try {
    const resolved = await deps.resolveModel({ model: row.model, ...raw })
    if (resolved === null || resolved === undefined) return null
    if (typeof resolved.provider !== 'string' || typeof resolved.model !== 'string') return null
    return `${resolved.provider}/${resolved.model}`
  } catch {
    return null
  }
}

/**
 * Read every durable binding row for the usage panel.
 *
 * A missing store (older deployments, backend-only compositions) or a throwing
 * read is an empty list: soul usage is informative, never a route failure.
 *
 * @param {object} deps
 * @param {string} root
 * @returns {Promise<object[]>}
 */
async function bindingRowsOf(deps, root) {
  if (typeof deps?.bindings?.list !== 'function') return []
  try {
    const rows = await deps.bindings.list(root)
    return Array.isArray(rows) ? rows : []
  } catch (error) {
    warn(deps, `cannot list soul bindings for usage: ${messageOf(error)}`)
    return []
  }
}

/**
 * Group binding rows by soul name and by the Session id they belong to.
 *
 * @param {object[]} bindings - rows from `createBindingStore.list`.
 * @returns {{ countsByName: Map<string, number>, lastUsedByName: Map<string, number>,
 *   namesByChild: Map<string, Set<string>> }}
 */
function bindingUsageIndex(bindings) {
  /** @type {Map<string, number>} */
  const countsByName = new Map()
  /** @type {Map<string, number>} */
  const lastUsedByName = new Map()
  /** @type {Map<string, Set<string>>} */
  const namesByChild = new Map()
  for (const binding of bindings) {
    if (!isRecord(binding)) continue
    const name = typeof binding.name === 'string' && binding.name !== '' ? binding.name : ''
    if (name === '') continue
    countsByName.set(name, (countsByName.get(name) ?? 0) + 1)
    if (typeof binding.savedAt === 'number' && Number.isFinite(binding.savedAt)) {
      const previous = lastUsedByName.get(name)
      if (previous === undefined || binding.savedAt > previous) lastUsedByName.set(name, binding.savedAt)
    }
    const childId = typeof binding.childId === 'string' && binding.childId !== '' ? binding.childId : ''
    if (childId === '') continue
    let names = namesByChild.get(childId)
    if (names === undefined) {
      names = new Set()
      namesByChild.set(childId, names)
    }
    names.add(name)
  }
  return { countsByName, lastUsedByName, namesByChild }
}

/**
 * Live teammate member names per soul name.
 *
 * Only live teammates (`tryMembership(...).role === 'teammate'`) whose Session
 * id has a binding for the soul count; the Lead and unrelated members do not.
 * Names are deduplicated across several Sessions of the same teammate name.
 *
 * @param {object} ctx
 * @param {Map<string, Set<string>>} namesByChild - Session id -> soul names.
 * @returns {Map<string, Set<string>>} soul name -> live member names.
 */
function activeMembersBySoul(ctx, namesByChild) {
  /** @type {Map<string, Set<string>>} */
  const active = new Map()
  if (namesByChild.size === 0) return active
  /** @type {unknown[]} */
  let agents = []
  try {
    const listed = ctx?.agents?.list?.()
    if (Array.isArray(listed)) agents = listed
  } catch {
    agents = []
  }
  const teamService = ctx?.agentTeams
  for (const agent of agents) {
    const childId = isRecord(agent) && typeof agent.id === 'string' ? agent.id : ''
    if (childId === '' || !namesByChild.has(childId)) continue
    /** @type {unknown} */
    let membership
    try {
      membership = typeof teamService?.tryMembership === 'function' ? teamService.tryMembership(agent) : undefined
    } catch {
      membership = undefined
    }
    if (!isRecord(membership) || membership.role !== 'teammate') continue
    const memberName = typeof membership.name === 'string' && membership.name !== '' ? membership.name : childId
    for (const name of namesByChild.get(childId) ?? []) {
      let members = active.get(name)
      if (members === undefined) {
        members = new Set()
        active.set(name, members)
      }
      members.add(memberName)
    }
  }
  return active
}

/**
 * The overview `usage` block for one document row.
 *
 * Rows without a usable soul name (an unparseable file) report an empty
 * usage block rather than matching unrelated bindings.
 *
 * @param {object} row - one DocumentSummary.
 * @param {{ countsByName: Map<string, number>, lastUsedByName: Map<string, number>,
 *   namesByChild: Map<string, Set<string>> }} usageIndex
 * @param {Map<string, Set<string>>} activeMembers
 * @returns {{ storedCount: number, lastUsedAt: number | null, activeMembers: string[] }}
 */
function usageOf(row, usageIndex, activeMembers) {
  const name = typeof row?.name === 'string' && row.name !== '' ? row.name : ''
  if (name === '') return { storedCount: 0, lastUsedAt: null, activeMembers: [] }
  const lastUsedAt = usageIndex.lastUsedByName.get(name)
  const members = activeMembers.get(name)
  return {
    storedCount: usageIndex.countsByName.get(name) ?? 0,
    lastUsedAt: typeof lastUsedAt === 'number' ? lastUsedAt : null,
    activeMembers: members === undefined ? [] : [...members].sort(),
  }
}

/**
 * The overview `commandStatus` block for one document row.
 *
 * Delegates to the exact P1 `previewCommand` computation so a scanned document
 * and its editor preview always agree on `name`/`status`. A short `message` is
 * added only where the status alone does not explain the next step: a
 * `collision` (the live Lead does not list the invocable command) or
 * `no-live-lead` (nothing can confirm registration).
 *
 * @param {object} deps
 * @param {object} row - one DocumentSummary.
 * @returns {{ name: string, status: string, message?: string }}
 */
function commandStatusOf(deps, row) {
  const command = previewCommand(deps, {
    name: typeof row?.name === 'string' ? row.name : '',
    userInvocable: row?.userInvocable === true,
  })
  /** @type {{ name: string, status: string, message?: string }} */
  const status = { name: command.name, status: command.status }
  if (command.status === 'collision') {
    status.message = 'the live Lead does not list this command; the name may already be in use, or registration failed'
  } else if (command.status === 'no-live-lead') {
    status.message = 'no live Team Lead is connected, so the command is neither registered nor confirmed'
  }
  return status
}

/**
 * The definition fields the catalog formatter reads, taken from one scanned row.
 *
 * The overview does not keep parsed definitions (the document layer's summaries
 * are enough for the list), so this row-shaped definition feeds the same
 * `catalogLineOf` helper the preview route uses.
 *
 * @param {object} row - one DocumentSummary.
 * @returns {object}
 */
function catalogDefinitionOf(row) {
  return {
    name: typeof row?.name === 'string' ? row.name : '',
    description: typeof row?.description === 'string' ? row.description : '',
    tools: Array.isArray(row?.tools) ? row.tools : null,
    model: typeof row?.model === 'string' ? row.model : undefined,
    userInvocable: row?.userInvocable === true,
  }
}

/**
 * Soul names used by more than one valid document, sorted for display.
 * @param {object[]} documents
 * @returns {string[]}
 */
function duplicateNamesOf(documents) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const row of documents) {
    if (row?.valid !== true || typeof row.name !== 'string' || row.name === '') continue
    counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort()
}

/** Budget large enough that the health measurement includes every catalog entry. */
const HEALTH_CATALOG_BUDGET = 10_000_000

/**
 * Build the P2 runtime health block.
 *
 * `definitions.used` counts every valid document the scan found, so a workspace
 * that exceeds `maxDefinitions` shows the over-budget number (the scan
 * diagnostic names how many were ignored). `catalogChars.used` is the full
 * rendered catalog prompt text, measured with a budget large enough to include
 * every entry, so it can exceed `maxPromptChars` and expose the over-budget
 * state; with no usable snapshot it is 0.
 *
 * @param {{ documents: object[], diagnostics: unknown[], snapshot: unknown,
 *   validCount: number, maxDefinitions: number, maxPromptChars: number, commandPrefix?: string,
 *   teamTools?: object }} input
 * @returns {{ duplicates: string[], invalidFiles: number,
 *   definitions: { used: number, max: number },
 *   catalogChars: { used: number, max: number }, diagnostics: number, teamTools: object }}
 */
function healthOf({ documents, diagnostics, snapshot, validCount, maxDefinitions, maxPromptChars, commandPrefix = '', teamTools }) {
  let catalogCharsUsed = 0
  if (isRecord(snapshot) && Array.isArray(snapshot.definitions)) {
    const promptText = catalogPromptText(snapshot, { maxPromptChars: HEALTH_CATALOG_BUDGET, commandPrefix })
    catalogCharsUsed = typeof promptText === 'string' ? promptText.length : 0
  }
  return {
    duplicates: duplicateNamesOf(documents),
    invalidFiles: Math.max(0, documents.length - validCount),
    definitions: { used: validCount, max: maxDefinitions },
    catalogChars: { used: catalogCharsUsed, max: maxPromptChars },
    diagnostics: Array.isArray(diagnostics) ? diagnostics.length : 0,
    teamTools: isRecord(teamTools) ? teamTools : inspectTeamToolSurface(undefined),
  }
}

/**
 * Build the overview payload.
 *
 * `scannedAt` comes from the plugin catalog's refresh (the authoritative scan
 * clock), while the row list comes from the document layer so invalid files
 * remain visible with their diagnostics. Live Team command status is real
 * (registered in the Lead's command scope), not inferred from the frontmatter.
 *
 * The P0 `catalogs` object exposes what a save can legally name right now: the
 * first live Lead's restrictable tools and the llm service's advertised models.
 * Every catalog lookup degrades (to `source: 'none'` / empty arrays) instead of
 * failing the overview.
 *
 * The P2 additions all reuse that same state: one binding-list read feeds every
 * row's usage, command status reuses `previewCommand`, catalog lines reuse
 * `catalogLineOf`, and health reuses the refreshed catalog snapshot.
 *
 * @param {object} deps
 * @returns {Promise<object>}
 */
async function buildOverview(deps) {
  const root = rootOf(deps)
  const config = isRecord(deps?.config) ? deps.config : {}
  const listed = await listDocuments({ config, root, logger: deps?.logger })
  let snapshot
  let scannedAt = null
  try {
    snapshot = await deps?.catalog?.refresh?.(root)
    if (isRecord(snapshot) && typeof snapshot.scannedAt === 'number' && snapshot.scannedAt > 0) scannedAt = snapshot.scannedAt
  } catch (error) {
    warn(deps, `soul overview scan failed: ${messageOf(error)}`)
  }
  // Files edited outside the GUI also become live commands once the page reads
  // the catalog; reconcile before command status is computed below.
  try {
    await deps?.syncSouls?.()
  } catch (error) {
    warn(deps, `soul command sync during overview failed: ${messageOf(error)}`)
  }
  if (scannedAt === null && typeof listed.scannedAt === 'number') scannedAt = listed.scannedAt
  const commandPrefix = typeof config.commandPrefix === 'string' ? config.commandPrefix : CONFIG_DEFAULTS.commandPrefix
  const maxDefinitions = Number.isFinite(config.maxDefinitions) ? config.maxDefinitions : CONFIG_DEFAULTS.maxDefinitions
  const maxPromptChars = Number.isFinite(config.maxPromptChars) ? config.maxPromptChars : CONFIG_DEFAULTS.maxPromptChars
  /** @type {Map<string, string>} */
  const expectedCommands = new Map()
  const definitions = isRecord(snapshot) && Array.isArray(snapshot.definitions) ? snapshot.definitions : null
  if (definitions !== null) {
    for (const definition of definitions) {
      if (definition?.userInvocable === true && typeof definition.name === 'string' && definition.name !== '') {
        expectedCommands.set(`${commandPrefix}${definition.name}`, definition.name)
      }
    }
  } else {
    for (const row of listed.documents) {
      if (row.valid && row.userInvocable && typeof row.name === 'string' && row.name !== '') {
        expectedCommands.set(`${commandPrefix}${row.name}`, row.name)
      }
    }
  }
  const teams = liveTeams(deps?.ctx, expectedCommands, deps)
  // One binding read feeds every row: rows are grouped by the stored soul
  // name, and live teammate Sessions are correlated by their Session id.
  const usageIndex = bindingUsageIndex(await bindingRowsOf(deps, root))
  const activeMembers = activeMembersBySoul(deps?.ctx, usageIndex.namesByChild)
  /** @type {object[]} */
  const documents = []
  for (const row of listed.documents) {
    // The row's `/name` display means "registered", so it must use the same
    // handler-aware status as the chip: a colliding soul command is not live
    // even though the name exists in the registry (the built-in owns it).
    const commandStatus = commandStatusOf(deps, row)
    const command = commandStatus.status === 'registered' ? `/${commandPrefix}${row.name}` : null
    documents.push({
      ...row,
      modelResolved: await resolveRowModel(deps, root, row),
      command,
      usage: usageOf(row, usageIndex, activeMembers),
      commandStatus,
      catalogLine: row.valid === true ? catalogLineOf(catalogDefinitionOf(row), commandPrefix) : '',
    })
  }
  let bindingsCount = null
  try {
    if (typeof deps?.bindings?.size === 'function') {
      const size = await deps.bindings.size(root)
      bindingsCount = typeof size === 'number' && Number.isFinite(size) ? size : null
    }
  } catch (error) {
    warn(deps, `cannot read the soul binding store: ${messageOf(error)}`)
    bindingsCount = null
  }
  // The catalog snapshot is the authoritative diagnostics set when its scan
  // succeeded (it also reports duplicate names and maxDefinitions overflow);
  // otherwise the document layer's scan diagnostics are all that is known.
  const scanDiagnostics = isRecord(snapshot) && Array.isArray(snapshot.diagnostics)
    ? snapshot.diagnostics
    : listed.diagnostics
  const diagnostics = scanDiagnostics.map(diagnostic => ({
    source: typeof diagnostic.source === 'string' ? diagnostic.source : root,
    message: typeof diagnostic.message === 'string' ? diagnostic.message : String(diagnostic.message ?? ''),
  }))
  const validCount = documents.filter(document => document.valid === true).length
  // The Team-tool row composition is informational: a Loader-less composition
  // reports `unknown` and every other page capability keeps working.
  let teamTools
  try {
    teamTools = deps?.composition?.inspect?.() ?? inspectTeamToolSurface(deps?.ctx)
  } catch (error) {
    warn(deps, `cannot inspect the Team-tool composition: ${messageOf(error)}`)
    teamTools = inspectTeamToolSurface(undefined)
  }
  // Health is computed from data already read for the page. Any unexpected
  // failure while formatting the catalog prompt degrades to a shaped default
  // instead of turning the whole overview into a 500.
  let health
  try {
    health = healthOf({
      documents,
      diagnostics: scanDiagnostics,
      snapshot,
      validCount,
      maxDefinitions,
      maxPromptChars,
      commandPrefix,
      teamTools,
    })
  } catch (error) {
    warn(deps, `cannot compute runtime health: ${messageOf(error)}`)
    health = {
      duplicates: [],
      invalidFiles: Math.max(0, documents.length - validCount),
      definitions: { used: validCount, max: maxDefinitions },
      catalogChars: { used: 0, max: maxPromptChars },
      diagnostics: Array.isArray(scanDiagnostics) ? scanDiagnostics.length : 0,
      teamTools,
    }
  }
  const pluginMeta = isRecord(deps?.pluginMeta) ? deps.pluginMeta : {}
  const catalogs = await catalogsOf(deps)
  // The orchestrator card is informative, never load-bearing: a read failure is
  // summarized as an invalid block instead of failing the whole overview.
  /** @type {object} */
  let orchestrator
  try {
    orchestrator = await orchestratorSummary({
      config,
      root,
      resolveModel: deps?.resolveModel,
      logger: deps?.logger,
    })
  } catch (error) {
    warn(deps, `cannot summarize the orchestrator definition: ${messageOf(error)}`)
    orchestrator = {
      path: '',
      configured: false,
      bundled: false,
      sourcePath: null,
      valid: false,
      name: 'orchestrator',
      model: '',
      modelResolved: null,
      tools: null,
      planFirst: false,
      gateMode: 'off',
      maxRetries: 0,
      pauseOnFatal: false,
      diagnostics: [{ message: `cannot read the orchestrator definition: ${messageOf(error)}` }],
    }
  }
  // The default-Soul card resolves against the same live definitions the row
  // validators used; a broken preferences file is visible, never fatal.
  const preferenceDefinitions = definitions !== null
    ? definitions
    : documents.filter(document => document.valid === true)
      .map(document => ({ name: document.name }))
  const preferences = await preferencesBlockOf(deps, root, preferenceDefinitions)
  return {
    plugin: {
      name: typeof pluginMeta.name === 'string' && pluginMeta.name !== '' ? pluginMeta.name : PLUGIN_META_DEFAULTS.name,
      version: typeof pluginMeta.version === 'string' && pluginMeta.version !== ''
        ? pluginMeta.version
        : PLUGIN_META_DEFAULTS.version,
      root,
    },
    settings: {
      dirs: Array.isArray(config.dirs) ? config.dirs.filter(dir => typeof dir === 'string') : [],
      resolvedDirs: resolveSoulDirs(config, root),
      bundled: typeof config.bundled === 'boolean' ? config.bundled : CONFIG_DEFAULTS.bundled,
      bundledDir: bundledSoulsDir(config),
      bindingsFile: typeof config.bindingsFile === 'string' ? config.bindingsFile : CONFIG_DEFAULTS.bindingsFile,
      bindingsPath: bindingsPathOf(deps, root),
      commandPrefix,
      defaultContext: typeof config.defaultContext === 'string' ? config.defaultContext : CONFIG_DEFAULTS.defaultContext,
      freshProvider: typeof config.freshProvider === 'string' ? config.freshProvider : CONFIG_DEFAULTS.freshProvider,
      forkProvider: typeof config.forkProvider === 'string' ? config.forkProvider : CONFIG_DEFAULTS.forkProvider,
      interrupt: typeof config.interrupt === 'boolean' ? config.interrupt : CONFIG_DEFAULTS.interrupt,
      maxDefinitions,
      maxPromptChars,
      providers: providersOf(deps?.ctx),
    },
    runtime: {
      scannedAt,
      validCount,
      invalidCount: documents.length - validCount,
      bindingsCount,
      liveTeams: teams,
      health,
    },
    catalogs,
    orchestrator,
    preferences,
    documents,
    diagnostics,
  }
}

/**
 * `GET /agent-soul/overview`.
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleOverview(deps, req, res) {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  const scoped = requestScope(deps, queryParameter(req, 'root'), res)
  if (scoped === null) return
  sendJson(res, 200, await buildOverview(scoped))
}

/**
 * `GET /agent-soul/document?file=…`.
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleReadDocument(deps, req, res) {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  const scoped = requestScope(deps, queryParameter(req, 'root'), res)
  if (scoped === null) return
  const root = rootOf(scoped)
  const file = queryParameter(req, 'file')
  const result = await readDocument({ config: scoped.config, root, file: file ?? undefined })
  if (!result.ok) {
    if (result.code === 'unsafe-path') {
      sendJson(res, 400, { ok: false, code: 'unsafe-path', message: result.message })
    } else if (result.code === 'not-found') {
      sendJson(res, 404, { ok: false, code: 'not-found', message: result.message })
    } else {
      sendJson(res, 400, { ok: false, code: 'invalid-request', message: result.message })
    }
    return
  }
  sendJson(res, 200, { document: result.document })
}

/**
 * `POST /agent-soul/parse`.
 *
 * Splits pasted Markdown into the editable fields/sections using the same
 * splitter the document GET returns, and validates it with the plugin parser.
 * Nothing is read from disk or written.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleParseDocument(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  if (typeof body.value.source !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'source must be a string' })
    return
  }
  const split = splitDocument(body.value.source)
  sendJson(res, 200, {
    ok: true,
    fields: split.fields,
    sections: split.sections,
    valid: split.valid,
    diagnostics: split.diagnostics,
  })
}

/**
 * `POST /agent-soul/preview`.
 *
 * No-write live feedback for the draft editor: composes (or takes raw source),
 * parses, and runs the same semantic validators a save uses. Invalid content is
 * still a 200 `{ ok: true, valid: false }` result so the browser can render
 * diagnostics while the person types; only a malformed wire body is a 400.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handlePreview(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  const payload = body.value
  if (payload.fields !== undefined && payload.fields !== null && !isRecord(payload.fields)) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'fields must be an object' })
    return
  }
  if (payload.sections !== undefined && payload.sections !== null && !isRecord(payload.sections)) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'sections must be an object' })
    return
  }
  if (payload.source !== undefined && payload.source !== null && typeof payload.source !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'source must be a string' })
    return
  }
  if (payload.file !== undefined && payload.file !== null && typeof payload.file !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'file must be a string path' })
    return
  }
  sendJson(res, 200, await buildPreview(scoped, payload))
}

/**
 * Send the shared document-save failure payload (fields and raw-source modes).
 *
 * A stale save is 409 with the hash the browser can retry against; a parser or
 * semantic refusal is 400 `invalid` with `fieldErrors` (an empty object when no
 * diagnostic names a form field, so the browser can read it unconditionally).
 *
 * @param {object} res
 * @param {{ ok: false, code: string, message: string,
 *   diagnostics?: { message: string, field?: string }[],
 *   currentHash?: string | null, currentModifiedAt?: number }} result
 * @returns {void}
 */
function sendSaveFailure(res, result) {
  if (result.code === 'conflict') {
    sendJson(res, 409, {
      ok: false,
      code: 'conflict',
      message: result.message,
      currentHash: result.currentHash ?? null,
      currentModifiedAt: typeof result.currentModifiedAt === 'number' ? result.currentModifiedAt : 0,
    })
    return
  }
  const fieldErrors = result.code === 'invalid' ? fieldErrorsOf(result.diagnostics) : {}
  sendJson(res, 400, {
    ok: false,
    code: result.code,
    message: result.message,
    ...Array.isArray(result.diagnostics) ? { diagnostics: result.diagnostics } : {},
    ...result.code === 'invalid' ? { fieldErrors } : {},
  })
}

/**
 * `POST /agent-soul/document`.
 *
 * Accepts the editable `fields`/`sections`, or a raw Markdown `source` instead of
 * both (the raw-mode save path), plus the optional P0 keys:
 *
 * - `expectedHash`: optimistic concurrency; a stale/missing file answers 409
 *   `conflict` with `currentHash`/`currentModifiedAt` and writes nothing;
 * - `expectedMissing: true`: guarded no-replace recreation of a missing file;
 * - the semantic validator below (`saveValidator`) rejects Team tool names,
 *   unknown tools, unresolvable model declarations, and duplicate names with
 *   400 `invalid` plus a `fieldErrors` object the browser renders inline.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleSaveDocument(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  const payload = body.value
  if (payload.file !== undefined && payload.file !== null && typeof payload.file !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'file must be a string path' })
    return
  }
  if (payload.expectedHash !== undefined && payload.expectedHash !== null && typeof payload.expectedHash !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'expectedHash must be a string' })
    return
  }
  if (payload.expectedMissing !== undefined && payload.expectedMissing !== null && typeof payload.expectedMissing !== 'boolean') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'expectedMissing must be a boolean' })
    return
  }
  if (payload.fields !== undefined && !isRecord(payload.fields)) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'fields must be an object' })
    return
  }
  if (payload.sections !== undefined && !isRecord(payload.sections)) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'sections must be an object' })
    return
  }
  if (payload.source !== undefined && payload.source !== null && typeof payload.source !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'source must be a string' })
    return
  }
  const root = rootOf(scoped)
  const file = typeof payload.file === 'string' ? payload.file : undefined
  // Empty is not a SHA-256 and remains guarded. A deliberate recreate must use
  // expectedMissing:true, which also publishes with atomic no-replace semantics.
  const expectedHash = typeof payload.expectedHash === 'string' ? payload.expectedHash : undefined
  const expectedMissing = payload.expectedMissing === true
  const validate = saveValidator(scoped, root, file)
  if (typeof payload.source === 'string') {
    // Raw Markdown mode: the file text is written verbatim after validation.
    const result = await saveDocumentSource({
      config: scoped.config,
      root,
      file,
      source: payload.source,
      expectedHash,
      expectedMissing,
      validate,
    })
    if (!result.ok) {
      sendSaveFailure(res, result)
      return
    }
    await rescan(scoped, root)
    sendJson(res, 200, { ok: true, document: result.document })
    return
  }
  const result = await saveDocument({
    config: scoped.config,
    root,
    file,
    fields: isRecord(payload.fields) ? payload.fields : {},
    sections: isRecord(payload.sections) ? payload.sections : {},
    expectedHash,
    expectedMissing,
    validate,
  })
  if (!result.ok) {
    sendSaveFailure(res, result)
    return
  }
  await rescan(scoped, root)
  sendJson(res, 200, { ok: true, document: result.document })
}

/**
 * `POST /agent-soul/create`.
 *
 * Creates the canonical skeleton, or the optional validated `source` template
 * text, as `<first dir>/<name>.md`.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleCreateDocument(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  if (body.value.source !== undefined && body.value.source !== null && typeof body.value.source !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'source must be a string' })
    return
  }
  const root = rootOf(scoped)
  const result = await createDocument({
    config: scoped.config,
    root,
    name: body.value.name,
    source: typeof body.value.source === 'string' ? body.value.source : undefined,
    validate: saveValidator(scoped, root, undefined),
  })
  if (!result.ok) {
    sendJson(res, 400, {
      ok: false,
      code: result.code,
      message: result.message,
      ...Array.isArray(result.diagnostics) ? { diagnostics: result.diagnostics } : {},
      ...result.code === 'invalid' ? { fieldErrors: fieldErrorsOf(result.diagnostics) } : {},
    })
    return
  }
  await rescan(scoped, root)
  sendJson(res, 200, { ok: true, document: result.document })
}

/**
 * `POST /agent-soul/duplicate`.
 *
 * Copies the source document under `name` in the first configured directory;
 * 400 carries `invalid-name` / `exists` / `not-found` / `invalid` / `unsafe-path`.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleDuplicateDocument(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  const payload = body.value
  if (payload.file !== undefined && payload.file !== null && typeof payload.file !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'file must be a string path' })
    return
  }
  if (payload.name !== undefined && payload.name !== null && typeof payload.name !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'name must be a string' })
    return
  }
  const root = rootOf(scoped)
  const result = await duplicateDocument({
    config: scoped.config,
    root,
    file: payload.file,
    name: payload.name,
    validate: saveValidator(scoped, root, undefined),
  })
  if (!result.ok) {
    sendJson(res, 400, {
      ok: false,
      code: result.code,
      message: result.message,
      ...Array.isArray(result.diagnostics) ? { diagnostics: result.diagnostics } : {},
      ...result.code === 'invalid' ? { fieldErrors: fieldErrorsOf(result.diagnostics) } : {},
    })
    return
  }
  await rescan(scoped, root)
  sendJson(res, 200, { ok: true, document: result.document })
}

/**
 * `POST /agent-soul/delete`.
 *
 * The document layer moves the file into the trash when it can, so the 200
 * response carries `trashedFile`; the browser offers Undo with it. A hard-delete
 * fallback omits `trashedFile`.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleDeleteDocument(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  const root = rootOf(scoped)
  const result = await deleteDocument({
    config: scoped.config,
    root,
    file: body.value.file,
  })
  if (!result.ok) {
    sendJson(res, 400, { ok: false, code: result.code, message: result.message })
    return
  }
  await rescan(scoped, root)
  sendJson(res, 200, {
    ok: true,
    ...typeof result.trashedFile === 'string' && result.trashedFile !== '' ? { trashedFile: result.trashedFile } : {},
  })
}

/**
 * `POST /agent-soul/restore`.
 *
 * Moves a previously trashed document back to `file`; both paths are fenced by
 * the document layer (trash directory / configured soul directory).
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleRestoreDocument(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  const root = rootOf(scoped)
  const result = await restoreDocument({
    config: scoped.config,
    root,
    trashedFile: body.value.trashedFile,
    file: body.value.file,
  })
  if (!result.ok) {
    sendJson(res, 400, { ok: false, code: result.code, message: result.message })
    return
  }
  await rescan(scoped, root)
  sendJson(res, 200, { ok: true, document: result.document })
}

/**
 * `GET /agent-soul/orchestrator`.
 *
 * Answers the one Lead-scoped orchestrator definition. A missing file is not a
 * 404: the contract asks for `configured: false` plus the canonical skeleton, so
 * the browser can render the same editor or create the file from it.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleReadOrchestrator(deps, req, res) {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  const scoped = requestScope(deps, queryParameter(req, 'root'), res)
  if (scoped === null) return
  const root = rootOf(scoped)
  const result = await readOrchestrator({ config: scoped.config, root })
  if (!result.ok) {
    sendJson(res, 400, { ok: false, code: result.code, message: result.message })
    return
  }
  sendJson(res, 200, { ok: true, orchestrator: result.orchestrator })
}

/**
 * `POST /agent-soul/orchestrator`.
 *
 * Accepts raw Markdown (`source`, validated and written verbatim) or the
 * editable `fields`/`sections` pair (composed with the plugin's own composer and
 * validated before writing). Parent directories are created on demand.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleSaveOrchestrator(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  const payload = body.value
  if (payload.source !== undefined && payload.source !== null && typeof payload.source !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'source must be a string' })
    return
  }
  if (payload.fields !== undefined && payload.fields !== null && !isRecord(payload.fields)) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'fields must be an object' })
    return
  }
  if (payload.sections !== undefined && payload.sections !== null && !isRecord(payload.sections)) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'sections must be an object' })
    return
  }
  if (typeof payload.source !== 'string' && !isRecord(payload.fields) && !isRecord(payload.sections)) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'source, or fields and sections, are required' })
    return
  }
  const root = rootOf(scoped)
  // Second validation layer: a declaration can be internally consistent yet
  // unresolvable for this deployment. The live route resolver is the same one
  // activation uses, so a save and a later `/orchestrate` agree.
  const validate = async (definition) => await orchestratorRouteDiagnostics(definition, deps?.resolveModel)
  const result = await saveOrchestrator({
    config: scoped.config,
    root,
    source: typeof payload.source === 'string' ? payload.source : undefined,
    fields: isRecord(payload.fields) ? payload.fields : undefined,
    sections: isRecord(payload.sections) ? payload.sections : undefined,
    validate,
  })
  if (!result.ok) {
    sendJson(res, 400, {
      ok: false,
      code: result.code,
      message: result.message,
      ...Array.isArray(result.diagnostics) ? { diagnostics: result.diagnostics } : {},
      ...result.code === 'invalid' ? { fieldErrors: fieldErrorsOf(result.diagnostics) } : {},
    })
    return
  }
  sendJson(res, 200, { ok: true, orchestrator: result.orchestrator })
}

/**
 * `GET /agent-soul/preferences`.
 *
 * Answers the persisted default-Soul selection, the effective default, and the
 * live catalog names it was validated against. A missing document is not an
 * error: the effective default is the bundled `generalist` soul when present.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleReadPreferences(deps, req, res) {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  const scoped = requestScope(deps, queryParameter(req, 'root'), res)
  if (scoped === null) return
  const root = rootOf(scoped)
  const definitions = await catalogDefinitionsOf(scoped, root)
  sendJson(res, 200, { ok: true, preferences: await preferencesBlockOf(scoped, root, definitions) })
}

/**
 * `POST /agent-soul/preferences`.
 *
 * Persists the default-Soul selection (`name`: a soul name, or null/empty to
 * clear it) after validating it against a fresh live catalog scan. The write is
 * atomic and stays inside the plugin's state directory.
 *
 * @param {object} deps
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function handleSavePreferences(deps, req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJsonBody(req)
  if (!body.ok) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: body.message })
    return
  }
  const scoped = requestScope(deps, body.value.root, res)
  if (scoped === null) return
  if (!Object.hasOwn(body.value, 'name')) {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'name is required (a soul name, or null to clear)' })
    return
  }
  const raw = body.value.name
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'name must be a soul name or null' })
    return
  }
  const name = typeof raw === 'string' ? raw.trim() : ''
  const selected = name === '' ? null : name
  const root = rootOf(scoped)
  const definitions = await catalogDefinitionsOf(scoped, root)
  if (selected !== null && !definitions.some(definition => definition?.name === selected)) {
    sendJson(res, 400, {
      ok: false,
      code: 'unknown-soul',
      message: `unknown agent soul "${selected}"`,
      available: definitions.map(definition => definition.name).filter(name => typeof name === 'string').sort(),
    })
    return
  }
  if (typeof scoped?.preferences?.set !== 'function') {
    sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'preferences are unavailable in this composition' })
    return
  }
  /** @type {{ ok: boolean, code?: string, message?: string }} */
  let saved
  try {
    saved = await scoped.preferences.set(root, selected)
  } catch (error) {
    saved = { ok: false, code: 'invalid-request', message: `cannot save the Agent Soul preferences: ${messageOf(error)}` }
  }
  if (saved?.ok !== true) {
    sendJson(res, 400, {
      ok: false,
      code: typeof saved?.code === 'string' ? saved.code : 'invalid-request',
      message: typeof saved?.message === 'string' ? saved.message : 'cannot save the Agent Soul preferences',
    })
    return
  }
  sendJson(res, 200, { ok: true, preferences: await preferencesBlockOf(scoped, root, definitions) })
}

/**
 * Wrap one handler with the trust fence and a last-resort error boundary.
 * @param {object} deps
 * @param {(deps: object, req: object, res: object) => Promise<void>} handler
 * @returns {(req: object, res: object) => Promise<void>}
 */
function guarded(deps, handler) {
  return async (req, res) => {
    if (rejected(deps, req, res)) return
    try {
      await handler(deps, req, res)
    } catch (error) {
      warn(deps, `GUI route failed: ${messageOf(error)}`)
      try {
        sendJson(res, 500, { ok: false, code: 'internal-error', message: 'the soul route failed unexpectedly' })
      } catch {
        // The response socket is gone; there is nothing left to answer.
      }
    }
  }
}

/**
 * The method split of the contract's shared document path.
 *
 * `GET /agent-soul/document` reads a document and `POST /agent-soul/document`
 * saves one. The web server refuses duplicate `(kind, path)` registrations, so
 * `createGuiRoutes` lists both endpoints while `installGui` groups them into one
 * registered exact path that dispatches on `req.method`.
 *
 * @typedef {{ kind: 'exact', path: string, method: 'GET' | 'POST',
 *   handler: (req: object, res: object) => Promise<void> }} GuiRoute
 */

/**
 * Build the authenticated exact routes consumed by the browser half.
 *
 * The thirteen endpoints of the contract are returned in contract order; the
 * `/agent-soul/document`, `/agent-soul/orchestrator`, and
 * `/agent-soul/preferences` method pairs share their paths and are merged by
 * `installGui`, so ten exact paths are registered.
 *
 * @param {{ ctx: object, config: object, catalog: object, bindings: object,
 *   logger?: object, root?: string, pluginMeta?: object,
 *   resolveModel?: (raw: object) => Promise<{ provider: string, model: string } | undefined> }} deps
 * @returns {GuiRoute[]} one descriptor per contract endpoint.
 */
export function createGuiRoutes(deps) {
  return [
    { kind: 'exact', path: ROUTE_PATHS.overview, method: 'GET', handler: guarded(deps, handleOverview) },
    { kind: 'exact', path: ROUTE_PATHS.document, method: 'GET', handler: guarded(deps, handleReadDocument) },
    { kind: 'exact', path: ROUTE_PATHS.document, method: 'POST', handler: guarded(deps, handleSaveDocument) },
    { kind: 'exact', path: ROUTE_PATHS.create, method: 'POST', handler: guarded(deps, handleCreateDocument) },
    { kind: 'exact', path: ROUTE_PATHS.duplicate, method: 'POST', handler: guarded(deps, handleDuplicateDocument) },
    { kind: 'exact', path: ROUTE_PATHS.remove, method: 'POST', handler: guarded(deps, handleDeleteDocument) },
    { kind: 'exact', path: ROUTE_PATHS.restore, method: 'POST', handler: guarded(deps, handleRestoreDocument) },
    { kind: 'exact', path: ROUTE_PATHS.parse, method: 'POST', handler: guarded(deps, handleParseDocument) },
    { kind: 'exact', path: ROUTE_PATHS.preview, method: 'POST', handler: guarded(deps, handlePreview) },
    { kind: 'exact', path: ROUTE_PATHS.orchestrator, method: 'GET', handler: guarded(deps, handleReadOrchestrator) },
    { kind: 'exact', path: ROUTE_PATHS.orchestrator, method: 'POST', handler: guarded(deps, handleSaveOrchestrator) },
    { kind: 'exact', path: ROUTE_PATHS.preferences, method: 'GET', handler: guarded(deps, handleReadPreferences) },
    { kind: 'exact', path: ROUTE_PATHS.preferences, method: 'POST', handler: guarded(deps, handleSavePreferences) },
  ]
}

/**
 * One exact-path handler for a group of endpoints sharing a path.
 *
 * A request whose method no endpoint supports is authenticated first and then
 * answered 405 with the merged `allow` header, matching the shipped pattern.
 *
 * @param {object} deps
 * @param {GuiRoute[]} group
 * @returns {(req: object, res: object) => Promise<void>}
 */
function combinedHandler(deps, group) {
  const allow = [...new Set(group.map(route => route.method))].join(', ')
  return async (req, res) => {
    const route = group.find(candidate => candidate.method === req.method)
    if (route === undefined) {
      if (rejected(deps, req, res)) return
      sendMethodNotAllowed(res, allow)
      return
    }
    await route.handler(req, res)
  }
}

/**
 * Register the GUI routes on the plugin context.
 *
 * Each `webServer.register` call runs inside its own `ctx.effect`, matching the
 * shipped host-plugin pattern: the registration is disposed with the plugin and
 * a duplicate route registration fails loudly at activation time instead of
 * shadowing another plugin's handler.
 *
 * @param {object} pluginCtx - the plugin's root Cordis context (must carry `webServer`).
 * @param {object} deps - the same deps object `createGuiRoutes` receives.
 * @returns {{ paths: string[], endpoints: string[], dispose: () => void }}
 *   the registered absolute paths, the `METHOD path` endpoints, and a disposer
 *   (also owned by `ctx.effect`).
 */
export function installGui(pluginCtx, deps) {
  const routes = createGuiRoutes(deps)
  /** @type {Map<string, GuiRoute[]>} */
  const groups = new Map()
  for (const route of routes) {
    const group = groups.get(route.path)
    if (group === undefined) groups.set(route.path, [route])
    else group.push(route)
  }
  /** @type {unknown[]} */
  const disposers = []
  for (const [path, group] of groups) {
    const handler = group.length === 1 ? group[0].handler : combinedHandler(deps, group)
    const result = pluginCtx.effect(
      () => pluginCtx.webServer.register({ kind: 'exact', path, handler }),
      `agent-soul: ${path}`,
    )
    disposers.push(result)
  }
  return {
    paths: [...groups.keys()],
    endpoints: routes.map(route => `${route.method} ${route.path}`),
    dispose() {
      for (const dispose of disposers.reverse()) {
        try {
          if (typeof dispose === 'function') dispose()
          else if (dispose !== null && typeof dispose === 'object' && typeof dispose.dispose === 'function') dispose.dispose()
        } catch (error) {
          warn(deps, `disposing a GUI route failed: ${messageOf(error)}`)
        }
      }
    },
  }
}
