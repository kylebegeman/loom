# L72 technical design

## Overview

```
browser --https--> Cloudflare edge --tunnel--> cloudflared (child of the server)
                                                   |
                                                   | http://127.0.0.1:<gateway port>
                                                   v
                                     gateway (node:http, loopback only)
                                     route by Host, entry code, cookie, Origin, port
                                                   |
                                                   | http://localhost:<port>
                                                   v
                                               dev server
```

`PreviewLinksService` owns settings, links, entry codes, the cookie key and the lifetimes of
the gateway and the tunnel. Clients call it over RPC as the owner; agents call it over MCP as
their own thread. Nothing here touches orchestration or the database.

## Contracts

`packages/contracts/src/fork/preview-links.ts`, feature `"preview-links"`. Every method fails
with `PreviewLinksError` (reasons `not-configured`, `port-denied`, `port-not-in-lane`,
`not-found`, `not-restorable`, `invalid`, `storage`, `tunnel`) or
`EnvironmentAuthorizationError`.

| Tag                                  | Input                                            | Success                | Scope                |
| ------------------------------------ | ------------------------------------------------ | ---------------------- | -------------------- |
| `loom.preview-links.watch`           | none                                             | `PreviewLinksSnapshot` | `orchestration:read` |
| `loom.preview-links.configure`       | settings, optional token (null removes it)       | `PreviewLinksSetup`    | `settings:write`     |
| `loom.preview-links.share`           | port, optional lifetime                          | `PreviewLink`          | `preview:operate`    |
| `loom.preview-links.open`            | link id or any URL on a link host, optional path | `PreviewLinkEntry`     | `preview:operate`    |
| `loom.preview-links.extend`          | link id, optional lifetime                       | `PreviewLink`          | `preview:operate`    |
| `loom.preview-links.revoke`          | link id                                          | `PreviewLink`          | `preview:operate`    |
| `loom.preview-links.restore`         | link id, optional lifetime                       | `PreviewLink`          | `preview:operate`    |
| `loom.preview-links.revokeAll`       | none                                             | void                   | `preview:operate`    |
| `loom.preview-links.signOutBrowsers` | none                                             | void                   | `preview:operate`    |

`watch` streams; it is in `ForkSubscriptionRpcTag`. The snapshot carries setup (settings,
`tokenStored`, `ready`, tunnel and gateway states with messages) and the links. The token is
never returned. `ready` means enabled with a domain; sharing does not wait for the tunnel.

## Server

`apps/server/src/fork/preview-links/`, built in `ForkLayer` with the same
`ProjectLifecycle.layer` instance the lane watcher observes.

- `PreviewLinksService.ts`: state behind one semaphore, publishing a snapshot after every
  change. An expiry fiber sleeps to the next deadline (at most 24 hours per sleep) and sweeps.
- `policy.ts`: host format, share segments (rejection sampling over bytes below 252), path
  sanitizing, the port denylist, cookie signing and the sweep.
- `gateway.ts`: the HTTP and upgrade proxy. `pages.ts`: its static pages.
- `tunnel.ts`: the `cloudflared` supervisor.
- `rpc.ts` (owner actor; `open` bound to the caller's session id and subject) and `mcp.ts`.

### Entry and cookie flow

1. `open` requires `ready`, finds the open link by id or host, and mints a 128-bit base64url
   code bound to the host, a sanitized path and the caller's session. Codes live 60 seconds,
   at most 256 are kept (oldest evicted), and they are memory only.
2. The client loads `https://<host>/__loom/enter?code=...`. The gateway spends the code on
   any presentation, even a mismatched one, then answers `303` to the path with
   `Set-Cookie`, `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. A spent or
   expired code gets the "Open the preview again from Loom" page (401).
3. The cookie is `__Host-loom_pv`, `Max-Age=43200; Path=/; Secure; HttpOnly; SameSite=Lax`,
   no `Domain`. Its value is `base64url(JSON {v, sub, sid, host, exp}).base64url(HMAC-SHA256)`,
   at most 4,096 characters, verified with `timingSafeEqual` against the request's host.

### Gateway

A raw `node:http` server bound to `127.0.0.1:<gatewayPort>` (default 3779), because it routes
by host before parsing and pipes raw upgrade sockets, which Effect's HTTP server cannot.
Requests and upgrades pass one decision, in order:

1. Host not a link label under this computer's suffix and machine name: 404 "Not found". A
   well-formed host on this computer with no open link (expired, ended or never issued): 410
   "This preview has ended".
2. `/__loom/enter` redeems a code (plain requests only). Any other `/__loom/` path: 404.
3. Exactly one `__Host-loom_pv` cookie that verifies for this host, is unexpired and whose
   session is not signed out. Otherwise 401 "Open this link from Loom".
4. Origin. An upgrade needs `Origin` exactly `https://<host>`. Any other request with an
   `Origin` that differs gets 403 unless `Sec-Fetch-Mode` is `navigate`.
5. The port is not denied, else 403.

Forwarding drops hop-by-hop headers and any named in `Connection`, sets `Host` to
`localhost:<port>`, rewrites `Origin` and same-origin `Referer` to `http://localhost:<port>`,
and strips every `__Host-loom*` cookie. Responses get `Location` rewritten from a local
origin on that port to the link, `Set-Cookie` without `Domain` and without any
`__Host-loom*` cookie, and `Cache-Control: private, no-store` plus `X-Robots-Tag: noindex,
nofollow` on everything. A refused port answers 502 "Nothing is answering on port N yet".
Upgrades are piped with `net.connect` and tracked by host and session, so ending a link,
signing out or removing a client closes them. A view that throws costs one 500 response.
Listen failures report "Port N is already in use on this computer." or "Loom is not allowed
to listen on port N." and retry on the next save.

### Tunnel supervision

`runPreviewTunnel` resolves `cloudflared` through `@t3tools/shared/relayClient`, installing it
when missing, and runs `cloudflared tunnel --no-autoupdate --loglevel info --output default
--metrics 127.0.0.1:0 run` with `TUNNEL_TOKEN` in the environment and no shell. It reads log
lines for the metrics port (added to the denylist) and counts "Registered" and
"Unregistered tunnel connection" lines; connected means at least one registration. `ERR`,
`FTL` and `PNC` lines become the status message, with the token redacted. A connector that
exits restarts after 1 second, doubling to 60 seconds, and starts over after 30 seconds of
uptime. States: `off` and `needs-token` ("Add the tunnel token from Cloudflare to connect.")
from setup, then `starting`, `connected` and `error` from the supervisor.

### Agent policy

`share` for an agent first calls `ProjectLifecycleService.ensureForThread`. A port in
`portBase` to `portBase + PORT_BLOCK - 1` (20 ports) records the lane id. Any lane failure,
including lanes being off, means no lane ports. Otherwise `PortDiscovery.scan()` must show a
server on that port whose terminal belongs to the caller's thread. Else `port-not-in-lane`.
`revoke` by an agent on another thread's or the owner's link is `not-found`. The lane watcher
ends a lane link only after it has seen that lane present and then gone.

## Storage

- `<stateDir>/fork/preview-links/state.json`: `{ version: 1, settings, links }`, written with
  `writeFileStringAtomically`. Missing gives the defaults (off, no domain, machine from the
  host name, 12 hours, port 3779). Unreadable logs a warning and gives the defaults.
- Links are bounded: the sweep expires open links at `expiresAt` (dating the end there, so
  downtime does not stretch the restore window) and drops ended links past
  `restorableUntil`.
- `ServerSecretStore`: `loom-preview-links-cookie-key` (32 random bytes, created on first
  start; a temporary key with a warning if the store fails) and
  `loom-preview-links-tunnel-token`. Neither is logged or returned.
- In memory only: entry codes, signed-out session ids (12 hours) and live upgrades.

A sidecar file instead of fork tables: the data is small, per computer, and read whole.

## Clients

- Shared atoms: `packages/client-runtime/src/fork/preview-links.ts` (snapshot subscription
  and one command per mutation, with `permissionAtom`s).
- Web navigation: `navigablePreviewUrlFor` in `apps/web/src/fork/preview-links/navigation.ts`
  is the one call the upstream seams make. A loopback URL on an environment this client
  cannot reach is shared and opened as an entry; a preview link URL becomes a fresh entry on
  the first connected computer that owns it (thread's computer first); a server-drawn browser
  on the owning computer loads `localhost` directly. Without the feature it falls back to the
  private network address, then to an error naming Settings > Previews.
- Web UI: `settings.tsx` (section `preview-links`, title "Previews"), `LinksSheet.tsx`
  (mounted as `preview-links-host` in `ForkRoot`), `PortCardActions.tsx`, `palette.tsx`.
  `systemBrowser.ts` opens the window before awaiting on the web and hands the finished URL
  to the shell on desktop.
- Web system browser: a link page opens nowhere outside Loom without an entry, so every way
  out swaps it for a fresh one (`needsPreviewLinkEntry` in contracts skips `/__loom/` pages).
  `localApi.ts` `shell.openExternal` calls `openPreviewLinkExternally`, covering Alt-click,
  context menus, `useOpenLink` and the terminal and preview fallbacks. Plain anchor clicks that
  React leaves to the browser are caught by a window click listener in `PreviewLinksHost`. The
  preview's "Open in browser" uses `openPreviewInSystemBrowser`, which also turns a loopback
  address into a link. `McpAppFrame`'s `openLink` calls `window.open` directly and is not
  covered.
- Gating: `capabilities.loomFeatures` includes `"preview-links"`
  (`advertised.ts`, `capability.ts`), plus each command's `permissionAtom`.
- Mobile: `apps/mobile/src/fork/preview-links/` (Previews screen, `externalUrl.ts`,
  `entryUrl.ts`, `previewLinksLogic.ts`). Every external open goes through
  `tryOpenExternalUrl`, which swaps a preview link for an entry link from the first connected
  computer whose `open` accepts it. Entry links pass through unchanged, and a link no computer
  serves opens as is. The lookup loads lazily so `openExternalUrl.ts` keeps no connection
  dependencies.

## Agent-facing tools

| Tool                       | Access          | Does                                                           |
| -------------------------- | --------------- | -------------------------------------------------------------- |
| `loom_preview_links_list`  | `readsAsCaller` | `ready`, tunnel state and the caller thread's links.           |
| `loom_preview_link_share`  | `actsAsCaller`  | Share as the caller's thread; returns the canonical link only. |
| `loom_preview_link_revoke` | `actsAsCaller`  | End one of the caller thread's links.                          |

All three require a thread scope. They are not gated on the preview MCP capability. Agents
never call `open`, so no transcript carries a working credential.

## Security reasoning

- **Why entry codes.** The canonical URL ends up in chats, transcripts, logs and clipboards.
  A bearer URL would let anyone who saw it in. An entry code is minted only for an
  authenticated Loom session with `preview:operate`, works once within 60 seconds, is bound
  to one host and path, and is spent even on a failed attempt. The 303 removes it from the
  address bar, and `no-referrer` and `no-store` keep it out of referrers and caches.
- **Why host-only cookies.** The `__Host-` prefix forces `Secure`, `Path=/` and no `Domain`,
  so no sibling host can set or scope a cookie for the whole domain. Each link is its own
  origin, and the signed host claim stops a cookie copied to another link from working.
  `HttpOnly` hides it from the previewed app, and the gateway strips `__Host-loom*` both
  ways so the app can neither read nor overwrite it. `SameSite=Lax` carries it on top-level
  navigation from Loom while leaving cross-site subresources without it.
- **Why Origin checks.** All links share one registrable domain, so they are same-site with
  each other and `SameSite` does not separate them. One previewed app could post to another
  link the browser is signed in to. The gateway refuses non-navigation requests from another
  origin, and requires an exact origin for WebSockets, which neither CORS nor `SameSite`
  protects (cross-site WebSocket hijacking). Navigations stay allowed so links open from
  anywhere.
- **Why Cache-Control.** Responses are a signed-in user's dev data, and they pass through
  Cloudflare's edge. A dev server that sends cacheable headers could otherwise let the edge
  or another cache serve the page to a browser with no cookie, skipping the gateway.
  `private, no-store` on every response prevents that; `X-Robots-Tag` keeps crawlers out.
- **Why loopback and a denylist.** The gateway binds `127.0.0.1` so the tunnel is the only way
  in. Debugger ports mean code execution and database ports mean data, so they are never
  shared, and the check repeats on every request so a later settings change cannot leave an
  open path to a newly reserved port.
- **Why the header rewrites.** Dev servers such as Vite refuse unknown hosts and check
  `Origin` for CSRF and WebSockets. Rewriting to `localhost:<port>` keeps them working
  without asking users to allow the public host.

## Performance

The snapshot is small and bounded by the sweep; it is pushed only on change. The web sheet
re-renders once a minute (`useNowMinute`), and mobile every 30 seconds while the screen is
open. The gateway streams bodies with `pipe` and keeps no per-request state beyond live
upgrades.

## Alternatives considered

- Cloudflare quick tunnels: random hostnames per run, no stable address to restore.
- Bearer URLs or basic auth: links in transcripts would be credentials.
- A cookie on the whole domain: every previewed app could read or overwrite it.
- Effect's HTTP server: cannot route by host before parsing or pipe raw upgrades.
- Library storage for links: links are per computer and short-lived. Slices 2 to 6 are where
  the Library comes in.

## Known gaps

- Signed-out sessions are memory only, so a restart re-admits a removed client's browsers
  until their cookies expire (at most 12 hours).
- Keep-alive connections are not cut when a link ends. Each request is re-authorized, so the
  next request on them fails.
- `configure` returns before the gateway binds; a bind failure shows up in the next snapshot.
- Lanes released while the server was down are not ended at startup.
- Readiness comes only from log lines. The "Unregistered tunnel connection" wording is not
  verified against `cloudflared` 2026.10.0, and an outdated binary is not upgraded.
- The default gateway port 3779 collides when a dev server and the live install both enable
  previews on one computer.
