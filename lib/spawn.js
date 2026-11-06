/**
 * Shared spawn orchestration for soul-aware teammates.
 *
 * Both the `spawn_teammate` tool and the user-invocable slash commands enter
 * through this module. It validates the request, resolves the soul from the
 * catalog (an explicit `agent_type`, else the configured default Agent Soul),
 * resolves the routed model, records a pending plan that the child's
 * `agent/created` listener applies, and finally persists the durable binding
 * used by cold resume.
 *
 * The plain no-soul spawn path was removed: every Team child runs a defined
 * Agent Soul. The creation fence exported here rejects any provider-owned
 * child of a Team member that did not enter through the roster.
 *
 * @module @local/dsh-agent-soul/spawn
 */

import { resolveDefaultSoul } from './preferences.js'
import { soulCommandRegistrationState } from './commands.js'

/** Team member names accepted by the Team service. */
const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
/** Maximum teammate name length accepted by the Team service. */
const MAX_MEMBER_NAME = 64
/** Maximum roster description length accepted by the Team service. */
const MAX_DESCRIPTION = 200
/** The Team Lead's reserved identity; it is never a teammate soul. */
const RESERVED_SOUL_NAME = 'lead'

/**
 * Tools this bundle registers in each Team member's own Agent scope. Scoped
 * registrations stay visible through `tools.restrict()`, so a soul cannot
 * hide them and must not pretend to; naming one is a definition error.
 */
const TEAM_SCOPED_TOOLS = new Set([
  'spawn_teammate',
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
  'list_agent_souls',
])

/** Lead-only Agent-scoped tools are visible to validation but can never be delegated. */
const LEAD_SCOPED_TOOLS = new Set(['manage_agent_souls'])

/** Human-readable message for one arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether one value is a plain (non-array) object.
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Preserve the platform cancellation reason at every sequential-operation boundary. */
function throwIfAborted(signal) {
  if (signal === undefined || signal === null) return
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted()
    return
  }
  if (signal.aborted === true) throw signal.reason ?? new Error('The operation was aborted')
}

/**
 * Collapse one line of text and bound its length.
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
function ellipsize(value, max) {
  const line = String(value).replace(/\s+/gu, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Validate one requested teammate name.
 * @param {unknown} value
 * @returns {string}
 */
function teammateName(value) {
  if (typeof value !== 'string') throw new Error('name must be a string')
  const name = value.trim()
  if (!MEMBER_NAME.test(name) || name.length > MAX_MEMBER_NAME || name === 'lead') {
    throw new Error('name must be lower-kebab-case, at most 64 characters, and not "lead"')
  }
  return name
}

/**
 * Validate one requested roster description.
 * @param {unknown} value
 * @returns {string}
 */
function rosterDescription(value) {
  if (typeof value !== 'string') throw new Error('description must be a string')
  const description = value.trim()
  if (description.length === 0) throw new Error('description must be non-empty')
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(`description exceeds ${MAX_DESCRIPTION} characters`)
  }
  return description
}

/**
 * Resolve the catalog fresh so a just-edited definition set takes effect.
 * @param {object} deps
 * @param {object} lead
 * @returns {Promise<object>} the catalog snapshot.
 */
async function refreshCatalog(deps, lead) {
  return await deps.catalog.refresh(deps.rootOf(lead))
}

/**
 * Find one soul by name in a fresh catalog snapshot with a model-facing
 * diagnostic.
 * @param {object} snapshot
 * @param {string} name
 * @returns {object} the definition.
 */
function requireSoul(snapshot, name) {
  // Defense in depth: the shared parser also rejects this name, so a manually
  // written file must never become a spawnable soul even if it bypassed the
  // catalog scan (an old catalog snapshot, an injected test snapshot, or a
  // future parser regression).
  if (name === RESERVED_SOUL_NAME) throw reservedSoulError()
  const definition = snapshot.byName.get(name)
  if (definition !== undefined) return definition
  const available = snapshot.definitions.map(candidate => candidate.name).sort().join(', ') || '(none)'
  const invalid = snapshot.diagnostics.length === 0
    ? ''
    : `; ${snapshot.diagnostics.length} definition file(s) are invalid — call list_agent_souls for detail`
  throw new Error(`unknown agent soul "${name}"; available souls: ${available}${invalid}`)
}

/** The one model-facing refusal for the Team Lead's reserved identity. */
function reservedSoulError() {
  return new Error('agent soul "lead" is reserved for the Team Lead; choose a different agent_type')
}

/**
 * Resolve the soul for one spawn: explicit `agent_type` first, else the
 * configured default Soul, else an actionable failure.
 *
 * The plainly-labelled "generic" teammate path is intentionally gone: every
 * Team child runs a defined Agent Soul so its persona, tool matrix, and model
 * are reviewable before it starts.
 *
 * @param {object} deps
 * @param {object} lead
 * @param {object} snapshot - freshly refreshed catalog.
 * @param {string | undefined} agentType
 * @returns {Promise<object>} the resolved definition.
 */
async function resolveSpawnSoul(deps, lead, snapshot, agentType) {
  if (agentType !== undefined) return requireSoul(snapshot, agentType)
  /** @type {{ selected: string | null, warning: string | null }} */
  let preferences = { selected: null, warning: null }
  if (typeof deps.preferences?.get === 'function') {
    /** @type {{ ok: boolean, preferences?: object, code?: string, message?: string }} */
    let read
    try {
      read = await deps.preferences.get(deps.rootOf(lead))
    } catch (error) {
      throw new Error(`cannot read the Agent Soul preferences: ${messageOf(error)}`)
    }
    if (read?.ok !== true) {
      throw new Error(`cannot read the Agent Soul preferences at ${read?.preferences?.path ?? deps.rootOf(lead)}: ${String(read?.message ?? 'unknown error')}`)
    }
    preferences = {
      selected: typeof read.preferences?.selected === 'string' && read.preferences.selected !== ''
        ? read.preferences.selected
        : null,
      warning: typeof read.preferences?.warning === 'string' && read.preferences.warning !== ''
        ? read.preferences.warning
        : null,
    }
  }
  if (preferences.warning !== null) {
    // A malformed or unreadable preferences document is not "no selection": a
    // silent reinterpretation would spawn the bundled default while hiding the
    // broken state. Fail the default spawn and point at the fix.
    throw new Error(
      `cannot use the default Agent Soul: the preferences document is invalid: ${preferences.warning}. `
      + 'Fix or clear it in Settings → Agent Soul → Souls, or pass an explicit agent_type.',
    )
  }
  const resolved = resolveDefaultSoul({
    selected: preferences.selected,
    definitions: snapshot.definitions,
  })
  if (!resolved.ok) {
    const corrupted = preferences.warning === null ? '' : ` (${preferences.warning})`
    const available = resolved.available.join(', ') || '(none)'
    throw new Error(
      `no usable default Agent Soul for spawn_teammate without agent_type: ${resolved.warning}${corrupted}. `
      + `Select a default Soul in Settings → Agent Soul → Souls, or pass agent_type. Available souls: ${available}`,
    )
  }
  return resolved.soul
}

/**
 * Validate one soul's tool permission matrix against the tools the Lead can
 * see. Preset and global tools are restrictable in a teammate scope; the Team
 * tools this plugin registers in the Agent scope are not, and unknown names are
 * almost always a typo. Failing here gives the orchestrator a clear retry
 * instead of a silently over-permissive teammate.
 * @param {object} deps
 * @param {object} lead
 * @param {object} definition
 */
function validateSoulTools(deps, lead, definition) {
  if (definition.tools === null) return
  const leadOnly = definition.tools.filter(name => LEAD_SCOPED_TOOLS.has(name))
  if (leadOnly.length > 0) {
    const problems = leadOnly.map(name => `"${name}" is a Lead-only scoped tool and cannot be delegated to a teammate`)
    throw new Error(`soul "${definition.name}" has an invalid tools list: ${problems.join('; ')}`)
  }
  const tools = deps.ctx.get('tools')
  if (tools === undefined || typeof tools.definitions !== 'function') return
  let visible
  try {
    visible = new Set(tools.definitions(lead).map(tool => tool.name))
  } catch (error) {
    deps.logger.warn(`agent-soul: cannot verify tools for soul "${definition.name}": ${messageOf(error)}`)
    return
  }
  const problems = []
  for (const name of definition.tools) {
    if (TEAM_SCOPED_TOOLS.has(name)) {
      problems.push(`"${name}" is a Team tool every teammate keeps and cannot be restricted`)
    } else if (!visible.has(name)) {
      problems.push(`"${name}" is not a tool visible in this session`)
    }
  }
  if (problems.length === 0) return
  const available = [...visible].filter(name => !TEAM_SCOPED_TOOLS.has(name) && !LEAD_SCOPED_TOOLS.has(name)).sort()
  const shown = available.slice(0, 40).join(', ')
  throw new Error(
    `soul "${definition.name}" has an invalid tools list: ${problems.join('; ')}. `
    + `Restrictable tools: ${shown}${available.length > 40 ? ', …' : ''}`,
  )
}

/**
 * Resolve one definition's model declaration.
 * @param {object} deps
 * @param {object} definition
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ provider: string, model: string, reasoningEffort?: string } | undefined>}
 */
async function resolveDefinitionModel(deps, definition, signal) {
  return await deps.resolveModel({
    model: definition.model,
    provider: definition.provider,
    reasoningEffort: definition.reasoningEffort,
  }, { signal })
}

/**
 * The slash-command name one definition would register.
 * @param {object} config
 * @param {{ name: string }} definition
 * @returns {string}
 */
export function commandNameFor(config, definition) {
  return `${config.commandPrefix}${definition.name}`
}

/**
 * Pick a teammate name not yet used in the Team, appending `-2`, `-3`, …
 * @param {object} deps
 * @param {object} lead
 * @param {string} base - the soul name to derive from.
 * @returns {string}
 */
export function nextTeammateName(deps, lead, base) {
  const taken = new Set(deps.ctx.agentTeams.listMembers(lead).map(member => member.name))
  const stem = base.slice(0, MAX_MEMBER_NAME)
  let candidate = stem
  if (!taken.has(candidate)) return candidate
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`
    candidate = `${stem.slice(0, MAX_MEMBER_NAME - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`cannot derive an unused teammate name from "${base}"`)
}

/**
 * Reject a provider-owned child created under a Team member outside the roster.
 *
 * `agent/created` is serial: throwing from the plugin's listener vetoes
 * publication, so a generic `subagent` / `subagent_fork` call can never leave a
 * live child behind. A seeded host fork is independent lineage and stays
 * allowed; roster teammates resolve as `role: 'teammate'` and stay allowed.
 * Every other non-roster child of a Team member is fenced.
 *
 * @param {object} deps - shared plugin deps (`ctx`).
 * @param {object} agent - the Agent being created.
 * @returns {void}
 * @throws {Error} when the parent is a Team member and the child is not a
 *   roster teammate.
 */
export function assertSoulOnlyTeamChild(deps, agent) {
  const parentId = agent?.session?.header?.parentSession
  if (typeof parentId !== 'string' || parentId === '') return
  /** @type {object | undefined} */
  let parent
  try {
    parent = deps?.ctx?.agents?.get?.(parentId)
  } catch {
    parent = undefined
  }
  if (parent === undefined || parent === null) return
  /** @type {object | undefined} */
  let parentMembership
  try {
    parentMembership = deps?.ctx?.agentTeams?.tryMembership?.(parent)
  } catch {
    parentMembership = undefined
  }
  if (!isRecord(parentMembership)) return
  /** @type {object | undefined} */
  let childMembership
  try {
    childMembership = deps?.ctx?.agentTeams?.tryMembership?.(agent)
  } catch {
    childMembership = undefined
  }
  if (isRecord(childMembership) && childMembership.role === 'teammate') return
  const header = agent?.session?.header
  // A seeded host fork is an independent Team root with inherited lineage, not
  // a delegated child, so it stays allowed. Provider-owned children always
  // carry origin 'subagent'; every other non-roster child of a Team member is
  // fenced.
  if (header?.origin !== 'subagent' && header?.isSeeded === true) return
  const parentName = typeof parentMembership.name === 'string' && parentMembership.name !== ''
    ? parentMembership.name
    : 'lead'
  throw new Error(
    `agent-soul: Team member "${parentName}" may only create defined-Agent-Soul teammates through spawn_teammate; `
    + 'generic subagent/subagent_fork children are not allowed',
  )
}

/**
 * Start one defined-Agent-Soul teammate.
 *
 * An explicit `agentType` selects that soul; omitted, the configured default
 * Agent Soul applies. The resolved model is routed for the child, the pending
 * plan is recorded for the child's creation listener, and the durable binding
 * is persisted for cold resume. There is no no-soul path.
 *
 * @param {object} deps - shared plugin deps.
 * @param {object} lead - exact live Team Lead Agent.
 * @param {{ name: unknown, description: unknown, prompt: unknown, context?: unknown,
 *   agentType?: unknown, signal?: AbortSignal }} args
 * @returns {Promise<{ member: object, soul: { name: string, tools: string[] | null, model: string | null } }>}
 */
export async function spawnTeamMember(deps, lead, args) {
  throwIfAborted(args.signal)
  const config = deps.config
  const name = teammateName(args.name)
  const description = rosterDescription(args.description)
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (prompt.length === 0) throw new Error('prompt must be non-empty')
  const agentType = typeof args.agentType === 'string' && args.agentType.trim().length > 0
    ? args.agentType.trim()
    : undefined
  // Argument validation stays ahead of every service read: a malformed context
  // must fail before the catalog or the preferences document is touched.
  if (args.context !== undefined && args.context !== 'fresh' && args.context !== 'fork') {
    throw new Error('context must be "fresh" or "fork"')
  }
  const snapshot = await refreshCatalog(deps, lead)
  throwIfAborted(args.signal)
  const soul = await resolveSpawnSoul(deps, lead, snapshot, agentType)
  // The default-Soul path resolves from the scanned catalog; guard it too so a
  // manually written or stale catalog file can never reach a child as "lead".
  if (soul?.name === RESERVED_SOUL_NAME) throw reservedSoulError()
  throwIfAborted(args.signal)
  validateSoulTools(deps, lead, soul)

  const context = args.context === undefined
    ? soul.context ?? config.defaultContext
    : args.context
  if (context !== 'fresh' && context !== 'fork') throw new Error('context must be "fresh" or "fork"')
  const provider = context === 'fork' ? config.forkProvider : config.freshProvider
  const request = {
    name,
    description,
    prompt: [{ type: 'text', text: prompt }],
    context,
    provider,
    signal: args.signal ?? new AbortController().signal,
  }

  const model = await resolveDefinitionModel(deps, soul, args.signal)
  throwIfAborted(args.signal)
  /** @type {object} */
  const plan = {
    name: soul.name,
    persona: soul.persona,
    tools: soul.tools,
    model: model ?? null,
    context,
    sourceLabel: soul.sourceLabel,
  }
  const key = deps.pendingKey(lead, name)
  const root = deps.rootOf(lead)
  const releasePending = deps.pending.set(key, plan)
  let spawned
  try {
    throwIfAborted(args.signal)
    spawned = await deps.ctx.agentTeams.spawnTeammate(lead, request)
  } finally {
    if (typeof releasePending === 'function') releasePending()
    else deps.pending.delete(key, plan)
  }
  try {
    await deps.bindings.set(root, spawned.member.id, plan)
  } catch (error) {
    deps.logger.warn(`agent-soul: could not persist soul binding for teammate "${name}": ${messageOf(error)}`)
  }
  return {
    member: spawned.member,
    soul: {
      name: soul.name,
      tools: soul.tools,
      model: model === undefined ? null : `${model.provider}/${model.model}`,
    },
  }
}

/**
 * Describe every soul visible from one member's workspace root.
 *
 * Refreshes the catalog first, then returns model-facing rows. Model routes are
 * resolved afresh per definition so provider catalog changes are observed; an
 * unresolvable route stays null rather than failing the list.
 *
 * @param {object} deps
 * @param {object} lead
 * @param {{ includeBody?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<{ souls: object[], diagnostics: object[], roots: string[] }>}
 */
export async function describeSouls(deps, lead, options = {}) {
  throwIfAborted(options.signal)
  const snapshot = await refreshCatalog(deps, lead)
  throwIfAborted(options.signal)
  const includeBody = options.includeBody === true
  const commands = deps.ctx.get('commands')
  const souls = []
  for (const definition of [...snapshot.definitions].sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfAborted(options.signal)
    let resolvedModel = null
    if (definition.model !== undefined) {
      try {
        const resolved = await resolveDefinitionModel(deps, definition, options.signal)
        throwIfAborted(options.signal)
        resolvedModel = resolved === undefined ? null : `${resolved.provider}/${resolved.model}`
      } catch {
        throwIfAborted(options.signal)
        // Ordinary resolution failures remain a null row for listability;
        // cancellation is never downgraded to a model diagnostic.
        resolvedModel = null
      }
    }
    const commandName = commandNameFor(deps.config, definition)
    let command = null
    if (definition.userInvocable) {
      // Handler identity, not name presence: a soul command that lost its name
      // to the built-in `/orchestrate` is not the registered soul command.
      const record = typeof deps.soulCommandRegistration === 'function'
        ? deps.soulCommandRegistration(lead)
        : undefined
      const state = soulCommandRegistrationState(commands, lead, commandName, record)
      if (state.known) {
        if (state.registered) command = `/${commandName}`
      } else if (commands !== undefined) {
        try {
          if (commands.find(lead, commandName) !== undefined) command = `/${commandName}`
        } catch {
          command = null
        }
      }
    }
    souls.push({
      name: definition.name,
      description: definition.description,
      tools: definition.tools,
      model: definition.model ?? 'inherit',
      model_resolved: resolvedModel,
      user_invocable: definition.userInvocable,
      context: definition.context ?? null,
      source: definition.sourceLabel,
      command,
      ...includeBody ? { body: definition.body } : {},
    })
  }
  /** @type {{ source: string, message: string }[]} */
  const diagnostics = snapshot.diagnostics.map(diagnostic => ({
    source: diagnostic.source,
    message: diagnostic.message,
  }))
  // Cold-resume admission refusals are surfaced here because the shared
  // subagent lifecycle wraps the Soul-specific veto in a generic NOT_RESUMABLE
  // error; the Lead can always re-check `list_agent_souls` for the real cause.
  if (typeof deps.admissionDiagnostics?.list === 'function') {
    try {
      for (const row of deps.admissionDiagnostics.list()) {
        const teammate = typeof row?.teammate === 'string' && row.teammate !== '' ? row.teammate : 'unknown'
        const message = typeof row?.message === 'string' && row.message !== ''
          ? row.message
          : 'a teammate could not be admitted because its Agent Soul plan is unavailable'
        diagnostics.push({ source: `admission:${teammate}`, message })
      }
    } catch {
      // The admission diagnostic sink is best-effort; the catalog rows stand.
    }
  }
  return {
    souls,
    diagnostics,
    roots: [...snapshot.dirs],
  }
}

/**
 * Start a soul teammate from one human slash-command invocation.
 *
 * The definition is re-read from a fresh catalog scan so a command registered
 * for an edited or deleted file fails cleanly, and the teammate name is derived
 * from the soul name while avoiding every roster name already in use.
 *
 * @param {object} deps
 * @param {object} lead - exact live Agent that received the command.
 * @param {{ name: string, description: string, userInvocable?: boolean }} definition
 * @param {string} rawInput - text following the command name.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ text: string }>}
 */
export async function spawnSoulFromCommand(deps, lead, definition, rawInput, options = {}) {
  throwIfAborted(options.signal)
  const membership = deps.ctx.agentTeams.membership(lead)
  if (membership.role !== 'lead') throw new Error('only the Team Lead can start a soul teammate')
  const task = typeof rawInput === 'string' ? rawInput.trim() : ''
  const command = `/${commandNameFor(deps.config, definition)}`
  if (task.length === 0) throw new Error(`usage: ${command} <task for the teammate>`)

  const snapshot = await refreshCatalog(deps, lead)
  throwIfAborted(options.signal)
  const current = snapshot.byName.get(definition.name)
  if (current === undefined || !current.userInvocable) {
    throw new Error(`soul "${definition.name}" is no longer available as a command`)
  }
  const name = nextTeammateName(deps, lead, current.name)
  const description = ellipsize(
    `User-invoked ${current.name} soul: ${current.description}`,
    MAX_DESCRIPTION,
  )
  const result = await spawnTeamMember(deps, lead, {
    name,
    description,
    prompt: task,
    agentType: current.name,
    signal: options.signal,
  })
  const model = result.soul?.model
  return {
    text: `Started teammate "${name}" with soul "${current.name}"${model === undefined || model === null ? '' : ` (model ${model})`}. It will report back when it finishes.`,
  }
}
