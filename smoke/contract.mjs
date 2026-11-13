/** Team tools registered by the DSH 0.2.2 base composition for every live member. */
export const TEAM_TOOL_NAMES = Object.freeze([
  'list_agents',
  'send_message',
  'wait_agent',
  'team_task_create',
  'team_task_get',
  'team_task_list',
  'team_task_update',
])

/** Exact, sorted tool set expected for one soul teammate. */
export function expectedSoulTools(...inherited) {
  return [...new Set([...TEAM_TOOL_NAMES, ...inherited])].sort()
}
