/**
 * Deterministic keyless LLM adapter for the Agent Soul smoke run.
 *
 * It scripts three roles: the Lead spawns a soul teammate, the teammate
 * reports its runtime facts (persona, tool matrix, routed model), and the Lead
 * prints the final success line that the runner asserts on. Observations are
 * appended as JSON lines to `$SOUL_PROBE_OUT` so the runner can check exact
 * values without parsing model prose.
 */

import { appendFileSync } from 'node:fs'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { expectedSoulTools } from './contract.mjs'

let nextCall = 0
let runtime: any = null
let commandAttempted = false
let commandObservation: Record<string, unknown> = { kind: 'command' }
let orchestratorAttempted = false
let orchestratorPromptObserved = false
let verifierSpawned = false
let orchestratorObservation: Record<string, unknown> = { kind: 'orchestrator' }

const LIVE_SHELL_TOOL = process.platform === 'win32' ? 'pwsh' : 'bash'

interface ToolChunkSpec {
  name: string
  args: Record<string, unknown>
}

interface MessageLike {
  role: string
  content: { type: string, text?: string, name?: string, arguments?: string }[]
  source?: { kind?: string, sections?: { name: string, text: string }[] }
}

function observe(observation: Record<string, unknown>): void {
  const out = process.env.SOUL_PROBE_OUT
  if (out === undefined || out === '') return
  appendFileSync(out, `${JSON.stringify(observation)}\n`)
}

function toolChunks(specs: ToolChunkSpec[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  for (const [index, spec] of specs.entries()) {
    const id = ToolCallId(`soul-fixture-${++nextCall}`)
    const args = JSON.stringify(spec.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: spec.name, argumentsDelta: args },
      { type: 'block-end', index, block: { type: 'tool-call', id, name: spec.name, arguments: args } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function messagesOf(options: GenerateOptions): MessageLike[] {
  return options.messages as unknown as MessageLike[]
}

/** The assembled system prompt reaches the adapter as `system` messages, not as `options.system`. */
function systemTextOf(options: GenerateOptions, messages: MessageLike[]): string {
  const fromMessages = messages
    .filter(message => message.role === 'system')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []))
    .join('\n\n')
  return (options.system ?? '') + '\n\n' + fromMessages
}

function identityOf(messages: MessageLike[]): string {
  const context = messages.findLast(message => message.role === 'user' && message.source?.kind === 'runtime-context')
  return context?.source?.sections?.find(section => section.name === 'subagent:identity')?.text ?? ''
}

function toolCallNames(messages: MessageLike[]): string[] {
  return messages.flatMap(message => message.role === 'assistant'
    ? message.content.filter(block => block.type === 'tool-call').map(block => block.name ?? '')
    : [])
}

function latestAssistantCalls(messages: MessageLike[]): string[] {
  const assistant = messages.findLast(message => message.role === 'assistant')
  return assistant?.content.filter(block => block.type === 'tool-call').map(block => block.name ?? '') ?? []
}

function peerText(messages: MessageLike[]): string {
  return messages.flatMap(message => message.role === 'user' && message.source?.kind === 'agent-message'
    ? message.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : [])
    : []).join('\n')
}

/** The soul teammate: report persona, tool matrix, and route from the real child runtime. */
function teammateChunks(options: GenerateOptions): StreamChunk[] {
  const messages = messagesOf(options)
  const system = systemTextOf(options, messages)
  const tools = options.tools.map(tool => tool.name)
  const observation = {
    kind: 'teammate',
    identity: identityOf(messages),
    model: options.model,
    provider: options.provider,
    tools,
    personaOk: system.includes('You are the soul probe'),
    markerOk: system.includes('SOUL_PROBE_MARKER'),
    toolsOk: JSON.stringify([...tools].sort()) === JSON.stringify(expectedSoulTools('read', 'grep', 'glob')),
    modelOk: options.model === 'deepseek-v4-pro',
  }
  observe(observation)
  const result = `SOUL_PROBE_RESULT persona=${observation.personaOk} marker=${observation.markerOk} tools=${observation.toolsOk} model=${observation.modelOk} model_id=${options.model} tool_names=${tools.join(',')}`
  if (!toolCallNames(messages).includes('send_message')) {
    return toolChunks([{ name: 'send_message', args: { agent: 'lead', message: result } }])
  }
  return textChunks('Probe complete.')
}

/** The Team Lead: spawn the soul teammate, wait, and surface its report. */
function leadChunks(options: GenerateOptions, observeOrchestratorPrompt = true): StreamChunk[] {
  const messages = messagesOf(options)
  const peer = peerText(messages)
  const systemText = systemTextOf(options, messages)
  if (observeOrchestratorPrompt && orchestratorAttempted && !orchestratorPromptObserved) {
    orchestratorPromptObserved = true
    observe({
      kind: 'orchestrator-prompt',
      activeIdentity: systemText.includes('You are the ORCHESTRATOR of this session.'),
      requiresSoulSpawn: (
        systemText.includes('Delegate only to defined Agent Souls through spawn_teammate')
          && systemText.includes('never use subagent or subagent_fork')
      ) || (systemText.includes('Enable Use Agent Teams')
        && systemText.includes('retry through spawn_teammate')),
      permitsStockFallback: systemText.includes('ordinary Soul-less delegation')
        || systemText.includes('Use those standard tools'),
    })
  }
  if (peer.includes('VERIFIER_RESULT')) {
    return textChunks(`SOUL_SMOKE_OK ${peer.trim()} COMMAND=${JSON.stringify(commandObservation)} ORCHESTRATOR=${JSON.stringify(orchestratorObservation)}`)
  }
  if (peer.includes('SOUL_PROBE_RESULT')) {
    if (!verifierSpawned) {
      verifierSpawned = true
      return toolChunks([{
        name: 'spawn_teammate',
        args: {
          name: 'verifier-1',
          description: 'Independently challenge the smoke candidate.',
          prompt: 'Review the orchestrated smoke candidate and report your runtime facts.',
          agent_type: 'adversarial-red-team-verifier',
        },
      }])
    }
    return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
  }
  const calls = toolCallNames(messages)
  const spawnTool = options.tools.find(tool => tool.name === 'spawn_teammate')
  const spawnProperties = spawnTool?.parameters['properties'] as Record<string, unknown> | undefined
  const listTool = options.tools.find(tool => tool.name === 'list_agent_souls')
  // The runner seeds removable canaries into its own environment before this
  // child starts; each one must be absent from the real child process env. A
  // provider key may be present only as the empty override the runner writes.
  const envScrub = {
    credentialCanaryAbsent: process.env.SMOKE_CANARY_CREDENTIAL === undefined
      && process.env.SMOKE_CANARY_SECRET === undefined,
    proxyCanaryAbsent: process.env.HTTP_PROXY === undefined
      && process.env.HTTPS_PROXY === undefined
      && process.env.ALL_PROXY === undefined,
    loaderCanaryAbsent: !String(process.env.NODE_OPTIONS ?? '').includes('SMOKE_CANARY')
      && process.env.DYLD_INSERT_LIBRARIES === undefined,
    providerKeyEmpty: process.env.DEEPSEEK_API_KEY === '',
  }
  observe({
    kind: 'lead',
    model: options.model,
    toolNames: options.tools.map(tool => tool.name),
    spawnHasAgentType: spawnProperties !== undefined && Object.hasOwn(spawnProperties, 'agent_type'),
    hasListSouls: listTool !== undefined,
    catalogInPrompt: systemText.includes('Available teammate souls'),
    soulPolicyInPrompt: systemText.includes('Delegation is soul-only'),
    baseSubagentAdviceInPrompt: systemText.includes('Use the names returned by subagent, subagent_fork'),
    envScrub,
    environmentScrubbed: Object.values(envScrub).every(Boolean),
    latestCalls: latestAssistantCalls(messages),
  })
  if (!calls.includes('spawn_teammate')) {
    return toolChunks([{
      name: 'spawn_teammate',
      args: {
        name: 'probe-1',
        description: 'Probe the soul runtime facts.',
        prompt: 'SOUL_PROBE_TASK: report your persona, allowed tools, and routed model.',
        agent_type: 'probe',
      },
    }])
  }
  return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
}

/** The teammate spawned by the user-invocable slash command. */
function commandTeammateChunks(options: GenerateOptions): StreamChunk[] {
  const messages = messagesOf(options)
  const system = systemTextOf(options, messages)
  observe({
    kind: 'teammate-command',
    identity: identityOf(messages),
    model: options.model,
    tools: options.tools.map(tool => tool.name),
    personaOk: system.includes('You are the command-line probe'),
    markerOk: system.includes('COMMAND_SOUL_MARKER'),
  })
  return textChunks('Command soul teammate complete.')
}

/** The shipped adversarial verifier spawned through the real Soul path. */
function verifierChunks(options: GenerateOptions): StreamChunk[] {
  const messages = messagesOf(options)
  const system = systemTextOf(options, messages)
  const tools = options.tools.map(tool => tool.name)
  const expected = expectedSoulTools(
    LIVE_SHELL_TOOL, 'read', 'grep', 'glob', 'read_image', 'working_directory', 'skill',
  )
  const observation = {
    kind: 'verifier',
    identity: identityOf(messages),
    model: options.model,
    provider: options.provider,
    reasoningEffort: options.reasoningEffort,
    tools,
    personaOk: system.includes('You are the delegated teammate "adversarial-red-team-verifier".'),
    markerOk: system.includes('Be skeptical, precise, calm, and fair.'),
    toolsOk: JSON.stringify([...tools].sort()) === JSON.stringify(expected),
    modelOk: options.provider === 'kimi-code-bridge'
      && options.model === 'k3.1-pro'
      && options.reasoningEffort === 'max',
  }
  observe(observation)
  const result = `VERIFIER_RESULT persona=${observation.personaOk} marker=${observation.markerOk} tools=${observation.toolsOk} model=${observation.modelOk} route=${options.provider}/${options.model} effort=${options.reasoningEffort}`
  if (!toolCallNames(messages).includes('send_message')) {
    return toolChunks([{ name: 'send_message', args: { agent: 'lead', message: result } }])
  }
  return textChunks('Verifier complete.')
}

/** Resolve and invoke one model-facing tool directly, without an LLM round trip. */
async function invokeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const agent = runtime.agents.list().find((candidate: any) => candidate.session?.header?.parentSession === undefined)
  if (agent === undefined) throw new Error('no live Lead Agent')
  const signal = new AbortController().signal
  let modelSelection
  try { modelSelection = agent.model.current() } catch { modelSelection = undefined }
  const toolSet = await runtime.tools.resolve({
    agent,
    modelSelection: modelSelection ?? { provider: 'deepseek-official', model: 'deepseek-flash' },
    signal,
  })
  try {
    const batch = await runtime.tools.execute({
      agent,
      toolSet,
      signal,
      calls: [{
        type: 'tool-call',
        id: ToolCallId(`orchestrator-${++nextCall}`),
        name,
        arguments: JSON.stringify(args),
      }],
    })
    return JSON.stringify(batch.results?.[0]?.result ?? batch.results ?? null)
  } finally {
    toolSet.dispose()
  }
}

/**
 * Activate the real orchestrator command with Team mode off, then prove stock
 * delegation is denied at the tool layer and a raw activation is denied at the
 * admission fence. Team is restored before the real verifier is spawned.
 */
async function runOrchestratorProbe(): Promise<void> {
  if (orchestratorAttempted) return
  orchestratorAttempted = true
  const observation: Record<string, unknown> = { kind: 'orchestrator' }
  let lead
  try {
    const agents = runtime.agents.list()
    lead = agents.find((agent: any) => agent.session?.header?.parentSession === undefined)
    observation.leadFound = lead !== undefined
    if (lead === undefined) throw new Error('no live Lead Agent')
    await runtime.agentTeams.setEnabled(lead, false)
    observation.teamDisabledBeforeActivation = runtime.agentTeams.isEnabled(lead) === false
    const executed = await runtime.commands.execute(
      lead,
      '/orchestrate',
      [],
      new AbortController().signal,
    )
    observation.executed = {
      kind: executed?.result?.kind ?? null,
      text: executed?.result?.text ?? null,
    }
    observation.teamStillDisabled = runtime.agentTeams.isEnabled(lead) === false

    observation.childrenBeforeStock = (await runtime.subagents.listDescendants(lead.id)).length
    const stockResults: Record<string, string> = {}
    for (const name of ['subagent', 'subagent_fork']) {
      try {
        stockResults[name] = await invokeTool(name, {
          description: 'Orchestrator guard probe.',
          prompt: 'This child must never be created while orchestrator mode is active.',
        })
      } catch (error) {
        stockResults[name] = `THREW: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    observation.stockResults = stockResults
    observation.stockDenied = Object.values(stockResults).every(value =>
      value.includes('Generic subagent tools are disabled while orchestrator mode is active')
      || value.includes('Generic subagent tools are disabled for Team members'))
    observation.stockChildCount = (await runtime.subagents.listDescendants(lead.id)).length

    let rawBypass
    try {
      rawBypass = await runtime.subagents.startActivation({
        provider: 'spawn',
        label: 'Raw activation bypass probe',
        name: 'raw-bypass',
        prompt: [{ type: 'text', text: 'This child must never be admitted without a Soul plan.' }],
        parent: lead,
        delivery: 'parent',
        signal: new AbortController().signal,
      })
      observation.rawBypassRejected = false
      observation.rawBypassChild = rawBypass?.childId ?? null
    } catch (error) {
      observation.rawBypassRejected = true
      observation.rawBypassError = error instanceof Error ? error.message : String(error)
    }

  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error)
  } finally {
    if (lead !== undefined) {
      try {
        if (runtime.agentTeams.isEnabled(lead) !== true) await runtime.agentTeams.setEnabled(lead, true)
        observation.teamRestored = runtime.agentTeams.isEnabled(lead) === true
      } catch (error) {
        observation.teamRestoreError = error instanceof Error ? error.message : String(error)
      }
    }
  }
  orchestratorObservation = observation
  observe(observation)
}

/** Ask the Lead's command registry for the user-invocable soul and execute it once. */
async function runCommandProbe(peer: string): Promise<void> {
  if (commandAttempted) return
  commandAttempted = true
  const observation: Record<string, unknown> = { kind: 'command', peer: peer.slice(0, 80) }
  try {
    const agents = runtime?.agents?.list?.() ?? []
    const lead = agents.find((agent: any) => agent.session?.header?.parentSession === undefined) ?? agents[0]
    observation.leadFound = lead !== undefined
    const descriptors = await runtime.commands.list(lead)
    const names = descriptors.map((descriptor: any) => descriptor.name)
    observation.commands = names
    observation.registered = names.includes('probe-cli')
    // The built-in orchestrator command is part of the plugin's surface: the
    // runner asserts its presence explicitly instead of relying on incidental
    // output that merely mentioned /orchestrate.
    observation.orchestrateRegistered = names.includes('orchestrate')
    if (observation.registered === true) {
      const executed = await runtime.commands.execute(
        lead,
        '/probe-cli SMOKE_COMMAND_TASK: report through your soul.',
        [],
        new AbortController().signal,
      )
      observation.executed = {
        kind: executed?.result?.kind ?? null,
        text: executed?.result?.text ?? null,
      }
    }
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error)
  }
  commandObservation = observation
  observe(observation)
}

class SoulSmokeAdapter extends LlmAdapter {
  async resolveModel(provider: string, model: string): Promise<Record<string, unknown>> {
    const base = { provider, id: model, name: model }
    if (provider === 'kimi-code-bridge' && model === 'k3.1-pro') {
      return { ...base, reasoning: { efforts: [{ id: 'max', name: 'Max' }] } }
    }
    return base
  }

  async listModels(provider: string): Promise<{ provider: string, id: string, name: string }[]> {
    if (provider === 'kimi-code-bridge') {
      return [{ provider, id: 'k3.1-pro', name: 'K3.1 Pro' }]
    }
    return [
      { provider, id: 'deepseek-flash', name: 'DeepSeek Flash' },
      { provider, id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ]
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const identity = identityOf(messagesOf(options))
    const isRoot = identity.startsWith('You are the root agent.')
    const peer = peerText(messagesOf(options))
    let probeRanNow = false
    if (isRoot && peer.includes('SOUL_PROBE_RESULT')) {
      if (!orchestratorAttempted) {
        await runOrchestratorProbe()
        probeRanNow = true
      }
      await runCommandProbe(peer)
    }
    let chunks: StreamChunk[]
    if (isRoot) chunks = leadChunks(options, !probeRanNow)
    else if (identity.includes('Your name is "probe-1".')) chunks = teammateChunks(options)
    else if (identity.includes('Your name is "probe-cli".')) chunks = commandTeammateChunks(options)
    else if (identity.includes('Your name is "verifier-1".')) chunks = verifierChunks(options)
    // Title generation and other non-Agent model calls carry no subagent
    // identity; answer them with harmless text instead of failing the run.
    else chunks = textChunks('Agent Soul smoke assistant.')
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name. */
export const name = 'soul-smoke-llm'
/** Services the scripted adapter observes through its own context. */
export const inject = ['llm', 'agents', 'commands', 'agentTeams', 'subagents', 'tools']

/** Register the keyless adapter on the shipped default provider route. */
export function apply(ctx: any): void {
  runtime = ctx
  ctx.llm.registerAdapter(['deepseek-official', 'kimi-code-bridge'], new SoulSmokeAdapter())
}
