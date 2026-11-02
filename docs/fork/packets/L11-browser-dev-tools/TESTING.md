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
shell or native-device result from web verification. HTTP request controls are shared with the same web/desktop panel.

The request-service tests cover bounded text/binary responses, timeouts, redirects, credential
redaction, persisted retry receipts, checkout isolation, history bounds, failed storage and
clearing during an in-flight request. The `dev-http.ndjson` eval cases cover sending through
the supported tool and inspecting a saved exchange without replay or clearing.

For live acceptance, use a local fixture with echo, binary, oversized, redirect and delayed
responses. Check status/timing/body, header and query redaction, draft insertion, saved field
loading and history after restarting the isolated server. Test clear cancellation and confirmed
clearing, plus a long history URL at phone width. These requests are intentionally real network
operations against the fixture, not a production API.

API workspace service tests use synthetic native files and real bounded script subprocesses.
They cover native preservation, inherited authentication, explicit environments, script captures
and invalidation, durable retries, stale revisions, binary bytes, dotenv comment preservation,
concurrent file changes and path escapes. `dev-api.ndjson` covers import without execution,
explicit dotenv routing and a single-variable JSON patch. Model simulation is separate from
actual client acceptance.

For client acceptance, import a synthetic collection and environment, browse and search its
folders, edit and save a variable, send to a local fixture, inspect checks and captured values,
and switch explicitly to a fixture dotenv file. Verify that edits must be saved before sending,
that file captures need an explicit save, and that remove cancellation preserves the workspace.
Check large catalogs with lazy endpoint selection and a phone-width layout. Real private packs
may be imported for compatibility inspection, but never run their production requests as a
side effect of import verification.
