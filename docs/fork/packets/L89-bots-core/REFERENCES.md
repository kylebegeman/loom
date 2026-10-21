# L89 references

- `apps/server/src/orchestration-v2/ThreadLaunchService.ts`: `launch`, `checkWorktreeBase`.
- `apps/server/src/orchestration-v2/ThreadManagementService.ts`: `waitForThread`,
  `interruptThread`, `getProjectThreadRecords`.
- `apps/server/src/scheduledTasks/ScheduledTaskService.ts`: `runTask`, the closest existing
  "server launches a thread from a stored prompt" flow.
- `apps/server/src/scheduledTasks/webhookTemplate.ts`: `{{path}}` placeholder rendering.
- `apps/server/src/mcp/toolkits/project/handlers.ts`: scratch launches through
  `ManagedProjectFolders.ensureScratchProject`.
- `apps/server/src/fork/device-qa/`: fork store, reactor, RPC and MCP layout for runs.
- `apps/web/src/components/Sidebar.logic.ts` `filterSidebarV2VisibleThreads` and
  `packages/client-runtime/src/state/threadShell.ts` navigation shells: the subagent filters
  bot runs join.
- Prior art: GitHub Actions reusable workflows (typed inputs, pinned runners), Claude Code
  subagents (named roles with fixed prompts and tools), OpenAI Assistants (pinned instructions
  and model per assistant).
