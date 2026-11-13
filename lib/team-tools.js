/**
 * Tool-name sets shared by the runtime, the GUI, and the tests.
 *
 * DSH 0.2.2 owns the Team task board and the standard subagent controls. The
 * plugin no longer registers `send_message`, `list_agents`, `wait_agent`,
 * `interrupt_agent`, or the `team_task_*` tools. It only adds soul-aware
 * delegation and catalog tools.
 *
 * @module @local/dsh-agent-soul/team-tools
 */

/**
 * Team tools registered by the shipped `tool-agent-team` and
 * `tool-subagent-control` rows. `interrupt_agent` is present only when the
 * composition enables the control tool; probing by name handles absence.
 */
export const BASE_TEAM_TOOL_NAMES = Object.freeze([
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
])

/** Lead-only tools registered by this plugin. */
export const PLUGIN_TEAM_TOOL_NAMES = Object.freeze([
  'spawn_teammate',
  'list_agent_souls',
  'manage_agent_souls',
])

/**
 * Tools every soul teammate keeps even when its `tools` list is a strict
 * allow-list. Without these a teammate could not report, inspect its peers, or
 * participate in the shared task board the base Team policy describes.
 */
export const ALWAYS_KEPT_TOOL_NAMES = Object.freeze([
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
])

/** Tools only the Lead may call. */
export const LEAD_ONLY_TOOL_NAMES = Object.freeze([
  'spawn_teammate',
  'list_agent_souls',
  'manage_agent_souls',
])

/** Generic subagent tools whose children would bypass the Agent Soul roster. */
export const GENERIC_SUBAGENT_TOOLS = Object.freeze(['subagent', 'subagent_fork'])

/** Every tool name the plugin's GUI explains as a Team-owned capability. */
export const TEAM_TOOL_NAMES = Object.freeze([
  ...BASE_TEAM_TOOL_NAMES,
  ...PLUGIN_TEAM_TOOL_NAMES,
])
