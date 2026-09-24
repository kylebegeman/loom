# L18 seams

## Extension points created by this packet

None specific. It uses `ext-core` (with persistence and a reactor), `ext-panels`,
`ext-settings`, `ext-palette` and `ext-mcp`. Run each existence check; create any missing one
exactly as specified in [EXTENSION-POINTS.md](../EXTENSION-POINTS.md), one commit each, and
record the commits here.

## Packet seams

None.

Everything the packet needs is reachable without editing upstream files:

| Need                                                | How, without a seam                                                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile editor                                      | `ext-settings` section on the Loom page; reads the scope with `useSettingsScope()`                                                                  |
| Env panel                                           | `ext-panels`                                                                                                                                        |
| Run a command with varlock in the thread's terminal | Upstream's public terminal store and atoms (`useTerminalUiStateStore`, `terminalEnvironment.open/.write`), as `ChatView.runProjectScript` uses them |
| Resolve project actions                             | `resolveProjectScripts` from `@t3tools/shared/projectScripts` and `ServerSettingsService` on the server                                             |
| Budget markers in the timeline                      | Existing `thread.activity.append` command dispatched by a fork reactor (EXTENSION-POINTS.md, Orchestration rule 3)                                  |
| Agents reading the profile                          | `ext-mcp` tool                                                                                                                                      |

Rejected seams, recorded so nobody adds them casually:

- Wrapping every upstream project action run with varlock would need seams in
  `apps/web/src/components/ChatView.tsx` (`runProjectScript`, where the terminal write of the
  script command happens at line 4229) and
  `apps/server/src/project/ProjectSetupScriptRunner.ts:343-356`. Not justified; see TECHNICAL,
  "Alternatives considered".
- Budget enforcement would need a decider or `thread.turn.start` seam. Out of scope.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

With no packet seams, any conflict can only come from extension point seams this packet
created. Record the tag and result.

## FORK.md rows

None for packet seams. Extension point rows only if this packet created an extension point.
