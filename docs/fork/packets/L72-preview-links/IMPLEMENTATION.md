# L72 implementation

Slices 1 to 5 are on fork `main`. This page records the order they were built in and what is
left.

## Before changing it

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Never enable previews against the live install's state, and never touch a running
`cloudflared`. A dev server defaults to a gateway port of its own (its port plus 10,000), so
keep a saved port off the live install's 3779. Library behavior needs a server with
`LOOM_LIBRARY_AUTHORITY` and its own state directory, never the live Library.

## Build order

1. **Port links (slice 1).** Contracts and the nine link RPCs, client atoms, `policy.ts`, the
   gateway and its pages, the tunnel supervisor, `PreviewLinksService` with its sidecar and
   expiry fiber, the MCP toolkit, then the web navigation seams, settings, links sheet, port
   card and palette, and the mobile screen and link interception. All nineteen upstream seams
   come from this slice, which merged with `feat/preview-links` before the upstream
   integration of nightly 20261019.3348 resolved its conflicts.
2. **Shared groundwork.** Saved html_render pages reach the Library's history, lane release
   stops killing Docker's port forwarder, and new lanes skip port blocks something already
   uses. Then one contracts change for every later slice: sign-in, pages and backed links.
3. **Library sign-in (slice 2).** `ticket.ts`, `PreviewAccessService` with its migration and
   routes, the computer's registration and `libraryKeys`, and the gateway's sign-in and ticket
   pages.
4. **Pages and replies (slices 3 and 4, one change).** `PageLibraryService` and its tables,
   the Library's page routes, the pages host, `PreviewPagesService` with its sources and
   reply relay, the page RPCs and MCP tools. Then the Pages list on web and mobile.
5. **Folder and container links (slice 5).** `backings.ts`, the folder and container shares
   in `PreviewLinksService`, the reconcile, `folderRoots` in the sidecar, and the backing
   line and missing Extend on clients.

6. **Gap fixes.** Four parallel branches closed most Known gaps: sign-in (`preview-access`
   migration 2 ties host rows to the registering session, shared-token and self-Library
   registration, no `Host` fallback, no ticket replay across restarts), pages (fail closed
   without the cookie key, revocable sign-ins through a second `preview-pages` migration and
   a sign-out route, the stored-page cap, the pushed `pagesRevision`), the gateway (idle
   sockets, `configure` waiting for the bind, lanes gone while down, the pinned
   `cloudflared`, the dev gateway port, the session relist) and backings (shutdown removal,
   pull before run, folder restore on its lane, byte ranges, stray retries).

Slice 6, guest links, is parked under the one-operator rule. Do not start it from this
packet.

## Remaining

- The LP-22 Library deploy of `0.0.89` or later, gate D4. The Library has served
  `pages.bagels.top` with its certificate since its 2026-10-20 deploy of `0.0.85`, which has
  pages and replies but not the gap fixes. Pages and Library sign-in are untested against
  the real Library.
- The real-client checks in [TESTING.md](./TESTING.md#still-to-check), then set the index
  Status.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A phone on cellular opens an agent's link from a thread and lands on the running app.
- The same link pasted into a fresh browser shows "Sign in with Loom", and signing in to the
  Library lands on the app.
- Ending, expiring and restoring a link behave as [PRODUCT.md](./PRODUCT.md) says, including
  live WebSockets closing on end.
- An agent publishes a page that opens at `pages.bagels.top` from another device, and a reply
  sent under it arrives in the publishing thread, including one sent while the computer was
  off.
- An agent's folder and container links open, and end with the lane.
