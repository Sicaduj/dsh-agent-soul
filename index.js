/**
 * Agent Soul for Agent Teams.
 *
 * Replaces the shipped `@deepseek-ai/dsh-experimental-tool-agent-team` row with
 * a soul-aware copy of the Team tool surface. A user defines one Markdown
 * file per Agent Soul (YAML frontmatter + role/inputs/rules/output body) in
 * the directories selected by this row's `dirs` config (the bundled patch points at this
 * project's `agents/` directory) reachable from the session workspace; the Team Lead can then
 * start a teammate with
 * `spawn_teammate({ ..., agent_type: "<name>" })`, a human can invoke a soul
 * through its `/ <name>` slash command, and every teammate started that way runs
 * with:
 *
 * - its soul body shadowing the deployment persona as the system prompt,
 * - its `tools` list enforced as a hard permission matrix,
 * - its `model` routed for that child session,
 * - a durable binding so cold resume re-applies the same soul.
 *
 * This bundle's patch disables the shipped Team tool row; this plugin owns that
 * surface and requires the Agent Teams service (`ctx.agentTeams`).
 *
 * @module @local/dsh-agent-soul
 */

import { readFileSync } from 'node:fs'
import { installSoulAdminTool } from './lib/admin-tool.js'
import { resolveGuiRoot } from './lib/admin.js'
import { createCatalog } from './lib/soul.js'
import { applyTeammateSoul, createAdmissionDiagnostics, createPendingSpawns, SoulPlanUnavailableError } from './lib/apply.js'
import { createBindingStore } from './lib/bindings.js'
import { createCompositionGuard } from './lib/composition.js'
import { createSoulCommandSync } from './lib/commands.js'
import { installGui } from './lib/gui-host.js'
import { resolveModelRoute } from './lib/model.js'
import { createOrchestratorRuntime, installOrchestratorCommand } from './lib/orchestrator.js'
import { orchestratorModeDefinition } from './lib/orchestrator-mode.js'
import { createPreferenceStore } from './lib/preferences.js'
import { assertSoulOnlyTeamChild, describeSouls, spawnSoulFromCommand, spawnTeamMember } from './lib/spawn.js'
import { installTeamTools } from './lib/tools.js'

/** Cordis plugin name. */
export const name = 'agent-soul-team'

/** Services this plugin cannot work without; the row stays inactive without them. */
export const inject = ['agents', 'agentTeams', 'tools', 'systemPrompt', 'sessionProjections']

/** Default soul directory spec, relative to each session workspace root. */
const DEFAULT_DIRS = ['.dsh/agents']

/** Every accepted config key, for the unknown-key warning. */
const CONFIG_KEYS = new Set([
  'dirs',
  'commandPrefix',
  'maxDefinitions',
  'maxPromptChars',
  'bindingsFile',
  'freshProvider',
  'forkProvider',
  'interrupt',
  'defaultContext',
  'claimTeamToolRow',
])

/** Human-readable message for one arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Package identity reported to the Web GUI. Read once from this module's own
 * manifest with a safe fallback so a linked checkout without a readable
 * manifest still starts the GUI.
 * @returns {{ name: string, version: string }}
 */
function pluginMeta() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    return { name: String(manifest.name ?? '@local/dsh-agent-soul'), version: String(manifest.version ?? '0.0.0') }
  } catch {
    return { name: '@local/dsh-agent-soul', version: '0.0.0' }
  }
}

/** Require a non-empty string config value. */
function stringValue(value, key) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`agent-soul config.${key} must be a non-empty string`)
  }
  return value.trim()
}

/** Require an integer config value inside one inclusive range. */
function integerValue(value, key, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`agent-soul config.${key} must be an integer from ${min} through ${max}`)
  }
  return value
}

/**
 * Normalize and validate one loader row config.
 *
 * Values are validated loudly: a malformed row fails activation instead of
 * running with half-applied limits. Unknown keys warn and are ignored.
 *
 * @param {unknown} raw - the loader row's `config`.
 * @param {{ warn(message: string): void }} logger
 * @returns {object} the normalized config.
 */
export function normalizeConfig(raw, logger) {
  const input = raw === undefined || raw === null ? {} : raw
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('agent-soul config must be an object')
  }
  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.has(key)) logger.warn(`agent-soul: ignoring unknown config key "${key}"`)
  }
  const config = {
    dirs: DEFAULT_DIRS,
    commandPrefix: '',
    maxDefinitions: 64,
    maxPromptChars: 12000,
    bindingsFile: '.dsh/agent-soul/bindings.json',
    freshProvider: 'spawn',
    forkProvider: 'fork',
    interrupt: true,
    defaultContext: 'fresh',
    claimTeamToolRow: false,
  }
  if (input.dirs !== undefined) {
    if (!Array.isArray(input.dirs) || input.dirs.length === 0) {
      throw new TypeError('agent-soul config.dirs must be a non-empty array of directory strings')
    }
    config.dirs = input.dirs.map((dir, index) => stringValue(dir, `dirs[${index}]`))
  }
  if (input.commandPrefix !== undefined) {
    if (typeof input.commandPrefix !== 'string' || !/^[a-z0-9_-]*$/u.test(input.commandPrefix)) {
      throw new TypeError('agent-soul config.commandPrefix must match /^[a-z0-9_-]*$/')
    }
    config.commandPrefix = input.commandPrefix
  }
  if (input.maxDefinitions !== undefined) {
    config.maxDefinitions = integerValue(input.maxDefinitions, 'maxDefinitions', 1, 1000)
  }
  if (input.maxPromptChars !== undefined) {
    config.maxPromptChars = integerValue(input.maxPromptChars, 'maxPromptChars', 1000, 200000)
  }
  if (input.bindingsFile !== undefined) config.bindingsFile = stringValue(input.bindingsFile, 'bindingsFile')
  if (input.freshProvider !== undefined) config.freshProvider = stringValue(input.freshProvider, 'freshProvider')
  if (input.forkProvider !== undefined) config.forkProvider = stringValue(input.forkProvider, 'forkProvider')
  if (input.interrupt !== undefined) {
    if (typeof input.interrupt !== 'boolean') throw new TypeError('agent-soul config.interrupt must be a boolean')
    config.interrupt = input.interrupt
  }
  if (input.defaultContext !== undefined) {
    if (input.defaultContext !== 'fresh' && input.defaultContext !== 'fork') {
      throw new TypeError('agent-soul config.defaultContext must be "fresh" or "fork"')
    }
    config.defaultContext = input.defaultContext
  }
  if (input.claimTeamToolRow !== undefined) {
    if (typeof input.claimTeamToolRow !== 'boolean') throw new TypeError('agent-soul config.claimTeamToolRow must be a boolean')
    config.claimTeamToolRow = input.claimTeamToolRow
  }
  return config
}

/**
 * The workspace root an Agent's soul files are resolved against.
 *
 * The session's committed working directory wins; the deployment default and
 * finally the process directory are fallbacks for unpublished agents and
 * compositions without the working-directory service.
 *
 * @param {object} ctx - root plugin context.
 * @param {object} agent - live Agent.
 * @returns {string} an absolute directory.
 */
export function resolveRoot(ctx, agent) {
  const workingDirectory = ctx.get('workingDirectory')
  if (workingDirectory !== undefined) {
    try {
      const current = workingDirectory.get(agent.session)
      if (typeof current === 'string' && current.length > 0) return current
    } catch {
      // An unpublished Session has no committed directory yet; fall through.
    }
    if (typeof workingDirectory.defaultDirectory === 'string' && workingDirectory.defaultDirectory.length > 0) {
      return workingDirectory.defaultDirectory
    }
  }
  return process.cwd()
}

/** Stable key for one pending spawn: exact Lead identity plus requested name. */
function pendingKeyOf(leadOrRoot, name) {
  const id = typeof leadOrRoot === 'string' ? leadOrRoot : leadOrRoot?.id
  return `${String(id)}\u0000${String(name)}`
}

/** Resolve the soul-specific services into one shared deps object. Exported for direct regression tests. */
export function createDeps(ctx, config, catalog, bindings, pending, logger) {
  const deps = {
    ctx,
    config,
    catalog,
    bindings,
    pending,
    // The default-Soul document is plugin-owned state beside the bindings file.
    preferences: createPreferenceStore({ config }),
    // Bounded best-effort record of cold-resume admission refusals. The shared
    // subagent lifecycle wraps the veto as a generic NOT_RESUMABLE, so the
    // Soul-specific reason must stay reachable through the plugin's own surface
    // (send_message translation and list_agent_souls diagnostics).
    admissionDiagnostics: createAdmissionDiagnostics(),
    logger,
    rootOf: agent => resolveRoot(ctx, agent),
    pendingKey: pendingKeyOf,
    async resolveModel(raw, options = {}) {
      // Providers and their catalogs are live registration surfaces. Resolve
      // for every request instead of retaining a route across topology changes.
      return await resolveModelRoute(raw, {
        llm: ctx.get('llm'),
        agentDefaultModel: ctx.get('agentDefaultModel'),
        logger,
        signal: options.signal,
      })
    },
  }
  Object.assign(deps, { spawnTeamMember, describeSouls, spawnSoulFromCommand })
  return deps
}

/**
 * Install the plugin.
 *
 * The plugin keeps one per-Agent installation record: the Team tool surface for
 * every Team member, soul slash commands for the Lead, and the applied
 * soul for teammates. Existing live members are prepared during activation;
 * later members are prepared from the awaited `agent/created` listener.
 *
 * @param {object} ctx - the plugin's root Cordis context.
 * @param {unknown} rawConfig - the loader row's config.
 * @returns {Promise<void>} resolves once existing Team members are prepared.
 */
export async function apply(ctx, rawConfig) {
  const logger = ctx.logger('agent-soul')
  const config = normalizeConfig(rawConfig, logger)
  const catalog = createCatalog({
    dirs: config.dirs,
    logger,
    maxDefinitions: config.maxDefinitions,
    maxPromptChars: config.maxPromptChars,
    bindingsFile: config.bindingsFile,
    commandPrefix: config.commandPrefix,
  })
  const bindings = createBindingStore({ fileSpec: config.bindingsFile, logger })
  const pending = createPendingSpawns()
  const deps = createDeps(ctx, config, catalog, bindings, pending, logger)
  // One process-wide runtime; it keeps a per-Lead bundle of doctrine sections,
  // tool restrictions, and the model selection captured by `/orchestrate`.
  const orchestrator = createOrchestratorRuntime(deps)
  // The Team tool surface reads this to call the Lead the orchestrator and to
  // mark it on the model-facing roster while the mode is active.
  deps.orchestrator = orchestrator
  // Soul files change while the Host runs (GUI, agent tool, editor). The
  // reconciler keeps each Live Lead's slash commands in step with the catalog;
  // mutations call `deps.syncSouls()` after their scan.
  const commandSync = createSoulCommandSync(deps)
  deps.syncSouls = () => commandSync.sync()
  // The GUI and the model-facing catalog must report command status by handler
  // identity, not by raw registry presence. A failed soul registration leaves
  // its name owned by another handler (the built-in `/orchestrate`), so the
  // name-only fallback would falsely report `registered`.
  deps.soulCommandRegistration = (agent) => commandSync.registrationOf(agent)
  // This bundle replaces the shipped Team tool row; the replacement is
  // deterministic only when this bundle's patch layer follows the Agent Teams
  // bundle's layer. Inspect the composed tree once and say so loudly instead of
  // degrading silently when a mis-ordered profile leaves both rows active.
  const composition = createCompositionGuard({ ctx, config, logger })
  deps.composition = composition
  try {
    const teamSurface = composition.inspect()
    if (teamSurface.ok === false) {
      logger.warn(`agent-soul: ${teamSurface.message}\n${teamSurface.fix}`)
    }
  } catch (error) {
    logger.warn(`agent-soul: cannot inspect the Team-tool composition: ${messageOf(error)}`)
  }

  // The session-header badge is driven by a Host projection over the same
  // durable command log. Register before any live Agent installation so a
  // Session opened during activation already carries the value. The contract
  // requires awaiting registration and retaining the ready handle; the
  // registration's lifetime is the plugin fiber, so teardown releases it.
  let orchestratorModeProjection
  try {
    orchestratorModeProjection = await ctx.sessionProjections.register(orchestratorModeDefinition)
  } catch (error) {
    logger.warn(`agent-soul: registering the orchestrator-mode session projection failed: ${messageOf(error)}`)
  }
  deps.orchestratorModeProjection = orchestratorModeProjection

  // The Settings GUI is optional: profiles without a web server (headless, SDK,
  // ACP) never activate this child, and every non-GUI capability keeps working.
  // The child injects the Host services its routes touch directly (the trust
  // fence and the team roster); its `get()` reads stay optional per call.
  ctx.inject(['webServer', 'connection', 'agents', 'agentTeams'], (guiCtx) => {
    try {
      installGui(guiCtx, {
        ctx: guiCtx,
        config,
        catalog,
        bindings,
        logger,
        composition,
        root: resolveGuiRoot(ctx),
        pluginMeta: pluginMeta(),
        preferences: deps.preferences,
        resolveModel: deps.resolveModel,
        syncSouls: deps.syncSouls,
        commandRegistration: deps.soulCommandRegistration,
      })
    } catch (error) {
      logger.warn(`agent-soul: installing the Settings GUI failed: ${messageOf(error)}`)
    }
  })

  /** @type {Map<object, { dispose(): void }>} */
  const installed = new Map()
  /** @type {Map<object, Promise<void>>} */
  const installing = new Map()
  /** Agents whose disposal arrived while their installation was still running. */
  const disposingAgents = new WeakSet()
  /** Root teardown makes every later installation boundary a logged skip. */
  let tornDown = false

  /** Whether one thrown value represents cooperative cancellation. */
  function isCancellation(error) {
    return typeof error === 'object' && error !== null
      && (error.name === 'AbortError' || error.code === 'ABORT_ERR')
  }

  /**
   * Check that installation still has a live target. The Agent registry enters
   * a child before serial creation listeners run, so an exact live Agent is the
   * normal creation path; test compositions without `agents.get` rely on the
   * disposal and cancellation signals alone.
   */
  function isAgentGone(agent, signal) {
    if (tornDown || disposingAgents.has(agent) || signal?.aborted === true) return true
    try {
      return typeof ctx.agents.get === 'function' && ctx.agents.get(agent.id) !== agent
    } catch {
      // If liveness cannot be established, do not keep installing into an
      // Agent whose creation may already be rolling back.
      return true
    }
  }

  function disposeInstalled(agent) {
    const record = installed.get(agent)
    if (record === undefined) return
    installed.delete(agent)
    try {
      record.dispose()
    } catch (error) {
      logger.warn(`agent-soul: disposing member registrations failed: ${messageOf(error)}`)
    }
  }

  async function install(agent, options = {}) {
    if (installed.has(agent)) return
    const { signal } = options
    if (isAgentGone(agent, signal)) {
      if (options.logFailure !== false) {
        logger.warn(`agent-soul: member installation for Agent ${agent.id} was cancelled before it started: the Agent was disposed, the plugin was torn down, or creation was aborted`)
      }
      return
    }
    let membership
    try {
      membership = ctx.agentTeams.tryMembership(agent)
    } catch (error) {
      logger.warn(`agent-soul: cannot resolve Team membership: ${messageOf(error)}`)
      return
    }
    if (membership === undefined) return
    const memberLabel = `${membership.role} "${membership.name}" (${agent.id})`

    /** @type {Array<() => void>} */
    const disposers = []
    let disposed = false
    const disposeRegistrations = () => {
      if (disposed) return
      disposed = true
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch (error) {
          logger.warn(`agent-soul: disposing a member registration failed: ${messageOf(error)}`)
        }
      }
    }
    const cancelInstallation = (reason) => {
      disposeRegistrations()
      if (options.logFailure !== false) {
        logger.warn(`agent-soul: member installation for ${memberLabel} was cancelled: ${reason}; no Soul effects were left active and a later creation or resume can retry`)
      }
    }
    const stopIfGone = () => {
      if (!isAgentGone(agent, signal)) return false
      cancelInstallation('the Agent was disposed, the plugin was torn down, or creation was aborted')
      return true
    }

    try {
      if (membership.role === 'lead') {
        try {
          await catalog.refresh(resolveRoot(ctx, agent))
        } catch (error) {
          logger.warn(`agent-soul: soul scan failed: ${messageOf(error)}`)
        }
        if (stopIfGone()) return
      }
      try {
        disposers.push(installTeamTools(agent, agent.ctx, { ctx, config, catalog, deps }))
      } catch (error) {
        let hint = ''
        try {
          if (composition.inspect().ok === false) {
            hint = '; another Team-tool row owns this Agent scope — run manage_agent_souls({ action: "repair_team_tools" }) or add the profile-patch override'
          }
        } catch {
          // The tool-install failure is the actionable one.
        }
        logger.warn(`agent-soul: installing Team tools failed: ${messageOf(error)}${hint}`)
      }
      if (membership.role === 'lead') {
        // Built-in commands are installed BEFORE soul commands so a
        // user-invocable soul named `orchestrate` can never shadow the
        // built-in `/orchestrate` command on a fresh Lead. A colliding soul
        // registration is contained in commandSync (warn, skip that name) and
        // stays reported as a collision by handler identity.
        try {
          const command = installOrchestratorCommand(agent, agent.ctx, deps, orchestrator)
          disposers.push(() => command.dispose())
        } catch (error) {
          logger.warn(`agent-soul: installing the /orchestrate command failed: ${messageOf(error)}`)
        }
        try {
          commandSync.installAgent(agent)
          disposers.push(() => commandSync.disposeAgent(agent))
        } catch (error) {
          logger.warn(`agent-soul: installing soul commands failed: ${messageOf(error)}`)
        }
        try {
          disposers.push(installSoulAdminTool(agent, agent.ctx, deps))
        } catch (error) {
          logger.warn(`agent-soul: installing manage_agent_souls failed: ${messageOf(error)}`)
        }
        // A Lead created after the plugin activated still re-applies an active
        // durable mode; inactive Leads are a no-op.
        try {
          const reapplied = await orchestrator.reapplyIfActive(agent)
          if (reapplied.ok !== true) {
            logger.warn(`agent-soul: cannot re-apply orchestrator mode for ${agent.id}: ${reapplied.error ?? 'unknown error'}`)
          }
        } catch (error) {
          logger.warn(`agent-soul: re-applying orchestrator mode failed: ${messageOf(error)}`)
        }
        if (stopIfGone()) return
      } else {
        // Plan resolution is the one admission veto: a roster teammate without
        // a pending or durable Soul plan must not be published Soul-less.
        // Post-plan failures are handled as logged skips by the catch below.
        const applied = await applyTeammateSoul(agent, membership, deps)
        disposers.push(applied.dispose)
        if (stopIfGone()) return
      }
      if (stopIfGone()) return
      installed.set(agent, { dispose: disposeRegistrations })
    } catch (error) {
      // No failure path may leave Team tools or a partially applied soul
      // behind. Only plan resolution is allowed to veto publication; disposal,
      // cancellation, and unexpected apply failures resolve after cleanup.
      disposeRegistrations()
      if (isAgentGone(agent, signal) || isCancellation(error)) {
        cancelInstallation('the Agent was disposed, the plugin was torn down, or installation was aborted')
        return
      }
      if (error instanceof SoulPlanUnavailableError) {
        // Keep the model-facing reason actionable: the shared subagent
        // lifecycle later wraps this veto in a generic NOT_RESUMABLE error, so
        // the stable code/reason (and the admission diagnostic store) are the
        // only Soul-specific signals that survive. The message itself is
        // already the actionable one and is preserved as the wrapper's cause.
        try {
          deps.admissionDiagnostics?.record?.({
            teammate: typeof membership.name === 'string' ? membership.name : agent.id,
            code: typeof error.code === 'string' ? error.code : 'SOUL_PLAN_UNAVAILABLE',
            reason: typeof error.reason === 'string' ? error.reason : undefined,
            message: messageOf(error),
            at: Date.now(),
          })
        } catch {
          // Diagnostics are best-effort; the admission veto below is the contract.
        }
        if (options.logFailure !== false) {
          logger.warn(`agent-soul: cannot admit ${memberLabel}: ${messageOf(error)} (code ${String(error.code ?? 'SOUL_PLAN_UNAVAILABLE')}${typeof error.reason === 'string' ? `, reason ${error.reason}` : ''})`)
        }
        throw error
      }
      if (options.logFailure !== false) {
        logger.warn(`agent-soul: member installation for ${memberLabel} was SKIPPED after an unexpected failure: ${messageOf(error)}; Team tools and partial Soul effects were unwound. Re-spawn this teammate; if it recurs, report this log line.`)
      }
    }
  }

  function maybeInstall(agent, options = {}) {
    const inFlight = installing.get(agent)
    if (inFlight !== undefined) return inFlight
    const task = install(agent, options).finally(() => {
      installing.delete(agent)
    })
    // The serial creation listener still receives the one admission-veto
    // rejection, but the shared task is always observed. An unexpected consumer
    // that abandons the returned promise can therefore never turn an install
    // failure into a process-fatal unhandled rejection.
    void task.catch(() => {})
    installing.set(agent, task)
    return task
  }

  // Serial creation fence: a provider-owned child of a Team member that did not
  // enter through the roster throws here, which vetoes publication. A generic
  // subagent child can therefore never become a soul-less Team child.
  ctx.on('agent/created', ({ agent, signal }) => {
    assertSoulOnlyTeamChild(deps, agent)
    return maybeInstall(agent, { signal })
  })
  ctx.on('agent/disposed', ({ agent }) => {
    try {
      // Mark first: an in-flight install sees this at its next boundary and
      // unwinds itself. Do not delete its task here, which could start a second
      // installation for the same Agent.
      disposingAgents.add(agent)
      orchestrator.disposeAgent(agent)
      commandSync.disposeAgent(agent)
      disposeInstalled(agent)
    } catch (error) {
      // A synchronous listener throw is an uncaught exception in the Host.
      logger.warn(`agent-soul: agent/disposed cleanup failed: ${messageOf(error)}`)
    }
  })
  ctx.effect(() => () => {
    tornDown = true
    for (const agent of [...installed.keys()]) disposeInstalled(agent)
    installing.clear()
    orchestrator.dispose()
    commandSync.dispose()
    catalog.dispose()
    pending.clear()
    void bindings.dispose().catch((error) => {
      logger.warn(`agent-soul: flushing binding store failed: ${messageOf(error)}`)
    })
  }, 'agent-soul.members()')

  for (const agent of ctx.agents.list()) {
    // Pre-existing non-roster children are never retrofitted with Team tools;
    // creation itself is vetoed above, but activation must not fail on them.
    try {
      assertSoulOnlyTeamChild(deps, agent)
    } catch (error) {
      logger.warn(`agent-soul: skipping non-roster child Agent ${agent.id}: ${messageOf(error)}`)
      continue
    }
    // A pre-existing live teammate without a Soul plan cannot be vetoed (its
    // publication already happened), so activation skips it with a warning
    // rather than failing the whole plugin or leaving Team tools attached.
    // New and cold-resumed teammates reach the same error through the serial
    // `agent/created` listener, where it vetoes publication.
    try {
      await maybeInstall(agent, { logFailure: false })
    } catch (error) {
      if (!(error instanceof SoulPlanUnavailableError)) throw error
      logger.warn(`agent-soul: skipping pre-existing Agent ${agent.id}: ${messageOf(error)}`)
    }
  }

  // With `claimTeamToolRow` on, reconcile a mis-ordered profile once the Loader
  // tree has settled: persist the shipped-row override through the Plugin
  // Manager and let the profile reload. Off by default, and a no-op when the
  // composition already replaces the row.
  void composition.scheduleClaim().catch((error) => {
    logger.warn(`agent-soul: scheduling the Team-tool repair failed: ${messageOf(error)}`)
  })
}
