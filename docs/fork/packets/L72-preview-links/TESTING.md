# L72 testing

The implementers reported every file below passing in focused runs on 2026-10-18. They were
not rerun when these docs were written; only `check_seams` was.

## Automated tests

Server, `apps/server/src/fork/preview-links/`:

| File                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreviewLinksService.test.ts` | Defaults and refusing to share while off; reuse of an open link and persistence across restarts; agent lane and terminal rules; agent revoke limits; denied, own and metrics ports; entry codes bound to host, clean path and 60 seconds; signed-out sessions and key rotation; expiry and purge; restore at the same address; domain change ends links and blocks restore; lane links ending only after the lane is seen and removed; starting and stopping only what changed; gateway listen failure and retry. |
| `policy.test.ts`              | Denylist, machine names, share segments, path sanitizing (no host escape or header injection), cookie signing (tampering, other host, other key, expiry), sweep and next deadline.                                                                                                                                                                                                                                                                                                                                |
| `gateway.test.ts`             | Against a real loopback upstream: 404 and 410, entry redemption and redirect, the open-from-Loom page, denied ports and cross-site requests, request and response header rewrites, the nothing-listening page, upgrade piping and closing, cross-origin upgrade refusal, busy port message.                                                                                                                                                                                                                       |
| `tunnel.test.ts`              | With a fake connector script: progress, metrics port and connection without leaking the token; restart with backoff; an exit with no error output; installing a missing `cloudflared` and retrying a failed install.                                                                                                                                                                                                                                                                                              |
| `mcp.test.ts`                 | Unique `loom_` names and object inputs; sharing as the caller and returning only the canonical link; listing only the caller's links; revoking only the caller's own; refusing act tools outside a live thread before the service runs.                                                                                                                                                                                                                                                                           |

Contracts and clients:

| File                                                                 | Covers                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/fork/preview-links.test.ts`                  | Splitting a host under its suffix, recognizing link hosts without the suffix, defaulting the gateway port.                                                                                                               |
| `packages/client-runtime/src/fork/preview-links.permissions.test.ts` | Each command's `permissionAtom` requires its scope on the serving computer.                                                                                                                                              |
| `apps/web/src/fork/preview-links/navigation.test.ts`                 | Every navigation branch: reachable loopback, share and open, private network fallback, Settings > Previews errors, owner lookup across computers, server-drawn browsers, ended links, stale entries landing on the root. |
| `apps/web/src/fork/preview-links/links.test.ts`                      | Link ordering, countdowns, settings normalization and the first invalid field.                                                                                                                                           |
| `apps/web/src/browser/browserTargetResolver.test.ts`                 | The updated unreachable error and leaving loopback unmapped for advertising environments.                                                                                                                                |
| `apps/mobile/src/fork/preview-links/previewLinksLogic.test.ts`       | Which computers are listed and asked first, setup status, link ordering and timing, actions per state and permission.                                                                                                    |

## Commands

```sh
vp test run apps/server/src/fork/preview-links
vp test run packages/contracts/src/fork/preview-links.test.ts packages/client-runtime/src/fork/preview-links.permissions.test.ts
vp test run apps/web/src/fork/preview-links apps/web/src/browser/browserTargetResolver.test.ts
vp test run apps/mobile/src/fork/preview-links
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
bash -c 'source scripts/fork/loom.sh && check_seams'
```

`scripts/fork/loom.sh check` does not typecheck `apps/mobile` (`TYPECHECK_DIRS`), so run its
typecheck by hand.

## Still to check

None of these have run. They need Kyle's permission, a worktree `.t3` (never the live
install), a gateway port that does not collide with the live install, and a test domain and
tunnel.

- Live tunnel: with a real connector token, the status reaches "Ready on <domain>"; removing
  the token stops `cloudflared`; a wrong token shows the tunnel error. Confirm the
  "Registered" and "Unregistered tunnel connection" log lines against `cloudflared`
  2026.10.0.
- Entry and cookie through Cloudflare: open a link from Loom and land on the app; the
  address bar loses the code; the same URL in a fresh or private browser shows "Open this
  link from Loom"; a replayed entry URL shows "Open the preview again from Loom"; responses
  carry `Cache-Control: private, no-store` at the browser.
- Vite hot reload and other WebSockets through the tunnel; ending the link closes them.
- Web on app.t3.codes over T3 Connect, and desktop connected to a remote computer: chat
  links, terminal links, the preview panel, port card **Copy preview link** and **Open in
  browser**, the links sheet, the palette items and Settings > Previews. Check Safari's
  clipboard after the asynchronous share.
- Mobile on cellular: Settings > Previews actions, and tapping an agent's link in a thread.
- An agent sharing a lane port and a terminal server, being refused another port, and its
  lane link ending when the lane is released.
- Restore within 7 days, refusal after a domain or computer name change, and Sign out
  preview browsers.
- Upstream T3 server: no preview actions; the unreachable loopback error names Settings >
  Previews.
- A runtime `ForkLayer` build (no test builds the full layer today).

## Merge safety

Not run yet. See [SEAMS.md](./SEAMS.md#merge-check).
