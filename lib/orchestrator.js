/**
 * Orchestrator soul: one optional Lead-scoped doctrine document plus the
 * session-scoped runtime that applies it.
 *
 * The rest of this plugin gives a delegated teammate its persona, tool matrix,
 * and model. This module is the mirror image for the Team Lead: one Markdown
 * document (`<dirname(bindingsFile)>/orchestrator.md`) describes how the Lead
 * plans, delegates, tracks state, verifies work, and recovers from failures, and
 * may override the Lead's model and visible tools — but only after a human runs
 * `/orchestrate` in that session. The mode is durable because it lives in the
 * session log (`command/run` events), not in this process; enabling applies the
 * doctrine through the Lead's Agent scope, and disabling removes it again.
 *
 * A workspace file always wins. When the workspace has none, the doctrine
 * shipped inside this package (`defaults/orchestrator.md`) is used instead so
 * `/orchestrate` works immediately after installation in any workspace; set
 * `bundled: false` to require a workspace-owned file.
 *
 * The document layer is deliberately shaped like `lib/admin.js`: parse/split,
 * compose/validate, read/save, and a summary for the GUI overview. Every write is
 * atomic (temporary file in the same directory + `rename`), creates missing
 * parent directories, and refuses a symbolic-link escape out of the state
 * directory.
 *
 * The runtime is deliberately shaped like `lib/apply.js`: one `agent.ctx.effect`
 * bundle owns every registration (the persona section, the five doctrine prompt
 * sections, the extra-markdown section, the tool restriction), so disabling
 * removes all of them together. The model selection is the one thing an effect
 * cannot restore by itself: the first explicit enable remembers
 * `agent.model.current()`, and disabling selects it again. A reapply after
 * plugin activation or Lead creation must not re-capture the value it just
 * selected.
 *
 * @module @local/dsh-agent-soul/orchestrator
 */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ORCHESTRATE_COMMAND_NAME,
  orchestratorModeFold,
  orchestratorModeInit,
  orchestratorModeNext,
  orchestratorModeOf,
} from './orchestrator-mode.js'
import { parseFrontmatter } from './soul.js'

/** Default bindings document when the composition did not configure one. */
const DEFAULT_BINDINGS_FILE = join('.dsh', 'agent-soul', 'bindings.json')

/** Name of the one orchestrator document beside the bindings document. */
const ORCHESTRATOR_FILE_NAME = 'orchestrator.md'

/**
 * The doctrine shipped inside this package, used when a workspace has no
 * `orchestrator.md` of its own. Resolved from this module's own URL so the
 * package may be linked, copied into a profile, or run from a source checkout.
 * @type {string}
 */
export const BUNDLED_ORCHESTRATOR_PATH = fileURLToPath(new URL('../defaults/orchestrator.md', import.meta.url))

/**
 * Whether packaged bundled content is enabled for one normalized config.
 * @param {{ bundled?: unknown } | undefined} config
 * @returns {boolean}
 */
function bundledEnabled(config) {
  return config?.bundled !== false
}

/** Document name used when the frontmatter omits it. */
const DEFAULT_ORCHESTRATOR_NAME = 'orchestrator'

/** Valid document name: lower-kebab-case (mirrors the soul document layer). */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Maximum document name length (mirrors the soul document layer). */
const MAX_NAME_CHARS = 64

/** Largest accepted `max-retries` value. */
const MAX_RETRIES = 10

/** The three accepted `gate-mode` values. */
const GATE_MODES = new Set(['strict', 'advisory', 'off'])

/** Tool names may carry namespace separators (`mcp__server__tool`). */
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

/** The Lead persona section this mode shadows (the same name `lib/apply.js` uses). */
const PERSONA_SECTION_NAME = 'deployment:persona-prefix'

/** Central prompt-order placement names read from the system-prompt service. */
const PERSONA_ORDER_NAME = 'DEPLOYMENT_PERSONA_PREFIX'
const TEAM_POLICY_ORDER_NAME = 'TEAM_POLICY'

/** Re-exported from the shared mode fold so existing importers keep this surface. */
export { ORCHESTRATE_COMMAND_NAME }

/** Exact Session title applied on a successful explicit activation. */
export const ORCHESTRATOR_SESSION_TITLE = 'orchestrator'

/**
 * Fixed Lead-persona wording installed by the runtime.
 *
 * The document's editable `identity` section is appended after it, so editing
 * the document can add boundaries but never remove the runtime role or the
 * soul-only delegation rule.
 */
export const ORCHESTRATOR_FIXED_IDENTITY = [
  'You are the ORCHESTRATOR of this session.',
  'You lead the Agent Team under the fixed internal target "lead": you own the plan, the delegation, the verification, and the final answer.',
  'Delegate only to defined Agent Souls through spawn_teammate. If no soul matches the task, omit agent_type so the configured default Soul applies; never use subagent or subagent_fork, and never start a child without a Soul.',
  'This runtime identity is fixed; editing the orchestrator document may add boundaries but cannot remove it.',
].join(' ')

/** Short model-facing identity line for the activation announcement. */
const ORCHESTRATOR_ANNOUNCEMENT_IDENTITY = 'Lead "lead" operating as the session orchestrator (internal Team target stays "lead")'

/** Body marker that separates canonical sections from preserved extra markdown. */
const EXTRA_MARKER = '<!-- orchestrator:extra -->'

/** A YAML plain scalar this layer is willing to emit without quoting. */
const PLAIN_SCALAR_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9 _.,;()/@+-]*$/u

/** Values a plain YAML scalar would parse as something other than a string. */
const NON_STRING_SCALAR_PATTERN = /^(?:true|True|TRUE|false|False|FALSE|null|Null|NULL|~|-?(?:0|[1-9]\d*)(?:\.\d+)?)$/u

/** A line that opens a body heading (one or two `#`). */
const HEADING_PATTERN = /^(#{1,2})[ \t]+(.+?)[ \t]*#*[ \t]*$/u

/** Known template variables substituted at apply time. */
const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/gu

/** Known template variable names; every other token stays literal. */
const TEMPLATE_VARIABLES = new Set(['maxRetries', 'gateMode', 'planFirst', 'pauseOnFatal', 'catalog'])

/** Monotonic suffix so two writes in the same millisecond never share a temp name. */
let temporaryCounter = 0

/**
 * Per-exact-Lead promise tail serializing `/orchestrate` handler work.
 *
 * Two overlapping command executions can otherwise both observe the first
 * command's still-pending `command/run` and mistake it for durable state.
 * Only this command handler participates; unrelated commands are unaffected.
 * A WeakMap keeps no Agent alive after it is released.
 *
 * @type {WeakMap<object, Promise<void>>}
 */
const orchestrateHandlerTails = new WeakMap()

/**
 * Canonical body sections in composition order.
 *
 * `identity` is not registered as a separate prompt section: its text is placed at the
 * deployment-persona order, after the harness's configured deployment persona-prefix line.
 * The other five become `orchestrator:*` sections.
 *
 * @type {ReadonlyArray<{ key: string, title: string, aliases: readonly string[],
 *   sectionName: string | null, orderOffset: number }>}
 */
const SECTION_DEFINITIONS = Object.freeze([
  {
    key: 'identity',
    title: 'Identity & Boundaries',
    aliases: ['identity & boundaries', 'identity and boundaries', 'identity', 'boundaries', 'role & boundaries', 'role and boundaries'],
    sectionName: null,
    orderOffset: 0,
  },
  {
    key: 'plan',
    title: 'Plan Generation',
    aliases: ['plan generation', 'planning', 'plan'],
    sectionName: 'orchestrator:plan',
    orderOffset: -100,
  },
  {
    key: 'delegation',
    title: 'Delegation & Context Minimization',
    aliases: ['delegation & context minimization', 'delegation and context minimization', 'delegation', 'context minimization', 'delegation & context'],
    sectionName: 'orchestrator:delegation',
    orderOffset: 10,
  },
  {
    key: 'state',
    title: 'State Tracking',
    aliases: ['state tracking', 'state'],
    sectionName: 'orchestrator:state',
    orderOffset: 20,
  },
  {
    key: 'verification',
    title: 'Quality Verification',
    aliases: ['quality verification', 'verification', 'quality'],
    sectionName: 'orchestrator:verification',
    orderOffset: 30,
  },
  {
    key: 'recovery',
    title: 'Exception & Recovery',
    aliases: ['exception & recovery', 'exception and recovery', 'exception handling', 'recovery'],
    sectionName: 'orchestrator:recovery',
    orderOffset: 40,
  },
])

/** Prompt-order offset of the preserved extra-markdown section (after the five). */
const EXTRA_SECTION_ORDER_OFFSET = 50

/** Lowercased heading text -> canonical section key. */
const SECTION_TITLE_TO_KEY = (() => {
  /** @type {Map<string, string>} */
  const map = new Map()
  /** @param {string} text @returns {string} */
  const normalize = (text) => text.replace(/\s+/gu, ' ').trim().toLowerCase().replace(/\s*&\s*/gu, ' & ')
  for (const definition of SECTION_DEFINITIONS) {
    map.set(normalize(definition.title), definition.key)
    for (const alias of definition.aliases) map.set(normalize(alias), definition.key)
  }
  return map
})()

/**
 * Human-readable message for one arbitrary thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether one value is a plain (non-array) object.
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether one parsed frontmatter mapping owns a key.
 * @param {Record<string, unknown>} data
 * @param {string} key
 * @returns {boolean}
 */
function has(data, key) {
  return Object.prototype.hasOwnProperty.call(data, key)
}

/**
 * Read one display string, coercing non-strings and treating absent values as ''.
 * @param {unknown} value
 * @returns {string}
 */
function textOf(value) {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value.trim() : String(value)
}

/**
 * Log one warning through an optional logger, swallowing logger failures.
 * @param {{ warn?: (message: string) => void } | undefined} logger
 * @param {string} message
 * @returns {void}
 */
function warn(logger, message) {
  try {
    if (typeof logger?.warn === 'function') logger.warn(`agent-soul: ${message}`)
  } catch {
    // Logging must never break an orchestrator operation.
  }
}

/**
 * The absolute workspace root relative specs resolve against.
 * @param {unknown} root
 * @returns {string}
 */
function baseRoot(root) {
  return typeof root === 'string' && root.trim() !== '' ? resolve(root) : process.cwd()
}

/**
 * Whether `target` is inside `base` (or equal to it) on the lexical path.
 * @param {string} base
 * @param {string} target
 * @returns {boolean}
 */
function within(base, target) {
  const rel = relative(resolve(base), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * `realpath` that answers null instead of throwing.
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function realpathOrNull(path) {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/**
 * Resolve every existing ancestor symlink while allowing a missing suffix.
 * An existing path that cannot be resolved (including a dangling symlink) is
 * unsafe rather than equivalent to a missing path.
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function realpathWithMissing(path) {
  let cursor = resolve(path)
  /** @type {string[]} */
  const suffix = []
  while (true) {
    const real = await realpathOrNull(cursor)
    if (real !== null) return join(real, ...suffix)
    const info = await lstatOrNull(cursor)
    if (info !== null) return null
    const parent = dirname(cursor)
    if (parent === cursor) return null
    suffix.unshift(basename(cursor))
    cursor = parent
  }
}

/**
 * `stat` that answers null instead of throwing.
 * @param {string} path
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function statOrNull(path) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

/**
 * `lstat` that answers null instead of throwing.
 * @param {string} path
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

/**
 * Render one YAML scalar: plain when unambiguously a string, else a JSON quoted string.
 * @param {unknown} value
 * @returns {string}
 */
function yamlScalar(value) {
  const text = (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))
    .replace(/\r\n?/gu, '\n')
    .trim()
  if (text !== '' && PLAIN_SCALAR_PATTERN.test(text) && !NON_STRING_SCALAR_PATTERN.test(text)) return text
  return text === '' ? '""' : JSON.stringify(text)
}

/**
 * Atomic UTF-8 write: temp file in the target directory, then `rename`.
 * @param {string} target - absolute file path whose parent directory exists.
 * @param {string} source
 * @returns {Promise<void>}
 */
async function writeAtomic(target, source) {
  const directory = dirname(target)
  temporaryCounter += 1
  const temporary = join(directory, `${basename(target)}.${process.pid}.${temporaryCounter}.tmp`)
  await writeFile(temporary, source, 'utf8')
  try {
    await rename(temporary, target)
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {
      // The rename failure is the meaningful error; cleaning up is best-effort.
    }
    throw error
  }
}

/** @returns {Record<string, unknown>} fresh editable field defaults. */
function defaultFields() {
  return {
    name: DEFAULT_ORCHESTRATOR_NAME,
    model: '',
    provider: '',
    reasoningEffort: '',
    tools: '*',
    planFirst: false,
    gateMode: 'off',
    maxRetries: 0,
    pauseOnFatal: false,
  }
}

/** @returns {Record<string, string>} fresh editable section defaults. */
function defaultSections() {
  return {
    identity: '',
    plan: '',
    delegation: '',
    state: '',
    verification: '',
    recovery: '',
    extraMarkdown: '',
  }
}

/**
 * Render one raw tools declaration as the editable comma-separated text form.
 * `'*'` = inherit every tool; `''` = deny every inherited tool.
 * @param {unknown} value
 * @returns {string}
 */
function toolsText(value) {
  if (value === undefined || value === null) return '*'
  if (typeof value === 'string') return value.trim() === '' ? '' : value
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    if (value.length === 1 && value[0] === '*') return '*'
    return value.map(item => (typeof item === 'string' ? item.trim() : String(item))).join(', ')
  }
  return String(value)
}

/**
 * Normalize the editable tools text into what the composer should emit.
 * @param {unknown} value - `fields.tools` (or a raw frontmatter value).
 * @returns {{ kind: 'inherit' } | { kind: 'none' } | { kind: 'list', items: string[] }}
 */
function toolsForCompose(value) {
  if (value === undefined || value === null) return { kind: 'inherit' }
  /** @type {string[]} */
  const parts = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === undefined || item === null) continue
      parts.push(typeof item === 'string' ? item.trim() : String(item))
    }
  } else {
    parts.push(...String(value).split(',').map(item => item.trim()))
  }
  /** @type {string[]} */
  const items = []
  for (const part of parts) {
    if (part === '' || items.includes(part)) continue
    items.push(part)
  }
  if (items.length === 0) return { kind: 'none' }
  if (items.length === 1 && items[0] === '*') return { kind: 'inherit' }
  return { kind: 'list', items }
}

/**
 * Best-effort summary form of one raw tools declaration.
 * @param {unknown} value
 * @returns {string[] | null} null = inherits every tool.
 */
function toolsForSummary(value) {
  const composed = toolsForCompose(value)
  if (composed.kind === 'inherit') return null
  if (composed.kind === 'none') return []
  return composed.items
}

/**
 * Strict form of the `tools` field: null = every tool, [] = no inherited tool.
 * @param {unknown} value
 * @returns {string[] | null}
 * @throws {Error} when the declaration is not `*`, a comma-separated string, or a sequence.
 */
function normalizeTools(value) {
  /** @param {unknown} item @returns {string} */
  const toolName = (item) => {
    if (typeof item !== 'string') throw new Error('must contain only strings')
    const name = item.trim()
    if (name === '') throw new Error('must not contain empty tool names')
    if (name === '*') throw new Error('must not mix "*" with tool names')
    if (!TOOL_NAME_PATTERN.test(name)) throw new Error(`invalid tool name "${name}"`)
    return name
  }
  if (typeof value === 'string') {
    if (value.trim() === '*') return null
    const items = value.split(',').map(item => item.trim()).filter(item => item !== '')
    if (items.length === 0) throw new Error('must not be empty')
    /** @type {string[]} */
    const names = []
    for (const item of items) {
      const name = toolName(item)
      if (!names.includes(name)) names.push(name)
    }
    return names
  }
  if (Array.isArray(value)) {
    if (value.length === 1 && value[0] === '*') return null
    /** @type {string[]} */
    const names = []
    for (const item of value) {
      const name = toolName(item)
      if (!names.includes(name)) names.push(name)
    }
    return names
  }
  throw new Error('must be "*", a comma-separated string, or a sequence of tool names')
}

/**
 * Normalize a heading line's title for alias lookup.
 * @param {string} title
 * @returns {string}
 */
function normalizeHeadingTitle(title) {
  return title.replace(/\s+/gu, ' ').trim().toLowerCase().replace(/\s*&\s*/gu, ' & ')
}

/**
 * The canonical section key of one body line, when it is a canonical heading.
 * @param {string} line
 * @returns {string | null}
 */
function canonicalKeyOf(line) {
  const match = HEADING_PATTERN.exec(line)
  if (match === null) return null
  return SECTION_TITLE_TO_KEY.get(normalizeHeadingTitle(match[2])) ?? null
}

/**
 * Split one body into the six canonical sections plus preserved extra markdown.
 *
 * A canonical heading (first occurrence only) starts its section. Every other
 * heading — a non-canonical title, a duplicate canonical title, or anything
 * before the first canonical heading — starts or continues `extraMarkdown`, so
 * "any other body content" is preserved as extras instead of being silently
 * folded into the last section. Because extras can be plain paragraphs with no
 * heading at all, the composer writes an explicit marker before them; after that
 * marker the rest of the body is extra markdown even if it contains canonical
 * headings. The composer appends the recovered extras after the canonical
 * sections, which makes "save then reopen" stable after one composition.
 *
 * @param {string} body
 * @returns {{ identity: string, plan: string, delegation: string, state: string,
 *   verification: string, recovery: string, extraMarkdown: string }}
 */
function splitBody(body) {
  /** @type {Record<string, string>} */
  const sections = defaultSections()
  /** @type {Map<string, string[]>} */
  const buffers = new Map()
  const extra = []
  /** @type {string[] | null} */
  let current = null
  let locked = false
  const seen = new Set()
  for (const line of String(body ?? '').split(/\r?\n/)) {
    if (line.trim() === EXTRA_MARKER) {
      locked = true
      current = null
      continue
    }
    if (!locked) {
      const match = HEADING_PATTERN.exec(line)
      if (match !== null) {
        const key = canonicalKeyOf(line)
        if (key !== null && !seen.has(key)) {
          seen.add(key)
          const lines = []
          buffers.set(key, lines)
          current = lines
          continue
        }
        // Any other heading opens the extras block; a later canonical heading
        // resumes the canonical sections (only the explicit marker locks extras).
        current = null
        extra.push(line)
        continue
      }
    }
    if (current === null) extra.push(line)
    else current.push(line)
  }
  for (const [key, lines] of buffers) sections[key] = lines.join('\n').trim()
  sections.extraMarkdown = extra.join('\n').trim()
  return sections
}

/**
 * Compose the body from the editable sections, canonical order, extras last.
 * @param {{ identity?: unknown, plan?: unknown, delegation?: unknown, state?: unknown,
 *   verification?: unknown, recovery?: unknown, extraMarkdown?: unknown }} sections
 * @returns {string} the body text (no frontmatter, no trailing newline).
 */
function composeBody(sections) {
  /** @param {unknown} value @returns {string} */
  const sectionText = (value) => (typeof value === 'string' ? value.replace(/\r\n?/gu, '\n').trim() : '')
  /** @type {string[]} */
  const blocks = []
  for (const definition of SECTION_DEFINITIONS) {
    const text = sectionText(sections?.[definition.key])
    if (text !== '') blocks.push(`## ${definition.title}\n\n${text}`)
  }
  const extra = sectionText(sections?.extraMarkdown)
  if (extra !== '') blocks.push(`${EXTRA_MARKER}\n\n${extra}`)
  return blocks.join('\n\n')
}

/**
 * Render one boolean frontmatter value, preserving malformed input so the
 * parser's own diagnostic refuses the save.
 * @param {unknown} value
 * @returns {string}
 */
function booleanForCompose(value) {
  if (value === true || value === 'true') return 'true'
  if (value === false || value === 'false' || value === undefined || value === null || value === '') return 'false'
  return JSON.stringify(String(value))
}

/**
 * Render `gate-mode`, preserving malformed input as a quoted string.
 * @param {unknown} value
 * @returns {string}
 */
function gateModeForCompose(value) {
  const text = textOf(value).toLowerCase()
  if (GATE_MODES.has(text)) return text
  if (text === '') return 'off'
  return JSON.stringify(text)
}

/**
 * Render `max-retries`, preserving malformed input as a quoted string.
 * @param {unknown} value
 * @returns {string}
 */
function maxRetriesForCompose(value) {
  if (value === undefined || value === null || value === '') return '0'
  const number = typeof value === 'number' ? value : Number(String(value).trim())
  if (Number.isInteger(number) && number >= 0 && number <= MAX_RETRIES) return String(number)
  return JSON.stringify(String(value))
}

/**
 * Compose the complete Markdown source from editable fields and sections.
 * @param {Record<string, unknown>} fields
 * @param {Record<string, unknown>} sections
 * @returns {string}
 */
function composeSource(fields, sections) {
  const lines = ['---']
  // An omitted name is the documented default; an explicitly empty one is a
  // validation error so clearing the editor field cannot save silently.
  const name = fields?.name === undefined || fields?.name === null
    ? DEFAULT_ORCHESTRATOR_NAME
    : textOf(fields.name)
  lines.push(`name: ${yamlScalar(name)}`)
  const model = textOf(fields?.model)
  if (model !== '') lines.push(`model: ${yamlScalar(model)}`)
  const provider = textOf(fields?.provider)
  if (provider !== '') lines.push(`provider: ${yamlScalar(provider)}`)
  const reasoningEffort = textOf(fields?.reasoningEffort)
  if (reasoningEffort !== '') lines.push(`reasoning-effort: ${yamlScalar(reasoningEffort)}`)
  const tools = toolsForCompose(fields?.tools)
  if (tools.kind === 'list') {
    lines.push('tools:')
    for (const item of tools.items) lines.push(`  - ${yamlScalar(item)}`)
  } else if (tools.kind === 'none') {
    lines.push('tools: []')
  }
  lines.push(`plan-first: ${booleanForCompose(fields?.planFirst)}`)
  lines.push(`gate-mode: ${gateModeForCompose(fields?.gateMode)}`)
  lines.push(`max-retries: ${maxRetriesForCompose(fields?.maxRetries)}`)
  lines.push(`pause-on-fatal: ${booleanForCompose(fields?.pauseOnFatal)}`)
  lines.push('---')
  const body = composeBody(sections)
  const frontmatter = lines.join('\n')
  return body === '' ? `${frontmatter}\n` : `${frontmatter}\n\n${body}\n`
}

/**
 * Best-effort editable fields from one parsed frontmatter mapping.
 * @param {Record<string, unknown> | null} data
 * @returns {Record<string, unknown>}
 */
function fieldsFromFrontmatter(data) {
  const fields = defaultFields()
  if (!isRecord(data)) return fields
  if (has(data, 'name') && data.name !== null) fields.name = textOf(data.name)
  fields.model = textOf(data.model)
  fields.provider = textOf(data.provider)
  fields.reasoningEffort = textOf(data['reasoning-effort'])
  fields.tools = toolsText(data.tools)
  if (has(data, 'plan-first') && data['plan-first'] !== null) fields.planFirst = data['plan-first'] === true
  if (has(data, 'gate-mode') && data['gate-mode'] !== null) {
    const mode = textOf(data['gate-mode']).toLowerCase()
    fields.gateMode = GATE_MODES.has(mode) ? mode : textOf(data['gate-mode'])
  }
  if (has(data, 'max-retries') && data['max-retries'] !== null) {
    fields.maxRetries = typeof data['max-retries'] === 'number' ? data['max-retries'] : textOf(data['max-retries'])
  }
  if (has(data, 'pause-on-fatal') && data['pause-on-fatal'] !== null) {
    fields.pauseOnFatal = data['pause-on-fatal'] === true
  }
  return fields
}

/**
 * The body text after the frontmatter block, best-effort even when it is malformed.
 * @param {string} text
 * @param {{ data: Record<string, unknown> | null, body: string }} parsed
 * @returns {string}
 */
function bodyTextOf(text, parsed) {
  if (parsed.data !== null) return parsed.body
  const lines = String(text).replace(/^\uFEFF/u, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return text
  // A missing closing delimiter is reported through diagnostics; keep the
  // remaining lines editable instead of discarding the whole document.
  return lines.slice(1).join('\n')
}

/**
 * Analyze one orchestrator document: validate the strict frontmatter/body subset
 * and return both the parsed definition and the editable split.
 *
 * @param {unknown} source - complete file text.
 * @returns {{ definition?: object, fields: Record<string, unknown>,
 *   sections: Record<string, string>, valid: boolean,
 *   diagnostics: { message: string, field?: string }[] }}
 *   `definition` is present only when the document is valid.
 */
function analyzeOrchestrator(source) {
  const text = typeof source === 'string' ? source.replace(/^\uFEFF/u, '') : ''
  /** @type {{ message: string, field?: string }[]} */
  const diagnostics = []
  let valid = true
  /** @param {string} message @param {string} [field] */
  const fail = (message, field) => {
    valid = false
    diagnostics.push(field === undefined ? { message } : { message, field })
  }

  const parsed = parseFrontmatter(text)
  const fields = fieldsFromFrontmatter(parsed.data)
  const sections = splitBody(bodyTextOf(text, parsed))

  if (parsed.data === null) {
    if (parsed.errors.length === 0) {
      diagnostics.push({ message: 'missing YAML frontmatter (expected a "---" block at the top of the file)' })
    }
    for (const error of parsed.errors) diagnostics.push({ message: error })
    return { fields, sections, valid: false, diagnostics }
  }
  for (const error of parsed.errors) diagnostics.push({ message: error })
  if (parsed.errors.length > 0) return { fields, sections, valid: false, diagnostics }

  const data = parsed.data
  let name = DEFAULT_ORCHESTRATOR_NAME
  if (has(data, 'name') && data.name !== null) {
    if (typeof data.name !== 'string' || data.name.trim() === '') {
      fail('name: must be a non-empty string', 'name')
    } else {
      name = data.name.trim()
      if (name.length > MAX_NAME_CHARS) fail(`name: must be at most ${MAX_NAME_CHARS} characters`, 'name')
      else if (!NAME_PATTERN.test(name)) fail('name: must be kebab-case (^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$)', 'name')
    }
  }

  /** @param {string} key @param {string} field @param {string} label @returns {string} */
  const optionalString = (key, field, label) => {
    if (!has(data, key) || data[key] === null) return ''
    if (typeof data[key] !== 'string' || data[key].trim() === '') {
      fail(`${label}: must be a non-empty string`, field)
      return ''
    }
    return data[key].trim()
  }
  const model = optionalString('model', 'model', 'model')
  const provider = optionalString('provider', 'provider', 'provider')
  const reasoningEffort = optionalString('reasoning-effort', 'reasoningEffort', 'reasoningEffort')

  let tools = null
  if (has(data, 'tools') && data.tools !== null) {
    try {
      tools = normalizeTools(data.tools)
    } catch (error) {
      fail(`tools: ${messageOf(error)}`, 'tools')
    }
  }

  /** @param {string} key @param {string} label @param {boolean} fallback @returns {boolean} */
  /** @param {string} key @param {string} field @param {string} label @param {boolean} fallback
   * @returns {boolean} */
  const optionalBoolean = (key, field, label, fallback) => {
    if (!has(data, key) || data[key] === null) return fallback
    if (typeof data[key] !== 'boolean') {
      fail(`${label}: must be true or false`, field)
      return fallback
    }
    return data[key]
  }
  const planFirst = optionalBoolean('plan-first', 'planFirst', 'planFirst', false)
  const pauseOnFatal = optionalBoolean('pause-on-fatal', 'pauseOnFatal', 'pauseOnFatal', false)

  let gateMode = 'off'
  if (has(data, 'gate-mode') && data['gate-mode'] !== null) {
    if (typeof data['gate-mode'] !== 'string') {
      fail('gateMode: must be "strict", "advisory", or "off"', 'gateMode')
    } else {
      const mode = data['gate-mode'].trim().toLowerCase()
      if (GATE_MODES.has(mode)) gateMode = mode
      else fail('gateMode: must be "strict", "advisory", or "off"', 'gateMode')
    }
  }

  let maxRetries = 0
  if (has(data, 'max-retries') && data['max-retries'] !== null) {
    if (!Number.isInteger(data['max-retries']) || data['max-retries'] < 0 || data['max-retries'] > MAX_RETRIES) {
      fail(`maxRetries: must be an integer from 0 through ${MAX_RETRIES}`, 'maxRetries')
    } else {
      maxRetries = data['max-retries']
    }
  }

  // Declaration-level route consistency: the same conflicts the activation
  // resolver rejects, but decidable from the document alone. Running them here
  // makes every caller (read/detail, summary, source and fields saves, the GUI,
  // and the Lead tool) agree without requiring a live LLM catalog.
  const slash = model.indexOf('/')
  if (slash > 0) {
    const prefix = model.slice(0, slash)
    const rest = model.slice(slash + 1)
    if (rest === '') fail(`model: soul model "${model}" has an empty model id`, 'model')
    else if (provider !== '' && provider !== prefix) {
      fail(`model: soul model "${model}" conflicts with provider "${provider}"`, 'model')
    }
  }
  if (model === '' && provider !== '') {
    fail('provider: soul "provider" requires "model"', 'provider')
  }
  // A reasoning effort without a model/provider is deliberately NOT a document
  // conflict: activation returns "inherit the Lead route" when both are absent
  // (resolveOrchestratorModel) and the effort is ignored, so rejecting the
  // declaration here would make read/save validation disagree with activation
  // and would invalidate long-lived inherited-route documents that only carried
  // an effort hint. Only a declared model makes the effort meaningful, and that
  // live-catalog check belongs to orchestratorRouteDiagnostics().

  const body = parsed.body.trim()
  if (body === '') fail('body: missing markdown body after the frontmatter block', 'body')

  if (!valid) return { fields, sections, valid: false, diagnostics }
  return {
    definition: {
      name,
      model,
      provider,
      reasoningEffort,
      tools,
      planFirst,
      gateMode,
      maxRetries,
      pauseOnFatal,
      body,
      sections,
    },
    fields,
    sections,
    valid: true,
    diagnostics,
  }
}

/**
 * Split one orchestrator document into editable parts.
 *
 * Never throws: a malformed frontmatter block or body is reported through
 * `diagnostics`, while the best-effort fields and sections stay editable.
 *
 * @param {unknown} source - complete file text.
 * @returns {{ fields: Record<string, unknown>, sections: Record<string, string>,
 *   valid: boolean, diagnostics: { message: string, field?: string }[] }}
 */
export function splitOrchestrator(source) {
  try {
    const analyzed = analyzeOrchestrator(source)
    return {
      fields: analyzed.fields,
      sections: analyzed.sections,
      valid: analyzed.valid,
      diagnostics: analyzed.diagnostics,
    }
  } catch (error) {
    return {
      fields: defaultFields(),
      sections: defaultSections(),
      valid: false,
      diagnostics: [{ message: `cannot split the orchestrator document: ${messageOf(error)}` }],
    }
  }
}

/**
 * Compose and validate one orchestrator document from editable parts.
 * @param {{ fields?: Record<string, unknown>, sections?: Record<string, unknown> } | undefined} input
 * @returns {{ source: string, valid: boolean, diagnostics: { message: string, field?: string }[] }}
 */
export function composeOrchestrator(input) {
  const fields = isRecord(input?.fields) ? input.fields : {}
  const sections = isRecord(input?.sections) ? input.sections : {}
  const source = composeSource(fields, sections)
  const analyzed = analyzeOrchestrator(source)
  return { source, valid: analyzed.valid, diagnostics: analyzed.diagnostics }
}

/**
 * The default document offered when no orchestrator file exists yet.
 *
 * It is valid by construction and demonstrates the template variables without
 * baking any deployment-specific model or tool names in. The six canonical
 * sections are present so the editor opens fully populated.
 *
 * @returns {string} complete Markdown source.
 */
export function canonicalOrchestratorSkeleton() {
  return composeOrchestrator({
    fields: {
      name: DEFAULT_ORCHESTRATOR_NAME,
      model: '',
      provider: '',
      reasoningEffort: '',
      tools: '*',
      planFirst: true,
      gateMode: 'advisory',
      maxRetries: 3,
      pauseOnFatal: true,
    },
    sections: {
      identity:
        'You are the orchestrator for this session. You own the plan, the delegation, and the final answer; you do not do every task yourself. Replace this paragraph with the boundaries of the role.',
      plan:
        'Plan generation: enabled = {{planFirst}}. Before acting, split the task into verifiable steps, name the owner of each step, and record the plan in the task list. Keep the plan current as work returns.',
      delegation:
        'Delegate context-minimized work to the available teammate souls. Give each teammate one self-contained task, the exact scope of files it owns, and the acceptance check to run. Every child must run a defined Agent Soul: pass agent_type when a soul matches, and omit it when none does so the configured default Soul applies. Never use subagent or subagent_fork. Never delegate the final synthesis.\n\nAvailable souls:\n\n{{catalog}}',
      state:
        'Track state with shared tasks: claim work with the current revision, mark it in progress, and complete it with the evidence that satisfied the acceptance check. Re-list before waiting; never poll.',
      verification:
        'Verify before reporting: gate mode = {{gateMode}}. Read the final diff, run the relevant tests, and check every claim a teammate returned against the repository. A teammate saying it passed is not evidence.',
      recovery:
        'On failure, stop and diagnose before retrying: max retries = {{maxRetries}}, pause on fatal = {{pauseOnFatal}}. Retry only with a changed hypothesis; otherwise escalate the concrete blocker to the person with the file path and command output.',
      extraMarkdown: '',
    },
  }).source
}

/** Resolve the document, its state directory, and its configured boundary. */
function orchestratorLocationOf(config, root) {
  const base = baseRoot(root)
  const spec = typeof config?.bindingsFile === 'string' && config.bindingsFile.trim() !== ''
    ? config.bindingsFile.trim()
    : DEFAULT_BINDINGS_FILE
  const relativeSpec = !isAbsolute(spec)
  const bindingsFile = relativeSpec ? resolve(base, spec) : resolve(spec)
  const stateDirectory = dirname(bindingsFile)
  return {
    base,
    relativeSpec,
    stateDirectory,
    path: join(stateDirectory, ORCHESTRATOR_FILE_NAME),
  }
}

/**
 * The absolute orchestrator document path for one workspace root.
 *
 * It lives beside the resolved bindings document — the plugin's one state
 * directory — so the default configuration yields
 * `<root>/.dsh/agent-soul/orchestrator.md`. This is the writable workspace
 * location; when it does not exist and `bundled` is enabled, the doctrine is
 * read from {@link BUNDLED_ORCHESTRATOR_PATH} instead.
 *
 * @param {{ bindingsFile?: unknown } | undefined} config - normalized plugin config.
 * @param {unknown} root - workspace root for a relative bindings file.
 * @returns {string} absolute path (the file may not exist).
 */
export function orchestratorPathOf(config, root) {
  return orchestratorLocationOf(config, root).path
}

/**
 * The detail payload for a document that does not exist yet (the GET skeleton).
 * @param {string} path
 * @returns {object}
 */
function skeletonDetail(path) {
  const source = canonicalOrchestratorSkeleton()
  const analyzed = analyzeOrchestrator(source)
  return {
    path,
    configured: false,
    bundled: false,
    sourcePath: null,
    source,
    valid: analyzed.valid,
    diagnostics: analyzed.diagnostics,
    fields: analyzed.fields,
    sections: analyzed.sections,
  }
}

/**
 * Read the packaged default doctrine as the effective definition for one
 * workspace target path.
 *
 * The detail keeps `path` as the writable workspace location (so a GUI save
 * creates the workspace override) and reports the read-only origin through
 * `bundled: true` and `sourcePath`. Absence or unreadability of the packaged
 * asset answers `null`, leaving the caller's skeleton behaviour unchanged.
 *
 * @param {string} targetPath - the workspace definition path this read stands in for.
 * @param {{ bundled?: unknown } | undefined} config
 * @returns {Promise<{ ok: true, orchestrator: object } | null>}
 */
async function readBundledOrchestrator(targetPath, config) {
  if (!bundledEnabled(config)) return null
  let info
  let source
  try {
    info = await stat(BUNDLED_ORCHESTRATOR_PATH)
    if (!info.isFile()) return null
    source = await readFile(BUNDLED_ORCHESTRATOR_PATH, 'utf8')
  } catch {
    // A package installed without the defaults behaves exactly like a workspace
    // with no definition; the caller reports the canonical skeleton.
    return null
  }
  const analyzed = analyzeOrchestrator(source)
  return {
    ok: true,
    orchestrator: {
      path: targetPath,
      configured: true,
      bundled: true,
      sourcePath: BUNDLED_ORCHESTRATOR_PATH,
      source,
      valid: analyzed.valid,
      diagnostics: analyzed.diagnostics,
      fields: analyzed.fields,
      sections: analyzed.sections,
    },
  }
}

/**
 * Read the one orchestrator document for a workspace root.
 *
 * A missing workspace file is not an error. With `bundled` enabled (the
 * default) the packaged default doctrine is the effective document; otherwise
 * the answer is `configured: false` with the canonical skeleton so the GUI can
 * open the editor or create the file from the same source it would have shown.
 *
 * @param {{ config?: object, root?: string } | undefined} options
 * @returns {Promise<{ ok: true, orchestrator: object } |
 *   { ok: false, code: 'unsafe-path' | 'invalid-request', message: string }>}
 */
export async function readOrchestrator(options = {}) {
  const path = orchestratorPathOf(options.config, options.root)
  const safe = await checkOrchestratorPath(options.config, options.root)
  if (!safe.ok) return safe
  let info
  let source
  try {
    info = await stat(path)
    source = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      const bundled = await readBundledOrchestrator(path, options.config)
      return bundled ?? { ok: true, orchestrator: skeletonDetail(path) }
    }
    return { ok: false, code: 'invalid-request', message: `cannot read the orchestrator definition: ${messageOf(error)}` }
  }
  if (!info.isFile()) {
    return { ok: false, code: 'unsafe-path', message: `the orchestrator path is not a regular file: ${path}` }
  }
  const analyzed = analyzeOrchestrator(source)
  return {
    ok: true,
    orchestrator: {
      path,
      configured: true,
      bundled: false,
      sourcePath: path,
      source,
      valid: analyzed.valid,
      diagnostics: analyzed.diagnostics,
      fields: analyzed.fields,
      sections: analyzed.sections,
    },
  }
}

/**
 * Validate the shared read/write path before any document I/O.
 *
 * A relative bindings file is workspace-owned: both its lexical path and its
 * real path (including existing ancestors of a missing suffix) must remain in
 * the real workspace root. An absolute bindings file explicitly places the
 * state directory outside the workspace, so its real state directory is the
 * boundary instead. In either case an existing final link must resolve to a
 * regular file inside the real state directory.
 *
 * @param {object | undefined} config
 * @param {unknown} root
 * @param {{ stateMustExist?: boolean }} [options]
 * @returns {Promise<{ ok: true } | { ok: false, code: 'unsafe-path', message: string }>}
 */
async function checkOrchestratorPath(config, root, options = {}) {
  const location = orchestratorLocationOf(config, root)
  const { base, relativeSpec, stateDirectory, path } = location
  const unsafe = message => ({ ok: false, code: 'unsafe-path', message })
  if (!path.toLowerCase().endsWith('.md')) {
    return unsafe(`the orchestrator path must end with .md: ${path}`)
  }
  if (relativeSpec && !within(base, stateDirectory)) {
    return unsafe(`the relative orchestrator state path escapes its workspace: ${stateDirectory}`)
  }

  const realBase = relativeSpec ? await realpathOrNull(base) : null
  if (relativeSpec && realBase === null) {
    return unsafe(`cannot resolve the real orchestrator workspace root: ${base}`)
  }
  const stateInfo = await lstatOrNull(stateDirectory)
  const realState = await realpathOrNull(stateDirectory)
  if (stateInfo !== null) {
    const targetInfo = await statOrNull(stateDirectory)
    if (realState === null || targetInfo === null || !targetInfo.isDirectory()) {
      return unsafe(`the orchestrator state path is not a resolvable directory: ${stateDirectory}`)
    }
  }
  if (options.stateMustExist === true && realState === null) {
    return unsafe(`the orchestrator state directory does not exist after creation: ${stateDirectory}`)
  }
  const resolvedState = realState ?? await realpathWithMissing(stateDirectory)
  if (resolvedState === null) {
    return unsafe(`cannot resolve the real orchestrator state directory: ${stateDirectory}`)
  }
  if (relativeSpec && !within(realBase, resolvedState)) {
    return unsafe(`the orchestrator state path escapes the real workspace through a symbolic link: ${stateDirectory}`)
  }

  const info = await lstatOrNull(path)
  if (info === null) return { ok: true }
  const targetInfo = await statOrNull(path)
  const realTarget = await realpathOrNull(path)
  if (realState === null || realTarget === null || targetInfo === null || !targetInfo.isFile()) {
    return unsafe(`the orchestrator path is not a regular file: ${path}`)
  }
  if (!within(realState, realTarget)) {
    return unsafe(`the orchestrator path escapes its real state directory through a symbolic link: ${path}`)
  }
  return { ok: true }
}

/**
 * Normalize one caller-supplied `validate(definition)` result into diagnostics.
 *
 * The contract mirrors the soul document layer (`lib/admin.js`): the callback may
 * be synchronous or asynchronous and may return `undefined`, an array of
 * `{ message, field? }` records or plain strings, or a `{ diagnostics }` record.
 * A callback that throws is treated as a refusal (never as a write), so a
 * validator bug cannot become an unhandled failure.
 *
 * @param {((definition: object) => unknown) | undefined} validate
 * @param {object} definition - the parsed definition the save would write.
 * @returns {Promise<{ message: string, field?: string }[]>} normalized diagnostics.
 */
async function validationDiagnostics(validate, definition) {
  if (typeof validate !== 'function') return []
  /** @type {unknown} */
  let result
  try {
    result = await validate(definition)
  } catch (error) {
    return [{ message: `cannot validate the orchestrator definition: ${messageOf(error)}` }]
  }
  const items = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.diagnostics) ? result.diagnostics : []
  /** @type {{ message: string, field?: string }[]} */
  const diagnostics = []
  for (const item of items) {
    if (typeof item === 'string') {
      const message = item.trim()
      if (message !== '') diagnostics.push({ message })
      continue
    }
    if (!isRecord(item)) continue
    const message = typeof item.message === 'string' ? item.message.trim() : ''
    if (message === '') continue
    /** @type {{ message: string, field?: string }} */
    const diagnostic = { message }
    if (typeof item.field === 'string' && item.field.trim() !== '') diagnostic.field = item.field.trim()
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

/**
 * Validate route declarations against the live LLM catalog.
 *
 * This is the second validation layer for saves: `analyzeOrchestrator` proves the
 * declaration is internally consistent, and this function proves a live
 * deployment can actually serve it. The GUI and the Lead tool pass it as
 * `saveOrchestrator`'s `validate` callback when a model resolver is available.
 * Without a resolver it reports nothing, so a document save never depends on the
 * LLM service and a complete `provider/model` route keeps working without one.
 *
 * Declaration conflicts (a full route plus a different `provider`, a provider
 * without a model, an empty model id) are the document layer's business and
 * deliberately not repeated here: this layer only distinguishes the routes a
 * catalog rejects from the routes a document contradicts. A `reasoning-effort`
 * without any model/provider is ignored at activation (the Lead route is
 * inherited), so it is not validated here either.
 *
 * @param {object | undefined} definition - the parsed definition being saved.
 * @param {((raw: object) => Promise<object | undefined>) | undefined} resolveModel
 *   the live route resolver (`deps.resolveModel`).
 * @returns {Promise<{ field: string, message: string }[]>} field-tagged diagnostics:
 *   `model` (or `provider` when only a provider is declared) for an unresolvable
 *   route, and `reasoningEffort` for an unsupported or unverifiable effort.
 */
export async function orchestratorRouteDiagnostics(definition, resolveModel) {
  if (typeof resolveModel !== 'function') return []
  /** @type {{ field: string, message: string }[]} */
  const diagnostics = []
  const model = typeof definition?.model === 'string' ? definition.model : ''
  const provider = typeof definition?.provider === 'string' ? definition.provider : ''
  const reasoningEffort = typeof definition?.reasoningEffort === 'string' ? definition.reasoningEffort : ''
  if (model !== '' || provider !== '') {
    /** @type {{ model?: string, provider?: string }} */
    const raw = {}
    if (model !== '') raw.model = model
    if (provider !== '') raw.provider = provider
    let modelResolved = true
    try {
      const resolved = await resolveModel(raw)
      if (resolved === null || resolved === undefined) {
        throw new Error('the model declaration could not be resolved to a registered route')
      }
    } catch (error) {
      modelResolved = false
      diagnostics.push({ field: model !== '' ? 'model' : 'provider', message: messageOf(error) })
    }
    // Only check the effort against a model that already resolved; otherwise the
    // model diagnostic above is the actionable one.
    if (modelResolved && reasoningEffort !== '') {
      try {
        await resolveModel({ ...raw, reasoningEffort })
      } catch (error) {
        diagnostics.push({ field: 'reasoningEffort', message: messageOf(error) })
      }
    }
  }
  // No model/provider: activation inherits the Lead route and ignores the
  // effort, so there is nothing this live layer can validate.
  return diagnostics
}

/**
 * Compose, validate, and atomically write the orchestrator document.
 *
 * Accepts either complete raw Markdown (`source`, validated and written
 * verbatim) or editable `fields`/`sections` (composed first). The parent
 * directory is created on demand; validation failures write nothing.
 *
 * The optional `validate(definition)` callback is the caller's semantic layer
 * (for example {@link orchestratorRouteDiagnostics} with a live catalog). It runs
 * after the document layer accepts the definition and before any path check or
 * write, and a non-empty result refuses the save unchanged.
 *
 * @param {{ config?: object, root?: string, source?: unknown,
 *   fields?: Record<string, unknown>, sections?: Record<string, unknown>,
 *   validate?: (definition: object) => unknown } | undefined} options
 * @returns {Promise<{ ok: true, orchestrator: object } |
 *   { ok: false, code: 'invalid' | 'unsafe-path' | 'invalid-request',
 *     message: string, diagnostics?: { message: string, field?: string }[] }>}
 */
export async function saveOrchestrator(options = {}) {
  const path = orchestratorPathOf(options.config, options.root)
  const hasSource = options.source !== undefined && options.source !== null
  /** @param {{ message: string, field?: string }[]} diagnostics */
  const invalid = diagnostics => ({
    ok: false,
    code: 'invalid',
    message: 'the orchestrator definition is invalid and was not saved',
    diagnostics,
  })
  /** @type {string} */
  let source
  /** @type {object} */
  let definition
  if (hasSource) {
    if (typeof options.source !== 'string') {
      return { ok: false, code: 'invalid-request', message: 'source must be a string' }
    }
    const analyzed = analyzeOrchestrator(options.source)
    if (!analyzed.valid || analyzed.definition === undefined) return invalid(analyzed.diagnostics)
    definition = analyzed.definition
    source = options.source
  } else {
    if (!isRecord(options.fields) && !isRecord(options.sections)) {
      return { ok: false, code: 'invalid-request', message: 'source, or fields and sections, are required' }
    }
    const composed = composeOrchestrator({
      fields: isRecord(options.fields) ? options.fields : {},
      sections: isRecord(options.sections) ? options.sections : {},
    })
    if (!composed.valid) return invalid(composed.diagnostics)
    // The composed source is the authoritative document: analyze it to hand the
    // caller the same definition a later read would report.
    const analyzed = analyzeOrchestrator(composed.source)
    if (!analyzed.valid || analyzed.definition === undefined) return invalid(analyzed.diagnostics)
    definition = analyzed.definition
    source = composed.source
  }
  // Semantic validation runs before any path check or write: a refused
  // definition must leave even an unsafe target untouched.
  const semantic = await validationDiagnostics(options.validate, definition)
  if (semantic.length > 0) return invalid(semantic)
  const safe = await checkOrchestratorPath(options.config, options.root)
  if (!safe.ok) return safe
  try {
    await mkdir(dirname(path), { recursive: true })
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-request',
      message: `cannot write the orchestrator definition: ${messageOf(error)}`,
    }
  }
  // Directory creation can traverse a changed or newly visible symlink. Check
  // the now-real state directory again before creating the temporary file.
  const createdSafe = await checkOrchestratorPath(options.config, options.root, { stateMustExist: true })
  if (!createdSafe.ok) return createdSafe
  try {
    await writeAtomic(path, source)
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-request',
      message: `cannot write the orchestrator definition: ${messageOf(error)}`,
    }
  }
  return readOrchestrator({ config: options.config, root: options.root })
}

/**
 * Resolve an optional model declaration for the summary block.
 * Every failure degrades to null; the overview can never fail on a model lookup.
 *
 * @param {{ resolveModel?: (raw: object) => Promise<object | undefined> } | undefined} deps
 * @param {Record<string, unknown>} fields
 * @returns {Promise<string | null>}
 */
async function summaryModelResolved(deps, fields) {
  const model = textOf(fields.model)
  const provider = textOf(fields.provider)
  if (model === '' || typeof deps?.resolveModel !== 'function') return null
  const reasoningEffort = textOf(fields.reasoningEffort)
  /** @type {Record<string, unknown>} */
  const raw = { model }
  if (provider !== '') raw.provider = provider
  if (reasoningEffort !== '') raw.reasoningEffort = reasoningEffort
  try {
    const resolved = await deps.resolveModel(raw)
    if (!isRecord(resolved) || typeof resolved.provider !== 'string' || typeof resolved.model !== 'string') return null
    return `${resolved.provider}/${resolved.model}`
  } catch {
    return null
  }
}

/**
 * The compact orchestrator block shown in the GUI overview.
 *
 * Shaped for the page: `configured` says whether the file exists, `valid` says
 * whether it would apply, and the remaining fields are display values (the
 * skeleton's defaults when absent). A read failure is reported as an invalid,
 * unconfigured-looking block instead of failing the whole overview.
 *
 * @param {{ config?: object, root?: string, resolveModel?: (raw: object) => Promise<object | undefined>,
 *   logger?: { warn(message: string): void } } | undefined} options
 * @returns {Promise<object>}
 */
export async function orchestratorSummary(options = {}) {
  const path = orchestratorPathOf(options.config, options.root)
  /** @returns {object} */
  const failureBlock = (configured, message) => ({
    path,
    configured,
    bundled: false,
    sourcePath: null,
    valid: false,
    name: DEFAULT_ORCHESTRATOR_NAME,
    model: '',
    modelResolved: null,
    tools: null,
    planFirst: false,
    gateMode: 'off',
    maxRetries: 0,
    pauseOnFatal: false,
    diagnostics: [{ message }],
  })
  /** @type {{ ok: boolean, orchestrator?: object, code?: string, message?: string }} */
  let read
  try {
    read = await readOrchestrator({ config: options.config, root: options.root })
  } catch (error) {
    warn(options.logger, `cannot read the orchestrator summary: ${messageOf(error)}`)
    return failureBlock((await statOrNull(path)) !== null, `cannot read the orchestrator definition: ${messageOf(error)}`)
  }
  if (!read.ok) {
    const info = await statOrNull(path)
    return failureBlock(info !== null && info.isFile(), read.message ?? 'cannot read the orchestrator definition')
  }
  const document = read.orchestrator
  const fields = isRecord(document.fields) ? document.fields : defaultFields()
  const valid = document.valid === true
  return {
    path: document.path,
    configured: document.configured === true,
    bundled: document.bundled === true,
    sourcePath: typeof document.sourcePath === 'string' ? document.sourcePath : null,
    valid,
    name: textOf(fields.name) || DEFAULT_ORCHESTRATOR_NAME,
    model: textOf(fields.model),
    // An invalid document must never advertise a resolved route, even when the
    // resolver would accept its declaration: the diagnostics are the actionable
    // output and the file would not enable.
    modelResolved: valid ? await summaryModelResolved(options, fields) : null,
    tools: toolsForSummary(fields.tools),
    planFirst: fields.planFirst === true,
    gateMode: GATE_MODES.has(textOf(fields.gateMode).toLowerCase()) ? textOf(fields.gateMode).toLowerCase() : 'off',
    maxRetries: Number.isInteger(fields.maxRetries) ? fields.maxRetries : 0,
    pauseOnFatal: fields.pauseOnFatal === true,
    diagnostics: Array.isArray(document.diagnostics) ? document.diagnostics : [],
  }
}

/**
 * Substitute the documented template variables in one doctrine text.
 *
 * `{{maxRetries}}`, `{{gateMode}}`, `{{planFirst}}`, `{{pauseOnFatal}}`, and
 * `{{catalog}}` are replaced; every other `{{token}}` stays literal so a
 * doctrine can talk about template syntax without the plugin eating it.
 *
 * @param {unknown} text
 * @param {Record<string, unknown>} [variables]
 * @returns {string}
 */
export function substituteTemplate(text, variables = {}) {
  return String(text ?? '').replace(TEMPLATE_VARIABLE_PATTERN, (token, name) => {
    if (!TEMPLATE_VARIABLES.has(name) || !Object.prototype.hasOwnProperty.call(variables, name)) return token
    const value = variables[name]
    if (value === undefined || value === null) return ''
    return typeof value === 'string' ? value : String(value)
  })
}

/**
 * Dispose one value that may be a function, a Cordis Fiber, or a disposable object.
 * @param {unknown} disposable
 * @returns {void}
 */
function safeDispose(disposable) {
  try {
    /** @type {unknown} */
    let result
    if (typeof disposable === 'function') result = disposable()
    else if (disposable !== null && typeof disposable === 'object'
      && typeof /** @type {{ dispose?: unknown }} */ (disposable).dispose === 'function') {
      result = /** @type {{ dispose: () => unknown }} */ (disposable).dispose()
    }
    if (result !== null && typeof result === 'object' && typeof /** @type {{ then?: unknown }} */ (result).then === 'function') {
      /** @type {{ then: (onFulfilled?: unknown, onRejected?: unknown) => unknown }} */ (result)
        .then(undefined, () => {})
    }
  } catch {
    // Disposal is best-effort; the Agent scope also owns its registrations.
  }
}

/**
 * Copy one model selection into a plain object; undefined when absent.
 * @param {object} agent
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | undefined}
 */
function captureModelSelection(agent) {
  const current = agent?.model?.current?.()
  if (!isRecord(current) || typeof current.provider !== 'string' || typeof current.model !== 'string') return undefined
  /** @type {{ provider: string, model: string, reasoningEffort?: string }} */
  const selection = { provider: current.provider, model: current.model }
  if (typeof current.reasoningEffort === 'string' && current.reasoningEffort !== '') {
    selection.reasoningEffort = current.reasoningEffort
  }
  return selection
}

/**
 * Apply one model selection, swallowing failures only when the caller can
 * continue without it (restoration).
 * @param {object} agent
 * @param {object | undefined} selection
 * @returns {boolean} whether a selection was applied.
 */
function selectModel(agent, selection) {
  if (!isRecord(selection) || typeof selection.provider !== 'string' || typeof selection.model !== 'string') return false
  agent.model.select(selection)
  return true
}

/**
 * Resolve the optional session-title service from one Agent scope.
 *
 * The service is optional: headless compositions may not mount it, and title
 * renaming must never make orchestrator mode unusable. Both the direct
 * `agent.ctx.sessionTitle` property and the scoped `get()` lookup are read so
 * Cordis contexts and test doubles behave the same way.
 *
 * @param {object} agent
 * @returns {object | undefined}
 */
function sessionTitleServiceOf(agent) {
  if (agent === null || typeof agent !== 'object') return undefined
  try {
    const direct = agent.ctx?.sessionTitle
    if (direct !== undefined && direct !== null) return direct
  } catch {
    // An unavailable service accessor falls through to the get() lookup.
  }
  try {
    return typeof agent.ctx?.get === 'function' ? agent.ctx.get('sessionTitle') : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the optional session-title service can read and rename titles.
 * @param {object} agent
 * @returns {boolean}
 */
function hasSessionTitleService(agent) {
  const service = sessionTitleServiceOf(agent)
  return service !== undefined && typeof service.get === 'function' && typeof service.rename === 'function'
}

/**
 * Read the current Session title without failing the caller.
 * @param {object} agent
 * @returns {string | undefined}
 */
function currentSessionTitle(agent) {
  const service = sessionTitleServiceOf(agent)
  if (service === undefined || typeof service.get !== 'function') return undefined
  try {
    const snapshot = service.get(agent.session)
    return isRecord(snapshot) && typeof snapshot.title === 'string' && snapshot.title !== ''
      ? snapshot.title
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Rename the Session title through the optional session-title service.
 * @param {object} agent
 * @param {string} title
 * @returns {{ ok: boolean, skipped?: boolean, error?: string }}
 */
function renameSessionTitle(agent, title) {
  const service = sessionTitleServiceOf(agent)
  if (service === undefined || typeof service.rename !== 'function' || agent?.session === undefined) {
    return { ok: false, skipped: true }
  }
  try {
    service.rename(agent.session, title)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/**
 * Probe the tools list the way `lib/apply.js` does and return the names the
 * Agent's own scope can restrict.
 *
 * The probe registers a one-name restriction and lifts it immediately. Names
 * owned by the Agent scope (the Team tools this plugin registers there) throw,
 * so they stay visible instead of failing the whole enable. The caller applies
 * one final `restrict({ allow })` with the survivors.
 *
 * @param {object} agent
 * @param {string[]} names
 * @param {{ logger?: { warn(message: string): void } }} [deps]
 * @returns {{ restrictable: string[], skipped: string[] }}
 */
function probeRestrictableTools(agent, names, deps) {
  const tools = agent?.ctx?.tools
  if (tools === undefined || typeof tools.restrict !== 'function') {
    throw new Error('the Lead Agent does not expose a tool-restriction service')
  }
  /** @type {string[]} */
  const restrictable = []
  /** @type {string[]} */
  const skipped = []
  for (const name of names) {
    try {
      const liftProbe = tools.restrict({ allow: [name] })
      safeDispose(liftProbe)
      restrictable.push(name)
    } catch {
      skipped.push(name)
    }
  }
  if (skipped.length > 0) {
    warn(deps?.logger, `orchestrator tools: non-restrictable tool(s) stay visible: ${skipped.join(', ')}`)
  }
  return { restrictable, skipped }
}

/**
 * Read one positive order number from the system-prompt service, failing loudly
 * when the service is absent (enable must not half-apply).
 * @param {object} agent
 * @param {string} name
 * @returns {number}
 */
function sectionOrderOf(agent, name) {
  const systemPrompt = agent?.ctx?.systemPrompt
  if (systemPrompt === undefined || typeof systemPrompt.getSectionOrder !== 'function') {
    throw new Error('the Lead Agent does not expose a system-prompt service')
  }
  const order = systemPrompt.getSectionOrder(name)
  if (typeof order !== 'number' || !Number.isFinite(order)) {
    throw new Error(`the system-prompt service returned no order for "${name}"`)
  }
  return order
}

/**
 * Build the substituted prompt texts one active mode applies.
 *
 * @param {object} document - valid orchestrator detail.
 * @param {{ catalog?: { promptText?: (root: string) => string } } | undefined} deps
 * @param {string} root
 * @returns {{ identity: string, sections: { name: string, order: number, text: string }[] }}
 */
function promptPlanOf(document, deps, root) {
  const definition = document.definition
  const fields = document.fields
  let catalog = ''
  try {
    if (typeof deps?.catalog?.promptText === 'function') catalog = String(deps.catalog.promptText(root) ?? '')
  } catch {
    catalog = ''
  }
  const variables = {
    maxRetries: definition.maxRetries,
    gateMode: definition.gateMode,
    planFirst: definition.planFirst,
    pauseOnFatal: definition.pauseOnFatal,
    catalog,
  }
  const sections = document.sections
  const documentIdentity = substituteTemplate(sections.identity, variables)
  // The fixed runtime role is always first: an edited (or emptied) document
  // identity can add boundaries but never erase the orchestrator role.
  const identity = documentIdentity.trim() === ''
    ? ORCHESTRATOR_FIXED_IDENTITY
    : `${ORCHESTRATOR_FIXED_IDENTITY}\n\n${documentIdentity.trim()}`
  /** @type {{ name: string, order: number, text: string }[]} */
  const doctrine = []
  for (const section of SECTION_DEFINITIONS) {
    if (section.sectionName === null) continue
    const text = substituteTemplate(sections[section.key], variables)
    if (text.trim() === '') continue
    doctrine.push({ name: section.sectionName, order: 0, text })
  }
  const extra = substituteTemplate(sections.extraMarkdown, variables)
  if (extra.trim() !== '') doctrine.push({ name: 'orchestrator:extra', order: 0, text: extra })
  return { identity, sections: doctrine, variables }
}

/**
 * Resolve the optional model route declared by one definition.
 *
 * @param {object} document - valid orchestrator detail.
 * @param {{ resolveModel?: (raw: object, options?: { signal?: AbortSignal }) => Promise<object | undefined> } | undefined} deps
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<{ provider: string, model: string, reasoningEffort?: string } | null>}
 * @throws {Error} when the declaration cannot be resolved to one registered route.
 */
async function resolveOrchestratorModel(document, deps, signal) {
  const fields = document.fields
  const model = textOf(fields.model)
  const provider = textOf(fields.provider)
  if (model === '' && provider === '') return null
  if (typeof deps?.resolveModel !== 'function') {
    throw new Error('model routing is unavailable in this composition')
  }
  const reasoningEffort = textOf(fields.reasoningEffort)
  /** @type {Record<string, unknown>} */
  const raw = {}
  if (model !== '') raw.model = model
  if (provider !== '') raw.provider = provider
  if (reasoningEffort !== '') raw.reasoningEffort = reasoningEffort
  const resolved = await deps.resolveModel(raw, { signal })
  if (!isRecord(resolved) || typeof resolved.provider !== 'string' || typeof resolved.model !== 'string') {
    throw new Error('the orchestrator model declaration could not be resolved to a registered route')
  }
  /** @type {{ provider: string, model: string, reasoningEffort?: string }} */
  const route = { provider: resolved.provider, model: resolved.model }
  const effort = typeof resolved.reasoningEffort === 'string' && resolved.reasoningEffort !== ''
    ? resolved.reasoningEffort
    : reasoningEffort
  if (effort !== '') route.reasoningEffort = effort
  return route
}

/**
 * The per-agent runtime: owns the applied bundle and the durable-mode read.
 *
 * Returned API (all methods are safe to call on any agent):
 * - `modeOf(agent, options?)` → `'on' | 'off'` from the session log, optionally
 *   excluding one invocation's command id (pre-invocation state);
 * - `enable(agent)` → read, validate, resolve, and apply (captures the prior model);
 * - `disable(agent)` → dispose the bundle and restore the captured model;
 * - `reapplyIfActive(agent)` → apply only when the session log says `on`, without
 *   re-capturing the prior selection or Session title;
 * - `isActive(agent)` → whether a live bundle currently owns the Agent scope;
 * - `snapshot(agent)` / `restore(agent, snapshot)` → capture and exactly restore
 *   a live bundle for an operation that must roll back to its prior state;
 * - `disposeAgent(agent)` → drop the bundle for one Agent (no model restore);
 * - `dispose()` → drop every bundle and restore every captured model.
 *
 * @param {object} deps - shared plugin deps (`config`, `catalog`, `logger`,
 *   `rootOf`, `resolveModel`).
 * @returns {{ modeOf: (agent: object, options?: { excludeCommandId?: unknown }) => 'on' | 'off',
 *   enable: (agent: object, options?: { signal?: AbortSignal }) => Promise<object>,
 *   disable: (agent: object) => object,
 *   reapplyIfActive: (agent: object, options?: { signal?: AbortSignal }) => Promise<object>,
 *   isActive: (agent: object) => boolean,
 *   snapshot: (agent: object) => object | undefined,
 *   restore: (agent: object, snapshot: object | undefined) => boolean,
 *   disposeAgent: (agent: object) => void,
 *   dispose: () => void }}
 */
export function createOrchestratorRuntime(deps) {
  /** @type {Map<object, { dispose: () => void, plan?: object,
   *   previousModel?: { provider: string, model: string, reasoningEffort?: string },
   *   previousTitle?: string }>} */
  const bundles = new Map()
  /** @type {WeakMap<object, number>} */
  const generations = new WeakMap()
  let disposed = false

  /** Invalidate every earlier operation for this Agent. */
  function nextGeneration(agent) {
    const generation = (generations.get(agent) ?? 0) + 1
    generations.set(agent, generation)
    return generation
  }

  /** Start one async apply and wire abort to the same per-Agent fence. */
  function beginAsyncOperation(agent, signal) {
    const generation = nextGeneration(agent)
    const onAbort = () => {
      // An older invocation's late abort must not cancel a newer operation.
      if (generations.get(agent) === generation) generations.set(agent, generation + 1)
    }
    if (typeof signal?.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })
    return { generation, signal, onAbort }
  }

  function endAsyncOperation(operation) {
    if (typeof operation.signal?.removeEventListener === 'function') {
      operation.signal.removeEventListener('abort', operation.onAbort)
    }
  }

  function operationIsCurrent(agent, operation) {
    return !disposed && generations.get(agent) === operation.generation && operation.signal?.aborted !== true
  }

  function staleOperationResult() {
    return { ok: false, stale: true, error: 'the orchestrator operation was superseded, aborted, or disposed' }
  }

  /**
   * Durable mode for one agent, read from the Session log.
   *
   * The latest `/orchestrate` `command/run` decides: an off-word disables, and
   * every other argument form enables — either the bare command or a task
   * submitted with `/orchestrate <task>`. A recognized invocation whose paired
   * `command/done` settled as `error` did not change the mode (the definition
   * was missing/invalid or the task could not be queued), so it is skipped.
   * An unreadable log is `off`.
   *
   * This is the same pure fold the Host session projection runs
   * (`lib/orchestrator-mode.js`), so the durable read and the Session-header
   * badge cannot disagree.
   *
   * `excludeCommandId` answers the durable state *before* one invocation. The
   * real CommandsService appends the current `command/run` before invoking the
   * handler, so a command reading its own pending run would mistake a first
   * enable for pre-existing durable activity. Excluding that exact id folds
   * every earlier run and error normally; an absent option preserves the full
   * log (the genuinely no-current-run case).
   *
   * `settledOnly` computes pre-invocation state across overlapping commands:
   * a run without a paired `command/done` is still pending and must not be
   * treated as durable on-state, so only settled successful runs count.
   * Settled errors suppress their own run. The normal mode (default) keeps the
   * durable semantics where a pending enable already took effect.
   *
   * @param {object} agent
   * @param {{ excludeCommandId?: unknown, settledOnly?: boolean }} [options]
   * @returns {'on' | 'off'}
   */
  function modeOf(agent, options = {}) {
    const session = agent?.session
    if (session === undefined || session === null || typeof session.eventAt !== 'function') return 'off'
    const end = Number.isSafeInteger(session.seq) ? session.seq : 0
    let state = orchestratorModeInit()
    for (let seq = 0; seq <= end; seq += 1) {
      /** @type {any} */
      let event
      try {
        event = session.eventAt(seq)
      } catch {
        continue
      }
      state = orchestratorModeFold(state, event)
    }
    return orchestratorModeOf(state, options)
  }

  /**
   * Create the one effect bundle that owns every registration.
   *
   * The callback registers the persona section and each non-empty doctrine
   * section, applies the tool restriction, and selects the model. Registrations
   * are pushed onto `owned` before the next fallible step, so a throw unwinds
   * everything already registered and enable leaves no partial state.
   *
   * @param {object} agent
   * @param {{ identity: string, sections: { name: string, order: number, text: string }[],
   *   restrictable: string[] | null,
   *   route: { provider: string, model: string, reasoningEffort?: string } | null,
   *   previousModel?: { provider: string, model: string, reasoningEffort?: string },
   *   personaOrder: number, onFailure?: () => void }} plan
   * @returns {{ dispose: () => void }}
   */
  function createBundle(agent, plan) {
    /** @type {unknown[]} */
    const owned = []
    let finished = false
    /** @param {() => void} [onUnwind] */
    const dispose = (onUnwind) => {
      if (finished) return
      finished = true
      for (const disposable of owned.reverse()) safeDispose(disposable)
      if (typeof onUnwind === 'function') onUnwind()
    }
    const systemPrompt = agent.ctx.systemPrompt
    const tools = agent.ctx.tools
    let selected = false
    try {
      const effect = agent.ctx.effect(() => {
        if (plan.identity.trim() !== '') {
          owned.push(systemPrompt.section({
            name: PERSONA_SECTION_NAME,
            order: plan.personaOrder,
            text: plan.identity,
            interpolate: false,
          }))
        }
        for (const section of plan.sections) {
          owned.push(systemPrompt.section({
            name: section.name,
            order: section.order,
            text: section.text,
            interpolate: false,
          }))
        }
        if (plan.restrictable !== null) {
          owned.push(tools.restrict({ allow: [...plan.restrictable] }))
        }
        if (plan.route !== null) {
          agent.model.select(plan.route)
          selected = true
        }
        return () => dispose()
      })
      // Retain the scope-owned disposer in either Cordis/test-double form.
      // dispose() marks the bundle finished before invoking it, so the effect's
      // callback disposer re-enters as a no-op while this loop continues with
      // the nested registrations: outer and nested disposal each happen once.
      if (typeof effect === 'function') owned.push(effect)
      else if (effect !== null && typeof effect === 'object' && typeof effect.dispose === 'function') {
        owned.push(() => effect.dispose())
      }
      return { dispose: () => dispose() }
    } catch (error) {
      dispose(() => {
        if (selected && plan.previousModel !== undefined) {
          try {
            selectModel(agent, plan.previousModel)
          } catch {
            // The original failure is the actionable one.
          }
        }
      })
      throw error
    }
  }

  /**
   * Read, validate, resolve, and apply the document for one Lead.
   *
   * @param {object} agent
   * @param {{ capturePrevious: boolean, generation: number,
   *   signal?: AbortSignal, onAbort?: () => void }} options
   * @returns {Promise<object>}
   */
  async function applyTo(agent, options) {
    if (disposed) return { ok: false, error: 'the orchestrator runtime is disposed' }
    if (!operationIsCurrent(agent, options)) return staleOperationResult()
    const root = typeof deps?.rootOf === 'function' ? deps.rootOf(agent) : process.cwd()
    /** @type {{ ok: boolean, orchestrator?: object, code?: string, message?: string }} */
    let read
    try {
      read = await readOrchestrator({ config: deps?.config, root })
    } catch (error) {
      if (!operationIsCurrent(agent, options)) return staleOperationResult()
      return { ok: false, error: `cannot read the orchestrator definition: ${messageOf(error)}` }
    }
    if (!operationIsCurrent(agent, options)) return staleOperationResult()
    if (!read.ok) return { ok: false, error: read.message }
    const document = read.orchestrator
    if (document.configured !== true) {
      const bundledNote = deps?.config?.bundled === false
        ? ' (bundled defaults are disabled by config.bundled=false)'
        : ''
      return {
        ok: false,
        path: document.path,
        error: `no orchestrator definition exists at ${document.path}${bundledNote}; create it from Settings → Agent Soul`,
      }
    }
    if (document.valid !== true) {
      const first = Array.isArray(document.diagnostics) && document.diagnostics.length > 0
        ? document.diagnostics[0].message
        : 'unknown validation error'
      const origin = document.bundled === true && typeof document.sourcePath === 'string'
        ? `the bundled default orchestrator definition at ${document.sourcePath}`
        : `the orchestrator definition at ${document.path}`
      return {
        ok: false,
        path: document.path,
        bundled: document.bundled === true,
        error: `${origin} is invalid: ${first}; edit it in Settings → Agent Soul → Orchestrator`,
      }
    }
    // The public detail does not carry the parsed definition; re-analyze the
    // source (already validated above, so this cannot fail).
    const analyzed = analyzeOrchestrator(document.source)
    if (analyzed.definition === undefined) {
      return { ok: false, path: document.path, error: `the orchestrator definition at ${document.path} is invalid` }
    }
    const detail = { ...document, definition: analyzed.definition }
    const existing = bundles.get(agent)
    // Capture the pre-orchestrator Session title only for a genuine first
    // explicit enable. A replacement while the mode is active preserves the
    // title captured by that first enable; a reload-driven reapply captures
    // nothing because the title is already durable in the Session log.
    const titleBefore = options.renameTitle === true && existing === undefined
      ? currentSessionTitle(agent)
      : undefined
    const previousTitle = existing !== undefined
      ? existing.previousTitle
      : (options.renameTitle === true ? titleBefore : undefined)

    // Everything fallible is resolved before the current bundle is touched.
    /** @type {{ provider: string, model: string, reasoningEffort?: string } | null} */
    let route
    try {
      route = await resolveOrchestratorModel(detail, deps, options.signal)
    } catch (error) {
      if (!operationIsCurrent(agent, options)) return staleOperationResult()
      return { ok: false, path: document.path, error: `cannot apply the orchestrator model: ${messageOf(error)}` }
    }
    if (!operationIsCurrent(agent, options)) return staleOperationResult()
    /** @type {string[] | null} */
    let restrictable = null
    if (Array.isArray(analyzed.definition.tools)) {
      try {
        restrictable = probeRestrictableTools(agent, analyzed.definition.tools, deps).restrictable
      } catch (error) {
        return { ok: false, path: document.path, error: `cannot apply the orchestrator tools: ${messageOf(error)}` }
      }
    }
    /** @type {{ identity: string, sections: { name: string, order: number, text: string }[] }} */
    let promptPlan
    let personaOrder
    let teamPolicyOrder
    try {
      const plan = promptPlanOf(detail, deps, root)
      personaOrder = sectionOrderOf(agent, PERSONA_ORDER_NAME)
      teamPolicyOrder = sectionOrderOf(agent, TEAM_POLICY_ORDER_NAME)
      promptPlan = { identity: plan.identity, sections: plan.sections }
    } catch (error) {
      return { ok: false, path: document.path, error: `cannot apply the orchestrator prompt sections: ${messageOf(error)}` }
    }
    for (const section of promptPlan.sections) {
      if (section.name === 'orchestrator:extra') section.order = teamPolicyOrder + EXTRA_SECTION_ORDER_OFFSET
      else {
        const definition = SECTION_DEFINITIONS.find(candidate => candidate.sectionName === section.name)
        section.order = teamPolicyOrder + (definition?.orderOffset ?? EXTRA_SECTION_ORDER_OFFSET)
      }
    }

    if (!operationIsCurrent(agent, options)) return staleOperationResult()
    const carriedPrevious = existing?.previousModel
    // Capture the outgoing selection only for a genuine first enable. Re-enabling
    // or replacing a definition while the mode is already active must never
    // capture this runtime's own route as the original.
    /** @type {{ provider: string, model: string, reasoningEffort?: string } | undefined} */
    let capturedPrevious
    // Also capture when the active previous plan routed nothing: the currently
    // selected route is then still the genuine pre-orchestrator selection.
    const captureNow = route !== null && carriedPrevious === undefined && options.capturePrevious
      && (existing === undefined || existing.plan?.route == null)
    if (captureNow) {
      try {
        capturedPrevious = captureModelSelection(agent)
      } catch (error) {
        return { ok: false, path: document.path, error: `cannot read the current model selection: ${messageOf(error)}` }
      }
    }
    // Snapshot the selection for rollback: a failed replacement that already
    // selected its route must not leave that route behind. This is not the
    // durable "previous" capture (that one is only for an explicit first enable).
    /** @type {{ provider: string, model: string, reasoningEffort?: string } | undefined} */
    let selectionBeforeAttempt
    if (route !== null || existing !== undefined) {
      try {
        selectionBeforeAttempt = captureModelSelection(agent)
      } catch (error) {
        warn(deps?.logger, `cannot snapshot the Lead model before applying the orchestrator: ${messageOf(error)}`)
      }
    }
    const restoreSelectionBeforeAttempt = () => {
      if (selectionBeforeAttempt === undefined) return
      /** @type {{ provider: string, model: string, reasoningEffort?: string } | undefined} */
      let currentNow
      try {
        currentNow = captureModelSelection(agent)
      } catch {
        currentNow = undefined
      }
      const unchanged = currentNow !== undefined
        && currentNow.provider === selectionBeforeAttempt.provider
        && currentNow.model === selectionBeforeAttempt.model
        && (currentNow.reasoningEffort ?? '') === (selectionBeforeAttempt.reasoningEffort ?? '')
      if (unchanged) return
      try {
        selectModel(agent, selectionBeforeAttempt)
      } catch (restoreError) {
        warn(deps?.logger, `cannot restore the Lead model after a failed orchestrator apply: ${messageOf(restoreError)}`)
      }
    }
    /** @type {{ provider: string, model: string, reasoningEffort?: string } | undefined} */
    const previousModel = route !== null ? (carriedPrevious ?? capturedPrevious) : carriedPrevious
    /** @type {object} */
    const plan = {
      identity: promptPlan.identity,
      sections: promptPlan.sections,
      restrictable,
      route,
      previousModel,
      personaOrder,
    }

    // Rename the Session title before touching the live bundle: the rename is a
    // single synchronous append, so a failure leaves the previous state intact.
    //
    // The rename is only safe when a prior title was captured to restore on
    // off. With no prior title the runtime must not invent one: doing so makes
    // a failed enable or a later off leak "orchestrator" with nothing to
    // restore. In that case the announcement and persona still provide the
    // visible orchestrator identity.
    /** @type {{ ok: boolean, skipped?: boolean, reason?: string | null, error?: string }} */
    let titleOutcome = { ok: false, skipped: true, reason: null }
    if (options.renameTitle === true) {
      if (previousTitle === undefined) {
        // Distinguish "the Session has no title to capture" from "this
        // composition has no title service"; both leave the title untouched.
        titleOutcome = {
          ok: false,
          skipped: true,
          reason: hasSessionTitleService(agent) ? 'no-prior-title' : 'service-unavailable',
        }
      } else {
        titleOutcome = renameSessionTitle(agent, ORCHESTRATOR_SESSION_TITLE)
        if (titleOutcome.ok !== true && titleOutcome.skipped !== true) {
          return {
            ok: false,
            path: document.path,
            error: `cannot rename the Session title to "${ORCHESTRATOR_SESSION_TITLE}": ${titleOutcome.error}`,
          }
        }
        titleOutcome.reason = titleOutcome.ok === true ? null : 'service-unavailable'
      }
    }

    // Duplicate section names cannot coexist, so the outgoing bundle is disposed
    // just before the replacement registers. A failure anywhere in the new plan
    // recreates the previous bundle below: an enabled session is never left half
    // torn down, and the original model capture is preserved.
    if (!operationIsCurrent(agent, options)) return staleOperationResult()
    if (existing !== undefined) {
      bundles.delete(agent)
      safeDispose(existing.dispose)
    }
    if (!operationIsCurrent(agent, options)) return staleOperationResult()
    const restoreTitleAfterFailure = () => {
      if (titleOutcome.ok !== true) return
      // A failed replacement keeps the active mode's orchestrator title.
      if (existing !== undefined) return
      if (titleBefore === undefined) return
      if (currentSessionTitle(agent) !== ORCHESTRATOR_SESSION_TITLE) return
      const restored = renameSessionTitle(agent, titleBefore)
      if (restored.ok !== true) {
        warn(deps?.logger, `cannot restore the Session title after a failed orchestrator enable: ${restored.error ?? 'the session-title service is unavailable'}`)
      }
    }
    let bundle
    const discardStaleAttempt = () => {
      if (bundle !== undefined) safeDispose(bundle.dispose)
      // A newer operation may already own a committed bundle; never roll its
      // model back with this stale operation's snapshot.
      if (bundles.get(agent) === undefined) restoreSelectionBeforeAttempt()
      return staleOperationResult()
    }
    try {
      bundle = createBundle(agent, plan)
      if (!operationIsCurrent(agent, options)) return discardStaleAttempt()
      // Removing a model route is part of the same transaction as constructing
      // the replacement. A failed restore must not commit a route-null bundle.
      if (route === null && carriedPrevious !== undefined) selectModel(agent, carriedPrevious)
    } catch (error) {
      if (!operationIsCurrent(agent, options)) return discardStaleAttempt()
      if (bundle !== undefined) safeDispose(bundle.dispose)
      let restored = false
      let restorationError
      if (existing !== undefined) {
        try {
          const previousBundle = createBundle(agent, existing.plan)
          if (!operationIsCurrent(agent, options)) {
            safeDispose(previousBundle.dispose)
            return staleOperationResult()
          }
          bundles.set(agent, {
            dispose: () => previousBundle.dispose(),
            plan: existing.plan,
            ...existing.previousModel === undefined ? {} : { previousModel: existing.previousModel },
            ...existing.previousTitle === undefined ? {} : { previousTitle: existing.previousTitle },
          })
          restored = true
        } catch (restoreError) {
          restorationError = restoreError
          warn(deps?.logger, `cannot restore the previous orchestrator state for ${String(agent?.id)}: ${messageOf(restoreError)}`)
        }
      }
      restoreSelectionBeforeAttempt()
      restoreTitleAfterFailure()
      warn(deps?.logger, `cannot apply orchestrator mode for ${String(agent?.id)}: ${messageOf(error)}`)
      const baseError = `cannot apply the orchestrator definition: ${messageOf(error)}`
      if (existing !== undefined) {
        const restoration = restored
          ? '; the previous orchestrator state was restored; previousStateRestored=true'
          : `; cannot restore the previous orchestrator state: ${messageOf(restorationError)}; previousStateRestored=false; orchestrator mode is inactive`
        return {
          ok: false,
          path: document.path,
          previousStateRestored: restored,
          active: restored,
          error: `${baseError}${restoration}`,
        }
      }
      return { ok: false, path: document.path, error: baseError }
    }
    if (!operationIsCurrent(agent, options)) return discardStaleAttempt()
    bundles.set(agent, {
      dispose: () => bundle.dispose(),
      plan,
      ...previousModel === undefined ? {} : { previousModel },
      ...previousTitle === undefined ? {} : { previousTitle },
    })
    return {
      ok: true,
      path: document.path,
      name: detail.definition.name,
      model: route,
      tools: restrictable,
      gateMode: detail.definition.gateMode,
      maxRetries: detail.definition.maxRetries,
      planFirst: detail.definition.planFirst,
      pauseOnFatal: detail.definition.pauseOnFatal,
      title: titleOutcome.ok === true ? ORCHESTRATOR_SESSION_TITLE : null,
      titleSkipped: titleOutcome.skipped === true,
      titleSkippedReason: titleOutcome.reason ?? null,
    }
  }

  /**
   * Enable the mode for one Lead (explicit `/orchestrate`).
   * @param {object} agent
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<object>}
   */
  async function enable(agent, options = {}) {
    const operation = beginAsyncOperation(agent, options.signal)
    try {
      return await applyTo(agent, { capturePrevious: true, renameTitle: true, ...operation })
    } finally {
      endAsyncOperation(operation)
    }
  }

  /**
   * Disable the mode for one Lead: restore the captured model and Session
   * title, then dispose every registration.
   *
   * The title is restored only while it is still exactly "orchestrator": a
   * human rename during the mode is respected and left untouched. A title
   * restore failure is a warning, not an off failure — the human must always be
   * able to leave orchestrator mode.
   *
   * @param {object} agent
   * @returns {{ ok: boolean, active: boolean, restoredModel: boolean,
   *   restoredTitle: boolean | null, error?: string }}
   */
  function disable(agent) {
    nextGeneration(agent)
    const bundle = bundles.get(agent)
    if (bundle === undefined) return { ok: true, active: false, restoredModel: false, restoredTitle: null }
    let restoredModel = false
    if (bundle.previousModel !== undefined) {
      try {
        // Restore first: if this fails the live bundle and its capture remain
        // available for a later off retry.
        restoredModel = selectModel(agent, bundle.previousModel)
      } catch (error) {
        const message = `cannot restore the Lead model after orchestrator mode: ${messageOf(error)}`
        warn(deps?.logger, message)
        return { ok: false, active: true, restoredModel: false, restoredTitle: null, error: message }
      }
    }
    /** @type {boolean | null} */
    let restoredTitle = null
    if (bundle.previousTitle !== undefined && currentSessionTitle(agent) === ORCHESTRATOR_SESSION_TITLE) {
      const renamed = renameSessionTitle(agent, bundle.previousTitle)
      if (renamed.ok === true) restoredTitle = true
      else if (renamed.skipped === true) {
        warn(deps?.logger, 'cannot restore the Session title: the session-title service is unavailable')
      } else {
        restoredTitle = false
        warn(deps?.logger, `cannot restore the Session title after orchestrator mode: ${renamed.error}`)
      }
    } else if (bundle.previousTitle !== undefined) {
      // The human renamed the Session while the mode was active; keep it.
      restoredTitle = false
    }
    bundles.delete(agent)
    safeDispose(bundle.dispose)
    return { ok: true, active: false, restoredModel, restoredTitle }
  }

  /**
   * Capture the live bundle state for an exact rollback.
   *
   * Used by `/orchestrate <task>` when a task queue failure must leave an
   * already-active mode exactly as it was before the invocation. The snapshot
   * is opaque to callers and only meaningful for the same Agent and runtime.
   *
   * @param {object} agent
   * @returns {object | undefined} undefined when the mode has no live bundle.
   */
  function snapshot(agent) {
    const bundle = bundles.get(agent)
    if (bundle === undefined) return undefined
    /** @type {{ provider: string, model: string, reasoningEffort?: string } | undefined} */
    let model
    try {
      model = captureModelSelection(agent)
    } catch {
      model = undefined
    }
    return {
      plan: bundle.plan,
      ...bundle.previousModel === undefined ? {} : { previousModel: bundle.previousModel },
      ...bundle.previousTitle === undefined ? {} : { previousTitle: bundle.previousTitle },
      ...model === undefined ? {} : { model },
    }
  }

  /**
   * Restore one snapshot captured before this invocation.
   *
   * Recreates the captured pre-invocation effect bundle, restores its model
   * selection, and keeps its durable captures for a later off. If that
   * recreation fails, the freshly applied bundle is kept instead when
   * possible; if both recreations fail, no bundle remains active and this
   * returns false. Returns true when an active bundle was restored.
   *
   * @param {object} agent
   * @param {object | undefined} captured
   * @returns {boolean} whether a snapshot was restored.
   */
  function restore(agent, captured) {
    if (captured === undefined || !isRecord(captured.plan)) return false
    nextGeneration(agent)
    const current = bundles.get(agent)
    /** @type {{ provider: string, model: string, reasoningEffort?: string } | undefined} */
    let currentModel
    try {
      currentModel = current === undefined ? undefined : captureModelSelection(agent)
    } catch {
      currentModel = undefined
    }
    if (current !== undefined) {
      bundles.delete(agent)
      safeDispose(current.dispose)
    }
    /** Recreate one bundle record after the current registrations were freed. */
    const commit = (source) => {
      const bundle = createBundle(agent, source.plan)
      bundles.set(agent, {
        dispose: () => bundle.dispose(),
        plan: source.plan,
        ...source.previousModel === undefined ? {} : { previousModel: source.previousModel },
        ...source.previousTitle === undefined ? {} : { previousTitle: source.previousTitle },
      })
    }
    try {
      commit(captured)
      if (captured.model !== undefined) {
        try {
          selectModel(agent, captured.model)
        } catch (error) {
          warn(deps?.logger, `cannot restore the Lead model after a failed task queue: ${messageOf(error)}`)
        }
      }
      return true
    } catch (error) {
      warn(deps?.logger, `cannot restore the pre-invocation orchestrator state: ${messageOf(error)}`)
      // Keep an already-active mode alive if the snapshot recreation itself
      // fails: the freshly applied replacement is better than a torn-down mode.
      if (current !== undefined) {
        try {
          commit(current)
          if (currentModel !== undefined) selectModel(agent, currentModel)
          return true
        } catch (fallbackError) {
          warn(deps?.logger, `cannot restore any orchestrator state after a failed task queue: ${messageOf(fallbackError)}`)
        }
      }
      return false
    }
  }

  /**
   * Whether orchestrator mode currently owns one Agent's scope.
   * @param {object} agent
   * @returns {boolean}
   */
  function isActive(agent) {
    return bundles.has(agent)
  }

  /**
   * Re-apply when the session log says the mode is on. Never captures the
   * previous selection: a reapply runs after activation/creation, where the
   * currently selected route is already ours.
   * @param {object} agent
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<object>}
   */
  async function reapplyIfActive(agent, options = {}) {
    const operation = beginAsyncOperation(agent, options.signal)
    try {
      if (disposed) return { ok: false, skipped: true, error: 'the orchestrator runtime is disposed' }
      if (!operationIsCurrent(agent, operation)) return staleOperationResult()
      if (modeOf(agent) !== 'on') return { ok: true, skipped: true }
      return await applyTo(agent, { capturePrevious: false, renameTitle: false, ...operation })
    } finally {
      endAsyncOperation(operation)
    }
  }

  /**
   * Drop one Agent's bundle (its scope is being disposed; no model restore).
   * @param {object} agent
   * @returns {void}
   */
  function disposeAgent(agent) {
    nextGeneration(agent)
    const bundle = bundles.get(agent)
    if (bundle === undefined) return
    bundles.delete(agent)
    safeDispose(bundle.dispose)
  }

  /**
   * Drop every bundle and restore every captured model selection (plugin unload).
   * @returns {void}
   */
  function dispose() {
    if (disposed) return
    disposed = true
    for (const [agent, bundle] of [...bundles.entries()]) {
      bundles.delete(agent)
      safeDispose(bundle.dispose)
      if (bundle.previousModel !== undefined) {
        try {
          selectModel(agent, bundle.previousModel)
        } catch (error) {
          warn(deps?.logger, `cannot restore a Lead model while unloading: ${messageOf(error)}`)
        }
      }
    }
  }

  return { modeOf, enable, disable, reapplyIfActive, isActive, snapshot, restore, disposeAgent, dispose }
}

/**
 * Build one user message for a task submitted through `/orchestrate <task>`.
 *
 * This package imports only Node builtins, so the value is shaped exactly like
 * the `createUserMessage` payload the chat composer submits: a stable identity,
 * the user role, one text block, and the user source kind. Session logging then
 * treats it as any other user turn.
 *
 * @param {string} text - the trimmed task text.
 * @returns {{ id: string, role: 'user', content: { type: 'text', text: string }[], source: { kind: 'user' } }}
 */
function queuedTaskMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/**
 * Queue one task as the Lead's next ordinary user turn.
 *
 * @param {object} agent - the receiving Lead Agent.
 * @param {string} text - the trimmed task text.
 * @returns {void}
 * @throws {Error} when the Agent cannot accept queued input.
 */
function queueTaskTurn(agent, text) {
  if (agent === null || typeof agent !== 'object' || typeof agent.followup !== 'function') {
    throw new Error('the Lead Agent cannot accept a queued message')
  }
  agent.followup(queuedTaskMessage(text))
}

/**
 * Render the mandatory, visibly prominent activation announcement.
 *
 * This block is deterministic: it always names the runtime identity, the
 * definition path, the resolved model (or `inherit`), the gate mode, the retry
 * budget, and the Session-title outcome.
 *
 * @param {object} enabled - successful `runtime.enable()` result.
 * @returns {string}
 */
export function orchestratorActivationAnnouncement(enabled) {
  const model = isRecord(enabled?.model) ? `${enabled.model.provider}/${enabled.model.model}` : 'inherit'
  const title = enabled?.title === ORCHESTRATOR_SESSION_TITLE
    ? `title: Session renamed to "${ORCHESTRATOR_SESSION_TITLE}"`
    : enabled?.titleSkippedReason === 'no-prior-title'
      ? 'title: unchanged (no prior Session title to restore)'
      : enabled?.titleSkipped === true
        ? 'title: unchanged (session-title service unavailable)'
        : 'title: unchanged'
  return [
    'ORCHESTRATOR MODE ACTIVE',
    `identity: ${ORCHESTRATOR_ANNOUNCEMENT_IDENTITY}`,
    `path: ${String(enabled?.path ?? '')}`,
    `model: ${model}`,
    `gate: ${String(enabled?.gateMode ?? 'off')}`,
    `retries: ${String(enabled?.maxRetries ?? 0)}`,
    title,
  ].join('\n')
}

/**
 * Register the Lead-scoped `orchestrate` chat command.
 *
 * The command is the only activation surface. An empty input enables, an
 * off-word disables, and any other input enables the mode and then queues that
 * text as the Lead's next user message, so `/orchestrate <task>` starts the work
 * in one step. Missing or invalid definitions answer an error that names the
 * file, and the durable mode is left unchanged. A task that cannot be queued
 * rolls the mode back so the live state and the session command log agree.
 *
 * @param {object} agent - the exact live Lead Agent.
 * @param {object} agentCtx - `agent.ctx`.
 * @param {object} deps - shared plugin deps (passed to the runtime calls).
 * @param {{ modeOf: Function, enable: Function, disable: Function,
 *   reapplyIfActive: Function, disposeAgent: Function, dispose: Function }} runtime
 * @returns {{ dispose: () => void }} disposer; always safe to call.
 */
export function installOrchestratorCommand(agent, agentCtx, deps, runtime) {
  const noop = { dispose() {} }
  try {
    // Tests may inject their own WeakMap to observe cleanup; production uses
    // the process-wide map so separate installs for one Agent still serialize.
    const handlerTails = deps?.handlerTails instanceof WeakMap ? deps.handlerTails : orchestrateHandlerTails
    /**
     * Run one invocation under the per-Agent serialization tail.
     *
     * A waiter that aborts before it can run releases its slot and returns a
     * normal error result; no doctrine/model/title work starts. The tail is
     * removed when it is still the latest one, so an idle Agent is not retained.
     *
     * @param {object} target - exact Lead Agent.
     * @param {AbortSignal | undefined} signal
     * @param {() => Promise<object>} work
     * @returns {Promise<object>}
     */
    const serially = async (target, signal, work) => {
      const previous = handlerTails.get(target) ?? Promise.resolve()
      /** @type {() => void} */
      let release
      const mine = new Promise(resolve => { release = resolve })
      const tail = previous.then(() => mine, () => mine)
      handlerTails.set(target, tail)
      // Retire the entry only after the tail (including the previous holder)
      // settles and only when no later invocation replaced it. Deleting it
      // while the previous holder is still running would make a third
      // invocation start concurrently.
      const cleanupTail = () => {
        void tail.then(() => {
          if (handlerTails.get(target) === tail) handlerTails.delete(target)
        }, () => {})
      }
      // An aborted waiter settles promptly instead of waiting for the active
      // holder. Its tail still waits for the previous holder, so no later
      // invocation can overtake work that is already running.
      /** @type {(() => void) | undefined} */
      let onAbort
      const aborted = signal === undefined
        ? undefined
        : new Promise(resolve => {
          onAbort = () => resolve(true)
          if (signal.aborted) {
            resolve(true)
            return
          }
          if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })
        })
      let abortedWhileWaiting = false
      try {
        if (aborted === undefined) {
          await previous
        } else {
          abortedWhileWaiting = await Promise.race([previous.then(() => false, () => false), aborted])
        }
      } finally {
        if (onAbort !== undefined && typeof signal?.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort)
        }
      }
      if (abortedWhileWaiting === true || signal?.aborted === true) {
        // The cancellation result returns now, but the tail stays registered
        // until the previous holder settles so later invocations still queue.
        release()
        cleanupTail()
        const reason = signal?.reason instanceof Error ? `: ${signal.reason.message}` : ''
        return { kind: 'error', text: `orchestrate was cancelled while waiting for the previous invocation${reason}` }
      }
      try {
        return await work()
      } finally {
        release()
        cleanupTail()
      }
    }

    /** @param {object} invocation @returns {Promise<object>} */
    const runHandler = async (invocation) => {
      try {
        const target = invocation?.agent ?? agent
        const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
        if (orchestratorModeNext(raw) === 'off') {
          const result = await runtime.disable(target)
          if (result?.ok === false) {
            return { kind: 'error', text: String(result.error ?? 'cannot disable orchestrator mode') }
          }
          const titleNote = result?.restoredTitle === true
            ? ' The previous Session title was restored.'
            : result?.restoredTitle === false
              ? ' The Session title was left as you set it.'
              : ''
          return {
            kind: 'success',
            text: `Orchestrator mode disabled. The previous model selection was restored when one was captured.${titleNote}`,
          }
        }
        // Capture whether this invocation started the mode. A queue failure
        // may only roll back a mode this invocation enabled; an already-active
        // (or durably active after a reload) mode must survive the failed task
        // submission with its title and live bundle intact.
        let wasActiveBefore = false
        try {
          wasActiveBefore = runtime.isActive(target) === true
        } catch {
          wasActiveBefore = false
        }
        let durableOnBefore = false
        try {
          // The real CommandsService has already appended this invocation's
          // command/run. Exclude exactly that id so a first `/orchestrate
          // <task>` is not mistaken for pre-existing durable activity; earlier
          // runs (and their errors) still fold normally.
          const commandId = invocation?.commandId
          // Two overlapping first task invocations can each see the other's
          // still-pending run. The per-Agent handler lock below plus settledOnly
          // makes pre-invocation state count only completed commands; the
          // current run is excluded explicitly as well.
          durableOnBefore = runtime.modeOf(
            target,
            commandId === undefined ? { settledOnly: true } : { excludeCommandId: commandId, settledOnly: true },
          ) === 'on'
        } catch {
          durableOnBefore = false
        }
        const keepActiveOnQueueFailure = wasActiveBefore || durableOnBefore
        const titleBeforeInvocation = keepActiveOnQueueFailure ? currentSessionTitle(target) : undefined
        // Only a live bundle can be snapshotted; a durably-active mode after a
        // reload has no live state to restore, so its freshly applied bundle is
        // kept instead.
        const snapshotBeforeInvocation = keepActiveOnQueueFailure && typeof runtime.snapshot === 'function'
          ? runtime.snapshot(target)
          : undefined
        const enabled = await runtime.enable(target, { signal: invocation?.signal })
        if (enabled.ok !== true) {
          return { kind: 'error', text: String(enabled.error ?? 'cannot enable orchestrator mode') }
        }
        // Activation is always visibly announced: even a bare enable answers
        // with the full ORCHESTRATOR MODE ACTIVE block.
        const announcement = orchestratorActivationAnnouncement(enabled)
        if (raw === '') {
          return { kind: 'success', text: `${announcement}\nUse /orchestrate off to exit.` }
        }
        try {
          queueTaskTurn(target, raw)
        } catch (error) {
          // The run will settle as a command error, so a first enable cannot
          // stay live without disagreeing with the durable mode. A mode that
          // existed before this invocation is different: keep its live bundle,
          // model, doctrine, and title, and only report the queue failure.
          let reverted = false
          let keptActive = false
          if (keepActiveOnQueueFailure) {
            keptActive = true
            // Restore the exact pre-invocation bundle (doctrine, tool
            // restriction, model, durable captures) when one existed. A
            // durably-active mode with no live bundle had nothing to snapshot,
            // so the bundle this invocation applied is kept.
            if (snapshotBeforeInvocation !== undefined && typeof runtime.restore === 'function') {
              if (runtime.restore(target, snapshotBeforeInvocation) !== true) {
                // Both recreations failed, so no bundle is live: the note below
                // must not claim the mode was kept.
                keptActive = false
                warn(deps?.logger, 'cannot restore the pre-invocation orchestrator state after a failed task queue')
              }
            }
            // A bare explicit enable renames the Session even while active.
            // Restore the pre-invocation title when this invocation changed
            // it, so a failed task submission is not observable as a rename.
            if (titleBeforeInvocation !== undefined && currentSessionTitle(target) !== titleBeforeInvocation) {
              const restored = renameSessionTitle(target, titleBeforeInvocation)
              if (restored.ok !== true) {
                warn(deps?.logger, `cannot restore the Session title after a failed task queue: ${restored.error ?? 'the session-title service is unavailable'}`)
              }
            }
          } else {
            try {
              reverted = runtime.disable(target)?.ok !== false
            } catch {
              // The queue failure is the actionable one.
            }
          }
          const stateNote = reverted
            ? '; the mode was reverted'
            : keptActive
              ? '; the already-active mode was kept'
              : keepActiveOnQueueFailure
                ? '; cannot restore the previous orchestrator state; orchestrator mode is inactive'
                : ''
          return {
            kind: 'error',
            text: `Orchestrator mode was enabled, but the task could not be queued as the next message: ${messageOf(error)}${stateNote}`,
          }
        }
        return { kind: 'success', text: `${announcement}\nThe task was queued as the next message. Use /orchestrate off to exit.` }
      } catch (error) {
        return { kind: 'error', text: `orchestrate failed: ${messageOf(error)}` }
      }
    }
    /** Serialize every `/orchestrate` invocation, including off, per exact Lead. */
    const handler = invocation => serially(
      invocation?.agent ?? agent,
      invocation?.signal,
      () => runHandler(invocation),
    )
    /** @param {object} commands @returns {unknown} */
    const register = (commands) => commands.register({
      name: ORCHESTRATE_COMMAND_NAME,
      description: 'Enable the session-scoped Orchestrator doctrine (persona, prompt sections, model, tools, and the orchestrator Session title). Answers with the ORCHESTRATOR MODE ACTIVE block. Append a task to also submit it; "off" exits.',
      input: { hint: '[<task>|off]' },
      handler,
    })
    /** @type {unknown} */
    let injected
    if (typeof agentCtx?.inject === 'function') {
      injected = agentCtx.inject(['commands'], (child) => register(child.commands))
    } else if (isRecord(agentCtx?.commands) && typeof agentCtx.commands.register === 'function') {
      injected = register(agentCtx.commands)
    } else {
      throw new Error('the Lead Agent scope exposes no commands service')
    }
    let disposed = false
    return {
      dispose() {
        if (disposed) return
        disposed = true
        safeDispose(injected)
      },
    }
  } catch (error) {
    warn(deps?.logger, `failed to install the /orchestrate command: ${messageOf(error)}`)
    return noop
  }
}
