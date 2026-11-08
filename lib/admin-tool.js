/**
 * Lead-only Agent tool for managing soul documents.
 *
 * This is the agent caller of the same document layer the Settings GUI uses for
 * list, read, create, edit (raw Markdown), and delete soul files. Routing both
 * callers through `./admin.js` shares filesystem, parsing, and write-safety
 * behavior, but their save contracts differ: for soul-document saves, the GUI
 * supplies semantic validation and `expectedHash` optimistic-conflict handling;
 * this tool's `save` action supplies neither.
 *
 * @module @local/dsh-agent-soul/admin-tool
 */

import { isAbsolute, join } from 'node:path'
import { createDocument, deleteDocument, listDocuments, readDocument, saveDocumentSource } from './admin.js'
import { orchestratorPathOf, orchestratorRouteDiagnostics, readOrchestrator, saveOrchestrator } from './orchestrator.js'

/** Actions the tool accepts. */
const ACTIONS = ['list', 'get', 'save', 'create', 'delete', 'get_orchestrator', 'save_orchestrator', 'diagnose', 'repair_team_tools']
/** Keep model-supplied source writes bounded before either document layer parses them. */
const MAX_SOURCE_BYTES = 1024 * 1024

/** Parameter spec compiled to JSON Schema by {@link defineTool}. */
const PARAMETERS = {
  action: {
    type: 'string',
    required: true,
    enum: ACTIONS,
    description: 'list every soul and its diagnostics; get one document as Markdown; save raw Markdown to an existing file; create a new soul from a kebab-case name; delete one file; get_orchestrator reads the Lead orchestrator definition as Markdown; save_orchestrator validates and writes that definition from raw Markdown; diagnose reports the live command registry and Team-tool row composition; repair_team_tools disables the shipped tool-agent-team row in the profile when a mis-ordered bundle list left both Team-tool rows active.',
  },
  file: {
    type: 'string',
    description: 'Absolute path or workspace-relative path of the soul file. Required for get, save, and delete; ignored for list, create, get_orchestrator, and save_orchestrator.',
  },
  name: {
    type: 'string',
    description: 'Lower-kebab-case soul name for create. The file is created in the first configured soul directory.',
  },
  source: {
    type: 'string',
    description: 'Complete Markdown document (YAML frontmatter plus body) for save or save_orchestrator, at most 1 MiB of UTF-8. Validated before writing.',
  },
}

/** Canonical JSON Schema for one tool output value (owned by the tools registry). */
const VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    message: { type: 'string' },
    file: { type: 'string' },
    source: { type: 'string' },
    // `get_orchestrator` reports where the returned source came from: the
    // packaged default doctrine (`bundled: true`) or the workspace document
    // (`bundled: false`). Both fields appear on every successful
    // get_orchestrator result and on no other action, so they stay optional in
    // this closed schema instead of being rejected as undeclared properties.
    bundled: { type: 'boolean' },
    sourcePath: { type: 'string' },
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          file: { type: 'string' },
          label: { type: 'string' },
          name: { type: 'string' },
          valid: { type: 'boolean' },
          model: { type: 'string' },
          model_resolved: { type: 'string' },
          user_invocable: { type: 'boolean' },
          source: { type: 'string' },
          diagnostics: { type: 'array', items: { type: 'string' } },
        },
        required: ['file', 'label', 'valid', 'diagnostics'],
      },
    },
    diagnostics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['message'],
      },
    },
  },
  required: ['ok', 'action'],
}

/** Human-readable message for one arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Compile one author parameter spec into the registry's JSON Schema subset.
 * @param {Record<string, object>} spec
 * @returns {Record<string, unknown>}
 */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [name, field] of Object.entries(spec)) {
    const node = {}
    for (const key of ['type', 'description', 'enum', 'items']) {
      if (field[key] !== undefined) node[key] = field[key]
    }
    properties[name] = node
    if (field.required === true) required.push(name)
  }
  return { type: 'object', additionalProperties: false, properties, ...required.length > 0 ? { required } : {} }
}

/**
 * Validate arguments against the author spec, then hand them to the provider.
 * @param {{ parameters: Record<string, object>, output: object, execute(args: object): Promise<object> }} options
 * @returns {object} a registry-ready tool definition.
 */
function defineTool(options) {
  const parameters = toJsonSchema(options.parameters)
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: VALUE_SCHEMA,
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const violations = []
      for (const [name, field] of Object.entries(options.parameters)) {
        const value = args[name]
        if (field.required === true && value === undefined) violations.push(`missing required property "${name}"`)
        if (value === undefined) continue
        if (field.type === 'string' && typeof value !== 'string') violations.push(`"${name}" must be a string`)
        if (field.type === 'array' && !Array.isArray(value)) violations.push(`"${name}" must be an array`)
        if (field.enum !== undefined && !field.enum.includes(value)) {
          violations.push(`"${name}" must be one of ${field.enum.join(', ')}`)
        }
      }
      if (violations.length > 0) throw new Error(`invalid arguments: ${violations.join('; ')}`)
      return await options.execute(args, exec)
    },
  }
}

/**
 * Resolve one tool file argument against the calling workspace root.
 * @param {string} root
 * @param {string} file
 * @returns {string}
 */
function fileOf(root, file) {
  return isAbsolute(file) ? file : join(root, file)
}

/**
 * Format one document list row for the model (snake_case, diagnostics flattened).
 * @param {object} document - one listDocuments row.
 * @returns {object}
 */
function modelRow(document) {
  return {
    file: document.file,
    label: document.label,
    valid: document.valid,
    diagnostics: (document.diagnostics ?? []).map(diagnostic => diagnostic.message ?? String(diagnostic)),
    ...document.name === null || document.name === undefined ? {} : { name: document.name },
    ...document.model === null || document.model === undefined ? {} : { model: document.model },
    ...document.modelResolved === null || document.modelResolved === undefined ? {} : { model_resolved: document.modelResolved },
    ...document.userInvocable === undefined ? {} : { user_invocable: document.userInvocable },
    ...document.source === undefined ? {} : { source: document.source },
  }
}

/**
 * Snapshot the live command-registry view the GUI uses (list vs find), for
 * diagnosing a command-status disagreement between the two lookups.
 * @param {object} deps
 * @param {object} caller - live agent used for the workspace root.
 * @returns {object}
 */
function diagnoseRegistry(deps, caller) {
  const ctx = deps.ctx
  const serviceOf = (serviceName) => {
    try {
      return typeof ctx?.get === 'function' ? ctx.get(serviceName) : undefined
    } catch {
      return undefined
    }
  }
  const agentsService = serviceOf('agents')
  const teamService = serviceOf('agentTeams')
  const commands = serviceOf('commands')
  /** @type {unknown[]} */
  let agents = []
  try {
    const listed = agentsService?.list?.()
    if (Array.isArray(listed)) agents = listed
  } catch {
    agents = []
  }
  const leads = []
  for (const agent of agents) {
    let membership
    try {
      membership = teamService?.tryMembership?.(agent)
    } catch {
      membership = undefined
    }
    if (membership?.role !== 'lead') continue
    const entry = { id: agent?.id, name: membership?.name, list: null, find: null, errors: [] }
    try {
      const listed = commands?.list?.(agent)
      entry.list = Array.isArray(listed) ? listed.map(descriptor => descriptor?.name) : String(listed)
    } catch (error) {
      entry.errors.push(`list: ${messageOf(error)}`)
    }
    try {
      entry.find = commands?.find?.(agent, 'code-reviewer') !== undefined
    } catch (error) {
      entry.errors.push(`find: ${messageOf(error)}`)
    }
    leads.push(entry)
  }
  return { commandsService: commands !== undefined, leadCount: leads.length, leads, root: deps.rootOf(caller) }
}

/**
 * Register `manage_agent_souls` in one Lead Agent scope.
 *
 * @param {object} agent - exact live Lead Agent (the workspace authority).
 * @param {object} scope - `agent.ctx`.
 * @param {{ config: object, catalog: object, bindings: object, logger: { warn(message: string): void },
 *   rootOf(agent: object): string }} deps - shared plugin deps.
 * @returns {() => void} disposer that unregisters the tool.
 */
export function installSoulAdminTool(agent, scope, deps) {
  return scope.tools.register(defineTool({
    name: 'manage_agent_souls',
    description:
      'Manage this workspace\'s Agent Soul definitions. The Settings > Agent Soul page edits the same files. '
      + 'Actions: list (all definitions with diagnostics), get (one document as Markdown), save (validate and write raw Markdown to an existing file), '
      + 'create (new canonical skeleton from a lower-kebab-case name), delete (remove one file), '
      + 'get_orchestrator (read the Lead orchestrator definition as Markdown), save_orchestrator (validate and write that definition from raw Markdown). '
      + 'A soul gives a teammate its persona, tool permission matrix, routed model, and optional slash command; '
      + 'the orchestrator definition only takes effect after a human runs /orchestrate in chat '
      + '(optionally /orchestrate <task>, which enables it and submits the task). '
      + 'diagnose also reports the live Team-tool row composition; repair_team_tools disables the shipped tool-agent-team row in the profile when this bundle was installed before the Agent Teams bundle (add that row override instead when the Plugin Manager service is unavailable). '
      + 'An edited file takes effect on the next spawn_teammate call.',
    parameters: PARAMETERS,
    async execute(args, exec) {
      const caller = exec.agent ?? agent
      const root = deps.rootOf(caller)
      // Mutations below change the catalog while Host runs; reconcile slash
      // commands once the write succeeded so no Host reload is needed.
      const syncCommands = async () => {
        try {
          await deps.syncSouls?.()
        } catch (error) {
          deps.logger?.warn?.(`agent-soul: soul command sync failed: ${messageOf(error)}`)
        }
      }
      try {
        if (
          (args.action === 'save' || args.action === 'save_orchestrator')
          && typeof args.source === 'string'
          && Buffer.byteLength(args.source, 'utf8') > MAX_SOURCE_BYTES
        ) {
          return { ok: false, action: args.action, message: 'source exceeds the 1 MiB limit', diagnostics: [] }
        }
        if (args.action === 'diagnose') {
          const registry = diagnoseRegistry(deps, exec.agent ?? agent)
          let teamTools = null
          try {
            teamTools = deps.composition?.inspect?.() ?? null
          } catch (error) {
            teamTools = { available: false, status: 'unknown', ok: null, message: messageOf(error), fix: null }
          }
          registry.teamTools = teamTools
          return { ok: true, action: 'diagnose', message: JSON.stringify(registry), diagnostics: [] }
        }
        if (args.action === 'repair_team_tools') {
          if (typeof deps.composition?.repair !== 'function') {
            return { ok: false, action: 'repair_team_tools', message: 'the composition repair runtime is unavailable in this composition', diagnostics: [] }
          }
          const result = await deps.composition.repair()
          return {
            ok: result?.ok === true,
            action: 'repair_team_tools',
            message: String(result?.message ?? ''),
            diagnostics: [],
          }
        }
        if (args.action === 'list') {
          const result = await listDocuments({ config: deps.config, root })
          return {
            ok: true,
            action: 'list',
            documents: result.documents.map(modelRow),
            diagnostics: result.diagnostics.map(diagnostic => ({
              source: diagnostic.source ?? '',
              message: diagnostic.message ?? String(diagnostic),
            })),
          }
        }
        if (args.action === 'get') {
          const result = await readDocument({ config: deps.config, root, file: fileOf(root, args.file) })
          if (!result.ok) return { ok: false, action: 'get', message: result.message ?? 'cannot read soul', diagnostics: [] }
          return {
            ok: true,
            action: 'get',
            file: result.document.file,
            source: result.document.source,
            diagnostics: (result.document.diagnostics ?? []).map(diagnostic => ({
              source: result.document.file,
              message: diagnostic.message ?? String(diagnostic),
            })),
          }
        }
        if (args.action === 'create') {
          const result = await createDocument({ config: deps.config, root, name: args.name })
          if (!result.ok) return { ok: false, action: 'create', message: result.message ?? 'cannot create soul', diagnostics: [] }
          await syncCommands()
          return {
            ok: true,
            action: 'create',
            file: result.document.file,
            source: result.document.source,
            message: `created ${result.document.label}`,
            diagnostics: [],
          }
        }
        if (args.action === 'save') {
          const result = await saveDocumentSource({
            config: deps.config,
            root,
            file: fileOf(root, args.file),
            source: args.source,
          })
          if (!result.ok) {
            return {
              ok: false,
              action: 'save',
              message: result.message ?? 'document is invalid',
              diagnostics: (result.diagnostics ?? []).map(diagnostic => ({
                source: fileOf(root, args.file),
                message: diagnostic.message ?? String(diagnostic),
              })),
            }
          }
          await syncCommands()
          return {
            ok: true,
            action: 'save',
            file: result.document.file,
            message: `saved ${result.document.label}`,
            diagnostics: [],
          }
        }
        if (args.action === 'get_orchestrator') {
          const path = orchestratorPathOf(deps.config, root)
          const result = await readOrchestrator({ config: deps.config, root })
          if (!result.ok) {
            return { ok: false, action: 'get_orchestrator', message: result.message ?? 'cannot read orchestrator', diagnostics: [] }
          }
          const document = result.orchestrator
          if (document.configured !== true) {
            return {
              ok: false,
              action: 'get_orchestrator',
              file: path,
              message: `no orchestrator definition exists at ${path}; the canonical skeleton is available from the Settings GUI`,
              diagnostics: [],
            }
          }
          const bundled = document.bundled === true
          const sourcePath = typeof document.sourcePath === 'string' ? document.sourcePath : document.path
          return {
            ok: true,
            action: 'get_orchestrator',
            file: document.path,
            bundled,
            sourcePath,
            source: document.source,
            message: bundled
              ? `loaded the bundled default ${sourcePath}; a save writes the workspace definition at ${document.path}`
              : `${document.valid === true ? 'loaded' : 'loaded (invalid)'} ${document.path}`,
            diagnostics: (document.diagnostics ?? []).map(diagnostic => ({
              source: sourcePath,
              message: diagnostic.message ?? String(diagnostic),
            })),
          }
        }
        if (args.action === 'save_orchestrator') {
          // Same second validation layer as the GUI: a well-formed declaration
          // the live catalog cannot serve is refused at save time (the document
          // analysis layer already rejects internally conflicting declarations).
          const validate = async (definition) => await orchestratorRouteDiagnostics(definition, deps.resolveModel)
          const result = await saveOrchestrator({ config: deps.config, root, source: args.source, validate })
          if (!result.ok) {
            return {
              ok: false,
              action: 'save_orchestrator',
              message: result.message ?? 'the orchestrator definition is invalid',
              diagnostics: (result.diagnostics ?? []).map(diagnostic => ({
                source: orchestratorPathOf(deps.config, root),
                message: diagnostic.message ?? String(diagnostic),
              })),
            }
          }
          return {
            ok: true,
            action: 'save_orchestrator',
            file: result.orchestrator.path,
            source: result.orchestrator.source,
            message: `saved ${result.orchestrator.path}`,
            diagnostics: [],
          }
        }
        const result = await deleteDocument({ config: deps.config, root, file: fileOf(root, args.file) })
        if (!result.ok) return { ok: false, action: 'delete', message: result.message ?? 'cannot delete soul', diagnostics: [] }
        await syncCommands()
        // Delete is recoverable when the document layer returns `trashedFile`:
        // the model can report that path for Undo. Trash setup or move failure
        // instead hard-deletes the source and omits `trashedFile`, leaving no
        // Undo path.
        const trashed = typeof result.trashedFile === 'string' && result.trashedFile !== '' ? result.trashedFile : ''
        return {
          ok: true,
          action: 'delete',
          file: fileOf(root, args.file),
          message: trashed === ''
            ? `deleted ${args.file}`
            : `deleted ${args.file} (moved to ${trashed})`,
          diagnostics: [],
        }
      } catch (error) {
        deps.logger.warn(`agent-soul: manage_agent_souls failed: ${messageOf(error)}`)
        return { ok: false, action: String(args.action), message: messageOf(error), diagnostics: [] }
      }
    },
  }))
}
