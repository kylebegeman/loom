# L11 implementation plan

Ordered steps for one agent. Each phase is shippable on its own; phase 4 adds the desktop
dock through `ext-desktop`.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder. Work in a worktree.
- Fixtures (outside the repo, then trimmed into
  `apps/server/src/fork/browser-dev-tools/__fixtures__/`): the output of
  `docker compose ps --all --format json` in both shapes (array and one object per line) if
  two Compose versions are at hand, otherwise write the second by hand and mark it
  synthetic; a `package.json` with typical scripts; lockfiles for each package manager (empty
  files are enough).
- Never run Docker commands against Kyle's real containers during tests; unit tests fake the
  spawner. The manual check creates and removes only Loom-labeled containers.

## Phase 0: extension points

Existence checks and creation (own commits) for `ext-core`, `ext-panels`, `ext-settings`,
`ext-palette`, `ext-web-root`, `ext-keybindings`, `ext-mcp`. `ext-desktop` waits for phase 4.

## Phase 1: servers and HTTP lab

1. Contracts `packages/contracts/src/fork/browser-dev-tools.ts` (all methods, so later phases
   only add handlers); registration; keybinding commands.
2. Server pure modules with tests: `servers.ts` (candidates, package manager, likely-server
   rules, duplicate hiding, terminal id), `httpLab.ts` (limits, header redaction, text vs binary),
   `obscura.ts` (argv, URL policy), `compose.ts` and `databases.ts` argv and parsers.
3. `migrations.ts`, `store.ts` with `SqlitePersistenceMemory` tests.
4. `DevEnvironmentService.ts`, servers part:
   - Candidates from `ServerSettingsService` + `resolveProjectScripts` and the workspace's
     `package.json` files.
   - Start: terminal open, subscribe, write; state machine driven by `TerminalManager.subscribe`
     events and `PortDiscovery.subscribe` snapshots; `retain` held while anything runs; 8 KB
     tails; `SubscriptionRef` per project feeding `watchServers`.
   - Stop and restart through `TerminalManager.close`.
     Sketch:

   ```ts
   const start = Effect.fn("DevEnvironment.start")(function* (input: {
     threadId: ThreadId;
     key: string;
     useVarlock?: boolean;
   }) {
     const ws = yield* resolveWorkspace(input.threadId);
     const candidate = yield* findCandidate(ws, input.key);
     yield* ensureNotRunning(ws.projectId, input.key); // already-running
     const terminalId = devTerminalId(input.key);
     const command =
       (input.useVarlock ?? candidate.useVarlock) && (yield* varlockReady(candidate.cwd))
         ? `varlock run -- ${candidate.command}`
         : candidate.command;
     yield* terminals.open({
       threadId: input.threadId,
       terminalId,
       cwd: candidate.cwd,
       worktreePath: ws.worktreePath,
       env: candidate.env,
     });
     yield* markStarting(ws.projectId, input.key, input.threadId, terminalId);
     yield* terminals.write({ threadId: input.threadId, terminalId, data: `${command}\r` });
     return yield* currentServer(ws.projectId, input.key);
   });
   ```

   Check `TerminalManager.open`'s input and whether a terminal with that id already exists
   (reuse it: `write` into an idle shell is fine; if it has a running subprocess, stop first).

5. HTTP lab part: `httpSend` with the limits, history write and trim, `httpHistory`,
   `httpClearHistory`.
6. Handlers, scopes, feature slug `browser-dev-tools`.
7. Web: panel with Servers and HTTP tabs, palette source, shortcuts, settings section (HTTP
   history size, clear history). Auto-open preview on `running` for `autoOpenPreview` scripts
   (desktop only; on web open nothing automatically).

## Phase 2: Compose and databases

8. Service: Docker probe, compose discovery, `composeStatus`, `composeAction` (stream),
   `composeLogs`, `composeFollowLogs` (terminal), databases (`createDatabase` stream,
   `databaseAction`, `databaseUrl` with `ServerSecretStore`, `listDatabases` with
   `docker inspect` state), startup orphan sweep for rows of deleted projects.
9. Web: Compose and Databases tabs; confirmation dialogs for `down` and for "Remove and delete
   data"; the remote-environment note on database URLs; settings for images and "Databases of
   removed projects".

## Phase 3: Obscura agent tool

10. `mcp.ts`: `loom_browser_dev_tools_fetch`; settings `obscuraPath`, `obscuraObeyRobots`,
    `obscuraAllowPrivateNetwork`, `agentFetchEnabled`; status card in the settings section.

## Phase 4: dev dock (desktop, needs `ext-desktop`)

11. Run the `ext-desktop` existence check; if it fails, create it exactly as
    EXTENSION-POINTS.md section 13 specifies, in its own commit, with the FORK.md rows.
12. `packages/contracts/src/fork/browser-dev-tools.ts`: `BrowserDevToolsDesktopBridge`:

    ```ts
    export interface DevConsoleEntry {
      seq: number;
      at: number;
      level: "debug" | "info" | "warning" | "error";
      text: string;
      source: string | null;
      line: number | null;
    }
    export interface DevNetworkEntry {
      seq: number;
      at: number;
      method: string;
      url: string;
      resourceType: string;
      status: number | null;
      error: string | null;
      fromCache: boolean;
      durationMs: number | null;
    }
    export interface DevCounts {
      consoleErrors: number;
      consoleWarnings: number;
      networkFailed: number;
    }
    export interface BrowserDevToolsDesktopBridge {
      snapshot: (
        webContentsId: number,
      ) => Promise<{ console: DevConsoleEntry[]; network: DevNetworkEntry[]; counts: DevCounts }>;
      subscribe: (
        webContentsId: number,
        mode: "counts" | "entries",
        listener: (batch: {
          console: DevConsoleEntry[];
          network: DevNetworkEntry[];
          counts: DevCounts;
        }) => void,
      ) => () => void;
      clear: (webContentsId: number) => Promise<void>;
    }
    ```

    Register it in `ForkDesktopBridge`.

13. `apps/desktop/src/fork/browser-dev-tools/collector.ts` (main): webview tracking, listeners,
    ring buffers, subscriptions keyed by `(sender webContents id, webContentsId, mode)`, 250 ms
    batching, cleanup on `destroyed` of either side. `bridge.ts` (preload): `ipcRenderer.invoke`
    and `ipcRenderer.on` wrappers. Register both in the `ext-desktop` fork files.
14. Web: `BrowserDevToolsDock.tsx` and the PreviewView seam; `sendErrors.ts`; dock settings
    (on or off) and the `toggle-dock` command.
15. Guard test: fails when `apps/desktop/src/**` outside `fork/` contains `webRequest.`.

## Phase 5: documentation and finish

16. `docs/fork/user/browser-dev-tools.md`: servers (and that they run in thread terminals),
    varlock, compose, databases (where the data lives, how to remove it, remote URL note), HTTP
    lab (runs on the environment host), the dev dock (desktop), Obscura (install from its
    releases, robots.txt default, private network setting; for Obscura's own MCP server use stdio
    or `obscura mcp --http` on 127.0.0.1 only, never a non-loopback bind without
    `OBSCURA_MCP_TOKEN`).
17. FORK.md rows, packet index Status, README Status.
18. Merge check and definition of done.

## Pitfalls

- Terminal ids are per thread; the same server key in two threads would create two terminals.
  The `already-running` check across threads prevents a second start; stop from any thread uses
  the stored thread id.
- `PortDiscovery` only reports ports that serve HTML (`PortScanner.ts:11-13`); an API-only server
  stays "Running, no page detected" with its terminal still linked. Say so in the row.
- `docker compose ps --format json` changed shape between Compose releases; parse both.
- `docker run` for a missing image pulls first; stream it, and do not apply a short timeout.
- Never pass database passwords through the WebSocket except in `databaseUrl`'s result; never
  log them; redact them from `createDatabase` output lines (`docker run` does not echo `-e`
  values, but check).
- Electron: one listener per `webRequest` event per session. Register once per session, not per
  webview, and route by `details.webContentsId`.
- `console-message` signature changed across Electron majors; use the event-object form of the
  installed version and type it from `electron.d.ts`.
- The dock must not steal focus from the webview or intercept keys while collapsed.
- HTTP lab requests can reach anything the environment host can; keep the `terminal:operate`
  scope.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Starting a Vite dev server from the panel shows its URL within one discovery cycle and opens
  the preview when `autoOpenPreview` is set.
- A page error appears in the dock within a second, and "Send errors to composer" inserts it.
- Opening DevTools on a preview tab does not stop the dock (and does not break upstream agent
  automation beyond what upstream already does).
- Removing a database with "delete data" leaves no Loom-labeled container or volume behind.
