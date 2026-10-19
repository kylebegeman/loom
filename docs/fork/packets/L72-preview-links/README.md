# L72: Preview links

Status: In progress (`feat/preview-links`). Slice 1 is implemented with focused tests; the
real-client and live-tunnel checks in [TESTING.md](./TESTING.md#still-to-check) are pending.
Contracts, scopes and shared atoms are committed in `64487ea714`; the server, web and mobile
work is not committed yet.

Selection: Hosted previews, Kyle 2026-10-18. User guide:
[Preview links](../../user/preview-links.md).

Loom shares a dev server port on the user's computer at an HTTPS address on the user's own
domain, such as `https://5173-k3f9x2-dorothy.example.com/`, through a Cloudflare tunnel Loom
runs itself. The address opens only in a browser that entered from Loom, so a link posted in
a chat or copied by accident shows a page asking to open it from Loom instead of the app.
Links end on their own after 1, 12 or 24 hours and can be restored at the same address for 7
days. Agents can share their own lane ports and terminal servers, and every client that
cannot reach the computer's loopback opens ports through a link instead.

## Scope

- In (slice 1):
  - Settings for one domain, a computer name, a default lifetime, the gateway port and the
    tunnel's connector token, per environment.
  - A loopback HTTP and WebSocket gateway that routes by host, signs browsers in with
    single-use entry codes and proxies to `localhost:<port>`.
  - A supervised `cloudflared` connector for a remotely managed tunnel.
  - Share, open, extend, end, end all, restore and "sign out preview browsers", for people
    over RPC and, limited to their own thread, for agents over MCP.
  - Web and desktop: the preview panel, port card actions, a links sheet, a settings section
    and palette commands. Mobile: a Previews settings screen and opening agent links from a
    thread.
- Out:
  - Slices 2 to 6: hosted HTML and Dossier documents, interactive pages that send replies
    back, and containers. They need Library schema changes and Kyle's approval before any
    design work.
  - Creating the Cloudflare zone, tunnel or DNS record from Loom. The user does this once in
    the Cloudflare dashboard.
  - Links that open in a browser without entering from Loom, and links for other people.

## Surfaces

Web and desktop: supported. Mobile: Settings > Previews lists each computer's setup status
and links with open, copy, extend, end and restore; setup itself is web or desktop only.
Remote: links exist for remote and tunneled clients, which cannot reach the computer's
loopback. A client that can reach it, or a server-drawn browser on the same computer, loads
`localhost` directly. Upstream T3 servers do not advertise `preview-links`, so clients keep
the old behavior and the settings section says the server does not have preview links.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): RPC group
  `loom.preview-links.*`, `ForkLayer` service, `ForkRuntime` service type and the
  `"preview-links"` feature.
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root): `PreviewLinksHost`, the
  links sheet.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): the "Previews" section.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): "Preview links" and
  "Preview link settings".
- [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp): three tools.

No right panel and no keybinding. No extension point was created.

## Packet seams

Eleven upstream files, all `fork: preview-links`. See [SEAMS.md](./SEAMS.md).

- Web preview navigation: `browserTargetResolver.ts` and its test, `openFileInPreview.ts`,
  `openPreviewSession.ts`, `openTerminalLinkInPreview.ts`, `PreviewView.tsx`.
- Web port card: `PreviewLocalServerCard.tsx`.
- Mobile: `Stack.tsx`, `settings-sheet-targets.ts`, `SettingsRouteScreen.tsx`,
  `ThreadFeed.tsx`.

## Prerequisites on the machine

A domain on Cloudflare with a proxied wildcard record pointing at a remotely managed tunnel,
whose public hostname routes to `http://127.0.0.1:<gateway port>`. Loom installs
`cloudflared` itself through the relay client when it is missing.

## Documents

- [PRODUCT.md](./PRODUCT.md), [TECHNICAL.md](./TECHNICAL.md), [SEAMS.md](./SEAMS.md),
  [IMPLEMENTATION.md](./IMPLEMENTATION.md), [TESTING.md](./TESTING.md),
  [REFERENCES.md](./REFERENCES.md).
