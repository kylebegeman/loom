# L72 testing

At the slice 5 commit, the focused suites passed: 14 files and 147 tests across
`apps/server/src/fork/preview-links`, `apps/server/src/fork/features.test.ts`,
`packages/client-runtime/src/fork/preview-links.test.ts`, `apps/web/src/fork/preview-links`
and `apps/mobile/src/fork/preview-links`.

After the gap fixes and the merge with `main` on 2026-10-20, the server suites passed: 17 files
and 222 tests across `preview-links`, `preview-access`, `preview-pages` and the project-library
`LibraryPublisher`, `LibraryReplication`, `LibraryActivityPublication` and
`LibraryCopyHealthPublication` tests. `apps/server`, `packages/contracts`,
`packages/client-runtime`, `apps/web` and `apps/mobile` typechecked clean.

## Automated tests

Links, `apps/server/src/fork/preview-links/`:

| File                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PreviewLinksService.test.ts` | Defaults and refusing to share while off; reuse of an open link and persistence across restarts; agent lane and terminal rules; agent revoke limits; denied, own and metrics ports; entry codes bound to host, clean path and 60 seconds; signed-out sessions and key rotation, including an interrupted caller; sessions removed while being listed or before a restart; sessions admitted later; T3 Connect browsers across hourly sessions, past the grace and after a restart; expiry, purge and restore at the same address, refused while the port has another open link; domain change ending links; lane links ending only after the lane is seen and removed; starting and stopping only what changed; gateway listen failure and retry. Library sign-in: a ticket signs a browser in once, a Library sign-in's requests end with its cookie, Library keys survive a restart until browsers are signed out, registration on and off riding out a Library blip, and the half-hourly refresh. Folders: the first free lane port once per folder, refusing folders outside the workspace, files and threads without lane ports, stopping the server on revoke or lane release, restoring only on a free port, serving again after a restart and ending a link whose folder went or whose port now answers something else. Containers: holding a starting container's port, running on a lane port and removing it at the end, ending when the container stops or its time is up, refusing without Docker and cleaning up after a failed start, and no extend or restore. |
| `gateway.test.ts`             | Against a real loopback upstream: 404 and 410, entry redemption, the open-from-Loom page, a cold navigation linked to Library sign-in with a fresh nonce, no sign-in link without a Library, a ticket traded for the cookie with the nonce cleared, a refused ticket answered with a fresh sign-in link or sent back to Loom, denied ports and cross-site requests, `Origin: null` form posts (own page only), header rewrites both ways, `no-transform` on HTML only, chunked bodies re-framed, streams cut when their link or key ends, the nothing-listening page, upgrade piping and closing, cross-origin upgrades refused, an upgrade answered without switching closed, and a busy port.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ticket.test.ts`              | A ticket round-trips for one host and nonce, and is refused for another host, nonce, issuer or key, when expired, from the future or tampered; only well-formed keys and nonces are accepted; one cookie read and duplicates refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `backings.test.ts`            | Content types; the `docker run` argv (detached, labelled for its lane and link, loopback only); requests kept inside the folder, its `realpath` included; `index.html` and never a listing; only `GET` and `HEAD` on loopback with safe headers; a taken port; starting a container and keeping its short id; explaining why Docker could not start one; reading and removing a container, a missing one counting as gone; removal by label when no id came back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `policy.test.ts`              | Denylist, machine names, share segments, path sanitizing (no host escape or header injection), cookie signing (tampering, other host, other key, expiry), sweep and next deadline. Library sign-in: an https Library kept exactly as given, anything that could send browsers elsewhere refused, and the sign-in link carrying the host, nonce and a path that stays on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `tunnel.test.ts`              | With a fake connector script: progress, metrics port and connection without leaking the token; restart with backoff; an exit with no error output; installing a missing `cloudflared` and retrying a failed install.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `mcp.test.ts`                 | Unique `loom_` names and object inputs; sharing ports, folders and containers as the caller and returning only the canonical link; listing and revoking only the caller's links; publishing from exactly one source; listing and changing only the caller's pages; act tools refused outside a live thread before the service runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Library sign-in, `apps/server/src/fork/preview-access/`:

| File                           | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http.test.ts`                 | Registration upserts and deletes a computer's hosts and returns the ticket key; the issuer from the request's origin without an identity callback, and the callback's port kept; not offered by a server that is not the Library authority; sessions that do not speak for a computer refused. Tickets: a signed-out browser sent through sign-in and back; a signed-in browser redirected only to a registered host; a bad nonce, an unregistered host and a session that cannot run work refused; a signed ticket verified by the preview host. |
| `PreviewAccessService.test.ts` | The configured public origin named as the pages issuer; its own pages tickets verified; another nonce or host, and anything malformed, refused; nothing verified without a fixed issuer.                                                                                                                                                                                                                                                                                                                                                          |

Pages and replies, `apps/server/src/fork/preview-pages/`:

| File                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageLibraryService.test.ts`  | Unavailable unless the Library is the authority with an https pages origin; publish and republish in place; keep, release, end and restore; expiry, and listing only while restorable; purging pages past restoring with their replies, and old acked replies; the open-page cap; reply validation, the waiting cap and a retried send ignored; leases, redelivery after a lapse and none after an ack; a waiting poll woken by a new reply.                                                                                                                                                                                                                                                                         |
| `libraryHttp.test.ts`         | Only a computer's own publisher session; 404 before reading the body without pages; publish, list, update and settle replies for the calling computer; page errors as 409 with reason and message; bodies declared over the cap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `host.test.ts`                | 421 for any other host; a signed-out navigation linked to sign-in with a fresh nonce, other signed-out requests without one; a ticket traded for the pages cookie, spent once with its nonce, and refused for another nonce or host; the shell's nonce'd policy around the raw page; the raw page sandboxed without its own origin; ended pages explained and a Library that cannot answer survived; nothing else routed and upgrades closed; a reply taken from the signed-in reader on the pages origin, refused without a session, from another origin, in another shape or over 64 KiB declared or streamed; `PagesHostLive` on `LOOM_PAGES_PORT`, and the server staying up when that port is taken or invalid. |
| `PreviewPagesService.test.ts` | Only this thread's html_render pages; workspace HTML files, refusing anything that resolves outside; the size limit and UTF-8; a computer or Library without pages reported as unavailable; a thread changing only its own pages and the owner any; replies delivered once as queued messages and settled; relaying on past a reply it cannot use; pacing a round that settled nothing; waiting out a refusing Library and backing off from an unreachable one.                                                                                                                                                                                                                                                      |

Elsewhere on the server:

| File                                                                                      | Covers                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/project-library/LibraryPublisher.test.ts`                           | Registering preview hosts, and reading a Library without preview sign-in as `not-found`; publishing, listing and updating pages and leasing and acknowledging replies; a Library without pages as unavailable, keeping the reasons it refuses with; pages unavailable without a Library and blocked without a token. |
| `apps/server/src/fork/project-library/attachments.test.ts`                                | Saved html_render pages collected from turn items and inherited items once each, sized from their files, and skipped when the file is gone.                                                                                                                                                                          |
| `apps/server/src/fork/project-lifecycle/` (`ProjectLifecycleService`, `leases`, `policy`) | Lane release removes lane containers before stopping listeners and spares the container runtime's port forwarders, by name when Docker does not answer; Docker Desktop and OrbStack found outside `PATH`; a new lane given a block nothing listens on or publishes, skipping a busy port at either edge.             |

Contracts and clients:

| File                                                                 | Covers                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/preview-links.test.ts`                  | Splitting a host under its suffix, recognizing link hosts without the suffix, which URLs need an entry, defaulting the gateway port.                                                                                                                                       |
| `packages/client-runtime/src/fork/preview-links.test.ts`             | Durations; which pages are listed and restorable; page timing and controls, never opening an address that is not https; the backing line for folders and containers, and nothing for a plain port.                                                                         |
| `packages/client-runtime/src/fork/preview-links.permissions.test.ts` | Each command's `permissionAtom`, page updates included, requires its scope on the serving computer.                                                                                                                                                                        |
| `packages/client-runtime/src/fork/preview-link-navigation.test.ts`   | Every navigation branch: reachable loopback, share and open, private network fallback, setup errors naming the client's settings, owner lookup across computers, server-drawn browsers, ended links, stale entries landing on the root.                                    |
| `apps/web/src/fork/preview-links/navigation.test.ts`                 | System browser opens from a thread: an unreachable loopback port and a preview link open through an entry, a reachable one and other addresses open unchanged, and a failed share closes its window.                                                                       |
| `apps/web/src/fork/preview-links/clipboard.test.ts`                  | The clipboard write starts during the click, falls back to text where a pending write is refused, and writes nothing on failure.                                                                                                                                           |
| `apps/web/src/fork/preview-links/links.test.ts`                      | Link ordering, ended container links dropped, countdowns, settings normalization and the first invalid field.                                                                                                                                                              |
| `apps/web/src/browser/browserTargetResolver.test.ts`                 | The updated unreachable error and leaving loopback unmapped for advertising environments.                                                                                                                                                                                  |
| `apps/mobile/src/fork/preview-links/previewLinksLogic.test.ts`       | Which computers are listed and which relay pages, setup status, link ordering and timing, actions per state and permission (none to extend or restore a container link), which connections reach a computer's loopback, and mapping a port to its private network address. |
| `apps/mobile/src/fork/preview-links/externalUrl.test.ts`             | A preview link swapped for an entry from the computer that serves it, or opened as is when none does.                                                                                                                                                                      |

Gap fixes, by area. Each new test was checked to fail with its fix taken out.

- Sign-in (`preview-access`, `ticket.test.ts`): no signing without a public origin, and 404
  routes until one is set; a shared operator token registers the computer it names, and a
  session that does not speak for that computer is refused; signing stops when the
  registering session is revoked or expires, deletes the row, and comes back on
  re-registration; a newer session's row survives a stale delete; a session-less row counts
  only for the Library's own computer; tickets issued before a restart are refused
  (`notBeforeMs`), on computers and on the pages host; `LibraryPublisher` sends
  `environmentId` and registers in process as its own Library.
- Pages (`preview-pages`, `LibraryPublisher.test.ts`): the host signs no one in without its
  stored cookie key; a sign-out refuses older cookies, including a same-millisecond second
  sign-out and a stepped-back clock, and signing in again works; the sign-out route takes a
  publisher session only and answers 404 without pages; the 1,000 stored-page eviction and
  its refusal, the 500 open-page cap on restore, open-first listing; the reply body cap,
  declared and streamed; the pages revision counting from its start; best-effort reader
  sign-out with its 10-second timeout under `TestClock`, and the 404 read as unavailable.
- Gateway and tunnel: an idle keep-alive socket closes when the access it last served ends
  (bounded at a second, so Node's own timeout cannot pass it); `configure` returns a gateway
  that cannot listen; lane links whose lane went while the server was down end at start;
  sessions revoked by another process end at the next minute's list, and a failed start list
  recovers; an older `cloudflared` gives way to the pinned release, runs while it downloads
  and falls back with a 10-minute retry.
- Backings: byte ranges (206, 416, several ranges); `--pull never` and pulling only a missing
  image; a share failing or cancelled during the pull leaves nothing to clean; strays removed
  by label after an outage, and a late container from a cancelled start; containers removed
  at shutdown within 5 seconds of a hung Docker, and their links ended at the next start;
  folder restore refused without its lane, or when the lane moved off its port; a folder
  link ended when its lane goes during the restore. `run --pull never` on a missing image was
  checked against Docker 29.8.0, whose exit and message match the error mapping.

The `PreviewLinksService` harness waits for the startup session list, and its lifecycle starts
with every stored lane, so a restart test with lane links must pass the same lanes to the
reopened harness. Its fake `docker` (`makeDocker`) can be shared across a restart.

## Commands

```sh
vp test run apps/server/src/fork/preview-links apps/server/src/fork/features.test.ts
vp test run apps/server/src/fork/preview-access apps/server/src/fork/preview-pages
vp test run apps/server/src/fork/project-library/LibraryPublisher.test.ts \
  apps/server/src/fork/project-library/LibraryReplication.test.ts \
  apps/server/src/fork/project-library/LibraryActivityPublication.test.ts \
  apps/server/src/fork/project-library/LibraryCopyHealthPublication.test.ts \
  apps/server/src/fork/project-library/attachments.test.ts apps/server/src/fork/project-lifecycle
vp test run packages/contracts/src/fork/preview-links.test.ts
vp test run packages/client-runtime/src/fork/preview-links.test.ts \
  packages/client-runtime/src/fork/preview-links.permissions.test.ts \
  packages/client-runtime/src/fork/preview-link-navigation.test.ts
vp test run apps/web/src/fork/preview-links apps/web/src/browser/browserTargetResolver.test.ts
vp test run apps/mobile/src/fork/preview-links
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
bash -c 'source scripts/fork/loom.sh && check_seams'
```

`scripts/fork/loom.sh check` does not typecheck `apps/mobile` (`TYPECHECK_DIRS`), so run its
typecheck by hand.

## Slice 1 live checks

Port links were checked on 2026-10-19 through a real tunnel on `bagels.top`, against a
worktree `.t3` and never the live install, with `cloudflared` 2026.9.1 from `PATH`:

- Setup reaches ready with one `cloudflared` as a child of the server, and again after a
  restart. Without a cookie the link shows "Open this link from Loom", uncached at the edge.
- Entry sets the host-only cookie and drops the code from the address; a reused entry and
  another link's cookie are refused. Origin, WebSocket, host and denied-port checks answer as
  [TECHNICAL.md](./TECHNICAL.md#gateway) says.
- Ending a link closes its WebSocket and event stream; restore brings the same address back
  on the old cookie; **Sign out preview browsers** refuses every cookie.
- The web Browser panel through a tailnet-paired remote client: links open from Loom, Vite
  hot reload works through the tunnel, and chat and terminal links to an unreachable
  `localhost` open their link. The port card, palette, links sheet and settings all work.
- Safari on an iPad simulator: **Copy preview link** reaches the pasteboard.
- The iPad app: an agent's `localhost` chat link, an html_render link and a Files markdown
  link each open Safari, signed in, on a link.
- Agents in a scratch project: lane and terminal ports share, other ports are refused with
  both rules named, and settling the thread ended the lane link.
- An upstream server paired with the same app offers no links and opens a loopback chat link
  on the computer's private address as before.

Traps for the next pass:

- An agent shell in a live-install lane carries that lane's `LOOM_LANE_*` variables and
  `TMPDIR` into anything it starts, the dev server included. Clear them before running the
  dev server's `lane-run` by hand, or the live install records the process as its own.
- Lane ports come from one 41000-48999 range for every Loom server on the computer, and a
  lane's release stops whatever listens on its block. Servers claim blocks in
  `~/.loom/lane-ports` (see the L19 technical notes), and new lanes skip blocks with a busy
  port, but a port outside any lane is not protected: check it with `lsof` before testing on
  it.

## Pages host smoke

A local run of the pages host checked:

- Any other `Host` gets 421.
- A cold navigation to a page gets 401 with the nonce cookie and the Library sign-in link.
- `/raw/<id>` and a reply `POST` without a cookie get 401.
- `/api` on the pages host is 404.
- The Library's pages API answers 401 without auth.

## Still to check

- A real-client pass for Library sign-in, pages, replies, and folder and container links.
- Pages at `pages.bagels.top` from another device, including a private window that signs in
  to the Library, and a reply sent while the computer is off.
- DPoP sessions: a browser opened from mobile or from web over T3 Connect stays in past an
  hour with its hot reload socket open, and removing that device signs it out.
- Web on app.t3.codes over T3 Connect, and desktop connected to a remote computer.
- Mobile on cellular: Settings > Previews actions, pages and link taps.
- A link in an MCP app. It goes through the same opener as the html_render and Files links,
  but no MCP server with an app UI was available to test.
- The "Unregistered tunnel connection" log line has not been seen, and neither readiness line
  has been checked against the pinned `cloudflared` 2026.10.0.
- Against the Library: a computer on the shared Library token registers, and revoking a
  computer's session ends sign-in to its links; **Sign out preview browsers** signs a pages
  reader out.

## Merge safety

All nineteen seams come from slice 1, and the upstream integration of nightly 20261019.3348
resolved its three thread-link conflicts. Slices 2 to 5 touched only fork-owned files. Before
the next integration, run the check in [SEAMS.md](./SEAMS.md#merge-check).
