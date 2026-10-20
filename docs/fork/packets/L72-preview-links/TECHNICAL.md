# L72 technical design

## Overview

Links, on the computer that serves them:

```
browser --https--> Cloudflare edge --tunnel--> cloudflared (child of the server)
   ^                                               |
   |                                               | http://127.0.0.1:<gateway port>
   |                                               v
   |                                 gateway (node:http, loopback only)
   |                                 route by Host; entry code or ticket; cookie, Origin, port
   |                                               |
   |                                               | http://localhost:<port>
   |                                               v
   |                          dev server, folder server or container (lane port)
   |
   | no cookie: 401 page with "Sign in with Loom" and a nonce cookie
   v
Library  GET /api/loom/preview/ticket  --no session--> Library sign-in, then back
         303 https://<host>/__loom/ticket?ticket=...&path=...
```

Pages, in the Library:

```
computer (PreviewPagesService, LibraryPublisher)
   | POST /api/loom/library/pages/publish | update, GET /api/loom/library/pages
   | POST .../replies/next (long poll) and .../replies/ack
   v
Library (PageLibraryService, fork_preview_pages, fork_preview_page_replies)
   ^
   | pages host: its own node:http listener on LOOM_PAGES_PORT, https://pages.<domain>
   |   /__loom/ticket   trades a Library ticket for the pages cookie
   |   /p/<id>          shell: title, sandboxed frame, reply box
   |   /raw/<id>        the published HTML, sandboxed without its own origin
   |   /p/<id>/replies  POST a reply
browser
```

`PreviewLinksService` owns link settings, links, entry codes, the cookie key, the Library
registration, folder servers, containers and the lifetimes of the gateway and the tunnel.
Clients call it over RPC as the owner; agents call it over MCP as their own thread. On the
Library, `PreviewAccessService` holds the ticket key and the registered hosts, and
`PageLibraryService` holds pages and replies. `PreviewPagesService` on the computer reads the
page source and relays replies into threads. Links never touch orchestration; a reply enters
a thread through `ThreadManagementService.sendToThread`, like any other queued message.

## Contracts

`packages/contracts/src/fork/preview-links.ts`, features `preview-links`, `preview-tickets`,
`preview-pages` and `preview-backings`. Link methods fail with `PreviewLinksError` (reasons
`not-configured`, `port-denied`, `port-not-in-lane`, `not-found`, `not-restorable`,
`invalid`, `storage`, `tunnel`), page methods with `PreviewPagesError` (`unavailable`,
`not-found`, `invalid`, `too-large`, `blocked`, `io`), and both with
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
| `loom.preview-pages.list`            | none                                             | `PreviewPagesList`     | `orchestration:read` |
| `loom.preview-pages.update`          | page id, keep, release, end or restore           | `PreviewPage`          | `preview:operate`    |

`watch` streams; it is in `ForkSubscriptionRpcTag`. The snapshot carries setup (settings,
`tokenStored`, `ready`, tunnel and gateway states with messages) and the links. The token is
never returned. `ready` means enabled with a domain; sharing does not wait for the tunnel. A
link's optional `backing` names its folder, or its image, container and stop time; old
clients ignore it and see a port link. Folder and container shares have no RPC, only MCP
tools. `pages.list` is a plain request, not a subscription: pages live in the Library, so
there is nothing on the computer to watch. It answers `available: false` instead of failing
when the computer has no Library that serves pages.

The Library's own HTTP routes, each under `/api/loom/` and documented in its handler:

| Route                                    | Caller                                     | Handler                                                                                         |
| ---------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `POST library/previews/register`         | a computer's publisher session             | [`preview-access/http.ts`](../../../../apps/server/src/fork/preview-access/http.ts)             |
| `GET preview/ticket`                     | any browser; signed-out ones sign in first | [`preview-access/http.ts`](../../../../apps/server/src/fork/preview-access/http.ts)             |
| `POST library/pages/publish`, `update`   | a computer's publisher session             | [`preview-pages/libraryHttp.ts`](../../../../apps/server/src/fork/preview-pages/libraryHttp.ts) |
| `GET library/pages`                      | a computer's publisher session             | same                                                                                            |
| `POST library/pages/replies/next`, `ack` | a computer's publisher session             | same                                                                                            |

The schemas are `LibraryPreviewRegisterRequest`, `LibraryPreviewAccess`,
`LibraryPagePublishRequest`, `LibraryPageReplies` and `LibraryPageReplyAckRequest` in the same
contracts file.

## Computer side

`apps/server/src/fork/preview-links/`, built in `ForkLayer` with the same
`ProjectLifecycle.layer` instance the lane watcher observes and the shared
`LibraryPublisher` layer.

- `PreviewLinksService.ts`: state behind one semaphore, publishing a snapshot after every
  change. An expiry fiber sleeps to the next link deadline, access key expiry or Library
  key lapse (at most 24 hours per sleep) and sweeps. A key that runs out there has its
  running requests and upgrades closed, because the session store sends no change when a
  disconnected client's session expires.
- `policy.ts`: host format, share segments (rejection sampling over bytes below 252), path
  sanitizing, the port denylist, cookie signing, the Library sign-in link and the sweep.
- `ticket.ts`: Ed25519 ticket signing and verification and the nonce cookie, shared with the
  Library and its pages host.
- `gateway.ts`: the HTTP and upgrade proxy. `pages.ts`: its static pages.
- `tunnel.ts`: the `cloudflared` supervisor.
- `backings.ts`: the folder server and the `docker` calls.
- `rpc.ts` (owner actor; `open` bound to the caller's session) and `mcp.ts`.

### Entry and cookie flow

1. `open` requires `ready`, finds the open link by id or host, and mints a 128-bit base64url
   code bound to the host, a sanitized path and the caller's access key. Codes live 60 seconds,
   at most 256 are kept (oldest evicted), and they are memory only.
2. The client loads `https://<host>/__loom/enter?code=...`. The gateway spends the code on
   any presentation, even a mismatched one, then answers `303` to the path with
   `Set-Cookie`, `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. A spent or
   expired code gets the "Open the preview again from Loom" page (401).
3. The cookie is `__Host-loom_pv`, `Max-Age=43200; Path=/; Secure; HttpOnly; SameSite=Lax`,
   no `Domain`. Its value is
   `base64url(JSON {v: 2, sub, key, host, iat, exp}).base64url(HMAC-SHA256)`, with `iat` in
   milliseconds, at most 4,096 characters, verified with `timingSafeEqual` against the
   request's host.

### Library sign-in

When `publisher.enabled`, the computer registers `{environmentId, machine, suffix}` with its
Library at start, after every settings change and every 30 minutes, or `null` when previews
are off, which deletes its row. The answer, `LibraryPreviewAccess`, names the Library's issuer
origin, ticket path, key id and Ed25519 public key; the computer keeps it in memory and
accepts it only when `parseLibraryPreviewAccess` finds an https origin it can check tickets
against. A failed refresh keeps the last answer, so a Library blip signs nobody out.
`not-found` means an older Library or one without a public origin, and turns sign-in off. A
server that is its own Library registers in process instead, with no session.

1. A request without a valid cookie that is a document navigation (`GET` with
   `Sec-Fetch-Mode: navigate`, or `text/html` in `Accept` without fetch metadata) gets the
   401 "Sign in to see this preview" page. It links to
   `<library origin>/api/loom/preview/ticket?host&nonce&path` and sets a fresh 32-byte nonce
   in `__Host-loom_pv_n` (10 minutes). Anything else gets the plain "Open this link from
   Loom" page, because a script's fetch setting a nonce would race the page's own. Without a
   Library answer, navigations get that page too.
2. The Library sends a browser without a session through `/api/loom/identity/login` and back
   (`returnTo` over 2,048 characters falls back to `/`). A session must have
   `orchestration:operate` and not be an MCP client, else 403. The host must be the
   Library's pages host or match a registered `fork_preview_hosts` row by machine and
   suffix, else 400. Only then does it sign a ticket and answer `303` to
   `https://<host>/__loom/ticket?ticket&path`.
3. The ticket is a compact JWS: `alg` `EdDSA`, `typ` `loom-preview-ticket+jwt`, `kid` the
   first 16 characters of the base64url SHA-256 of the public key. Claims: `iss` the
   Library's origin, `aud` `https://<host>`, `sub` the Library user, `nonce`, `iat`, `exp`
   (60 seconds) and a `jti`. Verification allows 30 seconds of clock skew and refuses
   tickets over 2,048 characters.
4. The host checks the signature, issuer, audience and that the nonce matches its nonce
   cookie, then spends the `jti` until 31 seconds past `exp` (the skew plus one) and the
   nonce for 10 minutes, in a memory map of at most 1,024 entries; a full map refuses new
   tickets. Because that map does not survive a restart, a ticket issued before the host's
   process started is refused outright. It answers `303` to the path with the preview cookie
   under the access key `library:<sub>`, clears the nonce cookie and sends
   `Referrer-Policy: no-referrer`. A refused ticket gets a fresh sign-in link, or the
   open-from-Loom page once no Library is known.

The ticket key is the secret `loom-preview-ticket-ed25519`, separate from every other
signing key. An unreadable stored key turns sign-in off until the secret is removed rather
than minting a new one under it. The issuer is the origin of `LOOM_IDENTITY_REDIRECT_URI`,
port included because Pocket ID accepts a callback on any https port. It is never taken from
a request's `Host`: without the variable the Library logs one warning at start, and its
register and ticket routes answer 404.

### Access keys

A cookie stands for an access key, not a session. For most sessions the key is the session id.
A DPoP session (mobile and web over T3 Connect) lasts an hour and is replaced by one with a
new id, so its key is `dpop:<subject>` and a browser stays in across the roll. Session rows do
not carry the proof key's thumbprint, so the subject is the finest grouping available without
a schema change, and every T3 Connect device shares the subject `cloud-connect`. A Library
sign-in's key is `library:<sub>`. It is live until the last cookie minted for it runs out,
survives restarts in the sidecar and ends with **Sign out preview browsers**.

- A session key is live while any of its sessions still counts, using the sessions the store
  lists at start, the changes it sends after and a fresh list once a minute. The store sends
  no change when another process, such as `t3 auth session revoke`, writes it, so a known
  session missing from the list counts as removed; a list that fails at start recovers at
  the next one. A session counts until it expires, and a
  DPoP session for 5 minutes more: its client asks for the next session only once the server
  closes its socket at expiry, so without the grace its browsers would lose their sockets and
  streams and get 401 for the seconds every hourly reconnect takes.
- Removing a session revokes its key for every cookie and entry code minted up to that moment.
  A later entry works again while another session of the key is live.
- The store also reports a session removed when its socket closes after the session ran out,
  which a DPoP session does every hour. A removal of a session already past its expiry counts
  as expiry: the session keeps its grace and the rest of its key stays in. A removal of a
  session this server does not know revokes nothing. Its key is either the session id, which
  cannot be admitted again, or a DPoP subject the removal does not name.

### Gateway

A raw `node:http` server bound to `127.0.0.1:<gatewayPort>`, because it routes by host before
parsing and pipes raw upgrade sockets, which Effect's HTTP server cannot. The default port is 3779. A dev server defaults to its own port plus 10,000 (minus 10,000 above 55535), so it
stays off the installed app's port and off other worktrees'. Saved settings keep their port.
Requests and upgrades pass one decision, in order:

1. Host not a link label under this computer's suffix and machine name: 404 "Not found". A
   well-formed host on this computer with no open link (expired, ended or never issued): 410
   "This preview has ended".
2. `/__loom/enter` redeems a code and `/__loom/ticket` a Library ticket (plain requests
   only). Any other `/__loom/` path: 404.
3. Exactly one `__Host-loom_pv` cookie that verifies for this host and is unexpired, whose
   access key is live and was not revoked after the cookie was minted. Otherwise 401, with
   the sign-in page for a navigation when a Library is known.
4. Origin. An upgrade needs `Origin` exactly `https://<host>`. Any other request passes when
   `Origin` is absent, is `https://<host>`, or is `null` with `Sec-Fetch-Site: same-origin` (a
   `no-referrer` page's own form post). Otherwise it gets 403 unless it is a `GET` or `HEAD`
   with `Sec-Fetch-Mode: navigate`.
5. The port is not denied, else 403.

Forwarding drops hop-by-hop headers and any named in `Connection`, sets `Host` to
`localhost:<port>`, rewrites `Origin` and same-origin `Referer` to `http://localhost:<port>`,
and strips every `__Host-loom*` cookie. A chunked request body is sent upstream chunked
again, because Node writes a `GET`, `HEAD`, `DELETE` or `OPTIONS` body raw when it has no
length and the shared keep-alive upstream would read it as more requests. Responses get
`Location` rewritten from a local origin on that port to the link, `Set-Cookie` without
`Domain` and without any `__Host-loom*` cookie, `CDN-Cache-Control`,
`Cloudflare-CDN-Cache-Control` and `Surrogate-Control` dropped, and `Cache-Control: private,
no-store` plus `X-Robots-Tag: noindex, nofollow` on everything, with `no-transform` added
to HTML. A refused port answers 503 "Nothing is answering on port N yet", and an upgrade to
one gets a bare 503. Not 502: Cloudflare replaces an origin's 502 or 504 with its own error
page, so the explanation would never arrive. An upgrade goes upstream with `http.request` on
a socket of its own, and nothing the browser sends is relayed until the upstream answers
`101`. Then that `101`, without `__Host-loom*` cookies, goes back and both sides are piped.
Any other answer is sent with the response rewrites and `Connection: close`, then both
sockets close, because `cloudflared` pools gateway connections across visitors and a
connection left open to the upstream would skip every check. Running requests and upgrades
are tracked by host and access key, and so is each idle keep-alive socket, under the host and
key of the last request it carried. Ending a link, signing out, removing a client or its key
expiring closes them all, event streams included. A view that throws costs one 500 response.
`configure` waits for the bind, which itself waits for server activation, so a listen failure
comes back in its own result as "Port N is already in use on this computer." or "Loom is not
allowed to listen on port N.", and the next save retries.

### Tunnel supervision

`runPreviewTunnel` resolves `cloudflared` through `@t3tools/shared/relayClient`, installing it
when missing. A binary on `PATH` or an older managed one below the pinned `CLOUDFLARED_VERSION`
starts an install of the pinned release in the background; the tunnel waits up to 30 seconds
for it, then runs the older binary and switches at its next start. A failed install is tried
again after 10 minutes, and a `T3CODE_CLOUDFLARED_PATH` override is never replaced. This
differs on purpose from the cloud connector, which leaves a `PATH` binary alone. It runs
`cloudflared tunnel --no-autoupdate --loglevel info --output default
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
ends a lane link once its lane no longer covers the link's port: the lane went, or moved to a
new port block at startup because another server claimed its old one. It counts only lanes
it has seen, seeded from the saved open links, so a lane released while the server was down
ends its links at the first status. It checks under the service lock, so a share or restore
finishing as its lane goes still ends, and with lanes off it ends nothing.

Folder and container shares need the thread's lane, and fail with "Folder and container links
need lanes on" without one. They claim the first lane port that is not denied, not held by a
container still starting, not used by another open link and free on both `127.0.0.1` and
`::1` (a 500 ms connect probe, then a bind).

### Folder and container backings

A folder must resolve, after `realpath`, to a directory inside the thread's worktree or
workspace root. The same folder shared again from the same thread returns its open link. The
folder server is an in-process `node:http` server on `127.0.0.1` only:

- `GET` and `HEAD` only, and `Host` must be `localhost:<port>` or `127.0.0.1:<port>`, so a
  DNS-rebound page cannot read the folder.
- The path is decoded before it is split, so `..%2F` is caught. Any dot segment but
  `.well-known` is 404, and the `realpath` of what it names must stay inside the folder's.
- A directory without a trailing slash redirects; a directory serves its `index.html` or 404,
  never a listing. There is no fallback to `index.html` for client-side routes.
- Files open with `O_NOFOLLOW | O_NONBLOCK`, so a symlink swapped in after the check or a FIFO
  named `index.html` cannot hold the server. `Content-Length` is fixed at `fstat`, and a
  short read destroys the connection rather than sending a truncated body.
- A single `bytes=` range answers 206 with `Content-Range`, an unsatisfiable one 416 with
  `bytes */<size>`, and every answer carries `Accept-Ranges: bytes`, so media can seek.
  Several ranges, or any `If-Range`, get the whole file, because no validator is sent.
- Every answer carries `nosniff` and `no-store`; types come from a table by extension.

A container starts in two steps, each one argv, never through a shell. If
`docker image inspect` (30 seconds) does not find the image, `docker pull <image>` fetches it
with 10 minutes. Then:

```
docker run -d --pull never --label loom.lane=<lane id> --label loom.preview-link=<link id>
  -p 127.0.0.1:<lane port>:<container port> [-e NAME=value ...] <image> [command ...]
```

`docker` is found with the lane leases' locator, so Docker Desktop and OrbStack both work.
The run has 2 minutes. While a start runs the port is held so no other share or restore takes
it. A start that fails or is cancelled during the pull has created nothing. One that reached
`docker run` is removed by its link label at once and becomes a stray: a container that may
still exist without a link. The `loom.lane` label lets lane release remove it with the lane's
other containers. A container link lives 5 to 240 minutes, 120 by default; its `expiresAt` is
the container's stop time, and it cannot be extended or restored.

One reconcile runs at startup and after every committed change. It restarts the folder
server of every open folder link (ending a link whose folder is gone or whose port answers
to something else), stops servers whose link ended, removes containers whose link ended and
ends links whose container stopped. Containers and strays are also checked every minute, so
a removal that failed while Docker was down is retried: strays for 24 hours, and an ended
link's container while the link is listed. A failed start counts as cleared only after a
removal at least a minute later, which catches a create that landed late. Strays are memory
only. On shutdown a finalizer removes every watched and stray container and gives up after 5
seconds, leaving the links saved; the next start finds the containers gone and ends them.

Restoring a folder link needs its folder, its own port free, lanes on, and the lane it was
shared from still covering that port. It keeps that lane, so it still ends with it. A link
saved without a lane by an older build is refused.

## Library side

The same server code runs on every computer; the Library parts answer only where
`LOOM_LIBRARY_AUTHORITY` is set, and every other server answers 404, which computers read as
"this Library does not offer it".

### Registration and tickets

`PreviewAccessService` and
[`preview-access/http.ts`](../../../../apps/server/src/fork/preview-access/http.ts).
Registration takes a body under 4 KiB from one of two sessions:

- A computer's own publisher session (`loom:library:publish`, subject `loom-host:<id>`). An
  `environmentId` in the body, if any, must be its own.
- An operator session (`orchestration:operate`), which is what the shared enrollment token
  signs in as. The body must name the computer in `environmentId`.

Anything else, MCP clients included, is 403. The route upserts or deletes that computer's
`fork_preview_hosts` row, recording the session that registered it, and answers the ticket
key, plus `pagesOrigin` when pages are on.

The ticket route is described above. It signs only for its own pages host or a host whose row
is still enrolled: the row's session exists, is not revoked and has not expired. A dead row is
deleted when one of its hosts next asks, unless a newer session re-registered it meanwhile,
so revoking or expiring a computer's session ends sign-in to its previews. A row without a
session counts only for the Library's own computer, which registers in process; any other
such row is treated as unenrolled and deleted.

### Pages

`PageLibraryService` needs `LOOM_LIBRARY_AUTHORITY` and `LOOM_PAGES_ORIGIN`, an https origin
without a port; otherwise it logs a warning and answers `unavailable`. Pages belong to the
publishing computer's subject:

- A page id is 16 random bytes in base64url. The HTML, at most 8 MiB of UTF-8, is stored in
  the row, not in object storage, so purging the row deletes it.
- A computer may hold 500 open pages, counted on publish, republish and restore, and 1,000
  stored pages in all. At 1,000 a publish first deletes the longest-closed pages that have no
  waiting replies, with their replies, in one transaction, or is refused when none can go.
  Lists return open pages first and stop at 500.
- Republishing with `pageId` replaces the HTML in place only from the same thread; another
  computer's page, or one past its restore window, reads as `not-found`.
- `keep` clears the expiry; `release` sets it 30 days from now; `end` closes it; `restore`
  reopens a closed page within 7 days for a fresh 30 days, when there is room.
- An hourly sweep deletes pages past their restore window with their replies, and settled
  replies older than 7 days.

The Library's computer-facing routes accept only a computer's own publisher session; an MCP
client or a session without `loom:library:publish` gets 403, and a Library without pages answers
404 before reading the body. Bodies are capped (publish at twice 8 MiB plus 64 KiB for JSON
escaping, the rest at 16 KiB), and page errors map to 409 with their reason and message.

### Pages host

[`preview-pages/host.ts`](../../../../apps/server/src/fork/preview-pages/host.ts) is a second
`node:http` listener on `LOOM_PAGES_PORT` (default 3774) at the server's host. It starts only
when pages are on and the Library has a fixed issuer origin; a taken or invalid port logs a
warning and costs only the pages. Because it is its own listener, no app, `/api` or `/ws`
route answers there.

- Any `Host` but the pages host gets 421. Routes: `/__loom/ticket` (GET only; HEAD is
  refused so a ticket is never spent without a page to show), `/p/<id>` (the shell),
  `/raw/<id>` (the page) and `POST /p/<id>/replies`. Everything else is 404, and upgrades are
  destroyed.
- Sign-in is the same ticket flow with audience `https://pages.<domain>`, verified against
  the Library's own key. The cookie is `__Host-loom_pv` for the pages host with key
  `library:<sub>`, signed with its own secret `loom-preview-pages-cookie-key`. Signed out, a
  navigation to a page gets the sign-in page and a nonce; anything else gets a bare 401. If
  that secret cannot be read or created, the host signs no one in: one logged error, then 503
  "Sign-in is unavailable" on every pages route. It never falls back to a random key.
- `POST /api/loom/library/pages/sign-out`, from a computer's publisher session only, records
  a sign-out in `fork_preview_page_signouts` at one past the latest from any computer. The
  host refuses every cookie issued at or before the latest sign-out on page, raw and reply
  requests, and mints new cookies one past it, so a clock step cannot keep a reader out. It
  is global, because every reader is the Library's one user, and it does not end Library
  sessions, so a reader can sign straight back in. **Sign out preview browsers** calls it
  after signing out link browsers, best effort with 10 seconds; an older Library's 404 is
  skipped, and any other failure only logs.
- Every answer is private: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex,
nofollow`, `nosniff` and `Referrer-Policy: no-referrer`. Status pages add
  `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'` and
  `X-Frame-Options: DENY`.
- The shell's policy allows only its own nonce'd script and style, frames and fetches from
  this host and `data:` images, with `base-uri`, `form-action` and `frame-ancestors` all
  `'none'`. The raw page carries
  `sandbox allow-scripts allow-forms allow-popups allow-downloads` and
  `frame-ancestors <pages origin>`, and the shell's iframe has the same sandbox with
  `referrerpolicy="no-referrer"`. Never `allow-same-origin`, so a page's scripts run at an
  opaque origin and cannot read the cookie, call the reply route or reach the shell; never
  `allow-modals`.
- The shell talks to the page only by `postMessage`: a Dossier reports its height (clamped to
  80 to 100,000 px) and can prefill the reply box with its decisions, and an html page gets
  its theme in the frame's fragment and on color-scheme changes. `ui/open-link` opens only
  http(s) addresses on a user gesture. Only a click on Send posts a reply.

### Replies

A reply needs a pages session and `Origin` exactly the pages origin, so the sandboxed page,
whose origin is `null`, cannot post one itself; the shell's fetch sets
`referrerPolicy: strict-origin` because its own `no-referrer` would send `Origin: null` too.
The body must be JSON under 64 KiB, declared or streamed (413 and a closed connection
otherwise). The reply id (8 to 64 URL-safe characters, one per draft) makes a retried send a
no-op, text is 1 to 20,000 characters, and a computer may have 1,000 waiting (429 in the
browser). The shell maps 400, 404, 429 and others to its own messages.

`PreviewPagesService` on the computer long-polls `replies/next` (up to 25 seconds; one wake
signal per computer subject). The Library leases each batch of up to 20 for 2 minutes. Each
reply is sent with `sendToThread`, mode `queue`, created by the system, with the command id
`preview-reply:<replyId>` and message id `preview-reply-message:<replyId>`, so a redelivery
cannot queue it twice. The text is
`A reply came in on your published page "<title>":` followed by the reply. The computer acks
a reply as delivered, or as rejected when the thread is archived, gone, a subagent or refuses
the command. Any other failure leaves it unacked, and the Library offers it again after the
lease. An unavailable or blocked Library pauses the relay 30 minutes; an unreachable one backs
off from 5 seconds to 5 minutes, and a round that settled nothing waits at least a second.

### Computer page sources

`loom_page_publish` takes exactly one source. An `attachmentId` must be an `html_render`
attachment whose id carries this thread's segment and the html extension, and whose
`realpath` stays inside the attachments directory. A `path` must be an `.html` or `.htm` file
whose `realpath` stays inside the thread's worktree or workspace root. Both are read through
the descriptor that was opened, bounded at 8 MiB, and must be valid UTF-8. A thread can list
and change only its own pages; the owner, over RPC, any of the computer's.

## Storage

- `<stateDir>/fork/preview-links/state.json`: `{ version: 1, settings, links, revokedKeys,
libraryKeys, folderRoots }`, written with `writeFileStringAtomically`. Missing gives the
  defaults (off, no domain, machine from the host name, 12 hours, port 3779). Unreadable
  logs a warning and gives the defaults. `libraryKeys` and `folderRoots` are optional, so an
  older file still reads.
- Links are bounded: the sweep expires open links at `expiresAt` (dating the end there, so
  downtime does not stretch the restore window) and drops ended links past
  `restorableUntil`.
- `revokedKeys` holds when each access key last lost a session to removal, kept for 12 hours,
  the longest a cookie lives. It is saved because a DPoP subject's other sessions are listed
  again after a restart and would make the key live for cookies minted before the removal.
- `libraryKeys` holds each Library sign-in's access key and when its last cookie runs out,
  because no session store knows those keys. `folderRoots` holds each folder link's resolved
  folder, so the reconcile can serve it again after a restart.
- `ServerSecretStore` on the computer: `loom-preview-links-cookie-key` (32 random bytes,
  created on first start; a temporary key with a warning if the store fails) and
  `loom-preview-links-tunnel-token`. Neither is logged or returned.
- In memory only: entry codes, the Library's ticket key and origin (fetched again at start),
  spent tickets and nonces, each Loom session's access key and when it stops counting
  (rebuilt from the session store's active sessions at every start), sessions removed while
  running (12 hours), running requests and upgrades, and folder servers.
- Library tables, in the fork migration sets every server runs: `fork_preview_hosts` (one row
  per computer subject: its environment, machine, suffix and registering session),
  `fork_preview_pages` (the page, its HTML, owner thread and lifecycle),
  `fork_preview_page_replies` (each reply with its lease and outcome) and
  `fork_preview_page_signouts` (each computer's latest pages sign-out). Migration 2 of
  `preview-access` added the session column and dropped every older row once, since none
  had a session to check; computers register again within 30 minutes. Library secrets:
  `loom-preview-ticket-ed25519` and `loom-preview-pages-cookie-key`.

Link state is a sidecar file instead of fork tables: the data is small, per computer, and read
whole. Pages and replies are tables because they live in the Library, outlive the computer
and are queried per subject.

## Clients

- Shared atoms: `packages/client-runtime/src/fork/preview-links.ts` (snapshot subscription,
  the pages list as a query, and one command per mutation, with `permissionAtom`s), plus the
  shared presentation: `previewLinkBackingLabel`, `visiblePreviewPages`, `previewPageTiming`
  and `previewPageControls`. Open is offered only for an https page address, because the
  address comes from the Library through the computer and web opens it from the app's origin.
- Navigation: `resolvePreviewNavigationWith` in
  `packages/client-runtime/src/fork/preview-link-navigation.ts`, given each client's
  `PreviewNavigationDeps` (`navigationDeps.ts` on web, `navigation.ts` on mobile). On web,
  seams that load a URL in the preview call `navigablePreviewUrlFor`; seams that open the
  system browser call `openEnvironmentUrlExternally`, `openPreviewInSystemBrowser` or
  `takeUnreachableLoopbackClick`. A loopback URL on an environment this client cannot reach
  is shared and opened as an entry; a preview link URL becomes a fresh entry on the first
  connected computer that owns it (thread's computer first); a server-drawn browser on the
  owning computer loads `localhost` directly. When links are not set up or this connection
  cannot share, a private network connection gets the computer's private network address.
  A computer without the feature, reached over a private network, keeps the URL as typed on
  web (`keepsTypedLoopbackOnPrivateNetwork`) and gets that address on mobile. Anything else
  is an error; the unreachable and not-set-up errors name the client's `settingsPath`.
- Web UI: `settings.tsx` (section `preview-links`, title "Previews", with `pages.tsx` below it
  when the server advertises `preview-pages`), `LinksSheet.tsx` (mounted as
  `preview-links-host` in `ForkRoot`), `PortCardActions.tsx`, `palette.tsx`.
  `systemBrowser.ts` opens the window before awaiting on the web and hands the finished URL
  to the shell on desktop. Container rows have no Extend, and ended container links leave
  the list.
- Web system browser: a link page opens nowhere outside Loom without an entry, so every way
  out swaps it for a fresh one (`needsPreviewLinkEntry` in contracts skips `/__loom/` pages).
  `localApi.ts` `shell.openExternal` calls `openPreviewLinkExternally`, covering Alt-click,
  context menus, `useOpenLink` and the terminal and preview fallbacks. Plain anchor clicks that
  React leaves to the browser are caught by a window click listener in `PreviewLinksHost`. The
  preview's "Open in browser" uses `openPreviewInSystemBrowser`, which also turns a loopback
  address into a link. `McpAppFrame`'s `openLink` calls `window.open` directly and is not
  covered.
- Gating: `capabilities.loomFeatures` includes `"preview-links"`, and `"preview-pages"` for
  the pages list (`advertised.ts`, `capability.ts`), plus each command's `permissionAtom`.
- Mobile: `apps/mobile/src/fork/preview-links/` (Previews screen, `PreviewPagesSection.tsx`,
  `externalUrl.ts`, `entryUrl.ts`, `previewLinksLogic.ts`). Every external open goes through
  `tryOpenExternalUrl`, which swaps a preview link for an entry link from the first connected
  computer whose `open` accepts it. Entry links pass through unchanged, and a link no computer
  serves opens as is. The lookup loads lazily so `openExternalUrl.ts` keeps no connection
  dependencies. A thread's other links (chat, html_render pages, MCP apps and the Files
  markdown preview) go through `openThreadUrlExternally`: a loopback port the phone cannot
  reach (anything but a simulator on its own Mac) is shared first. Where that cannot happen,
  a private network connection opens the port on the computer's address. Failures show an
  alert that names Settings > Loom > Previews in the desktop or web app. Container links offer
  neither Extend nor Restore.

## Agent-facing tools

| Tool                           | Access          | Does                                                                    |
| ------------------------------ | --------------- | ----------------------------------------------------------------------- |
| `loom_preview_links_list`      | `readsAsCaller` | `ready`, tunnel state and the caller thread's links.                    |
| `loom_preview_link_share`      | `actsAsCaller`  | Share a port as the caller's thread; returns the canonical link only.   |
| `loom_preview_folder_share`    | `actsAsCaller`  | Serve a built workspace folder on a lane port.                          |
| `loom_preview_container_share` | `actsAsCaller`  | Run an image on a lane port for 5 to 240 minutes (120 by default).      |
| `loom_preview_link_revoke`     | `actsAsCaller`  | End one of the caller thread's links.                                   |
| `loom_page_publish`            | `actsAsCaller`  | Publish an html_render result or workspace HTML file, or republish one. |
| `loom_pages_list`              | `readsAsCaller` | The caller thread's pages, or `available: false`.                       |
| `loom_page_update`             | `actsAsCaller`  | Keep, release, end or restore one of the caller thread's pages.         |

All require a thread scope. They are not gated on the preview MCP capability. Agents never
call `open` and never see a ticket, so no transcript carries a working credential.

## Security reasoning

- **Why entry codes.** The canonical URL ends up in chats, transcripts, logs and clipboards.
  A bearer URL would let anyone who saw it in. An entry code is minted only for an
  authenticated Loom session with `preview:operate`, works once within 60 seconds, is bound
  to one host and path, and is spent even on a failed attempt. The 303 removes it from the
  address bar, and `no-referrer` and `no-store` keep it out of referrers and caches.
- **Why tickets are bound to a host and a nonce.** A ticket is a credential in a URL, so it
  lives a minute, works once and names one host in its audience, which stops a ticket for
  one link from working on another or on the pages host. The nonce sits in a host-only
  cookie set on the page that showed the sign-in link, so a ticket only works in the browser
  that asked for it: an attacker cannot hand a victim a ticket for the attacker's session.
  The `jti` stays spent past `exp` by the skew allowance plus a second, so a ticket cannot
  verify again after its spent entry is dropped. Ed25519 lets computers verify without
  holding anything that can sign.
- **Why host-only cookies.** The `__Host-` prefix forces `Secure`, `Path=/` and no `Domain`,
  so no sibling host can set or scope a cookie for the whole domain. Each link is its own
  origin, and the signed host claim stops a cookie copied to another link from working.
  `HttpOnly` hides it from the previewed app, and the gateway strips `__Host-loom*` both
  ways so the app can neither read nor overwrite it. `SameSite=Lax` carries it on top-level
  navigation from Loom while leaving cross-site subresources without it.
- **Why Origin checks.** All links share one registrable domain, so they are same-site with
  each other and `SameSite` does not separate them. One previewed app could post to another
  link the browser is signed in to, and a form `POST` counts as a navigation. The gateway
  refuses requests from another origin unless they are `GET` or `HEAD` navigations, and
  requires an exact origin for WebSockets, which neither CORS nor `SameSite` protects
  (cross-site WebSocket hijacking). `GET` and `HEAD` navigations stay allowed so links open
  from anywhere. A `no-referrer` page sends `Origin: null` on its own form posts, so `null`
  counts as this origin when `Sec-Fetch-Site` is `same-origin`. The browser sets that header
  and gives it only when every redirect stayed on this host, so a sibling link (`same-site`)
  or a sandboxed frame (`cross-site`) cannot pass. A WebSocket always carries its page's real
  origin, so a `null` one is refused.
- **Why a separate pages host.** A published page is HTML an agent wrote, possibly from
  untrusted input. On the Library's own origin it would run with the reader's Library
  session. Its own host on its own listener means no Library route exists there to reach,
  the sandbox without `allow-same-origin` keeps its scripts off the pages cookie and the
  reply route, and the exact Origin check on replies refuses anything but the shell.
- **Why Cache-Control.** Responses are a signed-in user's dev data, and they pass through
  Cloudflare's edge. A dev server that sends cacheable headers could otherwise let the edge
  or another cache serve the page to a browser with no cookie, skipping the gateway.
  `private, no-store` on every response prevents that. `CDN-Cache-Control`,
  `Cloudflare-CDN-Cache-Control` and `Surrogate-Control` are dropped because Cloudflare
  obeys them over `Cache-Control`. `X-Robots-Tag` keeps crawlers out. Cloudflare also
  rewrites HTML by default, injecting its Web Analytics beacon and hiding email addresses, so
  HTML responses and the gateway's own pages add `no-transform`. Other responses leave it off
  because it also stops edge compression, which large dev bundles need on a phone.
- **Why loopback and a denylist.** The gateway, folder servers and container ports bind
  `127.0.0.1` so the tunnel is the only way in. Debugger ports mean code execution and
  database ports mean data, so they are never shared, and the check repeats on every request
  so a later settings change cannot leave an open path to a newly reserved port.
- **Why the header rewrites.** Dev servers such as Vite refuse unknown hosts and check
  `Origin` for CSRF and WebSockets. Rewriting to `localhost:<port>` keeps them working
  without asking users to allow the public host.

## Performance

The snapshot is small and bounded by the sweep; it is pushed only on change. The web sheet
re-renders once a minute (`useNowMinute`), and mobile every 30 seconds while the screen is
open. The gateway and folder server stream bodies and keep no per-request state beyond one
set entry per running request or upgrade, removed when it closes. The pages list is fetched
when the section mounts and when the links snapshot's optional `pagesRevision` moves, never
polled. The revision starts at the computer's boot time and counts this computer's own page
changes; a server without it leaves clients refetching after their own changes. The session
store is listed once a minute, one query. The reply relay holds one long
poll per computer, and the Library wakes it with one signal per subject instead of polling
the table. Containers are checked once a minute, not per request.

## Alternatives considered

- Cloudflare quick tunnels: random hostnames per run, no stable address to restore.
- Bearer URLs or basic auth: links in transcripts would be credentials.
- A cookie on the whole domain: every previewed app could read or overwrite it.
- Effect's HTTP server: cannot route by host before parsing or pipe raw upgrades.
- Library storage for links: links are per computer and short-lived. The Library holds only
  which hosts each computer serves.
- Serving pages from the computer through the tunnel: a page would die with the computer,
  and replies would have nowhere to wait.
- Pages on the Library's origin, or a path under it: a page's scripts would run beside the
  reader's Library session.
- Serving folders with the dev server or a container image: an in-process server is
  smaller, starts at once and can enforce containment itself.

## Known gaps

- A session revoked with `t3 auth session revoke` while the server runs keeps preview access
  for up to a minute, until the next list of the session store. A DPoP session revoked while
  the server is down revokes nothing, because the server never knew it, so its browsers stay
  in while another session of its subject is listed.
- A DPoP session removed before this server knew it (the list failed, or it was removed
  between subscribing to changes and reading the list) revokes nothing, because a removal
  carries only the session id. Its browsers stay in while another session of its subject is
  live. If the list fails at start, every preview cookie from a Loom session is refused until
  the next list a minute later.
- Removing one T3 Connect device signs out the browsers opened from every T3 Connect device,
  because they share one access key. A T3 Connect device that just stops connecting keeps its
  browsers in for 5 minutes after its last session runs out, and while another one stays
  signed in, up to the cookie's 12 hours.
- Restarting the desktop app replaces its session on its own computer, and the store reports
  that as a removal, so browsers it opened that computer's links in have to enter again.
- Readiness comes only from log lines, and both lines are confirmed only in `cloudflared`
  2026.9.1, not in the pinned 2026.10.0. On a platform with no release asset, an older binary
  on `PATH` starts an install that fails at once; it logs a warning at most every 10 minutes
  and keeps running.
- A dev server on a hand-picked port from 55536 takes its default gateway port 10,000 below,
  which can land in the lane port range. The dev runner's own ports never do.
- A computer enrolled with the shared enrollment token cannot be dropped on its own: its row
  is tied to the token's session, so revoking that ends preview sign-in for every computer
  that used it. Give a computer its own publisher credential to make it removable alone. A
  computer on the shared token from before this registration change still gets 403 until it
  upgrades.
- After the Library takes `preview-access` migration 2, a browser without a cookie cannot
  sign in to a computer's previews until that computer registers again, up to 30 minutes
  (or its restart).
- A computer judges "issued before I started" on the Library's clock. If the Library runs
  ahead, a ticket signed up to that skew (at most the 30 seconds allowed) before a restart
  can still be spent once, and only by the browser holding its nonce cookie. Closing it needs
  spent tickets on disk.
- The Library's identity login answers 503 without Pocket ID configured, so sign-in needs it.
- **Sign out preview browsers** reaches pages best effort: when the Library does not answer
  within 10 seconds, pages readers stay signed in and only a warning is logged. If the
  Library's clock steps back below a cookie it already minted, a later pages sign-out can land
  under that cookie's `iat` and miss it.
- The pages revision moves only for this computer's own changes. A page that expires in the
  Library, or changes from another computer, shows up on the next list read.
- Container strays are memory only, so a Docker outage that outlasts a Loom restart leaves
  any container a failed start created until its lane is released. Shutdown waits about 5
  seconds for removals, plus up to a second to stop a `docker` command already running.
- The folder server hides every dotfile but `.well-known`.
