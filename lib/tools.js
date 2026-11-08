/**
 * Soul-aware copy of the shipped Agent Teams tool surface.
 *
 * This module registers the complete Team tool set in exactly one Agent scope,
 * plus the shared Team policy prompt section, the Team identity context, and —
 * for the Team Lead only — the Agent Soul catalog prompt section. On top of
 * the shipped surface it adds `agent_type` to `spawn_teammate` and a new
 * `list_agent_souls` tool. Spawn orchestration is delegated to the shared
 * `deps.spawnTeamMember` / `deps.describeSouls` implementations so the tools
 * and the user-invocable slash commands share one code path.
 *
 * The module is plain ESM (no dependencies, no bare imports) because it is
 * loaded from a DSH profile where only the dsh installation resolves.
 *
 * @module @local/dsh-agent-soul/tools
 */

/** Names of every tool this module can register in an Agent scope. */
export const TEAM_TOOL_NAMES = [
  'spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent',
  'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  'list_agent_souls',
]

/**
 * Generic subagent tools that could bypass the Agent Soul roster.
 *
 * Every Team member hides these from its tool view, denies direct calls with a
 * scoped guard, and the plugin's `agent/created` fence rejects any child they
 * still manage to start. The plugin's own scoped Team tools are unaffected:
 * restrictions only mask inherited global tools.
 */
export const GENERIC_SUBAGENT_TOOLS = Object.freeze(['subagent', 'subagent_fork'])

/** Model-facing denial reason for a guarded generic subagent call. */
const SOUL_ONLY_DENIAL = 'Generic subagent tools are disabled for Team members. Every Team child must run a defined Agent Soul: call spawn_teammate with a valid agent_type, or omit agent_type to use the configured default Soul.'

/** Stable code carried by `SoulPlanUnavailableError` in lib/apply.js. */
const SOUL_PLAN_UNAVAILABLE_CODE = 'SOUL_PLAN_UNAVAILABLE'

/** Maximum `.cause` hops inspected while classifying one message-delivery failure. */
const MAX_CAUSE_HOPS = 8

/** Fallback reason text when a structurally matched Soul error carries no message. */
const SOUL_PLAN_UNAVAILABLE_FALLBACK = 'the Agent Soul plan for this teammate is unavailable'

/** Member statuses during which another member could produce a wait edge. */
const ACTIVE_WAIT_STATUSES = new Set(['running', 'provisioning'])

/** Model-facing explanation for a `wait_agent` call with no peer able to progress. */
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.'

/** Model-facing collaboration guidance shared by Lead and teammates. */
function teamPolicy(interrupt) {
  return `Agent Teams is available in this session

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message${interrupt ? ' and interrupt_agent' : ''}, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. A peer message starts with its sender name. A successful send does not mean the recipient has processed it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`
}

/** One model-facing roster row; the Lead pseudo-row omits teammate-only fields. */
const MEMBER_VIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    /** Present on the Lead row only while orchestrator mode is active. */
    orchestrator: { type: 'boolean' },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
}

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
}

/** Brief soul identity returned next to one freshly spawned member. */
const SOUL_BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    tools: { required: true, oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
    model: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
}

/** One full soul row returned by `list_agent_souls`; every key is present. */
const SOUL_ROW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    tools: { required: true, oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
    model: { type: 'string', required: true },
    model_resolved: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    user_invocable: { type: 'boolean', required: true },
    context: { required: true, oneOf: [{ type: 'string', enum: ['fresh', 'fork'] }, { type: 'null' }] },
    source: { type: 'string', required: true },
    command: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    body: { type: 'string' },
  },
}

/** Output of `list_agent_souls`. */
const SOULS_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    souls: { type: 'array', required: true, items: SOUL_ROW_SCHEMA },
    diagnostics: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
    },
    roots: { type: 'array', required: true, items: { type: 'string' } },
  },
}

/** Output of `spawn_teammate`; every spawn carries the Agent Soul it runs. */
const SPAWN_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
    soul: { ...SOUL_BRIEF_SCHEMA, required: true },
  },
}

/** Output of `list_agents`. */
const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA }

/** Output of `send_message`. */
const SEND_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { sent: { type: 'boolean', required: true, const: true } },
}

/** Output of `wait_agent`; `noProgress` appears only on the model-only shortcut. */
const WAIT_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-peer' },
        message: { type: 'string', required: true },
      },
    },
  },
}

/** Output of `interrupt_agent`. */
const INTERRUPT_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { previousStatus: { type: 'string', required: true, enum: ['running', 'inactive'] } },
}

/** Output of `team_task_list`. */
const TASK_LIST_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA }, nextCursor: { type: 'integer' } },
}

/** Compile one author-facing schema node (`required: true` flags move onto the parent array). */
function compileSchema(spec) {
  if (spec === undefined) return {}
  /** @type {Record<string, unknown>} */
  const schema = {}
  if (spec.description !== undefined) schema.description = spec.description
  if (spec.title !== undefined) schema.title = spec.title
  if (spec.oneOf !== undefined) {
    schema.oneOf = spec.oneOf.map(compileSchema)
    return schema
  }
  schema.type = spec.type
  if (spec.type === 'object') {
    /** @type {Record<string, object>} */
    const properties = {}
    const required = []
    for (const [key, child] of Object.entries(spec.properties ?? {})) {
      properties[key] = compileSchema(child)
      if (child.required === true) required.push(key)
    }
    schema.properties = properties
    if (required.length > 0) schema.required = required
    if (spec.additionalProperties !== undefined) schema.additionalProperties = spec.additionalProperties
  } else if (spec.type === 'array') {
    if (spec.items !== undefined) schema.items = compileSchema(spec.items)
  } else {
    if (spec.enum !== undefined) schema.enum = Array.from(spec.enum)
    if (spec.const !== undefined) schema.const = spec.const
  }
  return schema
}

/** Compile one implicit parameter property map into a raw object schema. */
function compileParameters(parameters) {
  /** @type {Record<string, object>} */
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(parameters)) {
    properties[key] = compileSchema(spec)
    if (spec.required === true) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...required.length > 0 ? { required } : {},
  }
}

/** Label one validation path the same way the shipped validator does. */
function diagnosticPath(path) {
  return path === '' ? 'arguments' : path
}

/** Append one object property to a validation path without a leading dot at the root. */
function propertyPath(path, key) {
  return path === '' ? key : `${path}.${key}`
}

/** Validate one scalar schema constraint. */
function validateScalar(schema, value, path) {
  const violations = []
  if (schema.enum !== undefined && !schema.enum.includes(value)) violations.push(`"${diagnosticPath(path)}" must be one of ${JSON.stringify(schema.enum)}`)
  if (schema.const !== undefined && value !== schema.const) violations.push(`"${diagnosticPath(path)}" must be ${JSON.stringify(schema.const)}`)
  return violations
}

/** Validate one value against one compiled schema node, collecting every violation. */
function validateSchema(schema, value, path) {
  if (schema.oneOf !== undefined) {
    let matched = 0
    for (const branch of schema.oneOf) {
      if (validateSchema(branch, value, path).length === 0) matched += 1
    }
    return matched === 1
      ? []
      : [`"${diagnosticPath(path)}" must match exactly one oneOf branch (matched ${matched})`]
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [`"${diagnosticPath(path)}" must be an object`]
      }
      const violations = []
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) {
          violations.push(`missing required property "${propertyPath(path, key)}"`)
        }
      }
      const properties = schema.properties ?? {}
      for (const [key, child] of Object.entries(properties)) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) continue
        violations.push(...validateSchema(child, value[key], propertyPath(path, key)))
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) {
            violations.push(`"${propertyPath(path, key)}" is not a declared property (additionalProperties: false)`)
          }
        }
      }
      return violations
    }
    case 'array': {
      if (!Array.isArray(value)) return [`"${diagnosticPath(path)}" must be an array`]
      if (schema.items === undefined) return []
      const violations = []
      for (const [index, entry] of value.entries()) {
        violations.push(...validateSchema(schema.items, entry, `${path}[${index}]`))
      }
      return violations
    }
    case 'string':
      return typeof value === 'string' ? validateScalar(schema, value, path) : [`"${diagnosticPath(path)}" must be a string`]
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? validateScalar(schema, value, path) : [`"${diagnosticPath(path)}" must be a number`]
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? validateScalar(schema, value, path) : [`"${diagnosticPath(path)}" must be an integer`]
    case 'boolean':
      return typeof value === 'boolean' ? validateScalar(schema, value, path) : [`"${diagnosticPath(path)}" must be a boolean`]
    case 'null':
      return value === null ? [] : [`"${diagnosticPath(path)}" must be null`]
    default: // An unconstrained schema node accepts any JSON value.

      return []
  }
}

/** One output declaration rendering the validated value as compact model-facing JSON. */
function jsonOutput(spec) {
  return { schema: compileSchema(spec), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Declare one tool definition with compiled parameters and strict argument validation. */
function defineTool(options) {
  const parameters = compileParameters(options.parameters ?? {})
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: options.output,
    async execute(args, exec) {
      const violations = validateSchema(parameters, args, '')
      if (violations.length > 0) throw new Error(`invalid arguments: ${violations.join('; ')}`)
      return await options.execute(args, exec)
    },
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent, toolName) {
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Expose the member name and a read-only live model overlay as its model-facing row. */
function modelMember(member, ctx, orchestratorActive) {
  const { id: _id, name, ...details } = member
  const view = { target: name, ...details }
  try {
    const current = ctx?.agents?.get?.(member.id)?.model?.current?.()
    if (typeof current?.provider === 'string' && current.provider.length > 0
      && typeof current.model === 'string' && current.model.length > 0) {
      view.model = `${current.provider}/${current.model}`
    }
  } catch {
    // A missing/inactive Agent or unavailable selection keeps the roster value.
  }
  if (member.role === 'lead' && orchestratorActive === true) view.orchestrator = true
  return view
}

/**
 * Text of the `team:identity` prompt context for one member.
 *
 * While orchestrator mode is active the Lead is still the internal Team target
 * "lead", but its model-facing identity names the orchestrator role explicitly.
 */
function teamIdentityText(team, agent, orchestratorActive) {
  const { role, name } = team.membership(agent)
  if (role === 'lead') {
    return `You are the Team Lead named "lead".${orchestratorActive === true
      ? ' You are currently operating as the ORCHESTRATOR of this session: you own the plan, the delegation, the verification, and the final answer.'
      : ''}
Use list_agents({}) to find your teammates and their names.
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).`
  }
  return `You are teammate "${name}".
Your Team Lead is named "lead".
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
Use list_agents({}) to find your teammates and their names.
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).`
}

/** TEAM_IDENTITY context order, tolerating prompt services without context ordering. */
function teamIdentityOrder(scope) {
  return typeof scope.systemPrompt.getContextOrder === 'function'
    ? scope.systemPrompt.getContextOrder('TEAM_IDENTITY')
    : scope.systemPrompt.getSectionOrder('TEAM_IDENTITY')
}

/** Dispose one function or disposable object without letting cleanup throw. */
function safeDispose(disposable) {
  try {
    if (typeof disposable === 'function') disposable()
    else if (disposable !== null && typeof disposable === 'object' && typeof disposable.dispose === 'function') {
      disposable.dispose()
    }
  } catch {
    // Registration cleanup is best-effort; the Agent scope is the backstop.
  }
}

/** Log one warning through the shared deps logger, swallowing logger failures. */
function warnTools(deps, message) {
  try {
    if (typeof deps?.logger?.warn === 'function') deps.logger.warn(`agent-soul: ${message}`)
  } catch {
    // Logging must never break tool installation.
  }
}

/**
 * Whether one thrown value is the Agent Soul admission veto.
 *
 * The check is structural (`name`/`code`) instead of `instanceof` so this
 * always-loaded module stays dependency-free and still recognizes the error
 * after it crossed the shared subagent lifecycle's generic wrapper.
 * @param {unknown} error
 * @returns {boolean}
 */
function isSoulPlanUnavailable(error) {
  return error !== null && typeof error === 'object'
    && (error.name === 'SoulPlanUnavailableError' || error.code === SOUL_PLAN_UNAVAILABLE_CODE)
}

/**
 * Find the Soul admission veto in one error's bounded `.cause` chain.
 *
 * The shipped lifecycle wraps a non-`SubagentError` creation failure as
 * `SubagentError("… is unavailable", "NOT_RESUMABLE", { cause })`, which the
 * Remote surface wraps again; walking a few hops recovers the actionable cause.
 * Unrelated refusal codes have no such cause and stay untouched.
 * @param {unknown} error
 * @returns {object | undefined}
 */
function soulPlanCauseOf(error) {
  let current = error
  for (let hops = 0; hops <= MAX_CAUSE_HOPS; hops += 1) {
    if (isSoulPlanUnavailable(current)) return current
    if (current === null || typeof current !== 'object') return undefined
    current = current.cause
  }
  return undefined
}

/**
 * Build the actionable cold-resume refusal for one acknowledged Soul veto.
 *
 * Records one admission diagnostic and one stable log line, then returns the
 * model-facing error. The original wrapper is preserved as `cause`.
 * @param {object} deps - shared plugin deps.
 * @param {string} target - addressed teammate.
 * @param {unknown} error - the delivery failure reported by the Team service.
 * @param {object} soulError - the matched admission veto.
 * @returns {Error}
 */
function resumeRefusal(deps, target, error, soulError) {
  const soulMessage = typeof soulError.message === 'string' && soulError.message.length > 0
    ? soulError.message
    : SOUL_PLAN_UNAVAILABLE_FALLBACK
  const code = typeof soulError.code === 'string' && soulError.code.length > 0
    ? soulError.code
    : SOUL_PLAN_UNAVAILABLE_CODE
  const reason = typeof soulError.reason === 'string' && soulError.reason.length > 0
    ? soulError.reason
    : undefined
  try {
    deps.admissionDiagnostics?.record?.({
      teammate: target,
      code,
      reason,
      message: soulMessage,
      at: Date.now(),
    })
  } catch {
    // The diagnostic sink is best-effort; the refusal below is the contract.
  }
  warnTools(deps, `cold resume refused for teammate "${target}": ${soulMessage} (code ${code}${reason === undefined ? '' : `, reason ${reason}`})`)
  return new Error(
    `teammate "${target}" could not be resumed: ${soulMessage}. The teammate was not started. Restore its durable Agent Soul binding or re-spawn it with spawn_teammate to create a valid one.`,
    { cause: error },
  )
}

/** Whether orchestrator mode currently owns this Lead's scope. */
function orchestratorActiveOf(deps, agent) {
  try {
    return deps?.orchestrator?.isActive?.(agent) === true
  } catch {
    return false
  }
}

/**
 * Install the soul-only delegation fences in one Team member's Agent scope.
 *
 * Three layers cover the same risk:
 * 1. a scoped tool restriction removes every visible `subagent` /
 *    `subagent_fork` global from the model-facing tool view; scoped Team tools
 *    stay visible because restrictions only mask inherited globals;
 * 2. a scoped `tools.guard` denies any direct call by name even when the tool
 *    is no longer (or not yet) visible;
 * 3. the plugin's `agent/created` fence in `lib/spawn.js` vetoes children.
 *
 * The restriction is reconciled on `tools/change`. A tool provider may mount
 * its generic `subagent`/`subagent_fork` tool after this Agent was prepared,
 * and the Harness rejects `restrict()` names that are not yet visible globals,
 * so the installed restriction must follow the live registry instead of
 * snapshotting it once.
 *
 * @param {object} agent - exact live Team member.
 * @param {object} scope - `agent.ctx`.
 * @param {object} deps - shared plugin deps (`ctx`, `logger`).
 * @returns {(() => void) | undefined} disposer for the installed fences.
 */
function installSoulOnlyFences(agent, scope, deps) {
  const tools = scope?.tools
  if (tools === undefined || tools === null) return undefined
  /** @type {Array<unknown>} */
  const disposers = []
  /** One independent, lifetime-held deny restriction per generic tool. */
  /** @type {Map<string, () => void>} */
  const restrictions = new Map()
  /** @type {Set<string>} */
  const deniedNames = new Set()
  let disposed = false
  let reconciling = false

  /** The names visible in this Agent scope, using the scoped or root service. */
  const visibleNames = () => {
    const definitions = typeof tools.definitions === 'function'
      ? tools.definitions(agent)
      : deps?.ctx?.get?.('tools')?.definitions?.(agent)
    const visible = new Set()
    if (Array.isArray(definitions)) {
      for (const definition of definitions) {
        if (typeof definition?.name === 'string' && definition.name !== '') visible.add(definition.name)
      }
    }
    return visible
  }

  /**
   * Align the active restriction with the currently visible generic tools.
   * Reentrancy is expected: applying or lifting a restriction emits
   * `tools/change` synchronously.
   */
  const reconcile = () => {
    if (disposed || reconciling) return
    reconciling = true
    try {
      while (!disposed) {
        let visible
        try {
          visible = visibleNames()
        } catch (error) {
          warnTools(deps, `cannot read the tool view for Agent ${String(agent?.id)}: ${String(error)}`)
          return
        }
        if (typeof tools.restrict !== 'function') {
          if (visible.has(GENERIC_SUBAGENT_TOOLS[0]) || visible.has(GENERIC_SUBAGENT_TOOLS[1])) {
            warnTools(deps, 'the tool service exposes no restrict(); generic subagent tools stay visible to this Team member')
          }
          return
        }
        // Each generic tool gets its own lifetime-held restriction. Never rebuild
        // a union containing an older name: an unregistered tool's existing deny
        // is inert, but passing that stale name to a NEW restrict() would fail
        // core's registration-time validation and expose the newly mounted tool.
        // Independent entries also avoid the probe/lift emissions that recursively
        // woke every other Agent's listener in the original implementation.
        const name = GENERIC_SUBAGENT_TOOLS.find(candidate => visible.has(candidate) && !deniedNames.has(candidate))
        if (name === undefined) break
        try {
          const next = tools.restrict({ deny: [name] })
          // Registration emits before returning its disposer. Do not leave a
          // fresh restriction behind when that notification disposed the fence.
          if (disposed) {
            safeDispose(next)
            return
          }
          restrictions.set(name, next)
          deniedNames.add(name)
          // A nested listener may have mounted the other generic tool while this
          // scope's own notification was suppressed. Re-read until no newly
          // visible generic name remains instead of losing that registration.
        } catch (error) {
          warnTools(deps, `could not hide generic subagent tool ${name} for Agent ${String(agent?.id)}: ${String(error)}`)
          return
        }
      }
    } finally {
      reconciling = false
    }
  }

  try {
    if (typeof scope.on === 'function') disposers.push(scope.on('tools/change', reconcile))
  } catch (error) {
    warnTools(deps, `could not observe tool changes for Agent ${String(agent?.id)}: ${String(error)}`)
  }
  // Restrict what is visible right now; the listener handles later mounts.
  reconcile()

  try {
    if (typeof tools.guard === 'function') {
      disposers.push(tools.guard((execution) => {
        const name = typeof execution?.name === 'string' ? execution.name : ''
        return GENERIC_SUBAGENT_TOOLS.includes(name) ? SOUL_ONLY_DENIAL : undefined
      }))
    }
  } catch (error) {
    warnTools(deps, `could not guard generic subagent tools for Agent ${String(agent?.id)}: ${String(error)}`)
  }
  if (disposers.length === 0 && restrictions.size === 0) return undefined
  return () => {
    disposed = true
    for (const restriction of restrictions.values()) safeDispose(restriction)
    restrictions.clear()
    for (const dispose of disposers.reverse()) safeDispose(dispose)
  }
}

/**
 * Install the Team tool set plus prompt sections in one exact Agent scope.
 *
 * Registers the `team:policy` section, the required `team:identity` context,
 * the Lead-only `team:agent-souls` catalog section, and every shipped Team
 * tool (plus `list_agent_souls`) with soul-aware `spawn_teammate`.
 * @param {object} agent - the exact live Agent owning `scope`.
 * @param {object} scope - `agent.ctx` (agent-scoped Context).
 * @param {{ ctx: object, config: object, catalog: object, deps: object }} args
 *   `args.ctx` is the ROOT plugin context, `args.config` the normalized config,
 *   `args.catalog` the soul catalog, `args.deps` the shared deps object.
 * @returns {() => void} disposer unregistering everything installed here.
 */
export function installTeamTools(agent, scope, args) {
  const ctx = args.ctx
  const deps = args.deps
  const interrupt = args.config?.interrupt ?? true
  const catalog = args.catalog ?? deps.catalog
  const team = ctx.agentTeams
  const orchestratorActive = () => orchestratorActiveOf(deps, agent)
  /** @type {Array<() => unknown>} */
  const disposers = []
  /** @param {() => unknown} disposer */
  const register = (disposer) => { disposers.push(disposer) }
  try {
    register(scope.systemPrompt.section({
      name: 'team:policy',
      order: scope.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: teamPolicy(interrupt),
    }))
    register(scope.systemPrompt.context({
      name: 'team:identity',
      order: teamIdentityOrder(scope),
      required: true,
      text: () => teamIdentityText(team, agent, orchestratorActive()),
    }))
    if (team.membership(agent).role === 'lead' && catalog !== undefined) {
      register(scope.systemPrompt.section({
        name: 'team:agent-souls',
        order: scope.systemPrompt.getSectionOrder('TEAM_POLICY') + 20,
        text: () => catalog.promptText(deps.rootOf(agent)),
        // Descriptions are soul-authored content and may contain literal {{…}}.
        interpolate: false,
      }))
    }
    const fences = installSoulOnlyFences(agent, scope, deps)
    if (fences !== undefined) register(fences)

    register(scope.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate. Only the Team Lead may call this tool. Every teammate runs a defined Agent Soul: agent_type selects one from list_agent_souls, and omitting agent_type uses the configured default Agent Soul. The teammate then runs that soul: its role definition is applied at the deployment-persona position (the deployment persona prefix line, when configured, is still emitted first), its tools list becomes the teammate tool permission matrix, and its model becomes the routed model. Never use subagent or subagent_fork; never invent a soul name.',
      parameters: {
        name: { type: 'string', required: true, description: 'Unique lower-kebab-case teammate name.' },
        description: { type: 'string', required: true, description: 'Short description of the delegated responsibility.' },
        prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
        context: {
          type: 'string',
          enum: ['fresh', 'fork'],
          description: 'fresh starts without Lead history; fork inherits completed Lead turns. Resolution order: the explicit context passed to this call, then the selected Soul\'s declared context, then the configured default context (config.defaultContext, normally fresh).',
        },
        agent_type: {
          type: 'string',
          description: 'Optional Agent Soul name from list_agent_souls. Omit it when no soul matches the task: spawn_teammate then uses the configured default Agent Soul (Settings > Agent Soul > Souls) and fails clearly if no default is usable. Never invent a soul name.',
        },
      },
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(toolArgs, exec) {
        const lead = callingAgent(exec.agent, 'spawn_teammate')
        const result = await deps.spawnTeamMember(deps, lead, {
          name: toolArgs.name,
          description: toolArgs.description,
          prompt: toolArgs.prompt,
          context: toolArgs.context,
          agentType: toolArgs.agent_type,
          signal: exec.signal,
        })
        const { member, soul } = result
        if (soul === undefined || soul === null || typeof soul.name !== 'string' || soul.name === '') {
          // The output contract requires a soul on every spawn. A spawn layer
          // that cannot name the soul it applied is a broken registration, not
          // a plain teammate.
          throw new Error('spawn_teammate returned a teammate without an Agent Soul; soul-only delegation is enforced')
        }
        return {
          member: modelMember(member, ctx, orchestratorActive()),
          soul: {
            name: soul.name,
            tools: soul.tools ?? null,
            model: soul.model ?? null,
          },
        }
      },
    })))

    register(scope.tools.register(defineTool({
      name: 'send_message',
      description: 'Send one message to another Team member. A running target receives it at the nearest step boundary; an inactive target starts or resumes a turn.',
      parameters: {
        target: { type: 'string', required: true, description: 'Member target returned by spawn_teammate or list_agents, including lead.' },
        message: { type: 'string', required: true, description: 'Self-contained message for the target.' },
      },
      output: jsonOutput(SEND_VALUE_SCHEMA),
      async execute(toolArgs, exec) {
        const caller = callingAgent(exec.agent, 'send_message')
        try {
          await team.sendMessage(caller, {
            target: toolArgs.target,
            content: [{ type: 'text', text: toolArgs.message }],
            signal: exec.signal,
          })
        } catch (error) {
          // The shared subagent lifecycle reports a vetoed cold resume as a
          // generic `NOT_RESUMABLE`. Translate only an acknowledged Soul cause:
          // self-messages, cancellations, and every other failure stay as-is.
          const soulError = soulPlanCauseOf(error)
          if (soulError === undefined) throw error
          throw resumeRefusal(deps, toolArgs.target, error, soulError)
        }
        return { sent: true }
      },
    })))

    register(scope.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with an addressable target and current availability. inactive means no turn is executing, not a task result. provisioning and failed describe member creation.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      execute(_toolArgs, exec) {
        return Promise.resolve(team.listMembers(callingAgent(exec.agent, 'list_agents'))
          .map(member => modelMember(member, ctx, orchestratorActive())))
      },
    })))

    register(scope.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait for the next teammate status, message, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(toolArgs, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = toolArgs.timeout_ms ?? 30_000
        // Preserve the Team service's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await team.waitForChange(caller, timeoutMs, exec.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = team.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer',
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        return await team.waitForChange(caller, timeoutMs, exec.signal)
      },
    })))

    if (interrupt) {
      register(scope.tools.register(defineTool({
        name: 'interrupt_agent',
        description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
        parameters: {
          target: { type: 'string', required: true, description: 'Teammate target returned by spawn_teammate or list_agents.' },
        },
        output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
        execute(toolArgs, exec) {
          return Promise.resolve(team.interrupt(callingAgent(exec.agent, 'interrupt_agent'), toolArgs.target))
        },
      })))
    }

    register(scope.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(toolArgs, exec) {
        return await team.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: toolArgs.subject,
          description: toolArgs.description,
          ...toolArgs.blocked_by === undefined ? {} : { blockedBy: toolArgs.blocked_by },
          ...toolArgs.write_scopes === undefined ? {} : { writeScopes: toolArgs.write_scopes },
        })
      },
    })))

    register(scope.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member target from spawn_teammate or list_agents, matching ownerName; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(toolArgs, exec) {
        const status = toolArgs.status
        const filtered = team.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (toolArgs.owner === undefined || (toolArgs.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === toolArgs.owner))
          && (toolArgs.ready === undefined || task.ready === toolArgs.ready))
        const cursor = toolArgs.cursor ?? 0
        const limit = toolArgs.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {},
        })
      },
    })))

    register(scope.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      execute(toolArgs, exec) {
        return Promise.resolve(team.getTask(callingAgent(exec.agent, 'team_task_get'), toolArgs.task_id))
      },
    })))

    register(scope.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member target from spawn_teammate or list_agents for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(toolArgs, exec) {
        return await team.updateTask(callingAgent(exec.agent, 'team_task_update'), {
          taskId: toolArgs.task_id,
          expectedRevision: toolArgs.expected_revision,
          action: toolArgs.action,
          ...toolArgs.subject === undefined ? {} : { subject: toolArgs.subject },
          ...toolArgs.description === undefined ? {} : { description: toolArgs.description },
          ...toolArgs.blocked_by === undefined ? {} : { blockedBy: toolArgs.blocked_by },
          ...toolArgs.write_scopes === undefined ? {} : { writeScopes: toolArgs.write_scopes },
          ...toolArgs.owner === undefined ? {} : { owner: toolArgs.owner },
        })
      },
    })))

    register(scope.tools.register(defineTool({
      name: 'list_agent_souls',
      description: 'List every discovered Agent Soul with its description, tool permission matrix, model route, default spawn context, source file, slash command, and diagnostics. Use it to choose a valid agent_type for spawn_teammate; never invent a soul name. Pass include_body to read the full operating contract of each soul.',
      parameters: {
        include_body: {
          type: 'boolean',
          description: 'Include each soul\'s full Markdown body (its operating contract) in the output. Defaults to false; bodies can be long.',
        },
      },
      output: jsonOutput(SOULS_VALUE_SCHEMA),
      async execute(toolArgs, exec) {
        const lead = callingAgent(exec.agent, 'list_agent_souls')
        return await deps.describeSouls(deps, lead, {
          includeBody: Boolean(toolArgs.include_body),
          ...exec.signal === undefined ? {} : { signal: exec.signal },
        })
      },
    })))
  } catch (error) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}
