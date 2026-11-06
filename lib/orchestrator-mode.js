/**
 * Shared durable Orchestrator-mode fold.
 *
 * The same command-log semantics answer two questions that must never drift:
 * `lib/orchestrator.js` asks them synchronously while handling `/orchestrate`
 * or re-applying after a Cold resume, and the Host session projection asks them
 * once per committed event so the Web GUI can render the Session-header badge.
 * Both therefore fold the same pure state machine defined here.
 *
 * The projection state is plain JSON:
 *
 *     {
 *       runs: [{ commandId: string, next: 'on' | 'off' }],
 *       settlements: [{ commandId: string, settled: 'success' | 'error' }],
 *     }
 *
 * The two arrays are deliberately separate. `runs` keeps every recognized
 * invocation in log order, including repeated command ids; `settlements` keeps
 * one outcome per command id (`error` wins over `success`, the first success
 * wins otherwise). The mode fold then walks the runs in invocation order and
 * consults the settlement map, which is exactly the historical full-scan
 * behavior: a `command/done` that arrives before its `command/run` still
 * settles that later run, repeated ids each participate in order, and the
 * latest *run* — not the latest settlement or unique id — decides the mode.
 * An unpaired run is pending: it counts in the default read and is ignored by
 * the `settledOnly` pre-invocation read.
 *
 * @module @local/dsh-agent-soul/orchestrator-mode
 */

/** The Lead-scoped chat command that toggles the mode. */
export const ORCHESTRATE_COMMAND_NAME = 'orchestrate'

/** Session projection key for the durable mode (client-visible wire value). */
export const ORCHESTRATOR_MODE_PROJECTION_KEY = 'agentSoulOrchestrator'

/** Persisted-cache invalidation version for the projection state. */
export const ORCHESTRATOR_MODE_STATE_VERSION = 1

/** Raw inputs that exit the mode (trimmed, lowercased). */
const OFF_WORDS = new Set(['off', 'exit', 'stop', 'disable'])

/**
 * One arbitrary value as a plain record.
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether one `/orchestrate` argument form enters or leaves the mode.
 *
 * The bare command, whitespace, and any task text enable; only the four off
 * words (after trimming and lowercasing) disable.
 *
 * @param {unknown} args - the invocation's raw argument text.
 * @returns {'on' | 'off'}
 */
export function orchestratorModeNext(args) {
  const raw = typeof args === 'string' ? args.trim().toLowerCase() : ''
  return OFF_WORDS.has(raw) ? 'off' : 'on'
}

/**
 * State types, documented once:
 * a `run` is `{ commandId: string, next: 'on' | 'off' }` and a `settlement` is
 * `{ commandId: string, settled: 'success' | 'error' }`.
 * @typedef {{ runs: { commandId: string, next: 'on' | 'off' }[],
 *   settlements: { commandId: string, settled: 'success' | 'error' }[] }} OrchestratorModeState
 */

/**
 * State for an empty Session log.
 * @returns {OrchestratorModeState}
 */
export function orchestratorModeInit() {
  return { runs: [], settlements: [] }
}

/**
 * Pure transition over one committed Session event.
 *
 * Unrecognized events return the same state reference, which is the projection
 * contract's signal for "no downstream work". Recognized events return a new
 * plain-JSON state and never mutate the input.
 *
 * @param {OrchestratorModeState} state
 * @param {object} event - one committed Session event.
 * @returns {OrchestratorModeState}
 */
export function orchestratorModeFold(state, event) {
  if (!isRecord(state) || !Array.isArray(state.runs) || !Array.isArray(state.settlements)) return state
  if (!isRecord(event)) return state
  const data = event.data
  if (!isRecord(data)) return state
  if (typeof data.commandId !== 'string' || data.commandId === '') return state

  if (event.type === 'command/run' && data.name === ORCHESTRATE_COMMAND_NAME) {
    // Every invocation keeps its own entry in log order. Deduplicating by
    // command id would let an earlier run reoccupy a later run's position.
    return {
      runs: [...state.runs, { commandId: data.commandId, next: orchestratorModeNext(data.args) }],
      settlements: state.settlements,
    }
  }

  if (event.type === 'command/done' && (data.kind === 'success' || data.kind === 'error')) {
    const index = state.settlements.findIndex(entry => isRecord(entry) && entry.commandId === data.commandId)
    if (index === -1) {
      // A settlement with no run yet is retained: a later run for the same id
      // (or a settlement before its run in a malformed log) must still see it.
      return {
        runs: state.runs,
        settlements: [...state.settlements, { commandId: data.commandId, settled: data.kind }],
      }
    }
    const existing = state.settlements[index]
    // Errors win over success for one command id; a repeated identical
    // settlement is not a state change.
    if (existing.settled === 'error' || existing.settled === data.kind) return state
    const settlements = state.settlements.slice()
    settlements[index] = { commandId: existing.commandId, settled: data.kind }
    return { runs: state.runs, settlements }
  }

  return state
}

/**
 * Durable mode over one folded state: the latest run in invocation order,
 * optionally excluding one command id and optionally counting only settled
 * successful runs.
 *
 * @param {OrchestratorModeState} state
 * @param {{ excludeCommandId?: unknown, settledOnly?: boolean }} [options]
 * @returns {'on' | 'off'}
 */
export function orchestratorModeOf(state, options = {}) {
  if (!isRecord(state) || !Array.isArray(state.runs)) return 'off'
  /** @type {Map<string, 'success' | 'error'>} */
  const settledKinds = new Map()
  if (Array.isArray(state.settlements)) {
    for (const entry of state.settlements) {
      if (!isRecord(entry)) continue
      if (typeof entry.commandId !== 'string') continue
      if (entry.settled !== 'success' && entry.settled !== 'error') continue
      settledKinds.set(entry.commandId, entry.settled)
    }
  }
  const excludedCommandId = options?.excludeCommandId
  const settledOnly = options?.settledOnly === true
  /** @type {'on' | 'off'} */
  let mode = 'off'
  for (const run of state.runs) {
    if (!isRecord(run)) continue
    if (run.next !== 'on' && run.next !== 'off') continue
    if (typeof run.commandId !== 'string') continue
    if (excludedCommandId !== undefined && run.commandId === excludedCommandId) continue
    const settled = settledKinds.get(run.commandId)
    if (settledOnly) {
      if (settled === 'success') mode = run.next
    } else if (settled !== 'error') {
      mode = run.next
    }
  }
  return mode
}

/**
 * Client-visible wire value: a stable primitive.
 * @param {OrchestratorModeState} state
 * @returns {'on' | 'off'}
 */
export function orchestratorModeView(state) {
  return orchestratorModeOf(state)
}

/**
 * Small parse-only schema for the runtime `sessionProjections.register`
 * contract. It validates and returns the same reference; the service owns
 * cloning and persistence.
 */
export const orchestratorModeStateSchema = {
  /**
   * @param {unknown} value
   * @returns {object}
   * @throws {TypeError} when the value is not one valid projection state.
   */
  parse(value) {
    if (!isRecord(value)) throw new TypeError('agentSoulOrchestrator state must be an object')
    for (const key of Object.keys(value)) {
      if (key !== 'runs' && key !== 'settlements') {
        throw new TypeError(`agentSoulOrchestrator state has an unknown field "${key}"`)
      }
    }
    if (!Array.isArray(value.runs)) throw new TypeError('agentSoulOrchestrator state.runs must be an array')
    for (const run of value.runs) {
      if (!isRecord(run)) throw new TypeError('agentSoulOrchestrator state.runs entries must be objects')
      for (const key of Object.keys(run)) {
        if (key !== 'commandId' && key !== 'next') {
          throw new TypeError(`agentSoulOrchestrator state run has an unknown field "${key}"`)
        }
      }
      if (typeof run.commandId !== 'string' || run.commandId === '') {
        throw new TypeError('agentSoulOrchestrator state run.commandId must be a non-empty string')
      }
      if (run.next !== 'on' && run.next !== 'off') {
        throw new TypeError('agentSoulOrchestrator state run.next must be "on" or "off"')
      }
    }
    if (!Array.isArray(value.settlements)) {
      throw new TypeError('agentSoulOrchestrator state.settlements must be an array')
    }
    const settledIds = new Set()
    for (const settlement of value.settlements) {
      if (!isRecord(settlement)) {
        throw new TypeError('agentSoulOrchestrator state.settlements entries must be objects')
      }
      for (const key of Object.keys(settlement)) {
        if (key !== 'commandId' && key !== 'settled') {
          throw new TypeError(`agentSoulOrchestrator state settlement has an unknown field "${key}"`)
        }
      }
      if (typeof settlement.commandId !== 'string' || settlement.commandId === '') {
        throw new TypeError('agentSoulOrchestrator state settlement.commandId must be a non-empty string')
      }
      if (settlement.settled !== 'success' && settlement.settled !== 'error') {
        throw new TypeError('agentSoulOrchestrator state settlement.settled must be "success" or "error"')
      }
      if (settledIds.has(settlement.commandId)) {
        throw new TypeError(`agentSoulOrchestrator state has duplicate settlements for "${settlement.commandId}"`)
      }
      settledIds.add(settlement.commandId)
    }
    return value
  },
}

/** Parse-only schema for the client-visible wire value. */
export const orchestratorModeViewSchema = {
  /**
   * @param {unknown} value
   * @returns {'on' | 'off'}
   * @throws {TypeError} when the value is not one of the two mode strings.
   */
  parse(value) {
    if (value !== 'on' && value !== 'off') {
      throw new TypeError('agentSoulOrchestrator view must be "on" or "off"')
    }
    return value
  },
}

/**
 * The Host session projection unit registered by `index.js`.
 *
 * `wire.summary` is false: the badge needs the value only for an open Session,
 * so the Session-list summary does not carry it. The state is versioned
 * independently from the wire value.
 */
export const orchestratorModeDefinition = {
  key: ORCHESTRATOR_MODE_PROJECTION_KEY,
  stateSchema: orchestratorModeStateSchema,
  init: () => orchestratorModeInit(),
  apply: (state, event) => orchestratorModeFold(state, event),
  wire: {
    viewSchema: orchestratorModeViewSchema,
    view: state => orchestratorModeView(state),
    summary: false,
  },
  stateVersion: ORCHESTRATOR_MODE_STATE_VERSION,
}
