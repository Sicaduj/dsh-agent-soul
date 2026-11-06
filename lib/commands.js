/**
 * User-invocable soul slash commands.
 *
 * Each soul with `user-invocable: true` becomes one scoped slash command for
 * the Team Lead agent, so a human can start a teammate with `/name <task>`
 * without going through the model. Commands are registered inside an injected
 * `commands` child scope of the Lead's Agent scope, so they shadow globals only
 * for that agent and dispose with it.
 *
 * @module @local/dsh-agent-soul/commands
 */

/** Slash-command names accepted by the commands service. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

/** Maximum soul description characters carried in the command summary. */
const DESCRIPTION_CHARS = 120

/**
 * Status reason for a command name this plugin did not register when no exact
 * failure was captured (for example a colliding registration from a record
 * produced by an older Live Lead).
 */
const OWNED_BY_ANOTHER_HANDLER = 'the command name is owned by another handler or registration failed'

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
 * Logging failures are swallowed: diagnostics must never break command install.
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

/**
 * The slash-command name one soul would register under the configured prefix.
 * @param {object} deps - shared plugin deps.
 * @param {{ name: string }} definition
 * @returns {string}
 */
function commandName(deps, definition) {
  const prefix = typeof deps.config?.commandPrefix === 'string' ? deps.config.commandPrefix : ''
  return `${prefix}${definition.name}`
}

/**
 * First `max` characters of one arbitrary value, coerced to a string.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function firstChars(value, max) {
  return (typeof value === 'string' ? value : String(value ?? '')).slice(0, max)
}

/**
 * Register one command handler that maps spawn failures to error results and
 * never throws.
 *
 * @param {object} deps - shared plugin deps.
 * @param {object} definition - soul definition captured at registration time.
 * @returns {(invocation: object) => Promise<{ kind: 'success', text?: string } | { kind: 'error', text: string }>}
 */
function createHandler(deps, definition) {
  return async (invocation) => {
    try {
      const result = await deps.spawnSoulFromCommand(
        deps,
        invocation.agent,
        definition,
        invocation.rawInput,
        { signal: invocation.signal },
      )
      return { kind: 'success', text: result?.text }
    } catch (error) {
      const message = messageOf(error)
      return { kind: 'error', text: message.length > 0 ? message : 'the command failed' }
    }
  }
}

/**
 * Dispose the injected child scope that owns the command registrations.
 * Accepts a Cordis Fiber (`{ dispose() }`, possibly thenable) or a bare disposer
 * function, and swallows disposal failures.
 *
 * @param {unknown} injected - value returned by `agentCtx.inject(...)`.
 * @returns {void}
 */
function disposeInjected(injected) {
  try {
    /** @type {unknown} */
    let result
    if (typeof injected === 'function') result = injected()
    else if (injected !== null && typeof injected === 'object'
      && typeof /** @type {{ dispose?: unknown }} */ (injected).dispose === 'function') {
      result = /** @type {{ dispose: () => unknown }} */ (injected).dispose()
    }
    if (result !== null && typeof result === 'object' && typeof /** @type {{ then?: unknown }} */ (result).then === 'function') {
      /** @type {{ then: (onFulfilled?: unknown, onRejected?: unknown) => unknown }} */ (result)
        .then(undefined, () => {})
    }
  } catch {
    // Disposal is best-effort; the Agent scope also owns the child fiber.
  }
}

/**
 * Read the Lead's catalog snapshot and turn it into the exact command list the
 * Lead should register. Reads `deps.catalog.get` only (no refresh of its own).
 *
 * @param {object} deps
 * @param {string} root
 * @returns {{ commands: { name: string, definition: object }[], signature: string }}
 */
function collectCommands(deps, root) {
  /** @type {{ name: string, definition: object }[]} */
  const commands = []
  try {
    let snapshot
    try {
      snapshot = deps.catalog.get(root)
    } catch (error) {
      warn(deps, `could not read the soul catalog for slash commands: ${messageOf(error)}`)
      return { commands, signature: '' }
    }
    const definitions = Array.isArray(snapshot?.definitions) ? snapshot.definitions : []
    for (const definition of definitions) {
      if (definition === null || typeof definition !== 'object') continue
      if (definition.userInvocable !== true) continue
      if (typeof definition.name !== 'string' || definition.name.length === 0) continue
      const name = commandName(deps, definition)
      if (!COMMAND_NAME.test(name)) {
        warn(deps, `skipping soul "${definition.name}": command name "${name}" does not match ${COMMAND_NAME}`)
        continue
      }
      commands.push({ name, definition })
    }
  } catch (error) {
    warn(deps, `failed to collect soul slash commands: ${messageOf(error)}`)
  }
  // The signature decides whether a running Lead needs a re-registration.
  const signature = commands.map(({ name, definition }) => [
    name,
    String(definition.name),
    String(definition.description),
  ].join('\u0000')).join('\u0001')
  return { commands, signature }
}

/**
 * Register one scoped slash command per collected soul for one Lead agent.
 * Each registration is contained, so a colliding name or a failing service warns
 * and leaves the remaining commands installed instead of tearing the bundle down.
 *
 * The returned record keeps the exact handler function accepted by
 * `commands.register` per name and the failure reason per rejected name, so
 * status consumers can tell "this soul's handler is live" from "the name is
 * invocable but owned by another handler" instead of trusting name presence
 * alone.
 *
 * @param {object} agent - exact live Lead Agent that owns the commands.
 * @param {object} agentCtx - the Lead Agent's scoped Context.
 * @param {object} deps - shared plugin deps.
 * @param {{ name: string, definition: object }[]} commands
 * @returns {{ dispose: () => void, registered: Map<string, Function>, failed: Map<string, string> }}
 *   registration record; always safe to dispose.
 */
function installCommandDefinitions(agent, agentCtx, deps, commands) {
  /** @type {Map<string, Function>} */
  const registered = new Map()
  /** @type {Map<string, string>} */
  const failed = new Map()
  if (commands.length === 0) return { dispose() {}, registered, failed }
  const injected = agentCtx.inject(['commands'], (child) => {
    for (const { name, definition } of commands) {
      const handler = createHandler(deps, definition)
      try {
        child.commands.register({
          name,
          description: `Start a "${definition.name}" teammate: ${firstChars(definition.description, DESCRIPTION_CHARS)}`,
          input: { hint: `task for the ${definition.name} teammate` },
          handler,
        })
        registered.set(name, handler)
      } catch (error) {
        const reason = messageOf(error)
        failed.set(name, reason)
        warn(deps, `soul command "${name}" could not be registered: ${reason}`)
      }
    }
  })

  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      disposeInjected(injected)
    },
    registered,
    failed,
  }
}

/**
 * Register one scoped slash command per user-invocable soul for one Lead
 * agent. Reads the Lead's catalog snapshot through `deps.catalog.get` (no
 * refresh of its own); command definitions are registered through
 * `agentCtx.inject(['commands'], child => child.commands.register(...))` so they
 * shadow globals only for that agent.
 *
 * @param {object} agent - exact live Lead Agent that owns the commands.
 * @param {object} agentCtx - the Lead Agent's scoped Context.
 * @param {object} deps - shared plugin deps.
 * @returns {{ dispose: () => void, registered: Map<string, Function>, failed: Map<string, string> }}
 *   disposer and registration record; always safe to dispose.
 */
export function installSoulCommands(agent, agentCtx, deps) {
  try {
    const root = typeof deps?.rootOf === 'function' ? deps.rootOf(agent) : process.cwd()
    const { commands } = collectCommands(deps, root)
    return installCommandDefinitions(agent, agentCtx, deps, commands)
  } catch (error) {
    warn(deps, `failed to install soul slash commands: ${messageOf(error)}`)
    return { dispose() {}, registered: new Map(), failed: new Map() }
  }
}

/**
 * Resolve one soul command's registration state by handler identity.
 *
 * The command registry resolves a name to one effective definition, and a
 * scoped soul registration can therefore be shadowed by, or fail against, a
 * definition owned by someone else (for example the built-in `/orchestrate`).
 * Name presence alone cannot prove that this soul's handler is live, so
 * callers pass the registration record captured by `installCommandDefinitions`
 * (directly or through `registrationOf`).
 *
 * `known: false` means no usable record exists (an older Live Lead or a
 * composition without the sync service); callers keep their legacy fallback.
 * With a record, `registered` is true only when this plugin's exact handler
 * function is the effective one. When the registry cannot answer (no `find`,
 * a throw, or no resolved definition), the record is authoritative.
 *
 * @param {unknown} commandsService - the `commands` service, when available.
 * @param {unknown} lead - exact Lead agent the record belongs to.
 * @param {string} name - command name without a leading slash.
 * @param {unknown} record - one registration record.
 * @returns {{ known: boolean, registered: boolean, reason?: string }}
 */
export function soulCommandRegistrationState(commandsService, lead, name, record) {
  const registered = record !== null && typeof record === 'object' ? record.registered : undefined
  if (registered === null || typeof registered !== 'object'
    || typeof registered.has !== 'function' || typeof registered.get !== 'function') {
    return { known: false, registered: false }
  }
  if (!registered.has(name)) {
    const failed = record.failed
    const captured = failed !== null && typeof failed === 'object' && typeof failed.get === 'function'
      ? failed.get(name)
      : undefined
    return {
      known: true,
      registered: false,
      reason: typeof captured === 'string' && captured.length > 0 ? captured : OWNED_BY_ANOTHER_HANDLER,
    }
  }
  const handler = registered.get(name)
  if (commandsService === null || typeof commandsService !== 'object'
    || typeof commandsService.find !== 'function') {
    return { known: true, registered: true }
  }
  /** @type {unknown} */
  let found
  try {
    found = commandsService.find(lead, name)
  } catch {
    return { known: true, registered: true }
  }
  // No resolved definition is not evidence against the record.
  if (found === null || typeof found !== 'object') return { known: true, registered: true }
  if (/** @type {{ handler?: unknown }} */ (found).handler === handler) {
    return { known: true, registered: true }
  }
  return {
    known: true,
    registered: false,
    reason: `the command "${name}" is currently owned by another handler`,
  }
}

/**
 * Process-wide reconciler for the soul slash commands of every live Lead.
 *
 * The catalog changes while the Host is running (posts from the GUI, the Lead's
 * agent tool, or an editor), and the `/commands` registry is scoped to each
 * Lead. This keeps the two in sync: `sync()` re-registers a Lead only when its
 * desired command set changed, drops commands of deleted/renamed souls, and
 * removes registrations for Agents that are no longer live Leads. A single
 * colliding name warns and is skipped without disturbing the other commands.
 *
 * @param {object} deps - shared plugin deps.
 * @returns {{ installAgent: (agent: object) => object | null,
 *   registrationOf: (agent: object) => object | undefined,
 *   sync: () => Promise<{ changed: number, leads: number }>,
 *   disposeAgent: (agent: object) => void, dispose: () => void }}
 */
export function createSoulCommandSync(deps) {
  /**
   * @type {Map<object, { dispose: () => void, signature: string,
   *   registered: Map<string, Function>, failed: Map<string, string> }>}
   */
  const installed = new Map()
  let disposed = false

  /** Record one successful registration under the Agent it belongs to. */
  function remember(agent, registration, signature) {
    const entry = {
      dispose: registration.dispose,
      signature,
      registered: registration.registered,
      failed: registration.failed,
    }
    installed.set(agent, entry)
    return entry
  }

  /** Replace one Agent's registrations with the current desired set. */
  function installAgent(agent) {
    if (disposed || agent === null || typeof agent !== 'object') return null
    const previous = installed.get(agent)
    if (previous !== undefined) {
      installed.delete(agent)
      try {
        previous.dispose()
      } catch (error) {
        warn(deps, `disposing soul commands failed: ${messageOf(error)}`)
      }
    }
    const root = typeof deps?.rootOf === 'function' ? deps.rootOf(agent) : process.cwd()
    const { commands, signature } = collectCommands(deps, root)
    const registration = installCommandDefinitions(agent, agent.ctx, deps, commands)
    return remember(agent, registration, signature)
  }

  /**
   * The live registration record for one Lead, or `undefined` when this
   * reconciler has never installed that Agent (or has since dropped it).
   *
   * @param {object} agent - exact Lead Agent.
   * @returns {{ dispose: () => void, signature: string,
   *   registered: Map<string, Function>, failed: Map<string, string> } | undefined}
   */
  function registrationOf(agent) {
    return installed.get(agent)
  }

  /** @returns {Promise<{ changed: number, leads: number }>} */
  async function sync() {
    if (disposed) return { changed: 0, leads: 0 }
    /** @type {unknown[]} */
    let agents = []
    try {
      const listed = deps?.ctx?.agents?.list?.()
      if (Array.isArray(listed)) agents = listed
    } catch {
      agents = []
    }
    const active = new Set()
    let changed = 0
    for (const agent of agents) {
      /** @type {unknown} */
      let membership
      try {
        membership = deps?.ctx?.agentTeams?.tryMembership?.(agent)
      } catch {
        membership = undefined
      }
      if (membership === null || typeof membership !== 'object' || membership.role !== 'lead') continue
      active.add(agent)
      const root = typeof deps?.rootOf === 'function' ? deps.rootOf(agent) : process.cwd()
      try {
        await deps?.catalog?.refresh?.(root)
      } catch (error) {
        warn(deps, `soul scan before command sync failed: ${messageOf(error)}`)
      }
      const desired = collectCommands(deps, root)
      const previous = installed.get(agent)
      if (previous !== undefined && previous.signature === desired.signature) continue
      if (previous !== undefined) {
        installed.delete(agent)
        try {
          previous.dispose()
        } catch (error) {
          warn(deps, `disposing soul commands failed: ${messageOf(error)}`)
        }
      }
      const registration = installCommandDefinitions(agent, agent.ctx, deps, desired.commands)
      remember(agent, registration, desired.signature)
      changed += 1
    }
    for (const agent of [...installed.keys()]) {
      if (active.has(agent)) continue
      const entry = installed.get(agent)
      installed.delete(agent)
      try {
        entry.dispose()
      } catch (error) {
        warn(deps, `disposing soul commands failed: ${messageOf(error)}`)
      }
    }
    return { changed, leads: active.size }
  }

  function disposeAgent(agent) {
    const entry = installed.get(agent)
    if (entry === undefined) return
    installed.delete(agent)
    try {
      entry.dispose()
    } catch (error) {
      warn(deps, `disposing soul commands failed: ${messageOf(error)}`)
    }
  }

  function dispose() {
    disposed = true
    for (const [agent, entry] of [...installed.entries()]) {
      installed.delete(agent)
      try {
        entry.dispose()
      } catch (error) {
        warn(deps, `disposing soul commands failed: ${messageOf(error)}`)
      }
    }
  }

  return { installAgent, registrationOf, sync, disposeAgent, dispose }
}
