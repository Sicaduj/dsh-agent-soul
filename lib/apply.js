/**
 * Soul application for freshly created (and cold-resumed) teammates.
 *
 * This module is the second half of the spawn path: `lib/spawn.js` records a
 * {@link SoulSnapshot} plan in `deps.pending` under
 * `deps.pendingKey(lead, teammateName)` before the teammate Agent exists, then
 * the Lead's `agent/created` listener calls {@link applyTeammateSoul} once
 * the child Agent is live. On a cold resume there is no pending plan, so the
 * same function falls back to the durable binding store.
 *
 * Required persona, tool, and model effects are transactional: a failure
 * removes partial effects and rejects Agent creation rather than admitting an
 * unrestricted teammate. Durable binding writes stay best-effort, but a
 * missing, unreadable, or corrupt cold-resume binding rejects admission: a
 * roster teammate is never allowed to start without its Soul plan.
 *
 * @module @local/dsh-agent-soul/apply
 */

/**
 * Scoped system-prompt section placed at the deployment-persona order. The harness's configured
 * deployment persona-prefix line (for example "You are an AI agent powered by DeepSeek Harness.")
 * is still emitted ahead of it, so this section adds the soul persona rather than deleting that line.
 */
const PERSONA_SECTION_NAME = 'deployment:persona-prefix'

/** Central prompt-order placement name for the deployment persona prefix. */
const PERSONA_ORDER_NAME = 'DEPLOYMENT_PERSONA_PREFIX'

/**
 * One soul as applied to a teammate; plain JSON (also the binding-store form).
 *
 * @typedef {object} SoulSnapshot
 * @property {string} name
 * @property {string} persona
 * @property {string[] | null} tools
 * @property {{ provider: string, model: string, reasoningEffort?: string } | null} model
 * @property {'fresh' | 'fork' | null} [context]
 * @property {string} [sourceLabel]
 */

/**
 * In-memory handoff between a spawn and the child's `agent/created` listener.
 *
 * @typedef {object} PendingSpawns
 * @property {(key: string, plan: SoulSnapshot) => () => void} set
 * @property {(key: string) => SoulSnapshot | undefined} take
 * @property {(key: string, expected?: SoulSnapshot) => boolean} delete
 * @property {() => void} clear
 * @property {readonly size: number} size
 */

/**
 * Human-readable message for one arbitrary thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Log one warning when the shared deps logger exposes `warn`.
 * Logging failures are swallowed: diagnostics must never break soul application.
 * @param {object} deps
 * @param {string} message
 * @returns {void}
 */
function warn(deps, message) {
  try {
    if (typeof deps?.logger?.warn === 'function') deps.logger.warn(`agent-soul: ${message}`)
  } catch {
    // ignore
  }
}

/** Stable machine-readable code for {@link SoulPlanUnavailableError}. */
const SOUL_PLAN_UNAVAILABLE_CODE = 'SOUL_PLAN_UNAVAILABLE'

/**
 * Raised when a roster teammate has no usable Agent Soul plan.
 *
 * Soul application is fail-closed: a new or cold-resumed teammate must resolve
 * a pending spawn plan or a durable binding before any effect is admitted. This
 * is the root installer's one admission-veto class. Cancellation, Agent
 * disposal, and unexpected post-plan failures are instead logged skips after
 * their partial effects are unwound; Agents already live at plugin activation
 * are skipped with a warning for this class too because they cannot be vetoed.
 *
 * `code` is a stable marker for logs and for the Team tool surface, which
 * translates the shared subagent lifecycle's generic `NOT_RESUMABLE` wrapper
 * back into an actionable refusal. `reason` distinguishes the admission cases
 * without changing the human-readable message.
 */
export class SoulPlanUnavailableError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, reason?: string }} [options]
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'SoulPlanUnavailableError'
    this.code = SOUL_PLAN_UNAVAILABLE_CODE
    if (options.cause !== undefined) this.cause = options.cause
    if (options.reason !== undefined) this.reason = options.reason
  }
}

/**
 * One bounded admission diagnostic; plain JSON so it can cross the tool/GUI
 * surface unchanged.
 *
 * @typedef {object} AdmissionDiagnostic
 * @property {string} teammate
 * @property {string} code
 * @property {string | null} reason
 * @property {string} message
 * @property {number} at
 */

/** Coerce one diagnostic field to a string, keeping the caller's fallback otherwise. */
function stringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

/**
 * Create a bounded in-memory store of cold-resume admission refusals.
 *
 * The best-effort diagnostic sink is intentionally tiny and pure: the plugin
 * records why a resume was refused so `list_agent_souls` can expose the
 * Soul-specific reason instead of only the shared subagent lifecycle's generic
 * "is unavailable" wrapper. Oldest entries are dropped once `limit` is reached.
 *
 * @param {number} [limit] maximum retained entries; the newest win.
 * @returns {{ record(entry?: object): AdmissionDiagnostic, list(): AdmissionDiagnostic[], clear(): void }}
 */
export function createAdmissionDiagnostics(limit = 20) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError('agent-soul admission diagnostics limit must be a positive integer')
  }
  /** @type {AdmissionDiagnostic[]} */
  const entries = []
  return {
    record(entry = {}) {
      const diagnostic = {
        teammate: stringOr(entry?.teammate, ''),
        code: stringOr(entry?.code, SOUL_PLAN_UNAVAILABLE_CODE),
        reason: stringOr(entry?.reason, null),
        message: stringOr(entry?.message, ''),
        at: Number.isFinite(entry?.at) ? entry.at : Date.now(),
      }
      entries.push(diagnostic)
      if (entries.length > limit) entries.splice(0, entries.length - limit)
      return { ...diagnostic }
    },
    list() {
      return entries.map(entry => ({ ...entry }))
    },
    clear() {
      entries.length = 0
    },
  }
}

/** Dispose one function, disposable object, or thenable disposer without masking the original failure. */
function safeDispose(disposable) {
  try {
    let result
    if (typeof disposable === 'function') result = disposable()
    else if (disposable !== null && typeof disposable === 'object' && typeof disposable.dispose === 'function') {
      result = disposable.dispose()
    }
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      result.then(undefined, () => {})
    }
  } catch {
    // Agent-scope ownership is the final cleanup backstop.
  }
}

/**
 * Create the in-memory map from a just-spawned teammate to the soul it must run.
 *
 * The plan is recorded before `spawnTeammate` resolves (the Team service awaits
 * `agent/created` listeners) and removed by the child's apply call.
 *
 * @returns {PendingSpawns}
 */
export function createPendingSpawns() {
  /** @type {Map<string, SoulSnapshot>} */
  const plans = new Map()
  return {
    set(key, plan) {
      if (plans.has(key)) throw new Error('a soul spawn for this Lead and teammate name is already pending')
      plans.set(key, plan)
      let owned = true
      return () => {
        if (!owned) return
        owned = false
        // take() may already have handed this plan to the child. Never remove a
        // different plan later installed under the same Lead+name key.
        if (plans.get(key) === plan) plans.delete(key)
      }
    },
    take(key) {
      const plan = plans.get(key)
      plans.delete(key)
      return plan
    },
    delete(key, expected) {
      if (expected !== undefined && plans.get(key) !== expected) return false
      return plans.delete(key)
    },
    clear() {
      plans.clear()
    },
    get size() {
      return plans.size
    },
  }
}

/** Use the child's immutable creation cwd for bindings, falling back to the Lead root for older Sessions. */
function bindingRoot(agent, membership, deps) {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return cwd
  return deps.rootOf(membership.root)
}

/**
 * Resolve the soul plan for one teammate: pending spawn first, durable
 * binding second. The pending entry is consumed whether or not it resolves.
 *
 * A roster teammate with neither plan is rejected with
 * {@link SoulPlanUnavailableError}: silently admitting it would run a child
 * under the deployment persona with unrestricted inherited tools. A binding
 * read failure is also fatal for the admission decision because the plan
 * cannot be verified.
 *
 * @param {object} agent - live teammate Agent.
 * @param {object} membership - Team membership row of the teammate.
 * @param {object} deps - shared plugin deps.
 * @returns {Promise<{ plan: SoulSnapshot, fromPending: boolean }>}
 * @throws {SoulPlanUnavailableError}
 */
async function resolvePlan(agent, membership, deps) {
  const name = typeof membership?.name === 'string' && membership.name !== '' ? membership.name : agent?.id
  const pendingKey = deps.pendingKey(membership.root, membership.name)
  const pendingPlan = deps.pending.take(pendingKey)
  if (pendingPlan !== undefined && pendingPlan !== null) return { plan: pendingPlan, fromPending: true }
  let bindingPlan
  try {
    bindingPlan = await deps.bindings.get(bindingRoot(agent, membership, deps), agent.id)
  } catch (error) {
    throw new SoulPlanUnavailableError(
      `teammate "${String(name)}" cannot read its durable Agent Soul binding (${messageOf(error)}); refusing to admit a Soul-less teammate`,
      { cause: error, reason: 'unreadable-binding' },
    )
  }
  if (bindingPlan === undefined || bindingPlan === null) {
    throw new SoulPlanUnavailableError(
      `teammate "${String(name)}" has no pending or durable Agent Soul plan; refusing to admit a Soul-less teammate`,
      { reason: 'missing-binding' },
    )
  }
  return { plan: bindingPlan, fromPending: false }
}

/**
 * Register the soul persona as a scoped section at the deployment-persona
 * order (after the harness's configured deployment persona-prefix line).
 * `agent.ctx.effect` ties the section's lifetime to the Agent scope;
 * the returned effect disposer is also retained by the root install record.
 *
 * @param {object} agent - live teammate Agent.
 * @param {SoulSnapshot} plan
 * @returns {unknown} the Agent-scoped effect disposer.
 */
function registerPersona(agent, plan) {
  const systemPrompt = agent.ctx.systemPrompt
  return agent.ctx.effect(() => systemPrompt.section({
    name: PERSONA_SECTION_NAME,
    order: systemPrompt.getSectionOrder(PERSONA_ORDER_NAME),
    text: plan.persona,
    // Soul Markdown is authored role text, not a deployment prompt template.
    interpolate: false,
  }))
}

/**
 * Turn `plan.tools` into a hard permission matrix.
 *
 * `restrict({ allow: [name] })` is probed per name and lifted immediately:
 * own-scope registrations (for example the Team tools) are not restrictable and
 * throw, so those names are reported as skipped and stay visible rather than
 * failing the teammate. The survivors become one final restriction; an empty
 * plan hides every inherited tool with `restrict({ allow: [] })`.
 *
 * @param {object} agent - live teammate Agent.
 * @param {SoulSnapshot} plan
 * @param {object} membership - Team membership row of the teammate.
 * @param {object} deps - shared plugin deps.
 * @returns {(() => void) | undefined} the final restriction disposer, when one was installed.
 */
function applyToolMatrix(agent, plan, membership, deps) {
  if (plan.tools === null || plan.tools === undefined) return undefined
  if (!Array.isArray(plan.tools)) {
    warn(deps, `soul "${plan.name}" for teammate "${membership.name}" has a malformed tools list; leaving the inherited tool set unchanged`)
    return
  }
  /** @type {string[]} */
  const restrictable = []
  /** @type {string[]} */
  const skipped = []
  for (const name of plan.tools) {
    try {
      const liftProbe = agent.ctx.tools.restrict({ allow: [name] })
      if (typeof liftProbe === 'function') liftProbe()
      restrictable.push(name)
    } catch {
      skipped.push(String(name))
    }
  }
  const dispose = agent.ctx.tools.restrict({ allow: restrictable })
  if (skipped.length > 0) {
    warn(deps, `soul "${plan.name}" for teammate "${membership.name}" lists non-restrictable tool(s) that stay visible: ${skipped.join(', ')}`)
  }
  return dispose
}

/**
 * Route the teammate through its soul-selected model, when one was resolved.
 *
 * @param {object} agent - live teammate Agent.
 * @param {SoulSnapshot} plan
 * @returns {void}
 */
function applyModel(agent, plan) {
  const route = plan.model
  if (route === null || route === undefined) return
  if (typeof route !== 'object' || typeof route.provider !== 'string' || typeof route.model !== 'string') return
  agent.model.select(route)
}

/**
 * Persist a pending (just-spawned) plan for cold resume. Duplicate writes are
 * harmless: the binding store replaces one child's record in place.
 *
 * @param {object} agent - live teammate Agent.
 * @param {object} membership - Team membership row of the teammate.
 * @param {SoulSnapshot} plan
 * @param {object} deps - shared plugin deps.
 * @returns {Promise<void>}
 */
async function persistBinding(agent, membership, plan, deps) {
  try {
    await deps.bindings.set(bindingRoot(agent, membership, deps), agent.id, plan)
  } catch (error) {
    warn(deps, `could not persist the soul binding for teammate "${membership.name}": ${messageOf(error)}`)
  }
}

/**
 * Apply the soul for one freshly created or cold-resumed teammate.
 *
 * The plan resolves from the pending spawn first, then from the durable
 * binding store. There is no silent no-op: a roster teammate without a valid
 * plan rejects admission with {@link SoulPlanUnavailableError}, and a binding
 * read failure does the same. Once a plan exists, required effect failures
 * reject creation and unwind every registration already made.
 *
 * @param {object} agent - live teammate Agent.
 * @param {object} membership - result of `ctx.agentTeams.membership(agent)` with role 'teammate'.
 * @param {object} deps - shared plugin deps.
 * @returns {Promise<{ soulName: string, dispose: () => void }>}
 * @throws {SoulPlanUnavailableError} when no usable plan exists.
 */
export async function applyTeammateSoul(agent, membership, deps) {
  const { plan, fromPending } = await resolvePlan(agent, membership, deps)
  const owned = []
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const disposable of owned.reverse()) safeDispose(disposable)
  }

  try {
    const persona = registerPersona(agent, plan)
    if (persona !== undefined && persona !== null) owned.push(persona)
    const restriction = applyToolMatrix(agent, plan, membership, deps)
    if (restriction !== undefined && restriction !== null) owned.push(restriction)
    applyModel(agent, plan)
    // Binding persistence is diagnostic-only and must never veto an otherwise
    // fully restricted fresh Agent.
    if (fromPending) await persistBinding(agent, membership, plan, deps)
    return { soulName: plan.name, dispose }
  } catch (error) {
    dispose()
    warn(deps, `failed to apply a soul to teammate "${membership?.name ?? '<unknown>'}": ${messageOf(error)}`)
    throw error
  }
}
