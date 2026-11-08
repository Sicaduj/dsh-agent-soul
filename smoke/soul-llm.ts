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
  return context?.source?.sections?.find(section => section.name === 'team:identity')?.text ?? ''
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
    personaOk: system.includes('You are the delegated teammate "probe".'),
    markerOk: system.includes('SOUL_PROBE_MARKER'),
    toolsOk: JSON.stringify([...tools].sort()) === JSON.stringify(expectedSoulTools('read', 'grep', 'glob')),
    modelOk: options.model === 'deepseek-v4-pro',
  }
  observe(observation)
  const result = `SOUL_PROBE_RESULT persona=${observation.personaOk} marker=${observation.markerOk} tools=${observation.toolsOk} model=${observation.modelOk} model_id=${options.model} tool_names=${tools.join(',')}`
  if (!toolCallNames(messages).includes('send_message')) {
    return toolChunks([{ name: 'send_message', args: { target: 'lead', message: result } }])
  }
  return textChunks('Probe complete.')
}

/** The Team Lead: spawn the soul teammate, wait, and surface its report. */
function leadChunks(options: GenerateOptions): StreamChunk[] {
  const messages = messagesOf(options)
  const peer = peerText(messages)
  if (peer.includes('SOUL_PROBE_RESULT')) {
    return textChunks(`SOUL_SMOKE_OK ${peer.trim()} COMMAND=${JSON.stringify(commandObservation)}`)
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
    spawnHasAgentType: spawnProperties !== undefined && Object.hasOwn(spawnProperties, 'agent_type'),
    hasListSouls: listTool !== undefined,
    catalogInPrompt: systemTextOf(options, messages).includes('Available teammate souls'),
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
    personaOk: system.includes('You are the delegated teammate "probe-cli".'),
    markerOk: system.includes('COMMAND_SOUL_MARKER'),
  })
  return textChunks('Command soul teammate complete.')
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
  async listModels(provider: string): Promise<{ provider: string, id: string, name: string }[]> {
    return [
      { provider, id: 'deepseek-flash', name: 'DeepSeek Flash' },
      { provider, id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ]
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const identity = identityOf(messagesOf(options))
    let chunks: StreamChunk[]
    if (identity.startsWith('You are the Team Lead named "lead".')) chunks = leadChunks(options)
    else if (identity.startsWith('You are teammate "probe-1".')) chunks = teammateChunks(options)
    else if (identity.startsWith('You are teammate "probe-cli".')) chunks = commandTeammateChunks(options)
    else throw new Error(`soul smoke: unrecognized team identity ${JSON.stringify(identity)}`)
    if (identity.startsWith('You are the Team Lead named "lead".')
      && peerText(messagesOf(options)).includes('SOUL_PROBE_RESULT')) {
      await runCommandProbe(peerText(messagesOf(options)))
      chunks = leadChunks(options)
    }
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name. */
export const name = 'soul-smoke-llm'
/** Services the scripted adapter observes through its own context. */
export const inject = ['llm', 'agents', 'commands']

/** Register the keyless adapter on the shipped default provider route. */
export function apply(ctx: any): void {
  runtime = ctx
  ctx.llm.registerAdapter(['deepseek-official'], new SoulSmokeAdapter())
}
