/**
 * The plugin's model-facing soul surface on top of the DSH 0.2.2 base Team
 * tools: a soul-aware delegation gate, the Lead catalog, and the soul-only
 * policy layer.
 *
 * DSH 0.2.2 owns \`team_task_*\`, \`send_message\`, \`list_agents\`,
 * \`wait_agent\`, and \`interrupt_agent\`. This module registers only
 * \`spawn_teammate\` and \`list_agent_souls\` plus a scoped \`team:policy\`
 * section that shadows the base policy for Team members.
 *
 * The module is plain ESM with only relative imports because it loads from a
 * DSH profile where only the DSH installation resolves.
 *
 * @module @local/dsh-agent-soul/tools
 */

import { isTeamEnabled, isTeamLead, teamMemberOf } from './team.js'
import {
  GENERIC_SUBAGENT_TOOLS,
  TEAM_TOOL_NAMES,
} from './team-tools.js'

export { TEAM_TOOL_NAMES }

/** Model-facing denial reason for a guarded generic subagent call. */
export const SOUL_ONLY_DENIAL = 'Generic subagent tools are disabled while orchestrator mode is active or for Team members. Every child must run a defined Agent Soul: call spawn_teammate with a valid agent_type, or omit agent_type to use the configured default Soul. If spawn_teammate is not in your tool list, enable Use Agent Teams in the Session model menu and retry; do not substitute a generic subagent.'

/**
 * Whether orchestrator mode owns one Agent's scope.
 *
 * The live bundle and the durable command log cover different gaps in the mode
 * lifecycle. A live bundle can remain after a failed rollback while the durable
 * command settled as off; a durable on-state exists before a resumed bundle is
 * installed. Either condition therefore owns the scope. An unreadable or
 * malformed probe fails closed because permitting a generic child could bypass
 * the only Soul-bound path.
 *
 * @param {object} deps - shared plugin deps; `orchestrator` may be absent in tests.
 * @param {object} agent - exact live Agent.
 * @returns {boolean}
 */
export function orchestratorActive(deps, agent) {
  const runtime = deps?.orchestrator
  if (runtime === undefined || runtime === null) return false
  const hasLive = typeof runtime.isActive === 'function'
  const hasDurable = typeof runtime.modeOf === 'function'
  if (!hasLive && !hasDurable) return true
  try {
    if (hasLive && runtime.isActive(agent) === true) return true
    return hasDurable && runtime.modeOf(agent) === 'on'
  } catch {
    return true
  }
}

/** Brief soul identity returned next to one freshly spawned teammate. */
const SOUL_BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    tools: { required: true, oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
    model: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
}

/** One full soul row returned by \`list_agent_souls\`; every key is present. */
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

/** Output of \`list_agent_souls\`. */
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
          code: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    roots: { type: 'array', required: true, items: { type: 'string' } },
  },
}

/** The teammate identity returned by \`spawn_teammate\`. */
const TEAMMATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    id: { type: 'string', required: true },
    description: { type: 'string' },
  },
}

/** Output of \`spawn_teammate\`; every spawn carries the Agent Soul it runs. */
const SPAWN_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    teammate: { ...TEAMMATE_SCHEMA, required: true },
    soul: { ...SOUL_BRIEF_SCHEMA, required: true },
  },
}

/** Compile one author-facing schema node (\`required: true\` flags move onto the parent array). */
function compileSchema(spec) {
  if (spec === undefined) return {}
  /** @type {Record<string, unknown>} */
  const schema = {}
  if (spec.description !== undefined) schema.description = spec.description
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

/** Validate one scalar schema constraint. */
function validateScalar(schema, value, path) {
  const violations = []
  if (schema.enum !== undefined && !schema.enum.includes(value)) violations.push(`"${path}" must be one of ${JSON.stringify(schema.enum)}`)
  if (schema.const !== undefined && value !== schema.const) violations.push(`"${path}" must be ${JSON.stringify(schema.const)}`)
  return violations
}

/** Validate one value against one compiled schema node, collecting every violation. */
function validateSchema(schema, value, path) {
  if (schema.oneOf !== undefined) {
    let matched = 0
    for (const branch of schema.oneOf) {
      if (validateSchema(branch, value, path).length === 0) matched += 1
    }
    return matched === 1 ? [] : [`"${path}" must match exactly one oneOf branch (matched ${matched})`]
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [`"${path}" must be an object`]
      }
      const violations = []
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) {
          violations.push(`missing required property "${path === '' ? '' : `${path}.`}${key}"`)
        }
      }
      const properties = schema.properties ?? {}
      for (const [key, child] of Object.entries(properties)) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) continue
        violations.push(...validateSchema(child, value[key], path === '' ? key : `${path}.${key}`))
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) {
            violations.push(`"${path === '' ? key : `${path}.${key}`}" is not a declared property (additionalProperties: false)`)
          }
        }
      }
      return violations
    }
    case 'array': {
      if (!Array.isArray(value)) return [`"${path}" must be an array`]
      if (schema.items === undefined) return []
      const violations = []
      for (const [index, entry] of value.entries()) {
        violations.push(...validateSchema(schema.items, entry, `${path}[${index}]`))
      }
      return violations
    }
    case 'string':
      return typeof value === 'string' ? validateScalar(schema, value, path) : [`"${path}" must be a string`]
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? validateScalar(schema, value, path) : [`"${path}" must be a number`]
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? validateScalar(schema, value, path) : [`"${path}" must be an integer`]
    case 'boolean':
      return typeof value === 'boolean' ? validateScalar(schema, value, path) : [`"${path}" must be a boolean`]
    case 'null':
      return value === null ? [] : [`"${path}" must be null`]
    default:
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
      const violations = validateSchema(parameters, args, 'arguments')
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

/** Log one warning through the shared deps logger, swallowing logger failures. */
function warnTools(deps, message) {
  try {
    if (typeof deps?.logger?.warn === 'function') deps.logger.warn(`agent-soul: ${message}`)
  } catch {
    // Logging must never break tool installation.
  }
}

/**
 * The soul-aware Team policy text registered in one Agent's scope.
 *
 * This section shadows the base \`team:policy\` for that Agent: it keeps the
 * shared-filesystem/task-board guidance from DSH 0.2.2 and replaces the
 * "use subagent/subagent_fork" delegation advice with the soul-only rule.
 *
 * @param {{ role: 'lead' | 'teammate' }} member - the Agent's Team role.
 * @param {boolean} enabled - whether Team mode is enabled for the Agent.
 * @returns {string}
 */
export function soulPolicyText(member, enabled) {
  if (member?.role === 'teammate' && enabled !== true) {
    return 'You are a defined Agent Soul teammate. Do not use subagent or subagent_fork; use send_message to report to the agent that delegated your work.'
  }
  if (enabled !== true) return ''
  return [
    'Agent Teams is available in this session.',
    '',
    'Delegation is soul-only: create every teammate with spawn_teammate, never with subagent or subagent_fork. Generic subagent tools are denied for Team members. Choose a valid agent_type with list_agent_souls; omitting agent_type uses the configured default Agent Soul. If spawn_teammate is not visible, report the missing Agent Soul spawn surface instead of trying a generic subagent tool.',
    '',
    'The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.',
    '',
    'Use the names returned by spawn_teammate or list_agents as owner when assigning or filtering shared tasks. The root can reassign tasks to itself or any continuable descendant; other agents claim ready tasks themselves. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. The root agent must wait for required teammates before giving the final answer.',
    '',
    'Task changes do not end wait_agent calls, add inbox messages, or start idle agents. Use send_message when another agent needs to act on a task.',
  ].join('\n')
}

/**
 * Install the soul surface in one exact Agent scope.
 *
 * Registers the scoped policy shadow, the Lead catalog, the soul-only guard,
 * and — for the Lead only — \`spawn_teammate\` and \`list_agent_souls\`.
 * The base \`tool-agent-team\` row stays enabled and keeps ownership of
 * \`team_task_*\`; \`tool-subagent-control\` keeps \`send_message\`/\`list_agents\`/\`wait_agent\`.
 *
 * @param {object} agent - exact live Agent owning \`scope\`.
 * @param {object} scope - \`agent.ctx\` (agent-scoped Context).
 * @param {{ ctx: object, config: object, catalog: object, deps: object, member?: object }} args
 *   \`ctx\` is the ROOT plugin context, \`config\` the normalized config,
 *   \`catalog\` the soul catalog, \`deps\` the shared deps object.
 * @returns {() => void} disposer unregistering everything installed here.
 */
export function installSoulSurface(agent, scope, args) {
  const ctx = args.ctx
  const deps = args.deps
  const catalog = args.catalog ?? deps.catalog
  const member = args.member ?? teamMemberOf(ctx, agent)
  if (member === undefined) return () => {}
  const lead = member.role === 'lead'
  /** @type {Array<() => unknown>} */
  const disposers = []
  /** @param {() => unknown} disposer */
  const register = (disposer) => { disposers.push(disposer) }
  try {
    // Shadow the shipped team:policy section for this Agent, preserving the
    // 0.2.2 task-board guidance while replacing the generic delegation advice.
    register(scope.systemPrompt.section({
      name: 'team:policy',
      order: scope.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: () => soulPolicyText(member, isTeamEnabled(ctx, agent)),
    }))
    if (lead && catalog !== undefined) {
      register(scope.systemPrompt.section({
        name: 'team:agent-souls',
        order: scope.systemPrompt.getSectionOrder('TEAM_POLICY') + 20,
        text: () => isTeamEnabled(ctx, agent) ? catalog.promptText(deps.rootOf(agent)) : '',
        // Descriptions are soul-authored content and may contain literal {{…}}.
        interpolate: false,
      }))
    }
    try {
      if (typeof scope.tools.guard === 'function') {
        register(scope.tools.guard((execution) => {
          const name = typeof execution?.name === 'string' ? execution.name : ''
          if (!GENERIC_SUBAGENT_TOOLS.includes(name)) return undefined
          if (orchestratorActive(deps, agent)) return SOUL_ONLY_DENIAL
          if (!isTeamEnabled(ctx, agent) && deps.isSoulTeammate?.(agent) !== true) return undefined
          return SOUL_ONLY_DENIAL
        }))
      }
    } catch (error) {
      warnTools(deps, `could not guard generic subagent tools for Agent ${String(agent?.id)}: ${String(error)}`)
    }

    if (lead) {
      register(scope.tools.register(defineTool({
        name: 'spawn_teammate',
        description: 'Create one named, durable teammate. Only the Team Lead may call this tool while Agent Teams is enabled. Every teammate runs a defined Agent Soul: agent_type selects one from list_agent_souls, and omitting agent_type uses the configured default Agent Soul. The teammate then runs that soul: its role definition is applied at the deployment-persona position, its tools list becomes the teammate tool permission matrix, and its model becomes the routed model. Never use subagent or subagent_fork; never invent a soul name.',
        parameters: {
          name: {
            type: 'string',
            required: true,
            description: 'Unique lower-kebab-case teammate name: lower-case letters, digits, or hyphens, starting with a letter, at most 32 characters, and not "lead".',
          },
          description: { type: 'string', required: true, description: 'Short lower-level description for this teammate (at most 200 characters).' },
          prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
          context: {
            type: 'string',
            enum: ['fresh', 'fork'],
            description: "fresh starts without Lead history; fork inherits completed Lead turns. Resolution order: the explicit context passed to this call, then the selected Soul's declared context, then the configured default context (config.defaultContext, normally fresh).",
          },
          agent_type: {
            type: 'string',
            description: 'Optional Agent Soul name from list_agent_souls. Omit it when no soul matches the task: spawn_teammate then uses the configured default Agent Soul (Settings > Agent Soul > Souls) and fails clearly if no default is usable. Never invent a soul name.',
          },
        },
        output: jsonOutput(SPAWN_VALUE_SCHEMA),
        async execute(toolArgs, exec) {
          const caller = callingAgent(exec.agent, 'spawn_teammate')
          const result = await deps.spawnTeamMember(deps, caller, {
            name: toolArgs.name,
            description: toolArgs.description,
            prompt: toolArgs.prompt,
            context: toolArgs.context,
            agentType: toolArgs.agent_type,
            signal: exec.signal,
          })
          const { member: teammate, soul } = result
          if (soul === undefined || soul === null || typeof soul.name !== 'string' || soul.name === '') {
            throw new Error('spawn_teammate returned a teammate without an Agent Soul; soul-only delegation is enforced')
          }
          return {
            teammate: {
              name: String(teammate?.name ?? ''),
              id: String(teammate?.id ?? ''),
              ...typeof teammate?.description === 'string' ? { description: teammate.description } : {},
            },
            soul: {
              name: soul.name,
              tools: soul.tools ?? null,
              model: soul.model ?? null,
            },
          }
        },
      }), { when: ({ agent: caller }) => isTeamLead(ctx, caller) && isTeamEnabled(ctx, caller) }));

      register(scope.tools.register(defineTool({
        name: 'list_agent_souls',
        description: 'List every discovered Agent Soul with its description, tool permission matrix, model route, default spawn context, source file, slash command, and diagnostics. Use it to choose a valid agent_type for spawn_teammate; never invent a soul name. Pass include_body to read the full operating contract of each soul.',
        parameters: {
          include_body: {
            type: 'boolean',
            description: "Include each soul's full Markdown body (its operating contract) in the output. Defaults to false; bodies can be long.",
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
      }), { when: ({ agent: caller }) => isTeamLead(ctx, caller) && isTeamEnabled(ctx, caller) }))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // Best-effort unwind; the Agent scope is the backstop.
      }
    }
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // Best-effort unwind; the Agent scope is the backstop.
      }
    }
  }
}
