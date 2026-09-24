# L11 references

Sources for this packet. Treat external repositories as references, not code to copy.

## Old Loom

Selection P13 ("Dev servers, Docker, local databases, HTTP lab, console and network
diagnostics, inside the browser panel") in [selections.md](../../selections.md). In old Loom
all four panels were side panels of
[apps/web/src/components/preview/PreviewView.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/preview/PreviewView.tsx).

| File                                                                                                                                                                                                                                                              | Keep / adapt / drop                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/components/preview/PreviewDevEnvironmentPanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/preview/PreviewDevEnvironmentPanel.tsx) (875)                                                                           | Adapt: three sub-panels (dev server, Docker, local DB), the "dev" pill for likely entry points, start/stop/restart, output preview. Drop its embedded terminal viewport (upstream's drawer shows the terminal) and the read-only query box (Database Studio is a separate app). |
| [apps/server/src/previewDevEnvironment/Layers/DevServerManager.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/previewDevEnvironment/Layers/DevServerManager.ts) (797)                                                                       | Adapt: script discovery and priority (`dev`, `start`, `serve`, `preview`, `storybook`), dev-tool detection in commands, lockfile to package manager, the 8,000-character rolling tail, URL by PID or owning terminal. Drop the self-approving decision receipts.                |
| [apps/server/src/previewDevEnvironment/Layers/DockerStackManager.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/previewDevEnvironment/Layers/DockerStackManager.ts) (528)                                                                   | Adapt: compose file names, `ps --format json` with fallback, state and health mapping, `Publishers` formatting. Drop the execution sandbox.                                                                                                                                     |
| [apps/server/src/previewDevEnvironment/Layers/LocalDbManager.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/previewDevEnvironment/Layers/LocalDbManager.ts) (1,358)                                                                         | Adapt a small part: Postgres and Redis containers on an allocated loopback port, URI format. Drop SQLite provisioning, snapshots, schema views and the query guard.                                                                                                             |
| [apps/web/src/components/preview/HttpLabPanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/preview/HttpLabPanel.tsx) (157), [apps/server/src/httpLab/](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/httpLab) | Drop: the lab only recorded requests to its own fixture routes, kept them in a module-level array, and hard-coded timings to 0. The list/inspector layout is a fine reference.                                                                                                  |
| [apps/web/src/components/preview/PreviewDiagnosticsPanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/preview/PreviewDiagnosticsPanel.tsx) (129)                                                                                 | Keep the UX: console and network tabs, issue badge counting console errors and warnings plus failed or 4xx/5xx requests. The data source changes (debugger-free events instead of CDP snapshots).                                                                               |
| [apps/web/src/components/preview/ScenarioRunner.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/preview/ScenarioRunner.tsx) (198)                                                                                                   | Drop: saved scenarios with `steps: []` and a visual diff that returned 0% or 100%.                                                                                                                                                                                              |
| [packages/desktop-host/src/preview/PickPreload.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/desktop-host/src/preview/PickPreload.ts) (1,305)                                                                                                     | Not needed: upstream now has its own pick and annotate implementation.                                                                                                                                                                                                          |

## Upstream T3 Code

| Path                                                                                                                             | Why                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/preview/PreviewView.tsx:65,143,153,581-665,713-777,760-774,823-824`                                     | Seam site, runtime tab id, desktop overlay, pick handler, chrome row, trailing actions, content and root closing tags. |
| `apps/web/src/components/preview/PreviewPanel.tsx:31-41`, `apps/web/src/previewStateStore.ts:462-465`                            | Preview is desktop-only; web shows a message.                                                                          |
| `apps/web/src/browser/HostedBrowserWebview.tsx:127-145,272-279,290-334,303`                                                      | The `<webview>`, `registerWebview`, fixed positioning, `data-preview-tab`.                                             |
| `apps/web/src/browser/BrowserSurfaceSlot.tsx:65`                                                                                 | `ResizeObserver` that lets the dock shrink the page area.                                                              |
| `apps/desktop/src/preview/Manager.ts:148,1085-1211,1233-1376,2416-2431`                                                          | Upstream's CDP capture, its 200-entry limit, the control session, DevTools detaching it.                               |
| `apps/desktop/src/window/DesktopWindow.ts:513-525`                                                                               | `will-attach-webview` hardening.                                                                                       |
| `packages/contracts/src/ipc.ts:710-712,921-1070,1214,1348-1435`                                                                  | `DesktopPreviewTabState.webContentsId`, pick payloads, `DesktopBridge`, `DesktopPreviewBridge`.                        |
| `apps/desktop/src/ipc/DesktopIpcHandlers.ts:3,74`, `apps/desktop/src/preload.ts:11,64`, `apps/desktop/src/ipc/DesktopIpc.ts:189` | `ext-desktop` seam sites and `makeIpcMethod`.                                                                          |
| `apps/server/src/preview/PortScanner.ts:11-13,43-67,69-73,516-526,584,598,625`                                                   | Port discovery service, HTML-only publishing, polling and retain, terminal attribution.                                |
| `packages/contracts/src/preview.ts:304-316`                                                                                      | `DiscoveredLocalServer`.                                                                                               |
| `apps/server/src/terminal/Manager.ts:146-217,2411-2415`                                                                          | Terminal service and process registration.                                                                             |
| `packages/contracts/src/terminal.ts:40-49,160-220`                                                                               | `TerminalOpenInput` (no command) and terminal events.                                                                  |
| `apps/server/src/project/ProjectSetupScriptRunner.ts:180-191,205-280,282-420,334`                                                | Server-side terminal command pattern and project script resolution.                                                    |
| `packages/contracts/src/orchestration.ts:401-425`                                                                                | `ProjectScript` including `previewUrl` and `autoOpenPreview`.                                                          |
| `packages/shared/src/projectScripts.ts:17,40,49,64`                                                                              | Script resolution, cwd, env, setup script.                                                                             |
| `apps/web/src/components/ChatView.tsx:2263,4141-4259`                                                                            | Configured preview URLs; `runProjectScript` (client-side script runs, which ignore `previewUrl` / `autoOpenPreview`).  |
| `apps/web/src/components/preview/openDiscoveredPort.ts:13-28`                                                                    | Opening a discovered server in the preview.                                                                            |
| `apps/web/src/composerDraftStore.ts:571,641,655`                                                                                 | `setPrompt`, `insertTerminalContext`, `addPreviewAnnotation`.                                                          |
| `apps/web/src/terminalUiStateStore.ts:567-577`                                                                                   | Opening the drawer on a terminal.                                                                                      |
| `apps/server/src/auth/ServerSecretStore.ts:138-150`                                                                              | Secret store for database passwords.                                                                                   |

## External

- Obscura (Apache-2.0), headless browser in Rust: https://github.com/h4ckf0r0day/obscura,
  reviewed at `1a3169d` (2026-09-20). `fetch --dump html|text|links|markdown|assets|original|cookies`,
  global flags `--obey-robots` (off by default in the engine, `crates/obscura-browser/src/context.rs:131`),
  `--allow-private-network` (private addresses blocked by default), `--stealth`, `--proxy`
  (`docs/CLI-reference.md`, README "Testing against localhost"); `obscura mcp` over stdio, or
  `--http` binding 127.0.0.1 by default with `OBSCURA_MCP_TOKEN` required for non-loopback binds
  (`docs/Use-the-MCP-server.md`). Release archives include `obscura` and `obscura-worker`;
  macOS and Linux builds on the releases page. The README advertises proxy sponsors and a
  "stealth" build; Loom uses neither.
- varlock (MIT): https://github.com/dmno-dev/varlock, `varlock run -- <command>` loads and
  validates env from `.env.schema` (README).
- pbakaus/impeccable (Apache-2.0), "live mode" element pick for inspiration:
  https://github.com/pbakaus/impeccable, reviewed at `e0881d2`. Its picked-element context
  (`extractContext` in `.cursor/skills/impeccable/scripts/live-browser.js:976-1030`: tag, id,
  classes, text, sanitized outerHTML, a set of computed styles, CSS custom properties, parent,
  size) matches what upstream's pick payload already carries plus computed styles; a later
  enhancement could add computed styles to upstream's annotation, but that is upstream's code.
- Electron 44 APIs: `webContents` `console-message` event, `session.webRequest` (`onSendHeaders`,
  `onCompleted`, `onErrorOccurred`; one listener per event), `app` `web-contents-created`,
  `webContents.getType()`: https://www.electronjs.org/docs/latest/api/web-contents,
  https://www.electronjs.org/docs/latest/api/web-request (check against the installed typings).
- Docker Compose `ps --format json`: https://docs.docker.com/reference/cli/docker/compose/ps/
- Redis licensing change (RSALv2/SSPLv1 from 7.4, AGPLv3 option from 8.0) behind PRODUCT.md
  question 2: https://redis.io/legal/licenses/ (not re-verified for this packet).
