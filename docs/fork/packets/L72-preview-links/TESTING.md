# L72 testing

The server files were rerun on 2026-10-19 after the DPoP renewal grace: the 54 tests in
`apps/server/src/fork/preview-links/` pass and the server typechecks. The contract and client
files were reported passing on 2026-10-18; that round changed only server code.

## Automated tests

Server, `apps/server/src/fork/preview-links/`:

| File                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreviewLinksService.test.ts` | Defaults and refusing to share while off; reuse of an open link and persistence across restarts; agent lane and terminal rules; agent revoke limits; denied, own and metrics ports; entry codes bound to host, clean path and 60 seconds; signed-out sessions and key rotation, including a sign-out whose caller is interrupted; sessions removed while being listed or before a restart; sessions admitted later waking the expiry timer; T3 Connect browsers staying in across an hourly session that renews only after it runs out, out once any session of the subject is removed, out 5 minutes after the last session runs out and back in with the next, and still out after a restart while another session is listed; expiry and purge; restore at the same address; domain change ends links and blocks restore; lane links ending only after the lane is seen and removed; starting and stopping only what changed; gateway listen failure and retry. |
| `policy.test.ts`              | Denylist, machine names, share segments, path sanitizing (no host escape or header injection), cookie signing (tampering, other host, other key, expiry), sweep and next deadline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `gateway.test.ts`             | Against a real loopback upstream: 404 and 410, entry redemption and redirect, the open-from-Loom page, denied ports and cross-site requests, request and response header rewrites, the nothing-listening page, `Origin: null` form posts (own page only), chunked bodies re-framed, streaming responses cut when their link or key ends, upgrade piping and closing, cross-origin upgrade refusal, an upgrade answered without switching being closed, busy port message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tunnel.test.ts`              | With a fake connector script: progress, metrics port and connection without leaking the token; restart with backoff; an exit with no error output; installing a missing `cloudflared` and retrying a failed install.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `mcp.test.ts`                 | Unique `loom_` names and object inputs; sharing as the caller and returning only the canonical link; listing only the caller's links; revoking only the caller's own; refusing act tools outside a live thread before the service runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Contracts and clients:

| File                                                                 | Covers                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/preview-links.test.ts`                  | Splitting a host under its suffix, recognizing link hosts without the suffix, defaulting the gateway port.                                                                                                                              |
| `packages/client-runtime/src/fork/preview-links.permissions.test.ts` | Each command's `permissionAtom` requires its scope on the serving computer.                                                                                                                                                             |
| `packages/client-runtime/src/fork/preview-link-navigation.test.ts`   | Every navigation branch: reachable loopback, share and open, private network fallback, setup errors naming the client's settings, owner lookup across computers, server-drawn browsers, ended links, stale entries landing on the root. |
| `apps/web/src/fork/preview-links/navigation.test.ts`                 | System browser opens from a thread: an unreachable loopback port and a preview link open through an entry, a reachable one and other addresses open unchanged, and a failed share closes its window.                                    |
| `apps/web/src/fork/preview-links/links.test.ts`                      | Link ordering, countdowns, settings normalization and the first invalid field.                                                                                                                                                          |
| `apps/web/src/browser/browserTargetResolver.test.ts`                 | The updated unreachable error and leaving loopback unmapped for advertising environments.                                                                                                                                               |
| `apps/mobile/src/fork/preview-links/previewLinksLogic.test.ts`       | Which computers are listed and asked first, setup status, link ordering and timing, actions per state and permission, which connections reach a computer's loopback, and mapping a port to its private network address.                 |

## Commands

```sh
vp test run apps/server/src/fork/preview-links
vp test run packages/contracts/src/fork/preview-links.test.ts
vp test run packages/client-runtime/src/fork/preview-links.permissions.test.ts \
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

## Live smoke

Run on 2026-10-19 against a worktree `.t3` (never the live install), gateway port 3779, and
the `loom-previews-dorothy` tunnel on bagels.top, with curl and Node clients on Dorothy going
out through Cloudflare. Loom sessions were bearer tokens issued with `t3 auth session issue`.
Connector: Homebrew `cloudflared` 2026.9.1 from `PATH`.

- Setup reaches ready, tunnel connected, gateway listening, with one `cloudflared` as a child
  of the server, and again after a server restart.
- Without a cookie: "Open this link from Loom", with `Cache-Control: private, no-store`,
  `X-Robots-Tag: noindex, nofollow` and `cf-cache-status: DYNAMIC`.
- Entry sets `__Host-loom_pv` (Secure, HttpOnly, SameSite=Lax, 12 hours) and redirects to the
  path and fragment without the code. A reused entry gets 401, and one link's cookie is
  refused on another.
- Proxied requests reach the app as `localhost:<port>` without the preview cookie; `Location`
  and `Set-Cookie` are rewritten, and the app's own cookies pass through.
- Origin: foreign and sibling-link POST navigations 403, a foreign GET navigation 200, an
  own-origin CORS POST 200, `Origin: null` 200 same-origin and 403 same-site.
- WebSockets: own origin with a cookie opens and pipes both ways; a foreign origin gets 403
  and no cookie 401. An upstream that does not upgrade is refused, the raw socket at the
  gateway gets 404 and is closed, and the plain upstream saw none of the private requests.
- Hosts: an unknown share on this computer 410, another computer 404, a bare label 404.
- Refused ports: 22, 80, 3779, the server and web ports, 5432, 9229 and the connector's
  metrics port.
- Revoke closes a running WebSocket and event stream, then the cookie gets 410. Restore is
  refused while the port has another open link, then reopens the same address and the old
  cookie works again. Extending to 1 hour sticks across a restart.
- A session revoked with the CLI while the server runs keeps its cookie (known gap) and loses
  it after a restart. The live session's cookie and the link survive the restart.
- Removing a session through the running server (`POST /api/auth/clients/revoke`) refuses its
  browser at once, leaves another session's browser in, and saves the revocation in
  `state.json`.
- **Sign out preview browsers** refuses every cookie, and a fresh entry works afterwards.

## Real-client pass

On 2026-10-19, web through T3's Browser panel against a worktree dev server on Dorothy, with
links on bagels.top:

- A link opened from Loom lands with the code gone from the address bar; a private window
  shows "Open this link from Loom".
- Vite hot reload works through the tunnel. Ending the link drops the socket at once and a
  reload shows the ended page; Restore brings the same address back on the old cookie.
- Port card **Copy preview link** and **Open in browser**, both palette items, the links
  sheet and Settings > Loom > Previews.
- From a client paired over the tailnet, a terminal link and a chat link to `localhost:5797`
  open its bagels.top link. From a localhost client the same chat link opens `localhost`.
- Safari on an iPad simulator paired over the tailnet: **Copy preview link** puts the link on
  the pasteboard. Before the fix the write ran after the share and Safari refused it.
- The iPad app paired over the tailnet: an agent's `localhost:5797` chat link opens Safari on
  its bagels.top link. With nothing on the port the page says so; it answered 502 before, and
  Cloudflare showed its own error page instead.

## Still to check

These need Kyle's permission for a real browser or device.

- Removing the connector token stops `cloudflared`, and a wrong token shows the tunnel error.
  The "Unregistered tunnel connection" log line has not been seen.
- DPoP sessions: a browser opened from mobile or from web over T3 Connect stays in past an
  hour with its hot reload socket open, and removing that device signs it out.
- Web on app.t3.codes over T3 Connect, and desktop connected to a remote computer.
- Mobile on cellular: Settings > Previews actions, and tapping an agent's link in a thread,
  in an html_render page, in an MCP app and in the Files markdown preview. Only the chat link
  has been tapped, on the simulator over the tailnet.
- An agent sharing a lane port and a terminal server, being refused another port, and its
  lane link ending when the lane is released.
- Restore refused after a domain or computer name change.
- Upstream T3 server: no preview actions; the unreachable loopback error names Settings >
  Loom > Previews.

## Merge safety

On 2026-10-19 at the closed-port commit: `check_seams` passes, and a merge with
`v0.1.1-nightly.20261019.3360` conflicts in the branch base's 59 files plus three thread-link
seams upstream has since rewritten. See [SEAMS.md](./SEAMS.md#merge-check) for how each
resolves.
