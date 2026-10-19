# L72 references

## Code

Contracts and shared client code:

- [`packages/contracts/src/fork/preview-links.ts`](../../../../packages/contracts/src/fork/preview-links.ts):
  schemas, RPC group, host helpers.
- [`packages/client-runtime/src/fork/preview-links.ts`](../../../../packages/client-runtime/src/fork/preview-links.ts):
  snapshot subscription and commands.

Server, [`apps/server/src/fork/preview-links/`](../../../../apps/server/src/fork/preview-links/):

- [`PreviewLinksService.ts`](../../../../apps/server/src/fork/preview-links/PreviewLinksService.ts):
  state, sidecar, secrets, entry codes, expiry, lane watcher, session removal.
- [`policy.ts`](../../../../apps/server/src/fork/preview-links/policy.ts): host format, denylist,
  path sanitizing, cookie signing, sweep.
- [`gateway.ts`](../../../../apps/server/src/fork/preview-links/gateway.ts) and
  [`pages.ts`](../../../../apps/server/src/fork/preview-links/pages.ts): the proxy and its pages.
- [`tunnel.ts`](../../../../apps/server/src/fork/preview-links/tunnel.ts): `cloudflared`
  supervisor.
- [`types.ts`](../../../../apps/server/src/fork/preview-links/types.ts): gateway and tunnel
  types, cookie name and reserved paths.
- [`rpc.ts`](../../../../apps/server/src/fork/preview-links/rpc.ts) and
  [`mcp.ts`](../../../../apps/server/src/fork/preview-links/mcp.ts).

Web, [`apps/web/src/fork/preview-links/`](../../../../apps/web/src/fork/preview-links/):

- [`navigation.ts`](../../../../apps/web/src/fork/preview-links/navigation.ts): what every
  upstream seam calls.
- [`settings.tsx`](../../../../apps/web/src/fork/preview-links/settings.tsx),
  [`LinksSheet.tsx`](../../../../apps/web/src/fork/preview-links/LinksSheet.tsx),
  [`PortCardActions.tsx`](../../../../apps/web/src/fork/preview-links/PortCardActions.tsx),
  [`palette.tsx`](../../../../apps/web/src/fork/preview-links/palette.tsx).
- [`systemBrowser.ts`](../../../../apps/web/src/fork/preview-links/systemBrowser.ts): opening a
  URL known only after a request, on web and desktop.

Mobile, [`apps/mobile/src/fork/preview-links/`](../../../../apps/mobile/src/fork/preview-links/):

- [`PreviewLinksScreen.tsx`](../../../../apps/mobile/src/fork/preview-links/PreviewLinksScreen.tsx),
  [`openPreviewLink.ts`](../../../../apps/mobile/src/fork/preview-links/openPreviewLink.ts),
  [`previewLinksLogic.ts`](../../../../apps/mobile/src/fork/preview-links/previewLinksLogic.ts).

## Upstream T3 Code

- `apps/server/src/auth/ServerSecretStore.ts`: holds the cookie key and the tunnel token.
- `apps/server/src/auth/SessionStore.ts`: `clientRemoved` changes sign out that client's
  preview browsers.
- `apps/server/src/preview/PortScanner.ts`: `PortDiscovery`, for terminal servers an agent
  may share.
- `packages/shared/src/relayClient.ts`: resolves and installs `cloudflared`, as T3 Connect
  does.
- `apps/server/src/httpResponseErrorGuard.ts`: guards gateway response writes.
- `apps/web/src/browser/browserTargetResolver.ts`: loopback reachability and private network
  mapping the navigation builds on.

## Fork

- [L19 project lifecycle](../L19-project-lifecycle/): lanes and their 20-port block
  (`apps/server/src/fork/project-lifecycle/policy.ts`, `PORT_BLOCK`;
  [user guide](../../user/project-lifecycle.md#what-a-lane-owns)).

## External

- Cloudflare Tunnel, remotely managed tunnels and published application routes:
  <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>.
- Tunnel routing, including the wildcard DNS record a wildcard route needs by hand:
  <https://developers.cloudflare.com/tunnel/concepts/routing/>.
- Cloudflare Universal SSL covers the apex and one level of subdomains:
  <https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/>.
- `cloudflared` (Apache 2.0): run as a child process, never vendored.
- Cookie prefixes (`__Host-`), RFC 6265bis:
  <https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/>.
- Fetch metadata (`Sec-Fetch-Mode`): <https://www.w3.org/TR/fetch-metadata/>.
- Cross-site WebSocket hijacking and Origin checks:
  <https://owasp.org/www-community/attacks/Cross-Site_WebSocket_Hijacking>.
