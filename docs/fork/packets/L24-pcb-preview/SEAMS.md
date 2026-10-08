# L24 seams

Core, panels, settings, palette, root, keybindings and MCP existed at the integration
baseline. L24 registers services/contracts/UI in fork-owned files. It adds a small CLI
extension and extends the existing panel presentation integration.

## Upstream changes

- `apps/server/src/processRunner.ts` and its regression test carry two `pcb-preview`
  markers each for optional `extendEnv`. Circuit execution supplies a filtered environment
  with inheritance disabled. Existing process callers retain their behavior.
- `packages/client-runtime/src/state/commandPermissions.test.ts` carries three
  `pcb-preview` markers for the protected PCB operations.
- `apps/server/src/binCli.ts` carries two `ext-cli` markers: import fork commands and spread
  them into the subcommand list. Implementation stays under `fork/cli` and packet folders.
- `apps/server/src/mcp/McpHttpServer.ts` retains two `ext-mcp` markers. Registration delegates
  to each typed fork entry so heterogeneous toolkits preserve their dependencies.
- `apps/web/src/components/ChatView.tsx` carries nine `ext-panels` markers. It mounts the
  fork presentation hook alongside existing panel actions and preserves the canvas keyboard
  exception. This enables acknowledged maximize/restore from editor tools.

[FORK.md](../../../../FORK.md), [the manifest](../../seams.tsv) and
[extension guidance](../EXTENSION-POINTS.md) record these integrations. Composer drafts,
clipboard helpers and the existing signed-file transport require no extra upstream seams.
There are no provider-adapter, native-mobile or deployment-infrastructure seams.

Focused manifest validation is separate from the repository-wide integration script. Merge
rehearsal against a future upstream release belongs to the eventual landing/release step;
this dirty feature worktree has not been merged or published.
