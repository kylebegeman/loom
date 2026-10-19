# L72 implementation

Slices 1 to 5 are on fork `main`. This page records the order they were built in and what is
left.

## Before changing it

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Never enable previews against the live install's state, and never touch a running
`cloudflared`. A dev server that enables previews needs a gateway port other than the live
install's. Library behavior needs a server with `LOOM_LIBRARY_AUTHORITY` and its own state
directory, never the live Library.

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

Slice 6, guest links, is parked under the one-operator rule. Do not start it from this
packet.

## Remaining

- The LP-22 Library deploy, gate D4: Kyle adds a DNS-only record for `pages.bagels.top` at
  the Library host and deploys with `LOOM_PAGES_ORIGIN` set. Until then pages and Library
  sign-in are untested against the real Library.
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
