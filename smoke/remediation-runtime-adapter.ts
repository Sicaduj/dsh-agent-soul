/** Keyless real CLI/Agent Teams remediation probes. Never loads a paid provider. */
import fs, { appendFileSync } from 'node:fs'
import fsp, { readFile, rename, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

const OUT = process.env.QAS_OUT!
const MODE = process.env.QAS_MODE!
const LABEL = process.env.QAS_ROOT_LABEL ?? ''
const EXPECTATION = process.env.QAS_EXPECTATION ?? 'candidate'
const TEAM_TOOLS = ['list_agents', 'send_message', 'wait_agent',
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update'].sort()
let runtime: any
let sequence = 0
let started = false
const requests: any[] = []
const outcomes = new Map<string, any>()
function emit(kind: string, value: any): void {
  appendFileSync(OUT, JSON.stringify({ kind, mode: MODE, root: LABEL, pid: process.pid, ...value }) + '\n')
}
function check(id: string, expected: any, actual: any, pass = JSON.stringify(expected) === JSON.stringify(actual)): void {
  emit('assertion', { id, expected, actual, verdict: pass ? 'PASS' : 'FAIL', tier: 'real-cli-registered-tools' })
  if (!pass) throw new Error(`assertion ${id} failed`)
}
function lead(): any {
  const agent = runtime.agents.list().find((a: any) => a.session?.header?.parentSession === undefined)
  if (!agent) throw new Error('no live root Agent')
  return agent
}
async function roster(): Promise<any[]> { return runtime.subagents.listDescendants(lead().id) }
async function row(name: string): Promise<any> { return (await roster()).find((m: any) => (m.path ?? m.name ?? m.id) === name) }
async function invoke(name: string, args: any): Promise<any> {
  const id = ToolCallId(`remediation-${++sequence}`)
  const agent = lead()
  const signal = new AbortController().signal
  // Conditional registrations (spawn_teammate/list_agent_souls) are admitted
  // only through a step's resolved tool set. Build one for this direct
  // invocation so the harness still exercises the real registry/pipeline.
  let modelSelection
  try { modelSelection = agent.model.current() } catch { modelSelection = undefined }
  const toolSet = await runtime.tools.resolve({
    agent,
    modelSelection: modelSelection ?? { provider: 'deepseek-official', model: 'deepseek-flash' },
    signal,
  })
  let batch
  try {
    batch = await runtime.tools.execute({ agent, toolSet, signal,
      calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }] })
  } finally {
    toolSet.dispose()
  }
  const result = batch.results[0]?.result
  if (!result) throw new Error('tool executor omitted result')
  const outcome = outcomes.get(id)
  // tools/result is the lossless typed result; the returned ToolResult is a rendered transport view.
  emit('tool-invocation', { id, name, args, pipelineObserved: outcome !== undefined, outcome: outcome ?? result })
  if (!outcome) throw new Error(`tools/result not observed for ${id}`)
  return outcome
}
async function settleById(childId: string, name: string): Promise<void> {
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const agent = runtime.agents.get(childId)
    if (requests.some(r => r.memberSessionId === childId) && agent?.status !== 'running') {
      if (agent) await agent.whenIdle()
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`child ${name} did not settle`)
}
async function settle(name: string): Promise<void> {
  const member = await row(name)
  if (!member) throw new Error(`child ${name} is not in the catalog`)
  await settleById(member.id, name)
}
function expected(label: string): any {
  return label === 'A' ? { provider: 'deepseek-official', model: 'deepseek-v4-pro', inherited: ['read'] }
    : { provider: 'scripted-alt', model: 'alt-only', inherited: ['grep'] }
}
function verifyRequest(name: string): void {
  const request = requests.findLast(r => r.memberName === name)
  const contract = expected(LABEL)
  check(`${MODE}.${LABEL}.persona-v1`, true, request?.system.includes(`QAS_ROOT_${LABEL}_V1`))
  check(`${MODE}.${LABEL}.no-persona-v2`, false, request?.system.includes(`QAS_ROOT_${LABEL}_V2`))
  check(`${MODE}.${LABEL}.model-v1`, { provider: contract.provider, model: contract.model },
    { provider: request?.provider, model: request?.model })
  check(`${MODE}.${LABEL}.tools-v1`, [...TEAM_TOOLS, ...contract.inherited].sort(), request?.tools)
  check(`${MODE}.${LABEL}.cwd`, process.cwd(), request?.cwd)
}
async function send(name: string): Promise<any> { return invoke('send_message', { agent: name, message: `COLD_${MODE}_${LABEL}` }) }
async function admissionDiagnostics(): Promise<any[]> {
  try {
    const result = await invoke('list_agent_souls', {})
    return Array.isArray(result.value?.diagnostics) ? result.value.diagnostics : []
  } catch {
    return []
  }
}
async function spawn(name: string): Promise<void> {
  const result = await invoke('spawn_teammate', { name, description: 'run-owned deterministic worker',
    prompt: `TASK_${LABEL}`, agent_type: 'qas-shared' })
  check(`${MODE}.${LABEL}.spawn-accepted`, false, result.isError)
  const childId = result.value?.teammate?.id
  check(`${MODE}.${LABEL}.spawn-child-id`, true, typeof childId === 'string' && childId.length > 0)
  await settleById(childId, name)
  verifyRequest(name)
  emit('accepted-worker', { leadSessionId: lead().id, memberSessionId: childId, memberName: name })
}
async function waitFile(path: string): Promise<void> {
  const until = Date.now() + 90000
  while (Date.now() < until) {
    try { await readFile(path); return } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  throw new Error(`timed out on run-owned barrier ${path}`)
}
/** Observe mutating builtin calls without preventing writes or changing results. */
function monitorWrites(roots: string[]): { writes: any[], restore(): void } {
  const writes: any[] = []
  const restores: (() => void)[] = []
  const scope = roots.map(root => resolve(root))
  const pathOf = (value: any): string | undefined => {
    try { return value instanceof URL ? fileURLToPath(value) : typeof value === 'string' ? resolve(value) : undefined } catch { return undefined }
  }
  const tracked = (value: any): boolean => {
    const path = pathOf(value)
    return path !== undefined && scope.some(root => path === root || path.startsWith(root + '/'))
  }
  const patch = (object: any, name: string, indexes = [0], condition = (_args: any[]) => true) => {
    const original = object[name]
    if (typeof original !== 'function') return
    object[name] = function (...args: any[]) {
      if (condition(args) && indexes.some(index => tracked(args[index]))) {
        writes.push({ api: name, paths: indexes.map(index => pathOf(args[index])).filter(Boolean) })
      }
      return original.apply(this, args)
    }
    restores.push(() => { object[name] = original })
  }
  for (const object of [fs, fsp]) {
    for (const base of ['appendFile', 'writeFile', 'mkdir', 'rm', 'rmdir', 'unlink', 'truncate', 'chmod', 'chown', 'utimes']) {
      patch(object, base); patch(object, base + 'Sync')
    }
    for (const base of ['rename', 'copyFile', 'cp', 'link', 'symlink']) { patch(object, base, [0, 1]); patch(object, base + 'Sync', [0, 1]) }
    for (const name of ['open', 'openSync']) patch(object, name, [0], args => typeof args[1] === 'number' ? args[1] !== 0 : /[wa+]/.test(String(args[1])))
    patch(object, 'createWriteStream')
  }
  syncBuiltinESMExports()
  return { writes, restore() { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports() } }
}
async function readProbe(): Promise<void> {
  const roots = [join(process.cwd(), '.dsh'), process.env.QAS_PLUGIN_DIR!]
  const monitor = monitorWrites(roots)
  let result: any
  try { result = await invoke('manage_agent_souls', { action: 'get_orchestrator' }) }
  finally { monitor.restore() }
  emit('read-operation-writes', { writes: monitor.writes, roots })
  check(`F001.${LABEL}.zero-writes`, [], monitor.writes)
  // Baseline carries undeclared bundled/sourcePath output keys and fails the real registry validator.
  check(`F001.${LABEL}.pipeline-success`, EXPECTATION === 'baseline' ? true : false, result.isError)
  if (EXPECTATION === 'candidate') {
    check(`F001.${LABEL}.value-ok`, true, result.value?.ok)
    check(`F001.${LABEL}.source-returned`, true, typeof result.value?.source === 'string' && result.value.source.length > 0)
    check(`F001.${LABEL}.read-action`, 'get_orchestrator', result.value?.action)
    check(`F001.${LABEL}.source-label`, LABEL === 'bundled', result.value?.bundled)
    check(`F001.${LABEL}.source-path`, true, typeof result.value?.sourcePath === 'string' && isAbsolute(result.value.sourcePath))
    if (LABEL === 'invalid') check('F001.invalid.diagnostics-preserved', true, result.value?.diagnostics?.length > 0)
  } else {
    const message = result.error?.message ?? ''
    check(`F001.${LABEL}.validation-defect`, true, result.error?.info?.code === 'INVALID_TOOL_OUTPUT'
      && message.includes('bundled') && message.includes('sourcePath') && message.includes('additionalProperties'))
  }
}
/**
 * Publish one readiness barrier atomically: readers see either no document or
 * the complete JSON, never a truncated in-progress write. The temporary file
 * stays in the same directory so rename() is atomic.
 *
 * @param path - absolute barrier path owned by the runner.
 * @param value - JSON-serializable readiness observation.
 */
async function publishReady(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value))
  await rename(temporary, path)
}
async function runMain(): Promise<void> {
  emit('root-start', { leadSessionId: lead().id, cwd: process.cwd(), sanitized: {
    canaryAbsent: process.env.QAS_CANARY_SECRET === undefined,
    providerKeysAbsent: Object.keys(process.env).filter(key => /API_KEY|TOKEN|SECRET|PASSWORD/.test(key)),
    proxyAbsent: !process.env.HTTP_PROXY && !process.env.HTTPS_PROXY && !process.env.ALL_PROXY,
  }, providers: runtime.llm.listProviders().map((p: any) => p.id) })
  if (MODE === 'bootstrap') return spawn('primer')
  if (MODE === 'concurrent') {
    const primer = await send('primer')
    const primerId = process.env.QAS_PRIMER_CHILD_ID
    check(`F002.${LABEL}.priming-cold-refusal`, true, primer.isError)
    const diagnostics = await admissionDiagnostics()
    check(`F002.${LABEL}.priming-binding-missing`, true, primer.error?.info?.code === 'NOT_RESUMABLE'
      && diagnostics.some(row => String(row?.source).startsWith('admission:')))
    check(`F002.${LABEL}.priming-roster-child`, true, typeof primerId === 'string' && primerId.length > 0)
    check(`F002.${LABEL}.priming-no-child-request`, 0, requests.length)
    emit('store-primed', { leadSessionId: lead().id, primerSessionId: primerId, outcome: primer })
    await publishReady(process.env.QAS_READY!, { pid: process.pid, leadSessionId: lead().id })
    await waitFile(process.env.QAS_GO!)
    return spawn('accepted-worker')
  }
  if (MODE === 'cold' || MODE === 'missing') {
    const result = await send('accepted-worker')
    const shouldFail = process.env.QAS_EXPECT_REFUSAL === '1'
    check(`${MODE}.${LABEL}.send-outcome`, shouldFail, result.isError)
    if (shouldFail) {
      check(`${MODE}.${LABEL}.no-child-request`, 0, requests.length)
      const diagnostics = await admissionDiagnostics()
      check(`${MODE}.${LABEL}.soul-specific-fail-closed`, true, result.error?.info?.code === 'NOT_RESUMABLE'
        && diagnostics.some(row => String(row?.source).startsWith('admission:')))
    } else {
      const childId = process.env.QAS_CHILD_ID
      check(`${MODE}.${LABEL}.cold-child-id`, true, typeof childId === 'string' && childId.length > 0)
      await settleById(childId, 'accepted-worker')
      verifyRequest('accepted-worker')
    }
    emit('cold-complete', { leadSessionId: lead().id, memberSessionId: process.env.QAS_CHILD_ID, shouldFail })
    return
  }
  if (MODE === 'read') return readProbe()
  throw new Error(`unsupported mode ${MODE}`)
}
function textChunks(text: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'stop' } }]
}
class RemediationAdapter extends LlmAdapter {
  async listModels(provider: string): Promise<any[]> {
    return ['deepseek-flash', 'deepseek-v4-pro', 'alt-only'].map(id => ({ provider, id, name: `Scripted ${id}` }))
  }
  async resolveModel(provider: string, model: string): Promise<any> { return { provider, id: model, name: model } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const messages = options.messages as any[]
    const identity = messages.findLast(m => m.role === 'user' && m.source?.kind === 'runtime-context')
      ?.source?.sections?.find((s: any) => s.name === 'subagent:identity')?.text ?? ''
    if (identity.startsWith('You are the root agent.')) {
      if (!started) { started = true; await runMain() }
      yield* textChunks('REMEDIATION_OK')
      return
    }
    const memberName = identity.match(/Your name is "([^"]+)"/)?.[1]
    if (!memberName) {
      yield* textChunks('remediation assistant')
      return
    }
    const memberSessionId = options.sessionId ?? (await row(memberName))?.id
    const record = { memberName, memberSessionId,
      provider: options.provider, model: options.model, tools: (options.tools ?? []).map(t => t.name).sort(),
      system: (options.system ?? '') + messages.filter(m => m.role === 'system').flatMap(m => m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text)).join('\n'),
      cwd: memberSessionId === undefined ? undefined : runtime.agents.get(memberSessionId)?.session.header.cwd }
    requests.push(record); emit('child-request', record)
    yield* textChunks(`CHILD_DONE_${memberName}`)
  }
}
export const name = 'remediation-runtime-scripted-llm'
export const inject = ['llm', 'agents', 'tools', 'agentTeams']
export function apply(ctx: any): void {
  runtime = ctx
  ctx.llm.registerAdapter(['deepseek-official', 'scripted-alt'], new RemediationAdapter())
  ctx.on('tools/result', (exec: any, result: any) => { outcomes.set(exec.callId, result) })
  emit('adapter-ready', { environment: 'sanitized-run-owned-profile', noProviderIO: true })
}
