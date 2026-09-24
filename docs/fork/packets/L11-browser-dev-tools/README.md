# L11: Browser dev tools

Status: Ready to build. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

Makes the browser preview a small dev environment. A **Dev environment** right panel starts,
stops and restarts the project's dev servers (in thread terminals, so upstream's port discovery
links each server to its URL and the preview opens it), runs Docker Compose stacks, starts
throwaway local Postgres and Redis (Valkey) containers with a copyable connection URL, and has a compact
HTTP request lab. Inside upstream's preview panel, a slim **dev dock** under the page shows the
page's console messages and network requests, live, with one click to send errors to the
composer. Agents get an optional fast page fetcher (Obscura) that returns Markdown or links and
obeys robots.txt by default.

Upstream's preview already does element picking and annotation ("pick an element and send it
to the composer"), dev server port discovery, and agent-only console and network capture. This
packet builds on those and replaces none of them.

## Scope

- In:
  - Dev servers: candidates from upstream project scripts plus `package.json` scripts (`dev`,
    `start`, `serve`, `preview`, `storybook`), package manager from the lockfile; start, stop,
    restart in a thread terminal named `loom-dev-<key>`, from any thread of the project (each
    row shows the owning thread and worktree with a link; stopping another thread's server
    asks a light confirmation); state (starting, running, exited with
    code), linked URLs from upstream's port discovery, an 8 KB output tail, "Show in terminal",
    "Open in preview" (desktop) or "Open in browser" (web). Honors upstream's
    `ProjectScript.previewUrl` and `autoOpenPreview`, which upstream stores but never acts on.
  - Optional `varlock run -- <command>` for a server when the project has `.env.schema` and
    `varlock` is installed.
  - Docker Compose: detect compose files, list services with state, health and ports, `up -d`,
    `down`, `restart <service>`, last 200 log lines, "Follow logs in terminal".
  - Local databases: one-click Postgres or "Redis (Valkey)" container (default images
    `postgres:17-alpine` and `valkey/valkey:8-alpine`, both configurable) per project on a free loopback port,
    labeled for Loom, with the password in the server secret store; start, stop, remove (keep or
    delete the data volume); copy the connection URL.
  - HTTP lab: method, URL (defaulting to a running dev server), headers, body; the request runs
    on the environment host; status, timing, headers and body (pretty JSON); history of 50 per
    project; "Add to composer".
  - Dev dock in the preview panel (desktop only, like the preview itself): console and network
    tabs for the active preview tab, error counts on the collapsed bar, filters, clear, request
    details, "Send errors to composer".
  - Obscura (optional, user-installed): agent tool `loom_browser_dev_tools_fetch` for Markdown,
    text or links of a URL, obeying robots.txt unless Kyle turns that off; loopback URLs allowed
    for local dev servers, other private addresses only with a setting.
  - Loom settings section, palette entries, unbound keybinding commands.
- Out:
  - Element pick and annotation (upstream has it: `apps/desktop/src/preview/PickPreload.ts`,
    `apps/web/src/components/preview/PreviewView.tsx:581-665`).
  - Full API client features (collections, environments, auth flows, scripting). API Studio is
    a standalone app (selections.md).
  - Database browsing and queries. Database Studio is a standalone app.
  - Recording or proxying preview traffic into the HTTP lab (old Loom's lab was fixture-only).
  - Browser scenario replay (old Loom's ScenarioRunner saved empty steps; argent's Chromium
    flows, L09, are the path if wanted later).
  - Running Obscura's MCP server for providers. The user doc explains adding it themselves on
    loopback.
  - Mobile UI; the preview itself is desktop-only upstream.

## Surfaces

- Desktop: everything.
- Web (local `npx t3` or app.t3.codes): the Dev environment panel works fully (servers,
  compose, databases, HTTP lab); servers open in a new browser tab instead of the preview. The
  dev dock does not exist on web because upstream's preview panel only shows "Preview is only
  available in the desktop app" there.
- Mobile: not supported.
- Remote: all panel work runs on the environment host over the WebSocket RPC. The dev dock
  reads the desktop client's own webview, so it works for any environment the desktop app
  previews.
- Upstream T3 server: the panel entry is disabled; the dock still shows console and network
  (it needs only the desktop client) but hides the servers chip.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels), [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) + [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings),
  [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp). Any may be created by this packet.
- `ext-desktop` ([EXTENSION-POINTS.md, section 13](../EXTENSION-POINTS.md#13-desktop-ipc-ext-desktop-optional)) for the console and network
  collector in the Electron main process (phase 4).

## Packet seams

- `apps/web/src/components/preview/PreviewView.tsx`: one import and one JSX element to mount
  the dev dock under the page (4 added lines, 2 of them markers).

## Optional integrations

None required. If L07 (bottom dock) is present, the dev dock stays inside the preview panel;
it does not move into L07's dock.

## Size estimate

Large: about 4,000 to 5,000 lines including tests. Servers and compose about 1,200, databases
400, HTTP lab 500, desktop collector and dock 900, panel UI 1,200.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md, then this
folder. Phases 1 to 3 do not need `ext-desktop`; phase 4 does.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
