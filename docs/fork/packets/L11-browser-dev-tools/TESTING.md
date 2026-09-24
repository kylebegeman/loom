# L11 testing

Focused tests only; no repo-wide checks; no sleeps. State machine tests drive fake terminal and
port discovery events and wait on the `watchServers` stream.

## Automated tests

Server (`apps/server/src/fork/browser-dev-tools/`):

| Test file                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `servers.test.ts`                       | Candidates from project scripts (setup script excluded) and `package.json` (root and workspace packages, limit 30); package manager by lockfile; likely-server ordering; duplicate hiding; varlock wrapping only with `.env.schema` present; stable terminal ids.                                                                                                                                         |
| `DevEnvironmentService.servers.test.ts` | With fake `TerminalManager` and `PortDiscovery` layers: start writes the command after subscribing; `starting` becomes `running` when a discovered server with the matching terminal appears; `exited` on an exit event with the code; `stopped` after close; `already-running` from a second thread; `retain` held only while something starts or runs; restart waits for `closed` before writing again. |
| `httpLab.test.ts`                       | Body cap and truncation flag; binary summary; header redaction in history only; history trimmed to the setting; timeout produces an exchange with `error`. Uses a local test HTTP server started in the test and closed in a finalizer.                                                                                                                                                                   |
| `compose.test.ts`                       | `ps --format json` parsing in array and line-delimited forms; publisher formatting; argv for up, down, restart, pull, logs; missing compose file error.                                                                                                                                                                                                                                                   |
| `databases.test.ts`                     | `docker run` argv for Postgres and Redis (loopback bind, labels, volume, image from settings); URL building; remove with and without data; state mapping for missing containers. Fake spawner and a test `ServerSecretStore` layer.                                                                                                                                                                       |
| `obscura.test.ts`                       | Robots flag before the subcommand when enabled; loopback hosts get `--allow-private-network`; `10.0.0.5` refused unless the setting is on; non-http schemes refused; output cap.                                                                                                                                                                                                                          |
| `store.test.ts`                         | Migrations idempotent; server rows upsert; history order and trim; orphan sweep.                                                                                                                                                                                                                                                                                                                          |
| `mcp.test.ts`                           | Tool name prefix; disabled and missing-Obscura errors.                                                                                                                                                                                                                                                                                                                                                    |

Desktop (`apps/desktop/src/fork/browser-dev-tools/`):

| Test file                 | Covers                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collector.test.ts`       | Ring buffers cap at 500; entries route by `webContentsId`; `onSendHeaders` then `onCompleted` yields a duration; `onErrorOccurred` yields an error entry; counts; batching sends at most one message per 250 ms window per subscriber (driven with Effect's `TestClock` or an injected scheduler, never real timers); destroyed webview drops its buffers and subscriptions. Electron objects are fakes. |
| `webRequestGuard.test.ts` | Reads `apps/desktop/src/**/*.ts` outside `fork/` and fails if any contains `webRequest.`, with a message pointing at this packet.                                                                                                                                                                                                                                                                        |

Contracts: `packages/contracts/src/fork/browser-dev-tools.test.ts`: tags prefixed.

Web (`apps/web/src/fork/browser-dev-tools/`):

| Test file            | Covers                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| `sendErrors.test.ts` | Formatting of console errors and failed requests, limit of 20, empty case.          |
| `autoOpen.test.ts`   | The auto-open decision: once per `startedAt`, `previewUrl` preferred, never on web. |

## Commands

```sh
vp test run apps/server/src/fork/browser-dev-tools apps/desktop/src/fork/browser-dev-tools packages/contracts/src/fork/browser-dev-tools.test.ts apps/web/src/fork/browser-dev-tools
vp test run apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts apps/web/src/fork/panels/registry.test.ts apps/web/src/fork/settings/registry.test.ts packages/contracts/src/fork/keybindings.test.ts
vp lint apps/server/src/fork/browser-dev-tools apps/desktop/src/fork apps/web/src/fork/browser-dev-tools apps/web/src/components/preview/PreviewView.tsx packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/desktop typecheck
```

## Manual check

With Kyle's permission (dev server, desktop app, Docker):

1. Seed the worktree `.t3` and start `vp run dev` in the background; for the dock, run the
   desktop app in development against it (see `docs/operations/development.md`).
2. In a thread on a Vite project: the Servers tab lists `dev` first. Start it: the terminal
   drawer shows it, the row turns Running with `http://localhost:5173`, and with
   `autoOpenPreview` on a project script the preview opens. Stop it: the terminal closes.
3. Introduce a `console.error` and a failing `fetch` in the page: the dock's bar shows the
   counts; expanded lists show them; "Send errors to composer" inserts the block. Open DevTools
   from the preview's menu: the dock keeps updating.
4. Compose: in a project with a compose file, `up`, see services running, read logs, `down`.
5. Databases: create Postgres; copy the URL; connect with `psql`; stop; remove with delete data;
   `docker ps -a --filter label=dev.loom.database` and `docker volume ls` show nothing left.
6. HTTP lab: GET the dev server's `/`, POST JSON to an endpoint; history shows both with
   redacted auth headers.
7. With Obscura installed: ask the agent to fetch a docs page with the Loom fetch tool; it gets
   Markdown; a site whose robots.txt disallows the path returns Obscura's refusal.
8. Web client (`vp run dev` in a browser): the panel works, servers open in a new tab, there is no
   dock.
9. Upstream server: panel entry disabled; the dock still shows console and network in the
   desktop app.

## Merge safety

Record the merge preview result (SEAMS.md) and, after merge, the result of
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`. Packet-seam
file that may conflict: `apps/web/src/components/preview/PreviewView.tsx`; if this packet
created `ext-desktop`, also its three files.
