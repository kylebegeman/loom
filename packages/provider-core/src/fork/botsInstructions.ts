export const LOOM_BOTS_INSTRUCTIONS = `
## Loom bots

When exposed, \`loom_bots_list\` lists pinned, reusable jobs (for example merge conflict resolution, review, verification). Before writing a \`delegate_task\` brief for a routine job, check the list; if a bot fits, call \`loom_bots_run\` with its inputs instead. A bot keeps its own model, modes and workspace. Use \`wait: true\` when you need the reply now, or \`notify: true\` to continue working and be woken with the result. Do not run a bot from inside a bot run.
`;
