/** Keyless real CLI/Agent Teams remediation probes. Never loads a paid provider. */
import fs, { appendFileSync } from 'node:fs'
import fsp, { readFile, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

const OUT = process.env.QAS_OUT!
const MODE = process.env.QAS_MODE!
const LABEL = process.env.QAS_ROOT_LABEL ?? ''
const EXPECTATION = process.env.QAS_EXPECTATION ?? 'candidate'
const TEAM_TOOLS = ['interrupt_agent', 'list_agent_souls', 'list_agents', 'send_message', 'spawn_teammate',
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update', 'wait_agent'].sort()
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
function roster(): any[] { return runtime.agentTeams.listMembers(lead()) }
function row(name: string): any { return roster().find((m: any) => m.name === name) }
async function invoke(name: string, args: any): Promise<any> {
  const id = ToolCallId(`remediation-${++sequence}`)
  const batch = await runtime.tools.execute({ agent: lead(), signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }] })
  const result = batch.results[0]?.result
  if (!result) throw new Error('tool executor omitted result')
  const outcome = outcomes.get(id)
  // tools/result is the lossless typed result; the returned ToolResult is a rendered transport view.
  emit('tool-invocation', { id, name, args, pipelineObserved: outcome !== undefined, outcome: outcome ?? result })
  if (!outcome) throw new Error(`tools/result not observed for ${id}`)
  return outcome
}
async function settle(name: string): Promise<void> {
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const member = row(name)
    const agent = member && runtime.agents.get(member.id)
    if (requests.some(r => r.memberSessionId === member?.id) && agent?.status !== 'running') {
      if (agent) await agent.whenIdle()
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`child ${name} did not settle`)
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
async function send(name: string): Promise<any> { return invoke('send_message', { target: name, message: `COLD_${MODE}_${LABEL}` }) }
async function spawn(name: string): Promise<void> {
  const result = await invoke('spawn_teammate', { name, description: 'run-owned deterministic worker',
    prompt: `TASK_${LABEL}`, agent_type: 'qas-shared' })
  check(`${MODE}.${LABEL}.spawn-accepted`, false, result.isError)
  await settle(name)
  verifyRequest(name)
  emit('accepted-worker', { leadSessionId: lead().id, memberSessionId: row(name)?.id, memberName: name })
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
async function runMain(): Promise<void> {
  emit('root-start', { leadSessionId: lead().id, cwd: process.cwd(), sanitized: {
    canaryAbsent: process.env.QAS_CANARY_SECRET === undefined,
    providerKeysAbsent: Object.keys(process.env).filter(key => /API_KEY|TOKEN|SECRET|PASSWORD/.test(key)),
    proxyAbsent: !process.env.HTTP_PROXY && !process.env.HTTPS_PROXY && !process.env.ALL_PROXY,
  }, providers: runtime.llm.listProviders().map((p: any) => p.id) })
  if (MODE === 'bootstrap') return spawn('primer')
  if (MODE === 'concurrent') {
    const primer = await send('primer')
    check(`F002.${LABEL}.priming-cold-refusal`, true, primer.isError)
    check(`F002.${LABEL}.priming-binding-missing`, true, /no pending or durable Agent Soul plan/.test(primer.error?.message ?? ''))
    check(`F002.${LABEL}.priming-roster-child`, true, typeof row('primer')?.id === 'string')
    check(`F002.${LABEL}.priming-no-child-request`, 0, requests.length)
    emit('store-primed', { leadSessionId: lead().id, primerSessionId: row('primer')?.id, outcome: primer })
    await writeFile(process.env.QAS_READY!, JSON.stringify({ pid: process.pid, leadSessionId: lead().id }))
    await waitFile(process.env.QAS_GO!)
    return spawn('accepted-worker')
  }
  if (MODE === 'cold' || MODE === 'missing') {
    const result = await send('accepted-worker')
    const shouldFail = process.env.QAS_EXPECT_REFUSAL === '1'
    check(`${MODE}.${LABEL}.send-outcome`, shouldFail, result.isError)
    if (shouldFail) {
      check(`${MODE}.${LABEL}.no-child-request`, 0, requests.length)
      check(`${MODE}.${LABEL}.soul-specific-fail-closed`, true, /Soul|SOUL_PLAN_UNAVAILABLE|durable/.test(result.error?.message ?? ''))
    } else { await settle('accepted-worker'); verifyRequest('accepted-worker') }
    emit('cold-complete', { leadSessionId: lead().id, memberSessionId: row('accepted-worker')?.id, shouldFail })
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
      ?.source?.sections?.find((s: any) => s.name === 'team:identity')?.text ?? ''
    if (identity.startsWith('You are the Team Lead named "lead".')) {
      if (!started) { started = true; await runMain() }
      yield* textChunks('REMEDIATION_OK')
      return
    }
    const memberName = identity.match(/^You are teammate "([^"]+)"\./)?.[1]
    if (!memberName) throw new Error(`unexpected identity ${identity}`)
    const record = { memberName, memberSessionId: row(memberName)?.id,
      provider: options.provider, model: options.model, tools: (options.tools ?? []).map(t => t.name).sort(),
      system: (options.system ?? '') + messages.filter(m => m.role === 'system').flatMap(m => m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text)).join('\n'),
      cwd: runtime.agents.get(row(memberName)?.id)?.session.header.cwd }
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
