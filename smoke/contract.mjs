/** Team-scoped tools that remain visible alongside the soul's inherited allow-list. */
export const TEAM_TOOL_NAMES = Object.freeze([
  'interrupt_agent',
  'list_agent_souls',
  'list_agents',
  'send_message',
  'spawn_teammate',
  'team_task_create',
  'team_task_get',
  'team_task_list',
  'team_task_update',
  'wait_agent',
])

/** Exact, sorted tool set expected for one smoke soul. */
export function expectedSoulTools(...inherited) {
  return [...new Set([...TEAM_TOOL_NAMES, ...inherited])].sort()
}
