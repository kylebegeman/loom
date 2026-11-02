# L11 verification

The first two slices use service tests for checkout ownership, terminal lifecycle, Docker
resource isolation, data preservation, credential handling and authorization. Browser
capture redaction is tested against the existing capture contract. Diagnostics do not
create a second collector.

Run the focused checks from the repository root:

```sh
vp test run apps/server/src/fork/browser-dev-tools apps/server/src/fork/project-profiles/ProjectProfileService.test.ts apps/web/src/fork/panels/registry.test.ts
vp run check:changed
```

`evals/mcp-tool-use/cases/dev-environment.ndjson` covers discovery before starting, read-only
inspection of another conversation's run and retaining database data. Use the MCP eval
runner's dry run before a paid sample; see [its guide](../../../../evals/mcp-tool-use/README.md).
These simulated worlds verify tool selection, not actual process or Docker lifecycle.

For an integrated client pass, use `test-t3-app` against isolated development state and a
small local project. Check the panel picker, command palette and Browser shortcut. Start
an app, observe its owned listener, open its page, inspect existing console/network captures
and add errors to a draft. Restart and stop the recorded run. A failing command must show
its exit code and bounded output. Conversations sharing a checkout reuse its run; another
worktree stays independent. Check a narrow layout as well as desktop.

With Docker available, start a checkout-scoped Compose fixture, inspect health and logs,
and stop it without deleting volumes. Create each database, verify it accepts a connection,
stop/start it, remove its container while retaining data, recreate it, and explicitly delete
its data. Inspect only the fixture's exact container/volume names when cleaning up. A missing
Docker runtime must leave dev-server controls usable. Never use live project data as the
fixture or print credential-bearing connection URLs.

Web and desktop share the panel. Native mobile has the same agent tools and existing
preview links, but no native Development panel in these slices. Do not report a desktop
shell or native-device result from web verification. The request lab remains future work.
