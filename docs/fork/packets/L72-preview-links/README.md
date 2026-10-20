# L72: Preview links

Status: Slices 1 to 5 are implemented on fork `main`, with the follow-up gap fixes for
sign-in, pages, the gateway and backings. The Library side waits for the LP-22 deploy (gate
D4). Kyle added the DNS-only record for `pages.bagels.top` at the Library host on
2026-10-20. Slice 6, guest links, is parked. The real-client checks in
[TESTING.md](./TESTING.md#still-to-check) are pending.

Selection: Hosted previews, Kyle 2026-10-18. Kyle approved slices 2 to 6 and their Library
schema changes on 2026-10-19. User guide: [Preview links](../../user/preview-links.md).

Loom shares a dev server port on the user's computer at an HTTPS address on the user's own
domain, such as `https://5173-k3f9x2-dorothy.example.com/`, through a Cloudflare tunnel Loom
runs itself. Agents can also share a built folder or a Docker container on one of their lane
ports, and publish a rendered page or a Dossier to the user's Library, where it lives at a
private `pages.<domain>` address and a reply typed under it comes back to the thread. Every
link and page opens only for the user: in a browser that entered from Loom, or one that
signed in to the user's Library.

## Scope

- In:
  - Port links (slice 1): settings per environment, a loopback HTTP and WebSocket gateway
    with single-use entry codes, a supervised `cloudflared` connector, and share, open,
    extend, end, end all, restore and "sign out preview browsers" for people over RPC and,
    limited to their own thread, for agents over MCP.
  - Library sign-in (slice 2): a browser that did not enter from Loom signs in to the
    Library, which hands it a one-minute ticket for that link's host.
  - Pages (slice 3): agents publish an html_render result or a workspace HTML file. The
    Library stores it and serves it on its own pages host for 30 days unless kept.
  - Replies (slice 4): a reply box under each page. Replies queue in the Library and arrive
    in the publishing thread as messages.
  - Folder and container links (slice 5): an agent serves a built folder, or runs a Docker
    image, on one of its lane ports and gets an ordinary link back.
  - Web and desktop: the preview panel, port card actions, a links sheet, a settings section
    with a Pages list, and palette commands. Mobile: a Previews settings screen with pages,
    and opening agent links from a thread.
- Out:
  - Slice 6, guest links for other people. Parked under the one-operator rule: every reader
    the Library signs in is its owner.
  - Creating the Cloudflare zone, tunnel or DNS record from Loom. The user does this once in
    the Cloudflare dashboard.
  - Sharing folders or containers by hand. Only agents start them.

## Surfaces

Web and desktop: supported. Mobile: Settings > Previews lists each computer's setup status,
links and pages with their actions; setup itself is web or desktop only. Remote: links
exist for remote and tunneled clients, which cannot reach the computer's loopback. A client
that can reach it, or a server-drawn browser on the same computer, loads `localhost`
directly. Pages open from anywhere, because the Library serves them. Upstream T3 servers do
not advertise `preview-links`, so clients offer no links or pages: an unreachable loopback
port shows an error (or, from a phone on a private network, opens on the computer's
address), and the settings section says the server does not have preview links.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): RPC group
  `loom.preview-links.*` and `loom.preview-pages.*`, the `ForkLayer` services, `ForkRuntime`
  service types and the features `preview-links`, `preview-tickets`, `preview-pages` and
  `preview-backings`. Through it, [persistence](../EXTENSION-POINTS.md#2-persistence) (the
  `PreviewAccessMigrations` and `PreviewPagesMigrations` sets) and
  [HTTP routes](../EXTENSION-POINTS.md#3-http-routes) (the Library's registration, ticket and
  page routes).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root): `PreviewLinksHost`, the
  links sheet.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): the "Previews" section
  and its Pages list.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): "Preview links" and
  "Preview link settings".
- [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp): eight tools.

No right panel and no keybinding. No extension point was created.

## Packet seams

Nineteen upstream files, all `fork: preview-links`, all from slice 1. Slices 2 to 5 added
registrations in fork-owned files only. See [SEAMS.md](./SEAMS.md).

- Web preview navigation: `browserTargetResolver.ts` and its test, `openFileInPreview.ts`,
  `openPreviewSession.ts`, `openTerminalLinkInPreview.ts`, `PreviewView.tsx`.
- Web system browser opens: `localApi.ts`, `useOpenLink.ts`, `ChatMarkdown.tsx`,
  `ThreadTerminalDrawer.tsx`.
- Web port card: `PreviewLocalServerCard.tsx`.
- Mobile: `Stack.tsx`, `settings-sheet-targets.ts`, `SettingsRouteScreen.tsx`,
  `openExternalUrl.ts`, and the thread link opens in `useOpenPullRequest.ts`,
  `HtmlRenderWebView.tsx`, `McpAppWebView.tsx` and `FileMarkdownPreview.tsx`.

## Prerequisites on the machine

- Port links: a domain on Cloudflare with a proxied wildcard record pointing at a remotely
  managed tunnel, whose public hostname routes to `http://127.0.0.1:<gateway port>`. Loom
  installs `cloudflared` itself through the relay client when it is missing.
- Library sign-in and pages: a Library this computer publishes to, with
  `LOOM_IDENTITY_REDIRECT_URI` set to its public https callback. Pages also need the Library
  to set `LOOM_PAGES_ORIGIN` and route that host to its pages listener.
- Folder and container links: lanes on (Settings > Loom > Storage). Container links also
  need Docker Desktop or OrbStack running.

## Documents

- [PRODUCT.md](./PRODUCT.md), [TECHNICAL.md](./TECHNICAL.md), [SEAMS.md](./SEAMS.md),
  [IMPLEMENTATION.md](./IMPLEMENTATION.md), [TESTING.md](./TESTING.md),
  [REFERENCES.md](./REFERENCES.md).
