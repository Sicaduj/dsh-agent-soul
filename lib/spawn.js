/**
 * Shared soul-aware spawn orchestration for DSH 0.2.2 Agent Teams.
 *
 * Both the \`spawn_teammate\` tool and the user-invocable slash commands enter
 * here. The module validates the request, resolves the soul from the catalog,
 * resolves the routed model, records a pending plan, and starts the child with
 * \`ctx.subagents.startActivation\`. The child's \`agent/created\` listener
 * applies the plan and persists the durable binding.
 *
 * There is no plain no-soul path: every child of a Team-enabled root or of a
 * soul teammate must resolve a pending or durable plan.
 *
 * @module @local/dsh-agent-soul/spawn
 */

import { randomUUID } from 'node:crypto'

import { ALWAYS_KEPT_TOOL_NAMES, GENERIC_SUBAGENT_TOOLS, LEAD_ONLY_TOOL_NAMES } from './team-tools.js'
import { directChildNames, isTeamEnabled, isTeamLead, teamMemberOf } from './team.js'
import { resolveDefaultSoul } from './preferences.js'
import { soulCommandRegistrationState } from './commands.js'
import { toolNameKnown } from './tool-names.js'

/** DSH 0.2.2 child-name pattern: one lower-case segment of at most 32 chars. */
const MEMBER_NAME = /^[a-z][a-z0-9-]{0,31}$/u
/** Maximum roster description length retained in the activation label. */
const MAX_DESCRIPTION = 200
/** The Team Lead's reserved identity; it is never a teammate soul. */
const RESERVED_SOUL_NAME = 'lead'
/** The root agent's fixed model-facing name. */
const ROOT_AGENT_NAME = 'lead'

/** Human-readable message for one arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
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

/** Collapse one line of text and bound its length. */
function ellipsize(value, max) {
  const line = String(value).replace(/\s+/gu, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Validate one requested teammate name against the DSH 0.2.2 child-name contract.
 * @param {unknown} value
 * @returns {string}
 */
function teammateName(value) {
  if (typeof value !== 'string') throw new Error('name must be a string')
  const name = value.trim()
  if (!MEMBER_NAME.test(name) || name === ROOT_AGENT_NAME) {
    throw new Error('name must be lower-kebab-case, at most 32 characters, start with a letter, and not "lead"')
  }
  return name
}

/**
 * Validate one requested teammate description.
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

/** Read the optional subagent service defensively. */
function subagentsOf(deps) {
  try {
    return typeof deps?.ctx?.get === 'function' ? deps.ctx.get('subagents') : deps?.ctx?.subagents
  } catch {
    return undefined
  }
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
 * Find one soul by name in a fresh catalog snapshot with a model-facing diagnostic.
 * @param {object} snapshot
 * @param {string} name
 * @returns {object} the definition.
 */
function requireSoul(snapshot, name) {
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
 * Resolve the soul for one spawn: explicit \`agent_type\` first, else the
 * configured default Soul, else an actionable failure.
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
 * see. Base Team collaboration tools are kept automatically and generic
 * subagent tools are denied to Team members, so listing either is a definition
 * error rather than a silent no-op.
 *
 * @param {object} deps
 * @param {object} lead
 * @param {object} definition
 */
function validateSoulTools(deps, lead, definition) {
  if (definition.tools === null) return
  /** @type {string[]} */
  const problems = []
  for (const name of definition.tools) {
    if (LEAD_ONLY_TOOL_NAMES.includes(name)) {
      problems.push(`"${name}" is a Lead-only scoped tool and cannot be delegated to a teammate`)
    } else if (ALWAYS_KEPT_TOOL_NAMES.includes(name)) {
      problems.push(`"${name}" is a Team tool every teammate keeps automatically and must not appear in a soul tools list`)
    } else if (GENERIC_SUBAGENT_TOOLS.includes(name)) {
      problems.push(`"${name}" is a generic subagent tool denied to Team members`)
    }
  }
  const tools = deps.ctx.get('tools')
  if (tools === undefined || typeof tools.definitions !== 'function') {
    if (problems.length > 0) throw new Error(`soul "${definition.name}" has an invalid tools list: ${problems.join('; ')}`)
    return
  }
  let visible
  try {
    visible = new Set(tools.definitions(lead).map(tool => tool.name))
  } catch (error) {
    deps.logger.warn(`agent-soul: cannot verify tools for soul "${definition.name}": ${messageOf(error)}`)
    if (problems.length > 0) throw new Error(`soul "${definition.name}" has an invalid tools list: ${problems.join('; ')}`)
    return
  }
  for (const name of definition.tools) {
    if (LEAD_ONLY_TOOL_NAMES.includes(name) || ALWAYS_KEPT_TOOL_NAMES.includes(name) || GENERIC_SUBAGENT_TOOLS.includes(name)) continue
    if (!toolNameKnown(name, visible)) {
      problems.push(`"${name}" is not a tool visible in this session`)
    }
  }
  if (problems.length === 0) return
  const available = [...visible].filter(name =>
    !ALWAYS_KEPT_TOOL_NAMES.includes(name)
    && !LEAD_ONLY_TOOL_NAMES.includes(name)
    && !GENERIC_SUBAGENT_TOOLS.includes(name)).sort()
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
 * Pick a teammate name not yet used among the Lead's direct children.
 *
 * The DSH 0.2.2 catalog is asynchronous; a failure to read it falls back to the
 * live children and lets \`startActivation\` reject a duplicate after all.
 *
 * @param {object} deps
 * @param {object} lead
 * @param {string} base - the soul name to derive from.
 * @returns {Promise<string>}
 */
export async function nextTeammateName(deps, lead, base) {
  /** @type {Set<string>} */
  let taken = new Set()
  try {
    taken = await directChildNames(deps.ctx, lead)
  } catch (error) {
    deps.logger.warn(`agent-soul: cannot list direct teammates before deriving a name: ${messageOf(error)}`)
    try {
      const subagents = subagentsOf(deps)
      const agentsService = deps.ctx.agents ?? deps.ctx.get?.('agents')
      for (const agent of agentsService?.list?.() ?? []) {
        if (agent?.session?.header?.parentSession !== lead.id) continue
        const self = subagents?.namesOf?.(agent)?.self
        if (typeof self === 'string' && self !== '') taken.add(self)
      }
    } catch {
      // The activation itself remains the uniqueness authority.
    }
  }
  const stem = base.slice(0, 32)
  const fallback = 'teammate'
  const root = stem === '' || !/^[a-z]/u.test(stem) ? fallback : stem
  let candidate = root
  if (!taken.has(candidate)) return candidate
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`
    candidate = `${root.slice(0, 32 - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`cannot derive an unused teammate name from "${base}"`)
}

/**
 * Start one defined-Agent-Soul teammate.
 *
 * @param {object} deps - shared plugin deps.
 * @param {object} lead - exact live Team Lead Agent.
 * @param {{ name: unknown, description: unknown, prompt: unknown, context?: unknown,
 *   agentType?: unknown, signal?: AbortSignal }} args
 * @returns {Promise<{ member: { id: string, name: string, description: string },
 *   soul: { name: string, tools: string[] | null, model: string | null } }>}
 */
export async function spawnTeamMember(deps, lead, args) {
  throwIfAborted(args.signal)
  const config = deps.config
  const member = teamMemberOf(deps.ctx, lead)
  if (member === undefined || member.role !== 'lead') {
    throw new Error('only the Team Lead can start a soul teammate')
  }
  if (member.enabled !== true) {
    throw new Error('Agent Teams is disabled in this session. Enable "Use Agent Teams" in the Session model menu before spawning a soul teammate.')
  }
  const name = teammateName(args.name)
  const description = rosterDescription(args.description)
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (prompt.length === 0) throw new Error('prompt must be non-empty')
  const agentType = typeof args.agentType === 'string' && args.agentType.trim().length > 0
    ? args.agentType.trim()
    : undefined
  if (args.context !== undefined && args.context !== 'fresh' && args.context !== 'fork') {
    throw new Error('context must be "fresh" or "fork"')
  }
  const snapshot = await refreshCatalog(deps, lead)
  throwIfAborted(args.signal)
  const soul = await resolveSpawnSoul(deps, lead, snapshot, agentType)
  if (soul?.name === RESERVED_SOUL_NAME) throw reservedSoulError()
  throwIfAborted(args.signal)
  validateSoulTools(deps, lead, soul)

  const context = args.context === undefined
    ? soul.context ?? config.defaultContext
    : args.context
  if (context !== 'fresh' && context !== 'fork') throw new Error('context must be "fresh" or "fork"')
  const provider = context === 'fork' ? config.forkProvider : config.freshProvider
  const subagents = subagentsOf(deps)
  if (subagents === undefined || typeof subagents.startActivation !== 'function') {
    throw new Error('the subagent service is unavailable, so no soul teammate can start in this composition')
  }
  if (typeof subagents.getProvider === 'function' && subagents.getProvider(provider) === undefined) {
    throw new Error(`subagent provider "${provider}" is not registered in this composition; check config.freshProvider/config.forkProvider`)
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
  // Reserve the durable child identity up front. startActivation accepts a
  // client-minted Session id for local providers, and the child's
  // agent/created listener can then match the pending plan by id even before
  // namesOf() sees its name.
  const childId = randomUUID()
  const childKey = deps.pendingKey(lead, childId)
  const releaseName = deps.pending.set(key, plan)
  let releaseChild
  try {
    releaseChild = deps.pending.set(childKey, plan)
  } catch (error) {
    if (typeof releaseName === 'function') releaseName()
    throw error
  }
  let started
  try {
    throwIfAborted(args.signal)
    const maxDepth = typeof subagents.resolveMaxDepth === 'function' ? subagents.resolveMaxDepth() : undefined
    started = await subagents.startActivation({
      provider,
      label: description,
      name,
      childId,
      prompt: [{ type: 'text', text: prompt }],
      parent: lead,
      ...model === undefined ? {} : { agentOptions: model },
      ...maxDepth === undefined ? {} : { maxDepth },
      signal: args.signal ?? new AbortController().signal,
      delivery: 'parent',
    })
  } finally {
    if (typeof releaseName === 'function') releaseName()
    else deps.pending.delete(key, plan)
    if (typeof releaseChild === 'function') releaseChild()
    else deps.pending.delete(childKey, plan)
  }
  const startedId = String(started?.childId ?? '')
  if (startedId === '') throw new Error('the subagent service returned no child Session id')
  try {
    await deps.bindings.set(root, startedId, plan)
  } catch (error) {
    deps.logger.warn(`agent-soul: could not persist soul binding for teammate "${name}": ${messageOf(error)}`)
  }
  return {
    member: {
      id: startedId,
      name: typeof started?.name === 'string' && started.name !== '' ? started.name : name,
      description,
    },
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
        resolvedModel = null
      }
    }
    const commandName = commandNameFor(deps.config, definition)
    let command = null
    if (definition.userInvocable) {
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
  if (typeof deps.admissionDiagnostics?.list === 'function') {
    try {
      for (const row of deps.admissionDiagnostics.list()) {
        const teammate = typeof row?.teammate === 'string' && row.teammate !== '' ? row.teammate : 'unknown'
        const message = typeof row?.message === 'string' && row.message !== ''
          ? row.message
          : 'a teammate could not be admitted because its Agent Soul plan is unavailable'
        const code = typeof row?.code === 'string' && row.code !== '' ? row.code : 'SOUL_PLAN_UNAVAILABLE'
        const reason = typeof row?.reason === 'string' && row.reason !== '' ? row.reason : undefined
        diagnostics.push({
          source: `admission:${teammate}`,
          message: `${message} (code ${code}${reason === undefined ? '' : `, reason ${reason}`})`,
          code,
          ...reason === undefined ? {} : { reason },
        })
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
 * @param {object} deps
 * @param {object} lead - exact live Agent that received the command.
 * @param {{ name: string, description: string, userInvocable?: boolean }} definition
 * @param {string} rawInput - text following the command name.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ text: string }>}
 */
export async function spawnSoulFromCommand(deps, lead, definition, rawInput, options = {}) {
  throwIfAborted(options.signal)
  const member = teamMemberOf(deps.ctx, lead)
  if (member === undefined || member.role !== 'lead') throw new Error('only the Team Lead can start a soul teammate')
  if (member.enabled !== true) {
    throw new Error('Agent Teams is disabled in this session. Enable "Use Agent Teams" in the Session model menu before using a soul command.')
  }
  const task = typeof rawInput === 'string' ? rawInput.trim() : ''
  const command = `/${commandNameFor(deps.config, definition)}`
  if (task.length === 0) throw new Error(`usage: ${command} <task for the teammate>`)

  const snapshot = await refreshCatalog(deps, lead)
  throwIfAborted(options.signal)
  const current = snapshot.byName.get(definition.name)
  if (current === undefined || !current.userInvocable) {
    throw new Error(`soul "${definition.name}" is no longer available as a command`)
  }
  const name = await nextTeammateName(deps, lead, current.name)
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
