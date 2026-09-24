# L11 technical design

Upstream citations are to this fork at `a931bd85f3` (upstream v0.0.42), Electron 44.1.0
(`apps/desktop/package.json:27`).

## Overview

```
 desktop renderer (web bundle)                         environment server (ForkLayer)
+----------------------------------------+   RPC   +------------------------------------------+
| Dev environment panel (fork panel)     | ------> | DevEnvironmentService                    |
|  Servers | Compose | Databases | HTTP  | <------ |  servers: TerminalManager (loom-dev-*)   |
+----------------------------------------+  watch  |           + PortDiscovery (upstream)     |
| PreviewView (upstream)                 |         |  compose: docker compose ... (spawner)   |
|  chrome row / webview / ...            |         |  databases: docker run/start/stop/rm     |
|  BrowserDevToolsDock (packet seam) ----+--+      |           secrets: ServerSecretStore     |
+----------------------------------------+  |      |  http lab: fetch on the host, history    |
                                            |      |  obscura: CLI fetch (agent tool)         |
          window.desktopBridge.fork         |      +------------------------------------------+
          .browserDevTools (ext-desktop)    |
+----------------------------------------+  |
| Electron main: DevToolsCollector       |<-+  subscribe(webContentsId) / events (batched)
|  app "web-contents-created" (webview)  |
|  wc "console-message"                  |
|  session.webRequest onSendHeaders /    |
|  onCompleted / onErrorOccurred         |
|  ring buffers, 500 + 500 per webview   |
+----------------------------------------+
```

The server side works on every surface; the dock needs the desktop main process and therefore
the `ext-desktop` extension point.

## What upstream already provides (and this packet reuses)

| Upstream piece                              | Where                                                                                                                                                                                                                                                                                | Use here                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port discovery, PID to terminal attribution | `apps/server/src/preview/PortScanner.ts:43-67` (`PortDiscovery` service: `scan`, `subscribe`, `retain`), fed by the terminal manager (`apps/server/src/terminal/Manager.ts:2411-2415`)                                                                                               | A server's URL is the discovered server whose `terminal` matches `{ threadId, terminalId: "loom-dev-<key>" }`.                                             |
| `DiscoveredLocalServer`                     | `packages/contracts/src/preview.ts:304-316`                                                                                                                                                                                                                                          | Shown per server row.                                                                                                                                      |
| Terminal sessions                           | `apps/server/src/terminal/Manager.ts:146-217` (`open`, `write`, `close`, `subscribe`, `subscribeMetadata`); `TerminalOpenInput` has no command, so commands are written (`packages/contracts/src/terminal.ts:40-49`)                                                                 | Dev servers and "follow logs" terminals.                                                                                                                   |
| Server-side terminal command runner pattern | `apps/server/src/project/ProjectSetupScriptRunner.ts:282-420` (open, subscribe before write, write command)                                                                                                                                                                          | Same pattern for starting servers.                                                                                                                         |
| Project scripts                             | `packages/contracts/src/orchestration.ts:401-425` (`ProjectScript` with `previewUrl`, `autoOpenPreview`); `resolveProjectScripts`, `projectScriptCwd`, `projectScriptRuntimeEnv` (`packages/shared/src/projectScripts.ts:17,40,49`); server use at `ProjectSetupScriptRunner.ts:334` | Server candidates and their cwd and env.                                                                                                                   |
| Open a discovered server in the preview     | `apps/web/src/components/preview/openDiscoveredPort.ts:13-28`                                                                                                                                                                                                                        | "Open in preview".                                                                                                                                         |
| Composer insertion                          | `apps/web/src/composerDraftStore.ts` (`insertTerminalContext` :641, `setPrompt` :571), `ChatComposerHandle.insertTextAtEnd` (`apps/web/src/components/chat/ChatComposer.tsx:1216-1256`)                                                                                              | "Add to composer", "Send errors to composer".                                                                                                              |
| Agent console/network capture               | `apps/desktop/src/preview/Manager.ts:1085-1211` (CDP, failures only, 200 entries, only after a debugger session attaches)                                                                                                                                                            | Not reused: it is agent-only, detaches when DevTools opens, and keeps only failures. The dock uses debugger-free Electron events instead, so both coexist. |
| Element pick and annotation                 | `apps/desktop/src/preview/PickPreload.ts`, `PreviewView.tsx:581-665`, `composerDraftStore.addPreviewAnnotation` (:655)                                                                                                                                                               | Already done upstream; out of scope.                                                                                                                       |

## Contracts

File `packages/contracts/src/fork/browser-dev-tools.ts`.

```ts
export const BROWSER_DEV_TOOLS_WS_METHODS = {
  status: "loom.browser-dev-tools.status",
  watchServers: "loom.browser-dev-tools.watchServers",
  startServer: "loom.browser-dev-tools.startServer",
  stopServer: "loom.browser-dev-tools.stopServer",
  restartServer: "loom.browser-dev-tools.restartServer",
  serverOutput: "loom.browser-dev-tools.serverOutput",
  composeStatus: "loom.browser-dev-tools.composeStatus",
  composeAction: "loom.browser-dev-tools.composeAction",
  composeLogs: "loom.browser-dev-tools.composeLogs",
  composeFollowLogs: "loom.browser-dev-tools.composeFollowLogs",
  listDatabases: "loom.browser-dev-tools.listDatabases",
  createDatabase: "loom.browser-dev-tools.createDatabase",
  databaseAction: "loom.browser-dev-tools.databaseAction",
  databaseUrl: "loom.browser-dev-tools.databaseUrl",
  httpSend: "loom.browser-dev-tools.httpSend",
  httpHistory: "loom.browser-dev-tools.httpHistory",
  httpClearHistory: "loom.browser-dev-tools.httpClearHistory",
  getSettings: "loom.browser-dev-tools.getSettings",
  updateSettings: "loom.browser-dev-tools.updateSettings",
} as const;

export const DevThreadRef = Schema.Struct({ threadId: ThreadId });

export const DevToolStatus = Schema.Struct({
  docker: Schema.Struct({
    available: Schema.Boolean,
    version: Schema.NullOr(Schema.String),
    compose: Schema.NullOr(Schema.String),
    error: Schema.NullOr(Schema.String),
  }),
  varlock: Schema.Struct({
    installed: Schema.Boolean,
    version: Schema.NullOr(Schema.String),
    schemaPresent: Schema.Boolean,
  }),
  obscura: Schema.Struct({ installed: Schema.Boolean, version: Schema.NullOr(Schema.String) }),
  packageManager: Schema.NullOr(Schema.Literals(["pnpm", "bun", "yarn", "npm"])),
  composeFiles: Schema.Array(Schema.String), // workspace-relative
});

export const DevServerSource = Schema.Literals(["project-script", "package-json"]);
export const DevServerState = Schema.Literals(["stopped", "starting", "running", "exited"]);

export const DevServer = Schema.Struct({
  /** Stable per project: `script:<scriptId>` or `pkg:<relative package dir>:<script name>`. */
  key: TrimmedNonEmptyString,
  label: Schema.String,
  source: DevServerSource,
  command: Schema.String, // the exact command line written to the terminal
  cwd: Schema.String,
  previewUrl: Schema.NullOr(Schema.String), // from ProjectScript.previewUrl
  autoOpenPreview: Schema.Boolean,
  likelyDevServer: Schema.Boolean, // dev/start/serve/preview/storybook or a known dev tool in the command
  useVarlock: Schema.Boolean,
  state: DevServerState,
  threadId: Schema.NullOr(ThreadId), // the owning thread: where it runs
  /** The owning thread's worktree when started; null = the project root. The client shows the folder name. */
  worktreePath: Schema.NullOr(Schema.String),
  terminalId: Schema.NullOr(Schema.String), // "loom-dev-<hash of key>"
  urls: Schema.Array(Schema.String), // from PortDiscovery, matched by terminal
  exitCode: Schema.NullOr(Schema.Int),
  startedAt: Schema.NullOr(Schema.String),
});

export const ComposeService = Schema.Struct({
  name: Schema.String,
  container: Schema.NullOr(Schema.String),
  state: Schema.String, // running, exited, ...
  health: Schema.NullOr(Schema.String),
  ports: Schema.Array(Schema.String), // "127.0.0.1:5432->5432/tcp"
});

export const ComposeActionEvent = Schema.Union([
  Schema.TaggedStruct("output", { line: Schema.String }),
  Schema.TaggedStruct("done", { exitCode: Schema.Int }),
]);

export const LocalDatabase = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  engine: Schema.Literals(["postgres", "redis"]),
  name: Schema.String, // display name, also the Postgres database name
  image: Schema.String,
  container: Schema.String,
  volume: Schema.String,
  hostPort: Schema.Int,
  state: Schema.Literals(["running", "stopped", "missing", "unknown"]),
  createdAt: Schema.String,
});

export const HttpRequestSpec = Schema.Struct({
  method: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(8192)),
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])).check(
    Schema.isMaxLength(100),
  ),
  body: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024 * 1024))),
  followRedirects: Schema.Boolean,
  timeoutMs: Schema.Int, // 1000..120000
});

export const HttpExchange = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  request: HttpRequestSpec,
  response: Schema.NullOr(
    Schema.Struct({
      status: Schema.Int,
      statusText: Schema.String,
      headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
      body: Schema.String, // text; binary shown as "<n bytes, content-type>"
      bodyTruncated: Schema.Boolean,
      sizeBytes: Schema.Number,
      finalUrl: Schema.String,
    }),
  ),
  error: Schema.NullOr(Schema.String),
  timing: Schema.Struct({
    startedAt: Schema.String,
    headersMs: Schema.NullOr(Schema.Number),
    totalMs: Schema.Number,
  }),
});

export const CreateDatabaseEvent = Schema.Union([
  Schema.TaggedStruct("output", { line: Schema.String }),
  Schema.TaggedStruct("created", { database: LocalDatabase }),
  Schema.TaggedStruct("done", { exitCode: Schema.Int }),
]);

export const DevToolsSettings = Schema.Struct({
  obscuraPath: Schema.NullOr(Schema.String),
  obscuraObeyRobots: Schema.Boolean, // default true
  obscuraAllowPrivateNetwork: Schema.Boolean, // default false; loopback is always allowed
  agentFetchEnabled: Schema.Boolean, // default true when obscura is installed
  postgresImage: Schema.String, // default "postgres:17-alpine"
  /** The "Redis (Valkey)" option's image; any Redis-protocol image with the docker-library entrypoint works. */
  redisImage: Schema.String, // default "valkey/valkey:8-alpine"
  httpHistorySize: Schema.Int, // default 50
});

export class DevToolsError extends Schema.TaggedError<DevToolsError>()("DevToolsError", {
  reason: Schema.Literals([
    "workspace-not-found",
    "server-not-found",
    "already-running",
    "docker-unavailable",
    "compose-file-not-found",
    "database-not-found",
    "invalid-request",
    "command-failed",
    "timeout",
    "tool-missing",
  ]),
  message: Schema.String,
}) {}
```

| Tag                             | Payload                                                                       | Success                                                                                                                                    | Stream         | Scope                                         |
| ------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------- |
| `status`                        | `DevThreadRef`                                                                | `DevToolStatus`                                                                                                                            | no             | `orchestration:read`                          |
| `watchServers`                  | `DevThreadRef`                                                                | `{ servers: DevServer[] }`                                                                                                                 | subscription   | `orchestration:read`                          |
| `startServer`                   | `{ threadId, key, useVarlock? }`                                              | `DevServer`                                                                                                                                | no             | `terminal:operate`                            |
| `stopServer`, `restartServer`   | `{ threadId, key }`                                                           | `DevServer`                                                                                                                                | no             | `terminal:operate`                            |
| `serverOutput`                  | `{ threadId, key }`                                                           | `{ tail: string }` (last 8 KB)                                                                                                             | no             | `orchestration:read`                          |
| `composeStatus`                 | `{ threadId, file }`                                                          | `{ services: ComposeService[] }`                                                                                                           | no             | `orchestration:read`                          |
| `composeAction`                 | `{ threadId, file, action: "up" \| "down" \| "restart" \| "pull", service? }` | `ComposeActionEvent`                                                                                                                       | stream command | `terminal:operate`                            |
| `composeLogs`                   | `{ threadId, file, service, tail? }`                                          | `{ text }` (at most 200 lines, 64 KB)                                                                                                      | no             | `orchestration:read`                          |
| `composeFollowLogs`             | `{ threadId, file, service? }`                                                | `{ terminalId }`                                                                                                                           | no             | `terminal:operate`                            |
| `listDatabases`                 | `DevThreadRef`                                                                | `{ databases: LocalDatabase[] }`                                                                                                           | no             | `orchestration:read`                          |
| `createDatabase`                | `{ threadId, engine, name? }`                                                 | `CreateDatabaseEvent` (`output` lines while the image pulls, then `created` with the `LocalDatabase`, or `done` with a non-zero exit code) | stream command | `terminal:operate`                            |
| `databaseAction`                | `{ id, action: "start" \| "stop" \| "remove", deleteData? }`                  | `LocalDatabase`                                                                                                                            | no             | `terminal:operate`                            |
| `databaseUrl`                   | `{ id }`                                                                      | `{ url }`                                                                                                                                  | no             | `terminal:operate` (it reveals a secret)      |
| `httpSend`                      | `{ threadId, request: HttpRequestSpec }`                                      | `HttpExchange`                                                                                                                             | no             | `terminal:operate`                            |
| `httpHistory`                   | `DevThreadRef`                                                                | `{ exchanges: HttpExchange[] }` (bodies trimmed to 4 KB in the list)                                                                       | no             | `orchestration:read`                          |
| `httpClearHistory`              | `{ projectId? }`                                                              | void                                                                                                                                       | no             | `orchestration:operate`                       |
| `getSettings`, `updateSettings` | `{}`, partial                                                                 | `DevToolsSettings`                                                                                                                         | no             | `orchestration:read`, `orchestration:operate` |

`watchServers` joins `ForkSubscriptionRpcTag`; `composeAction` and `createDatabase` join
`ForkStreamCommandRpcTag`. Every error union is `Schema.Union([DevToolsError,
EnvironmentAuthorizationError])`.

## Server

Directory `apps/server/src/fork/browser-dev-tools/`:

| File                                            | Contents                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DevEnvironmentService.ts`                      | `loom/DevEnvironmentService`: status, servers, compose, databases, HTTP lab, settings.                                                            |
| `servers.ts`                                    | Candidate discovery (pure given file contents), command building, terminal ids.                                                                   |
| `compose.ts`                                    | `docker compose ps --format json` parsing (a JSON array in older Compose v2, one JSON object per line in newer ones; accept both), argv builders. |
| `databases.ts`                                  | `docker run` argv, labels, URL building.                                                                                                          |
| `httpLab.ts`                                    | Request execution with limits, redaction of `Authorization` and `Cookie` values in history.                                                       |
| `obscura.ts`                                    | Argv, URL policy, output cap.                                                                                                                     |
| `store.ts`, `migrations.ts`, `rpc.ts`, `mcp.ts` | Storage and transport.                                                                                                                            |

Upstream services from `ForkLayer`: `TerminalManager`, `PortDiscovery`,
`ServerSettingsService` (project scripts), `ProjectionSnapshotQuery` (+
`resolveThreadWorkspaceCwd`, `apps/server/src/checkpointing/Utils.ts:12`), `ServerSecretStore`
(`apps/server/src/auth/ServerSecretStore.ts:138-150`: `get`, `set`, `create`,
`getOrCreateRandom`, `remove`), `ChildProcessSpawner`, `ProcessRunner` (provided locally as upstream does), `NetService`
from `@t3tools/shared/Net` for free ports (as `LocalDeviceHost.ts` does), `HttpClient` for the
HTTP lab.

### Dev servers

Candidates for the thread's project:

1. Upstream project scripts: `resolveProjectScripts(settings, project)` exactly as
   `ProjectSetupScriptRunner.ts:334`. Key `script:<id>`. cwd and env from
   `projectScriptCwd` and `projectScriptRuntimeEnv`. `setupProjectScript` entries
   (`runOnWorktreeCreate`) are excluded.
2. `package.json` scripts in the workspace root and in workspace packages one level down
   (`apps/*`, `packages/*` only when a `pnpm-workspace.yaml`, `package.json#workspaces` or
   `bun` workspace lists them; at most 30 packages). Key `pkg:<dir>:<name>`. Command
   `<pm> run <name>` with the package manager from the lockfile (`pnpm-lock.yaml` pnpm,
   `bun.lock`/`bun.lockb` bun, `yarn.lock` yarn, else npm; old Loom's order). A project script
   whose command equals a package script's command hides the duplicate.
3. `likelyDevServer`: name in `dev`, `start`, `serve`, `preview`, `storybook` (old Loom's
   priority order), or the command mentions `vite`, `next`, `astro`, `remix`, `nuxt`,
   `storybook`, `webpack-dev-server`, `expo`. Likely servers sort first.

Starting (`startServer`):

- If a row for this project and key is `starting` or `running` in any thread, fail with
  `already-running` naming the thread (the client offers "Open thread" and "Stop", the latter
  with the other-thread confirmation below).
- Terminal id `loom-dev-<first 10 hex of sha256(key)>`. `TerminalManager.open({ threadId,
terminalId, cwd, worktreePath, env })`, subscribe to the terminal's events first, then
  `write({ data: command + "\r" })`, following `ProjectSetupScriptRunner.ts:282-420`.
- `useVarlock` and varlock present and `<cwd>/.env.schema` exists: the command becomes
  `varlock run -- <command>`.
- State: `starting` until `PortDiscovery` reports a server whose `terminal` equals this terminal,
  then `running` with its URLs; an `exited` terminal event sets `exited` with the code; a
  closed terminal sets `stopped`. The terminal's `activity.hasRunningSubprocess` going false
  while `starting` also means `exited` (shell still open, command ended).
- The service holds one `PortDiscovery.retain` scope while any fork dev server is starting or
  running, so upstream's 3 second scan runs only then (`PortScanner.ts:73,584,598`).
- Output tail: the last 8 KB of the terminal's `output` events, kept in memory per server (old
  Loom's rolling tail). Not persisted.
- `autoOpenPreview` / `previewUrl`: when a server becomes `running`, `watchServers` carries
  `urls`; the client opens the preview once per start (desktop) when `autoOpenPreview` is true,
  preferring `previewUrl` if set, else the first discovered URL. Server-side nothing opens UI.

Stopping: `TerminalManager.close({ threadId, terminalId })`, which ends the PTY and its process
tree the way closing a terminal tab does. Restart is stop, wait for the `closed` event, start.

Any thread of the project can stop or restart a server:

- `stopServer` and `restartServer` take `{ threadId, key }`, where `threadId` is the calling
  thread and only identifies the project (through `resolveWorkspace`). The service acts on the
  owning thread and terminal stored for that key, never on the caller's terminal. Restart
  starts again in the owning thread, with its cwd and worktree, so a server keeps its home.
  A caller in another project gets `server-not-found`.
- Both need `terminal:operate`, the same scope in every thread; there is no per-thread
  authorization, because threads of one environment share one operator.
- The confirmation for another thread's server is a client-side guard: the row compares
  `server.threadId` with the panel's thread, and when they differ Stop and Restart open
  "Stop the dev server running in <thread title>? Its terminal in that thread closes."
  ("Restart" wording for restart). The thread title comes from the client's thread shells
  (`useThreadShells`, `apps/web/src/state/entities.ts:77-79`); the link opens
  `/$environmentId/$threadId`. "Stop all dev servers" in the palette shows one confirmation
  listing the servers of other threads, if any.
- Deleting the owning thread stops its servers: upstream's thread deletion closes all of the
  thread's terminals (`apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts:53-65`),
  and the terminal's `closed` event sets the row to `stopped`.

Persistence: `fork_browser_dev_tools_servers` remembers per project and key the last thread,
terminal id, `use_varlock` and last exit code, so the panel can show "Last run exited with 1"
after a server restart. Runtime state is rebuilt from `TerminalManager` on startup (terminals do
not survive a server restart, so rows reset to `stopped`).

### Docker Compose

- Probe once per 60 s: `docker version --format '{{json .}}'` (daemon reachable?) and
  `docker compose version --short`.
- Files: `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml` in the
  workspace root and one level down (old Loom's list).
- Project name: `loom-<projectId short>` is not used; Compose's default (directory name) is kept
  so the stack matches what Kyle runs by hand. Commands always pass `-f <file>`.
- Status: `docker compose -f <file> ps --all --format json`; map `Service`, `Name`, `State`,
  `Health`, `Publishers` (to "host:published->target/protocol").
- Actions: `up -d [service]`, `down`, `restart <service>`, `pull`; streamed through
  `ChildProcessSpawner` as `ComposeActionEvent`s; timeout 15 minutes.
- Logs: `docker compose -f <file> logs --no-color --tail 200 <service>`; "Follow" opens a thread
  terminal `loom-compose-logs-<hash>` and writes `docker compose -f <file> logs -f --tail 50
[service]`.

### Local databases

- Create: pick a free loopback port (`NetService`), generate a 24-byte random password, and run

  ```
  docker run -d --name loom-<proj8>-<engine>-<id6>
    --label dev.loom.project=<projectId> --label dev.loom.database=<id>
    -p 127.0.0.1:<port>:<5432|6379>
    -v loom-<proj8>-<engine>-<id6>:<data dir>
    postgres: -e POSTGRES_USER=loom -e POSTGRES_PASSWORD=<pw> -e POSTGRES_DB=<name> <postgresImage>
    redis:    <redisImage> --requirepass <pw> --appendonly yes
  ```

  The Redis option passes only flags after the image, so the image's own entrypoint picks the
  server binary: the docker-library entrypoint prepends `valkey-server` (Valkey) or
  `redis-server` (Redis) when the first argument starts with `-` (checked in
  valkey-io/valkey-container `docker-entrypoint.sh` and docker-library/redis
  `docker-entrypoint.sh` on 2026-09-24). A custom image without that entrypoint must accept the
  same flags; the settings help says so. The engine id stays `redis` (it names the protocol).

  Data dirs: `/var/lib/postgresql/data` (Postgres), `/data` (both the Valkey and the Redis
  images use `WORKDIR /data`). The image pull streams as
  output events. The password goes to `ServerSecretStore` under
  `loom-browser-dev-tools-db-<id>`; the row stores no secret.

- URL: `postgres://loom:<pw>@127.0.0.1:<port>/<name>` or `redis://:<pw>@127.0.0.1:<port>/0`,
  built only in `databaseUrl`.
- State: `docker inspect --format '{{json .State}}' <container>`; a missing container shows
  `missing` with "Recreate" (same volume) and "Forget".
- Remove: `docker rm -f <container>`, then `docker volume rm <volume>` only with `deleteData`;
  delete the secret and the row.
- Loom never touches containers without its `dev.loom.database` label.

### HTTP lab

- Executed with upstream's `HttpClient` (or Node `fetch` with `AbortSignal.timeout`), manual or
  followed redirects, `timeoutMs` 1 to 120 seconds.
- Response body read up to 2 MiB; text types (JSON, text, XML, HTML, JavaScript) decoded as
  UTF-8, anything else summarized as "<n bytes, content-type>". JSON is pretty-printed client
  side.
- Timing: `headersMs` when headers arrive, `totalMs` when the body is read.
- History: the last `httpHistorySize` exchanges per project in
  `fork_browser_dev_tools_http_history`; stored response bodies are trimmed to 64 KB; header
  values of `authorization`, `cookie`, `set-cookie`, `proxy-authorization` and `x-api-key` are
  replaced with `<redacted>` in history (the live response shows them once).
- "Add to composer" formats `METHOD URL`, status, selected headers and the first 4 KB of the body
  as a fenced block.

### Obscura (agent fetch)

- Located via the `obscuraPath` setting or `PATH`. The release archives ship `obscura` and
  `obscura-worker`; only `fetch` is used, which needs just `obscura`.
- Command: `obscura [--obey-robots] [--allow-private-network] fetch <url> --dump
<markdown|text|links> --timeout 30 --quiet`. `--obey-robots` and `--allow-private-network`
  are top-level flags and go before the subcommand (Obscura CLI reference).
- URL policy (checked before spawning): `http` and `https` only. Hosts `localhost`,
  `127.0.0.0/8` and `::1` get `--allow-private-network` automatically (local dev servers);
  other private or link-local literals, and names that resolve to them, are refused unless
  `obscuraAllowPrivateNetwork` is on. Obscura also checks at DNS resolution time; Loom's check is
  a second fence, not the only one.
- Output capped at 200 KB (truncated with a note). Exit non-zero: the tool returns stderr's last
  lines.
- Loom never starts `obscura mcp` or `obscura serve`.

## Desktop: console and network collector (`ext-desktop`)

`apps/desktop/src/fork/browser-dev-tools/collector.ts`, installed from
`installForkDesktopIpcHandlers` (SEAMS.md):

- `app.on("web-contents-created", (_event, wc) => ...)`, keeping only `wc.getType() ===
"webview"`. Upstream's only webviews are preview tabs (`HostedBrowserWebview.tsx:290-334`,
  hardened by `will-attach-webview` in `apps/desktop/src/window/DesktopWindow.ts:513-525`). Also
  walk `webContents.getAllWebContents()` once at install time for webviews created earlier.
- Console: `wc.on("console-message", (event) => ...)` with Electron 44's event object (`level`,
  `message`, `lineNumber`, `sourceId`; verify the shape in the installed Electron typings, it
  changed from positional arguments in earlier majors). Entry `{ seq, at, level, text (capped at
4 KB), source, line }`.
- Network: per webview session, once, `session.webRequest.onSendHeaders`, `onCompleted` and
  `onErrorOccurred` with filter `{ urls: ["<all_urls>"] }`, routed by `details.webContentsId`.
  Entry `{ seq, at, method, url (capped 2 KB), resourceType, status | null, error | null,
fromCache, durationMs }`. These listeners are passive (no callback), add no latency, and do not
  attach a debugger, so upstream's CDP automation (`Manager.ts:1233-1376`) is unaffected and
  DevTools can be open.
- Ring buffers of 500 console and 500 network entries per `webContentsId`, dropped on
  `wc.on("destroyed")`. Reload clears nothing; the dock has "Clear".
- IPC (channels `loom:browser-dev-tools:<name>`):
  - `snapshot(webContentsId)` returns both buffers.
  - `subscribe(webContentsId)` / `unsubscribe(webContentsId)`; while subscribed, new entries are
    sent to the subscribing renderer (`event.sender`) in batches every 250 ms on
    `loom:browser-dev-tools:events`, at most 200 entries per batch.
  - `clear(webContentsId)`.

Electron allows one listener per `webRequest` event per session: a later `onCompleted(...)` call
replaces the earlier one. Upstream registers none today (`git grep "webRequest\."` in
`apps/desktop/src` finds nothing). A fork test fails if upstream starts using `webRequest.` in
`apps/desktop/src` outside `fork/`, so a merge that adds one is caught before it silently breaks
either side.

## Clients

- `packages/client-runtime/src/fork/browser-dev-tools.ts`: atoms for all server methods.
- `packages/contracts/src/fork/desktop.ts` (created by `ext-desktop`) gains
  `browserDevTools?: BrowserDevToolsDesktopBridge` with `snapshot`, `subscribe(webContentsId,
listener) => unsubscribe`, `clear`.
- `apps/web/src/fork/browser-dev-tools/`:
  - `panel.tsx`: `{ id: "browser-dev-tools", title: "Dev environment", icon: ServerCogIcon,
shortcut: "V", unavailableHint: "Needs a Loom server with dev tools", isAvailable:
threadRef !== null && loomFeatures.includes("browser-dev-tools") }`; lazy body with the four
    sections as tabs.
  - `ServersSection.tsx`: rows with state, URLs, Start/Stop/Restart, "Show in terminal" (opens the
    drawer on that terminal with `useTerminalUiStateStore` `setTerminalOpen` / `setActiveTerminal`,
    `apps/web/src/terminalUiStateStore.ts:567-577`), "Open in preview" (desktop,
    `openDiscoveredPort`) or "Open in browser" (web), output tail popover, varlock toggle.
    Auto-open on `running` for `autoOpenPreview` scripts, once per `startedAt`.
  - `ComposeSection.tsx`, `DatabasesSection.tsx`, `HttpLabSection.tsx`.
  - `BrowserDevToolsDock.tsx`: rendered by the PreviewView seam with `threadRef`, `tabId`
    (runtime tab id) and `visible`. Returns `null` when `window.desktopBridge?.fork?.browserDevTools`
    is absent or the dock is turned off. Finds the tab's `webContentsId` from upstream's preview
    bridge state events (`previewBridge.onStateChange`, `DesktopPreviewTabState.webContentsId`,
    `packages/contracts/src/ipc.ts:710-712`) with the `<webview data-preview-tab="<runtimeTabId>">`
    element's `getWebContentsId()` (`HostedBrowserWebview.tsx:303`) as the initial value.
    Collapsed: a 28 px bar ("Console 3 errors, 1 warning | Network 2 failed | 2 servers") and a
    chevron. Expanded: resizable (drag handle, 120 to 60% of the panel height), height stored in
    `loom:browser-dev-tools:dock-height:v1`, tabs Console and Network, level and text filters,
    virtualized lists, "Send errors to composer". Subscribes to the collector only while visible
    and expanded; while collapsed it reads counts from a lightweight subscription that sends only
    counts (the collector batches counts the same way).
  - `sendErrors.ts`: formats the last 20 console errors and failed requests as a text block and
    inserts it through the mounted composer handle or the draft store.
  - `palette.tsx`, `shortcuts.tsx`, `settings.tsx`.
- The dock shrinks the preview's content area; `BrowserSurfaceSlot` measures itself with a
  `ResizeObserver` (`apps/web/src/browser/BrowserSurfaceSlot.tsx:65`) and the fixed-position
  webview follows, so no upstream change is needed for layout.

## Agent-facing tools

One tool, registered through `ext-mcp`:

```ts
const FetchTool = Tool.make("loom_browser_dev_tools_fetch", {
  description:
    "Fetch a web page with the Obscura headless browser and return it as markdown, text or links. " +
    "Fast and light; obeys robots.txt. Use the preview_* tools to interact with pages instead.",
  parameters: Schema.Struct({
    url: Schema.String,
    format: Schema.optional(Schema.Literals(["markdown", "text", "links"])),
  }),
  success: Schema.Struct({
    url: Schema.String,
    format: Schema.String,
    content: Schema.String,
    truncated: Schema.Boolean,
  }),
  failure: DevToolsToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Fetch page")
  .annotate(Tool.Readonly, true);
```

Enabled when Obscura is found and `agentFetchEnabled` is on; otherwise the call fails with
"Obscura is not installed on this environment" or "Page fetch is turned off in Loom settings".
The tool is always listed (EXTENSION-POINTS.md: `tools/list` is not filtered), so the
description stays short. No dev server or compose tools for agents: they already have
terminals, and upstream's preview tools cover the browser.

## Storage

Tracking table `fork_migrations_browser_dev_tools`.

```sql
-- 1_Servers
CREATE TABLE IF NOT EXISTS fork_browser_dev_tools_servers (
  project_id TEXT NOT NULL,
  server_key TEXT NOT NULL,
  last_thread_id TEXT,
  terminal_id TEXT NOT NULL,
  use_varlock INTEGER NOT NULL DEFAULT 0,
  last_started_at TEXT,
  last_exit_code INTEGER,
  PRIMARY KEY (project_id, server_key)
);

-- 2_Databases
CREATE TABLE IF NOT EXISTS fork_browser_dev_tools_databases (
  id TEXT PRIMARY KEY,               -- "db_" + 12 hex
  project_id TEXT NOT NULL,
  engine TEXT NOT NULL,              -- postgres | redis
  name TEXT NOT NULL,
  image TEXT NOT NULL,
  container TEXT NOT NULL UNIQUE,
  volume TEXT NOT NULL,
  host_port INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_browser_dev_tools_databases_project
  ON fork_browser_dev_tools_databases (project_id);

-- 3_HttpHistory
CREATE TABLE IF NOT EXISTS fork_browser_dev_tools_http_history (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  exchange_json TEXT NOT NULL        -- HttpExchange with redacted headers and trimmed body
);
CREATE INDEX IF NOT EXISTS fork_browser_dev_tools_http_history_project
  ON fork_browser_dev_tools_http_history (project_id, created_at DESC);

-- 4_Settings
CREATE TABLE IF NOT EXISTS fork_browser_dev_tools_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
```

Orphans: rows of deleted projects are removed by a startup sweep against the projection.
Database containers of a deleted project are not removed automatically; the settings section
lists "Databases of removed projects" with Remove buttons (containers hold data; deleting them
must be deliberate).

## Performance

- `watchServers` emits only on state or URL changes, with at most the project's candidates
  (tens of rows). Output tails are pulled on demand, never streamed through the subscription.
- `PortDiscovery.retain` is held only while a fork server is starting or running.
- Compose and database status are fetched when their tab is visible, plus after each action; no
  polling timers.
- The collector keeps bounded buffers in the main process and sends batched events only to
  subscribed renderers, every 250 ms at most; nothing is sent while the dock is collapsed except
  count changes.
- The dock uses virtualized lists and no animation; collapsing unsubscribes.

## Alternatives considered

- **Reuse upstream's CDP capture for the dock.** It exists only for agents, keeps only failed
  requests, attaches the debugger on first automation, and is torn down when DevTools opens.
  Reading it would need seams in `apps/desktop/src/preview/Manager.ts` (5,020 lines). The
  debugger-free events need none.
- **Dev servers as hidden child processes.** Cleaner exit codes, but no terminal drawer view, no
  upstream PID-to-terminal port attribution, and agents could not see them.
- **Replacing the preview panel.** The brief says to extend it; upstream's preview is better than
  old Loom's.
- **A fork HTTP proxy that records preview traffic for the HTTP lab.** Old Loom's lab never did
  this for real; the dock's network list covers observation.
