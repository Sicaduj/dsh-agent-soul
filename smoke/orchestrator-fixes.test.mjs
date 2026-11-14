/**
 * Regression tests for the Orchestrator-mode defects ORCH-02/D10, D14, and D15.
 *
 * Every case runs the real runtime and command handler from lib/orchestrator.js
 * against a deterministic in-memory Agent double: a fake prompt service, tool
 * restriction service, effect scope, model selection, and Session event log.
 * Faults are injected at the handler seam by throwing from the fake
 * model.select / systemPrompt.section / agent.followup, so no real model,
 * network, Host, profile, or credential is involved. Workspace doctrine files
 * live in throwaway temporary directories; the packaged defaults are only read.
 *
 * Covered behavior:
 * - D10: a first-enable /orchestrate <task> whose queue step fails after a
 *   route override reverts cleanly when the model restore succeeds, and reports
 *   active=true/modelRestored=false with an /orchestrate off recovery path when
 *   the model restore also fails; the durable fold is off while the live bundle
 *   stays active until that retry.
 * - D10: an already-active /orchestrate <task> queue failure restores the exact
 *   prior doctrine and route when possible; a model-restore failure is reported
 *   as previous doctrine on the new route (never as "kept"); a failed snapshot
 *   recreation reports the explicit fallback to the newly applied doctrine; and
 *   both recreations failing reports an inactive mode with the durable/model
 *   caveats instead of a false kept status.
 * - D14: the bundled doctrine prompt states the conditional route inheritance,
 *   lists only the task board's supported status values, scopes the correction
 *   loop to strict gating and the configured retry budget, and fixes the
 *   mismatched quote; the prompt is asserted after {{gateMode}}/{{maxRetries}}
 *   substitution.
 * - D15: the registered spawn_teammate context parameter describes the real
 *   call -> Soul -> config.defaultContext resolution instead of an unconditional
 *   fresh fallback.
 *
 * Run with: node --test smoke/orchestrator-fixes.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createOrchestratorRuntime, installOrchestratorCommand, orchestratorFixedIdentity } from '../lib/orchestrator.js'
import { installSoulSurface } from '../lib/tools.js'

/** The real package root, used only to read the bundled defaults. */
const REAL_PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/** Normalized plugin config for one temporary workspace. */
const CONFIG = Object.freeze({
  dirs: ['.dsh/agents'],
  bundled: true,
  bundledEditable: false,
  bindingsFile: '.dsh/agent-soul/bindings.json',
  freshProvider: 'spawn',
  forkProvider: 'spawn',
})

/** Workspace-relative orchestrator document, beside the default bindings file. */
const DOCTRINE_RELATIVE = join('.dsh', 'agent-soul', 'orchestrator.md')

/** The shipped doctrine text, captured once to prove the suite never writes it. */
const REAL_DOCTRINE = readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8')

/** The initial Lead selection every fake Agent starts from. */
const BASE_MODEL = Object.freeze({ provider: 'test-provider', model: 'base-model' })

/** Prompt-order inputs the runtime reads from the system-prompt service. */
const SECTION_ORDERS = Object.freeze({ DEPLOYMENT_PERSONA_PREFIX: 10, TEAM_POLICY: 20 })

/** Incremented by every assertion helper, so the run can report an exact count. */
const tally = { assertions: 0 }

/** Assert one truthy condition and count it. */
function ok(value, message) {
  tally.assertions += 1
  assert.ok(value, message)
  return value
}

/** Assert one strict equality and count it. */
function equal(actual, expected, message) {
  tally.assertions += 1
  assert.equal(actual, expected, message)
}

/** Assert one deep equality and count it. */
function deepEqual(actual, expected, message) {
  tally.assertions += 1
  assert.deepEqual(actual, expected, message)
}

/**
 * Create one canonical temporary workspace and remove it afterwards.
 * @param {string} label
 * @param {object} t - node:test context
 * @returns {string}
 */
function workspace(label, t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-soul-orchestrator-' + label + '-')))
  t.after(() => {
    assert.equal(dirname(root), realpathSync(tmpdir()), 'cleanup only removes the fixture under the OS temp directory')
    assert.ok(root.includes('agent-soul-orchestrator-' + label + '-'), 'cleanup only removes this fixture')
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

/**
 * Write one workspace doctrine with an optional route and one identity marker.
 * @param {string} root
 * @param {{ name?: string, route?: string, marker: string }} options
 * @returns {void}
 */
function writeDoctrine(root, options) {
  const directory = dirname(join(root, DOCTRINE_RELATIVE))
  mkdirSync(directory, { recursive: true })
  const lines = ['---', 'name: ' + (options.name ?? 'test-conductor')]
  if (options.route !== undefined) lines.push('model: ' + options.route)
  lines.push('gate-mode: strict', 'max-retries: 3', '---', '', '## Identity & Boundaries', '', options.marker, '')
  writeFileSync(join(root, DOCTRINE_RELATIVE), lines.join('\n'))
}

/**
 * Build one deterministic Agent double for the orchestrator runtime.
 *
 * The double implements exactly the services the runtime touches: the effect
 * scope, prompt section/order service, model selection, Session log, and
 * followup queue. Fault hooks let a test throw from a specific seam without a
 * real provider, timer, or network.
 *
 * @param {{ model?: object }} [options]
 * @returns {{ agent: object, state: object }}
 */
function fakeAgent(options = {}) {
  const state = {
    current: { ...(options.model ?? BASE_MODEL) },
    selectCalls: [],
    selectFault: null,
    sectionFault: null,
    sections: [],
    restrictions: [],
    events: [],
    queued: [],
    queueError: null,
    teamEnabled: false,
    teamSetCalls: [],
    teamEnableFault: null,
    teamDisableFault: null,
  }
  const agent = {
    id: 'fake-lead',
    session: {
      get seq() { return state.events.length - 1 },
      eventAt(index) { return state.events[index] },
    },
    followup(message) {
      if (state.queueError !== null) throw state.queueError
      state.queued.push(message)
    },
    model: {
      current() { return { ...state.current } },
      select(selection) {
        state.selectCalls.push({ ...selection })
        if (state.selectFault !== null && state.selectFault(selection, state.selectCalls.length) === true) {
          throw new Error('injected model selection failure')
        }
        state.current = { ...selection }
      },
    },
    ctx: {
      systemPrompt: {
        section(registration) {
          if (state.sectionFault !== null && state.sectionFault(registration, state) === true) {
            throw new Error('injected prompt section failure')
          }
          const record = { ...registration, disposed: false }
          state.sections.push(record)
          return { dispose() { record.disposed = true } }
        },
        context(registration) {
          const record = { ...registration, disposed: false }
          state.sections.push(record)
          return { dispose() { record.disposed = true } }
        },
        getSectionOrder(name) { return SECTION_ORDERS[name] ?? 100 },
      },
      tools: {
        restrict(request) { state.restrictions.push(request); return { dispose() {} } },
        definitions() { return [] },
        get(name) { return name === 'spawn_teammate' ? state.spawnTool : undefined },
      },
      effect(callback) {
        const cleanup = callback()
        return () => { if (typeof cleanup === 'function') cleanup() }
      },
    },
  }
  return { agent, state }
}

/** Resolve one prompt-section text (a string or a per-assembly function). */
function registrationText(registration, context = {}) {
  return typeof registration.text === 'function'
    ? String(registration.text(context))
    : String(registration.text ?? '')
}

/** Active (not disposed) prompt-section texts, in registration order. */
function activeTexts(state, context = {}) {
  return state.sections
    .filter(section => section.disposed !== true)
    .map(section => registrationText(section, context))
}

/** Append one pre-invocation command/run event. */
function pushRun(events, commandId, args) {
  events.push({ type: 'command/run', data: { commandId, name: 'orchestrate', args } })
}

/** Append one settled command/done event. */
function pushDone(events, commandId, kind) {
  events.push({ type: 'command/done', data: { commandId, kind } })
}

/**
 * Build the real runtime plus the real command handler over one fake Agent.
 * @param {{ root: string, resolveModel?: Function }} options
 * @returns {{ runtime: object, agent: object, state: object, warnings: string[],
 *   invoke: (rawInput: string, commandId: string) => Promise<object>,
 *   dispose: () => void }}
 */
function harness(options) {
  const warnings = []
  const { agent, state } = fakeAgent()
  const deps = {
    config: CONFIG,
    rootOf: () => options.root,
    logger: { warn(message) { warnings.push(String(message)) } },
    handlerTails: new WeakMap(),
    teamModeOf: () => state.teamEnabled,
    async setTeamMode(_agent, enabled) {
      state.teamSetCalls.push(enabled)
      if (enabled === true && state.teamEnableFault !== null) throw state.teamEnableFault
      if (enabled === false && state.teamDisableFault !== null) throw state.teamDisableFault
      state.teamEnabled = enabled === true
    },
    // The real runtime resolves Team mode through the plugin context; the fake
    // Agent owns the same tool service here.
    ctx: {
      tools: agent.ctx.tools,
      get(name) {
        if (name === 'subagents') return { rootOf: value => value, namesOf: () => ({ self: 'lead' }) }
        if (name === 'agentTeams') {
          return {
            isEnabled: () => state.teamEnabled,
            async setEnabled(_agent, enabled) {
              state.teamSetCalls.push(enabled)
              if (enabled === true && state.teamEnableFault !== null) throw state.teamEnableFault
              if (enabled === false && state.teamDisableFault !== null) throw state.teamDisableFault
              state.teamEnabled = enabled === true
            },
          }
        }
        return undefined
      },
    },
    ...options.resolveModel === undefined ? {} : { resolveModel: options.resolveModel },
  }
  const runtime = createOrchestratorRuntime(deps)
  /** @type {object} */
  let definition
  const agentCtx = { commands: { register(value) { definition = value; return { dispose() {} } } } }
  const installed = installOrchestratorCommand(agent, agentCtx, deps, runtime)
  return {
    runtime,
    agent,
    state,
    warnings,
    invoke(rawInput, commandId) {
      return definition.handler({ agent, rawInput, commandId })
    },
    dispose() { installed.dispose() },
  }
}

/** Resolve every declared test route into one fake registered selection. */
async function resolveTestModel(raw) {
  return { provider: 'test-provider', model: raw.model ?? 'test-default' }
}

// The tally is internal bookkeeping; enable it when measuring the suite size.
if (process.env.AGENT_SOUL_ASSERTION_TALLY === '1') {
  process.once('exit', () => {
    console.log('orchestrator-fixes smoke assertions: ' + tally.assertions)
  })
}

test('first-enable task queue failure reverts a cleanly restorable mode', async t => {
  const root = workspace('first-revert', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'FIRST-REVERT-DOCTRINE' })
  const run = harness({ root, resolveModel: resolveTestModel })
  run.state.queueError = new Error('injected queue failure')
  pushRun(run.state.events, 'cmd-1', 'do the task')

  const result = await run.invoke('do the task', 'cmd-1')

  equal(result.kind, 'error', 'a failed task queue is an error result')
  ok(String(result.text).includes('the mode was reverted'), 'a successful rollback is reported as a revert')
  ok(!String(result.text).includes('active=true'), 'a reverted mode is not reported as active')
  equal(run.runtime.isActive(run.agent), false, 'disable disposed the bundle')
  equal(run.state.current.model, 'base-model', 'the captured model was restored')
  equal(run.state.teamEnabled, false, 'the first-enable rollback also disables Team mode')

  pushDone(run.state.events, 'cmd-1', 'error')
  equal(run.runtime.modeOf(run.agent), 'off', 'the error settlement leaves the durable mode off')
  run.dispose()
})

test('first-enable compound rollback failure surfaces live state and preserves off retry', async t => {
  const root = workspace('first-compound', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'FIRST-COMPOUND-DOCTRINE' })
  const run = harness({ root, resolveModel: resolveTestModel })
  // The queue failure arrives after the route override was selected; the
  // rollback's attempt to restore the previous selection then fails too.
  run.state.selectFault = selection => selection.model === 'base-model'
  run.state.queueError = new Error('injected queue failure')
  pushRun(run.state.events, 'cmd-1', 'do the task')

  const result = await run.invoke('do the task', 'cmd-1')
  const text = String(result.text)

  equal(result.kind, 'error', 'the queue failure remains an error result')
  ok(text.includes('active=true'), 'the error surfaces that the live mode is still active')
  ok(text.includes('modelRestored=false'), 'the error surfaces the failed model restore')
  ok(text.includes('durable log reports the mode as off'), 'the error names the live/durable disagreement')
  ok(text.includes('/orchestrate off'), 'the error gives the recoverable off retry')
  equal(run.runtime.isActive(run.agent), true, 'the live bundle survives for that retry')
  equal(run.state.current.model, 'test-route-a', 'the newly applied route remains live')
  ok(run.warnings.some(message => message.includes('cannot restore the Lead model after orchestrator mode')),
    'the failed restore is logged with its cause')
  ok(activeTexts(run.state).some(value => value.includes('FIRST-COMPOUND-DOCTRINE')),
    'the applied doctrine remains installed until the retry')

  pushDone(run.state.events, 'cmd-1', 'error')
  equal(run.runtime.modeOf(run.agent), 'off', 'the command log folds to off while the live bundle is active')

  // Recovering through /orchestrate off must use the retained capture.
  run.state.selectFault = null
  const off = await run.invoke('off', 'cmd-2')
  equal(off.kind, 'success', 'the off retry succeeds')
  equal(run.runtime.isActive(run.agent), false, 'the off retry disposes the bundle')
  equal(run.state.current.model, 'base-model', 'the off retry restores the captured model')
  pushDone(run.state.events, 'cmd-2', 'success')
  equal(run.runtime.modeOf(run.agent), 'off', 'the recovered durable mode is off')
  run.dispose()
})

test('already-active task queue failure keeps the exact prior doctrine and route', async t => {
  const root = workspace('active-exact', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'OLD-DOCTRINE-A' })
  const run = harness({ root, resolveModel: resolveTestModel })
  pushRun(run.state.events, 'cmd-0', '')
  equal((await run.invoke('', 'cmd-0')).kind, 'success', 'the first enable succeeds')
  pushDone(run.state.events, 'cmd-0', 'success')

  writeDoctrine(root, { name: 'test-conductor-b', route: 'test-route-b', marker: 'NEW-DOCTRINE-B' })
  run.state.queueError = new Error('injected queue failure')
  pushRun(run.state.events, 'cmd-1', 'do the task')
  const result = await run.invoke('do the task', 'cmd-1')
  pushDone(run.state.events, 'cmd-1', 'error')
  const text = String(result.text)

  equal(result.kind, 'error', 'the queue failure is an error result')
  ok(text.includes('the already-active mode was kept'), 'an exact rollback reports the kept mode')
  ok(!text.includes('could not be restored'), 'no restore failure is reported when both restored')
  equal(run.runtime.isActive(run.agent), true, 'the already-active mode remains live')
  equal(run.state.current.model, 'test-route-a', 'the snapshot model selection was restored')
  equal(run.state.teamEnabled, true, 'the kept active mode remains Team-enabled')
  const texts = activeTexts(run.state)
  ok(texts.some(value => value.includes('OLD-DOCTRINE-A')), 'the pre-invocation doctrine is installed again')
  ok(!texts.some(value => value.includes('NEW-DOCTRINE-B')), 'the replacement doctrine is not left behind')
  equal(run.runtime.modeOf(run.agent), 'on', 'the durable mode stays on after the error settlement')
  run.dispose()
})

test('already-active model restore failure reports previous doctrine on the new route', async t => {
  const root = workspace('active-model', t)
  // The pre-invocation doctrine declares no route, so recreating it selects
  // nothing and the newly applied route is what survives the failed restore.
  writeDoctrine(root, { marker: 'OLD-DOCTRINE-A' })
  const run = harness({ root, resolveModel: resolveTestModel })
  pushRun(run.state.events, 'cmd-0', '')
  equal((await run.invoke('', 'cmd-0')).kind, 'success', 'the first enable succeeds')
  pushDone(run.state.events, 'cmd-0', 'success')

  writeDoctrine(root, { name: 'test-conductor-b', route: 'test-route-b', marker: 'NEW-DOCTRINE-B' })
  // The rollback recreates the old doctrine, then fails to reselect the
  // pre-invocation model selection.
  run.state.selectFault = selection => selection.model === 'base-model'
  run.state.queueError = new Error('injected queue failure')
  pushRun(run.state.events, 'cmd-1', 'do the task')
  const result = await run.invoke('do the task', 'cmd-1')
  pushDone(run.state.events, 'cmd-1', 'error')
  const text = String(result.text)

  equal(result.kind, 'error', 'the queue failure is an error result')
  ok(text.includes('the previous doctrine was restored'), 'the restored doctrine is reported accurately')
  ok(text.includes('model selection could not be restored'), 'the failed model restore is reported')
  ok(text.includes('active=true'), 'the error reports that the mode remains active')
  ok(text.includes('modelRestored=false'), 'the error reports the unrestored model')
  ok(text.includes('previous doctrine and the new model route'), 'the mixed doctrine/route state is named')
  ok(text.includes('/orchestrate off'), 'the recoverable retry is named')
  ok(text.includes('restore the captured pre-orchestrator model'), 'the retry states what it restores')
  equal(run.runtime.isActive(run.agent), true, 'the restored bundle remains live')
  equal(run.state.current.model, 'test-route-b', 'the newly applied route remains selected')
  const texts = activeTexts(run.state)
  ok(texts.some(value => value.includes('OLD-DOCTRINE-A')), 'the previous doctrine is installed')
  ok(!texts.some(value => value.includes('NEW-DOCTRINE-B')), 'the replacement doctrine was disposed')
  equal(run.runtime.modeOf(run.agent), 'on', 'the durable mode stays on')
  ok(run.warnings.some(message => message.includes('cannot restore the Lead model after a failed task queue')),
    'the partial rollback is logged')

  run.state.selectFault = null
  const off = await run.invoke('off', 'cmd-2')
  equal(off.kind, 'success', 'the off retry succeeds')
  equal(run.runtime.isActive(run.agent), false, 'the off retry disposes the bundle')
  equal(run.state.current.model, 'base-model', 'the carried capture restores the pre-orchestrator model')
  run.dispose()
})

test('already-active snapshot recreation failure reports the explicit fresh fallback', async t => {
  const root = workspace('active-fallback', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'OLD-DOCTRINE-A' })
  const run = harness({ root, resolveModel: resolveTestModel })
  pushRun(run.state.events, 'cmd-0', '')
  equal((await run.invoke('', 'cmd-0')).kind, 'success', 'the first enable succeeds')
  pushDone(run.state.events, 'cmd-0', 'success')

  writeDoctrine(root, { name: 'test-conductor-b', route: 'test-route-b', marker: 'NEW-DOCTRINE-B' })
  // Recreating the pre-invocation doctrine fails; recreating the freshly
  // applied bundle still works, which is the documented fallback.
  run.state.sectionFault = registration => registrationText(registration).includes('OLD-DOCTRINE-A')
  run.state.queueError = new Error('injected queue failure')
  pushRun(run.state.events, 'cmd-1', 'do the task')
  const result = await run.invoke('do the task', 'cmd-1')
  pushDone(run.state.events, 'cmd-1', 'error')
  const text = String(result.text)

  equal(result.kind, 'error', 'the queue failure is an error result')
  ok(text.includes('newly applied orchestrator state was kept instead'), 'the fallback state is named')
  ok(text.includes('fallback=true'), 'the error marks the fallback')
  ok(text.includes('new doctrine and model route'), 'the fallback doctrine and route are named')
  equal(run.runtime.isActive(run.agent), true, 'the fallback bundle keeps the mode live')
  equal(run.state.current.model, 'test-route-b', 'the fresh route stays selected')
  const texts = activeTexts(run.state)
  ok(texts.some(value => value.includes('NEW-DOCTRINE-B')), 'the fresh doctrine is installed')
  ok(!texts.some(value => value.includes('OLD-DOCTRINE-A')), 'the stale doctrine was disposed')
  ok(run.warnings.some(message => message.includes('cannot restore the pre-invocation orchestrator state')),
    'the failed snapshot recreation is logged')

  const off = await run.invoke('off', 'cmd-2')
  equal(off.kind, 'success', 'off still works after the fallback')
  equal(run.state.current.model, 'base-model', 'the fallback bundle kept the durable capture')
  run.dispose()
})

test('already-active double recreation failure reports an inactive mode accurately', async t => {
  const root = workspace('active-double-fail', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'OLD-DOCTRINE-A' })
  const run = harness({ root, resolveModel: resolveTestModel })
  pushRun(run.state.events, 'cmd-0', '')
  equal((await run.invoke('', 'cmd-0')).kind, 'success', 'the first enable succeeds')
  pushDone(run.state.events, 'cmd-0', 'success')

  writeDoctrine(root, { name: 'test-conductor-b', route: 'test-route-b', marker: 'NEW-DOCTRINE-B' })
  let freshRegistrations = 0
  run.state.sectionFault = registration => {
    const text = registrationText(registration)
    if (text.includes('OLD-DOCTRINE-A')) return true
    if (text.includes('NEW-DOCTRINE-B')) {
      freshRegistrations += 1
      // The enable registers the fresh identity once; the fallback retry is
      // the second registration and must fail too.
      return freshRegistrations > 1
    }
    return false
  }
  run.state.queueError = new Error('injected queue failure')
  pushRun(run.state.events, 'cmd-1', 'do the task')
  const result = await run.invoke('do the task', 'cmd-1')
  pushDone(run.state.events, 'cmd-1', 'error')
  const text = String(result.text)

  equal(result.kind, 'error', 'the queue failure is an error result')
  ok(text.includes('cannot restore any orchestrator state'), 'the double failure is named')
  ok(text.includes('orchestrator mode is inactive (active=false)'), 'inactivity is reported, not a false kept status')
  ok(text.includes('durable log still records the mode as on'), 'the durable disagreement is surfaced')
  ok(text.includes('model selection may still be the newly applied route'), 'the unrestored route is disclosed')
  equal(run.runtime.isActive(run.agent), false, 'no bundle remains live')
  equal(run.state.current.model, 'test-route-b', 'the newly applied route remains selected')
  equal(activeTexts(run.state).length, 0, 'no orchestrator prompt section remains installed')
  equal(run.runtime.modeOf(run.agent), 'on', 'the earlier activation is still durably on')
  run.dispose()
})

test('orchestrate enables Agent Teams before reporting success', async t => {
  const root = workspace('team-enable', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'TEAM-ENABLE-DOCTRINE' })
  const run = harness({ root, resolveModel: resolveTestModel })
  pushRun(run.state.events, 'cmd-team-1', '')
  const result = await run.invoke('', 'cmd-team-1')
  equal(result.kind, 'success', 'the activation succeeds')
  equal(run.state.teamEnabled, true, 'Team mode is persisted on')
  deepEqual(run.state.teamSetCalls, [true], 'the runtime requests Team mode exactly once')
  ok(String(result.text).includes('team: enabled'), 'the announcement reports Team activation')
  ok(String(result.text).includes('Soul-only'), 'the announcement states Soul-only delegation')
  pushDone(run.state.events, 'cmd-team-1', 'success')
  equal(run.runtime.modeOf(run.agent), 'on', 'the durable mode is on')
  run.dispose()
})

test('orchestrate does not duplicate an already-enabled Team selection', async t => {
  const root = workspace('team-already-on', t)
  writeDoctrine(root, { marker: 'TEAM-ALREADY-ON' })
  const run = harness({ root })
  run.state.teamEnabled = true
  pushRun(run.state.events, 'cmd-team-already', '')
  const result = await run.invoke('', 'cmd-team-already')
  equal(result.kind, 'success', 'activation succeeds')
  equal(run.state.teamSetCalls.length, 0, 'an already-enabled Team selection is not rewritten')
  run.dispose()
})

test('Team enable failure aborts activation without applying doctrine or queueing work', async t => {
  const root = workspace('team-enable-fail', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'TEAM-ENABLE-FAIL' })
  const run = harness({ root, resolveModel: resolveTestModel })
  run.state.teamEnableFault = new Error('injected Team enable failure')
  pushRun(run.state.events, 'cmd-team-2', 'do the task')
  const result = await run.invoke('do the task', 'cmd-team-2')
  equal(result.kind, 'error', 'the activation is an error')
  ok(String(result.text).includes('cannot enable Agent Teams for orchestrator mode'), 'the error names the Team failure')
  equal(run.runtime.isActive(run.agent), false, 'no live orchestrator bundle starts')
  equal(run.state.teamEnabled, false, 'Team mode remains off')
  equal(run.state.selectCalls.length, 0, 'the model route is never applied')
  equal(activeTexts(run.state).length, 0, 'no prompt section is applied')
  equal(run.state.queued.length, 0, 'the task is not queued')
  run.dispose()
})

test('apply failure after Team activation restores Team off on a first enable', async t => {
  const root = workspace('team-apply-fail', t)
  writeDoctrine(root, { marker: 'TEAM-APPLY-FAIL' })
  const run = harness({ root })
  run.state.sectionFault = () => true
  pushRun(run.state.events, 'cmd-team-3', '')
  const result = await run.invoke('', 'cmd-team-3')
  equal(result.kind, 'error', 'the apply failure is an error')
  equal(run.runtime.isActive(run.agent), false, 'no bundle remains')
  equal(run.state.teamEnabled, false, 'Team mode is restored off')
  deepEqual(run.state.teamSetCalls, [true, false], 'the runtime enables then restores Team mode')
  run.dispose()
})

test('off disables Team mode and reports it', async t => {
  const root = workspace('team-off', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'TEAM-OFF' })
  const run = harness({ root, resolveModel: resolveTestModel })
  pushRun(run.state.events, 'cmd-team-4', '')
  equal((await run.invoke('', 'cmd-team-4')).kind, 'success', 'activation succeeds')
  pushDone(run.state.events, 'cmd-team-4', 'success')
  const off = await run.invoke('off', 'cmd-team-5')
  equal(off.kind, 'success', 'off succeeds')
  equal(run.state.teamEnabled, false, 'Team mode is disabled')
  ok(String(off.text).includes('Agent Teams was disabled'), 'the off result reports Team shutdown')
  equal(run.runtime.isActive(run.agent), false, 'the bundle is disposed')
  run.dispose()
})

test('Team disable failure keeps the mode active for an off retry', async t => {
  const root = workspace('team-off-fail', t)
  writeDoctrine(root, { route: 'test-route-a', marker: 'TEAM-OFF-FAIL' })
  const run = harness({ root, resolveModel: resolveTestModel })
  pushRun(run.state.events, 'cmd-team-6', '')
  equal((await run.invoke('', 'cmd-team-6')).kind, 'success', 'activation succeeds')
  pushDone(run.state.events, 'cmd-team-6', 'success')
  run.state.teamDisableFault = new Error('injected Team disable failure')
  const off = await run.invoke('off', 'cmd-team-7')
  equal(off.kind, 'error', 'off reports the failure')
  ok(String(off.text).includes('cannot disable Agent Teams'), 'the failure is actionable')
  equal(run.runtime.isActive(run.agent), true, 'the live bundle remains for a retry')
  equal(run.state.teamEnabled, true, 'Team mode remains on')
  run.state.teamDisableFault = null
  const retry = await run.invoke('off', 'cmd-team-8')
  equal(retry.kind, 'success', 'the off retry succeeds')
  equal(run.state.teamEnabled, false, 'the retry disables Team mode')
  run.dispose()
})

test('off while inactive leaves an unrelated Team selection untouched', async t => {
  const root = workspace('team-off-inactive', t)
  const run = harness({ root })
  run.state.teamEnabled = true
  const off = await run.invoke('off', 'cmd-team-9')
  equal(off.kind, 'success', 'inactive off succeeds')
  equal(run.state.teamEnabled, true, 'the unrelated Team selection is unchanged')
  equal(run.state.teamSetCalls.length, 0, 'no Team write is attempted')
  run.dispose()
})

test('off disables Team even when a durable-on mode has no live bundle', async t => {
  const root = workspace('team-off-no-bundle', t)
  writeDoctrine(root, { marker: 'TEAM-OFF-NO-BUNDLE' })
  const run = harness({ root })
  pushRun(run.state.events, 'cmd-team-20', '')
  equal((await run.invoke('', 'cmd-team-20')).kind, 'success', 'activation succeeds')
  pushDone(run.state.events, 'cmd-team-20', 'success')
  equal(run.state.teamEnabled, true, 'Team is on before the reload-like disposal')
  run.runtime.disposeAgent(run.agent)
  const off = await run.invoke('off', 'cmd-team-21')
  equal(off.kind, 'success', 'off succeeds without a live bundle')
  equal(run.state.teamEnabled, false, 'the durable active mode still disables Team')
  ok(String(off.text).includes('Agent Teams was disabled'), 'the result reports Team shutdown')
  run.dispose()
})

test('reapplyIfActive enables Team for a durable on mode', async t => {
  const root = workspace('team-reapply', t)
  writeDoctrine(root, { marker: 'TEAM-REAPPLY' })
  const run = harness({ root })
  pushRun(run.state.events, 'cmd-team-10', '')
  equal((await run.invoke('', 'cmd-team-10')).kind, 'success', 'the initial activation succeeds')
  pushDone(run.state.events, 'cmd-team-10', 'success')
  run.runtime.disposeAgent(run.agent)
  run.state.teamEnabled = false
  const reapplied = await run.runtime.reapplyIfActive(run.agent)
  equal(reapplied.ok, true, 'the reapply succeeds')
  equal(run.state.teamEnabled, true, 'the durable mode re-enables Team')
  equal(run.runtime.isActive(run.agent), true, 'the doctrine bundle is restored')
  run.dispose()
})

test('reapply reports a Team re-enable failure without claiming the mode resumed', async t => {
  const root = workspace('team-reapply-fail', t)
  writeDoctrine(root, { marker: 'TEAM-REAPPLY-FAIL' })
  const run = harness({ root })
  pushRun(run.state.events, 'cmd-team-11', '')
  equal((await run.invoke('', 'cmd-team-11')).kind, 'success', 'the initial activation succeeds')
  pushDone(run.state.events, 'cmd-team-11', 'success')
  run.runtime.disposeAgent(run.agent)
  run.state.teamEnabled = false
  run.state.teamEnableFault = new Error('injected reapply Team failure')
  const reapplied = await run.runtime.reapplyIfActive(run.agent)
  equal(reapplied.ok, false, 'the reapply reports failure')
  ok(String(reapplied.error).includes('cannot re-enable Agent Teams'), 'the error names the Team failure')
  equal(run.runtime.isActive(run.agent), false, 'no doctrine bundle is claimed active')
  run.dispose()
})

test('bundled doctrine prompt carries the corrected route, status, gate, and quote text', async t => {
  const root = workspace('doctrine', t)
  const run = harness({ root })
  pushRun(run.state.events, 'cmd-0', '')

  const result = await run.invoke('', 'cmd-0')

  equal(result.kind, 'success', 'the bundled doctrine enables without a workspace file')
  const text = String(result.text)
  ok(text.includes('model: inherit'), 'the shipped no-route definition inherits the Lead model')
  ok(text.includes('gate: strict'), 'the shipped gate mode is announced')
  ok(text.includes('retries: 10'), 'the shipped retry budget is announced')
  equal(run.state.selectCalls.length, 0, 'an inherited route selects nothing')
  equal(run.state.current.model, 'base-model', 'the Lead selection is unchanged')
  equal(readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8'), REAL_DOCTRINE,
    'reading the bundled doctrine never writes it')

  const texts = activeTexts(run.state)
  const identity = texts.find(value => value.includes('You are the ORCHESTRATOR of this session.')) ?? ''
  const stateSection = texts.find(value => value.includes('Use the harness\'s Team task board as the durable work ledger.')) ?? ''
  const verification = texts.find(value => value.includes('Apply `strict` explicitly:')) ?? ''
  const delegation = texts.find(value => value.includes('Consult the live soul catalog and inspect relevant definitions before routing work.')) ?? ''
  ok(identity.includes("The shipped default declares no route, so the Lead's current model selection is inherited."),
    'the runtime contract states the conditional route inheritance')
  ok(text.includes('team: enabled (delegation is Soul-only through spawn_teammate)'),
    'activation announces that Team mode is enabled and delegation is Soul-only')
  ok(identity.includes('never use subagent or subagent_fork'),
    'the fixed identity states the unconditional Soul-only rule')
  ok(!identity.includes('does not expose the Agent Soul spawn_teammate tool'),
    'the non-Team fallback is gone from the fixed identity')
  ok(!identity.includes('it selects the provider, model, and reasoning effort declared in this file\'s frontmatter'),
    'the old unconditional route claim is gone')
  ok(delegation.includes('`name: adversarial-red-team-verifier`'), 'the verifier name uses matched backticks')
  ok(!/adversarial-red-team-verifier['"]/u.test(delegation), 'the mismatched quote typo is gone')
  ok(delegation.includes('Delegate only through `spawn_teammate`'),
    'the bundled doctrine makes spawn_teammate the only delegation path')
  ok(delegation.includes('Never use `subagent` or `subagent_fork`'),
    'the bundled doctrine keeps the unconditional Soul-only rule')
  ok(!delegation.includes('ordinary Soul-less delegation'),
    'the bundled doctrine never advertises a Soul-less fallback')

  for (const status of ['`pending`', '`in_progress`', '`completed`', '`deleted`']) {
    ok(stateSection.includes(status), 'the state tracking section lists supported status ' + status)
  }
  ok(!/\bFailed\b/u.test(stateSection), 'the state tracking section never instructs a Failed board status')

  ok(verification.includes('Under `strict` gating, a failed or unperformed gate blocks acceptance'),
    'gate correction is scoped to strict gating')
  ok(verification.includes('within the remaining `10` allowance'),
    'the strict correction loop is bounded by the configured retry budget')
  ok(verification.includes('Under `advisory` or `off`'),
    'advisory/off continuation is stated without blocking')
  ok(!verification.includes('When a gate fails, block the workflow and run a correction loop'),
    'the old unconditional gate correction is gone')
  ok(!verification.includes('{{maxRetries}}') && !verification.includes('{{gateMode}}'),
    'the prompt carries substituted settings, not raw template tokens')
  run.dispose()
})

test('the fixed identity always states Soul-only delegation', async t => {
  const soulOnly = orchestratorFixedIdentity()
  assert.match(soulOnly, /spawn_teammate/)
  assert.match(soulOnly, /never use subagent or subagent_fork/)
  assert.doesNotMatch(soulOnly, /does not expose/)


  const run = harness({ root: workspace('identity', t) })
  const result = await run.invoke('', 'identity-spawn-visible')
  assert.equal(result.kind, 'success')
  assert.equal(run.state.teamEnabled, true)
  const identity = activeTexts(run.state, { agent: run.agent, scope: {}, toolSet: undefined })
    .find(value => value.includes('You are the ORCHESTRATOR of this session.'))
  assert.match(identity ?? '', /spawn_teammate/)
  assert.match(identity ?? '', /never use subagent or subagent_fork/)
  assert.doesNotMatch(identity ?? '', /does not expose/)
  run.dispose()
})

test('spawn_teammate context schema describes the real defaultContext resolution', async t => {
  const registered = []
  const scope = {
    systemPrompt: {
      section() { return () => {} },
      context() { return () => {} },
      getSectionOrder() { return 10 },
    },
    tools: {
      register(definition) { registered.push(definition); return () => {} },
    },
  }
  const catalog = { promptText() { return 'CATALOG' } }
  const deps = {
    ctx: { get() { return undefined } },
    logger: { warn() {} },
    catalog,
    rootOf() { return '/tmp/unused' },
  }
  const disposer = installSoulSurface(
    { id: 'fake-lead' },
    scope,
    {
      ctx: { get(name) { return name === 'agentTeams' ? { isEnabled: () => true } : undefined } },
      config: {},
      catalog,
      deps,
      member: { role: 'lead', name: 'lead', enabled: true, root: { id: 'fake-lead' } },
    },
  )
  ok(typeof disposer === 'function', 'the soul surface installs a disposer')

  const spawn = registered.find(definition => definition.name === 'spawn_teammate')
  ok(spawn !== undefined, 'spawn_teammate is registered')
  const context = spawn.parameters.properties.context
  const expected = "fresh starts without Lead history; fork inherits completed Lead turns. Resolution order: the explicit context passed to this call, then the selected Soul's declared context, then the configured default context (config.defaultContext, normally fresh)."
  equal(context.description, expected, 'the model-facing description names the real resolution order')
  deepEqual(context.enum, ['fresh', 'fork'], 'the context enum stays fresh/fork')
  ok(context.description.indexOf('explicit context passed to this call') < context.description.indexOf("selected Soul's declared context"),
    'the explicit call is resolved before the Soul declaration')
  ok(context.description.indexOf("selected Soul's declared context") < context.description.indexOf('config.defaultContext'),
    'the Soul declaration is resolved before the configured default')
  ok(!context.description.includes('else fresh'), 'no unconditional fresh fallback remains')
  disposer()
  t.diagnostic('spawn_teammate context description asserted from the registered schema')
})
