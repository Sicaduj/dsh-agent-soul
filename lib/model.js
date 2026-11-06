/**
 * Resolution of a soul's `model` frontmatter into one concrete LLM route.
 *
 * A soul may name a model alone (`deepseek-v4-pro`), a full route
 * (`deepseek-official/deepseek-v4-pro`), or a model plus a separate `provider`
 * key. Resolution is async because providers advertise their catalogs through
 * the `llm` service; without that service only a full route can be accepted.
 *
 * @module @local/dsh-agent-soul/model
 */

/** @typedef {{ provider: string, model: string, reasoningEffort?: string }} ResolvedModel */

/** Options that may appear in soul frontmatter. */
/** @typedef {{ model?: unknown, provider?: unknown, reasoningEffort?: unknown }} RawModel */

/** Services used for validation; every field is optional so the module stays testable. */
/** @typedef {{ llm?: {
 *   listProviders(): { id: string, name: string }[],
 *   listModels(provider: string): Promise<{ id: string, name: string }[]>,
 *   resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{
 *     id: string, name: string, reasoning?: { efforts: { id: string, name: string }[] },
 *   }>,
 * }, agentDefaultModel?: { currentSelection(): { provider: string, model: string } | null | undefined },
 * logger?: { warn(message: string): void }, signal?: AbortSignal }} ModelServices */

/** Read one optional non-empty string from soul frontmatter. */
function text(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** Human-readable message for one arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Throw the caller's cancellation reason without converting it into a model diagnostic. */
function throwIfAborted(signal) {
  if (signal === undefined || signal === null) return
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted()
    return
  }
  if (signal.aborted === true) throw signal.reason ?? new Error('The operation was aborted')
}

/**
 * Render the registered routes that advertise `model`, for diagnostics.
 * @param {{ id: string }[]} providers
 * @param {(provider: string) => Promise<{ id: string }[]>} listModels
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ provider: string, model: string }[]>}
 */
async function advertisingRoutes(providers, listModels, signal) {
  const routes = []
  for (const provider of providers) {
    throwIfAborted(signal)
    try {
      for (const model of await listModels(provider.id)) routes.push({ provider: provider.id, model: model.id })
      throwIfAborted(signal)
    } catch {
      throwIfAborted(signal)
      // A provider whose catalog cannot be read cannot advertise anything here;
      // the ambiguity diagnostic simply omits it. Cancellation is not a
      // provider-catalog failure and must propagate.
    }
  }
  return routes
}

/**
 * Format a bounded route list for one error message.
 * @param {{ provider: string, model: string }[]} routes
 * @returns {string}
 */
function routeSummary(routes) {
  const shown = routes.slice(0, 12).map(route => `${route.provider}/${route.model}`)
  return shown.length === 0 ? '(none)' : shown.join(', ') + (routes.length > shown.length ? ', …' : '')
}

/**
 * Resolve one soul model declaration into a concrete route.
 *
 * When the `llm` service is unavailable the declaration must be complete
 * (`provider` and/or a `provider/model` route); otherwise the model is matched
 * against the providers' advertised catalogs, preferring the deployment's
 * current default provider.
 *
 * @param {RawModel} raw - the soul's `model`, `provider`, and `reasoningEffort` values.
 * @param {ModelServices} [services] - optional LLM catalog services.
 * @returns {Promise<ResolvedModel | undefined>} the route, or undefined when no model is declared.
 * @throws {Error} when the declaration cannot be resolved to exactly one registered route.
 */
export async function resolveModelRoute(raw, services = {}) {
  throwIfAborted(services.signal)
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') throw new Error('soul model declaration must be an object')

  const { llm, agentDefaultModel, logger, signal } = services
  const modelValue = text(raw.model)
  let provider = text(raw.provider)
  const reasoningEffort = text(raw.reasoningEffort)

  if (modelValue === undefined) {
    if (provider !== undefined) throw new Error('soul "provider" requires "model"')
    if (reasoningEffort !== undefined) throw new Error('soul "reasoningEffort" requires "model"')
    return undefined
  }

  let model = modelValue
  const slash = modelValue.indexOf('/')
  if (slash > 0) {
    const prefix = modelValue.slice(0, slash)
    const rest = modelValue.slice(slash + 1)
    if (rest.length === 0) throw new Error(`soul model "${modelValue}" has an empty model id`)
    if (provider !== undefined && provider !== prefix) {
      throw new Error(`soul model "${modelValue}" conflicts with provider "${provider}"`)
    }
    provider = prefix
    model = rest
  }

  if (llm === undefined) {
    if (provider === undefined) {
      throw new Error(
        `soul model "${modelValue}" cannot be resolved without the LLM service; write it as "provider/model"`,
      )
    }
    return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort }
  }

  const providers = llm.listProviders()
  if (provider === undefined) {
    const defaultProvider = agentDefaultModel?.currentSelection()?.provider
    if (defaultProvider !== undefined) {
      const advertised = await advertisingRoutes([{ id: defaultProvider }], id => llm.listModels(id), signal)
      throwIfAborted(signal)
      if (advertised.some(route => route.model === model)) provider = defaultProvider
    }
    if (provider === undefined) {
      const routes = await advertisingRoutes(providers, id => llm.listModels(id), signal)
      throwIfAborted(signal)
      const matches = [...new Set(routes.filter(route => route.model === model).map(route => route.provider))]
      if (matches.length === 1) {
        provider = matches[0]
      } else if (matches.length === 0) {
        throw new Error(
          `soul model "${modelValue}" is not advertised by any registered LLM provider; available routes: ${routeSummary(routes)}`,
        )
      } else {
        throw new Error(
          `soul model "${modelValue}" is advertised by several providers (${matches.join(', ')}); write it as "provider/${model}"`,
        )
      }
    }
  } else if (!providers.some(candidate => candidate.id === provider)) {
    const available = providers.map(candidate => candidate.id).join(', ') || '(none)'
    throw new Error(`soul provider "${provider}" is not a registered LLM provider; available providers: ${available}`)
  }

  throwIfAborted(signal)
  let info
  try {
    info = await llm.resolveModelInfo(provider, model, signal)
    throwIfAborted(signal)
  } catch (error) {
    throwIfAborted(signal)
    throw new Error(`soul model "${provider}/${model}" is not available: ${messageOf(error)}`)
  }
  const efforts = info?.reasoning?.efforts ?? []
  if (reasoningEffort !== undefined && efforts.length > 0 && !efforts.some(effort => effort.id === reasoningEffort)) {
    const available = efforts.map(effort => effort.id).join(', ')
    throw new Error(
      `soul reasoningEffort "${reasoningEffort}" is not supported by "${provider}/${model}"; available efforts: ${available}`,
    )
  }
  if (reasoningEffort !== undefined && efforts.length === 0 && logger !== undefined) {
    logger.warn(`soul reasoningEffort "${reasoningEffort}" is unverified for "${provider}/${model}"`)
  }
  return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort }
}
