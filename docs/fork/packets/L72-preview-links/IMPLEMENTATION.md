# L72 implementation plan

Slice 1 was built in this order on `feat/preview-links`. Steps 1 and 2 are committed in
`64487ea714`; the rest is in the working tree.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Never enable previews against the live install's state, and never touch a running
`cloudflared`. A dev server that enables previews needs a gateway port other than the live
install's.

## Steps

1. Contracts: `packages/contracts/src/fork/preview-links.ts` (schemas, nine RPCs, host
   helpers), registered in the fork RPC group, the subscription tags and client guards.
   Scopes in `apps/server/src/fork/rpcAuthorization.ts`; feature `"preview-links"`.
2. Client-runtime atoms: `packages/client-runtime/src/fork/preview-links.ts`.
3. Server policy: host format, share segments, path sanitizing, the denylist, cookie signing
   and the sweep (`policy.ts`).
4. Gateway and pages (`gateway.ts`, `pages.ts`), tested against a real loopback upstream.
5. Tunnel supervisor (`tunnel.ts`), tested with a fake connector script.
6. `PreviewLinksService` with the sidecar, secrets, entry codes, expiry fiber, lane watcher
   and session removal; RPC handlers; registration in `ForkLayer`, `ForkRuntime` and the
   fork RPC layer.
7. MCP toolkit (`mcp.ts`) and its entry in `FORK_MCP_TOOLKITS`.
8. Web: navigation and its upstream seams, settings section, links sheet, port card actions,
   palette source.
9. Mobile: Previews screen, settings row and route, thread link interception.
10. Docs: this packet, the user guide, FORK.md, the packet index and IMPLEMENT-NOW.

## Remaining for slice 1

- Commit the server, web and mobile work on `feat/preview-links`.
- Run the merge check in [SEAMS.md](./SEAMS.md#merge-check).
- Run the real-client and live-tunnel checks in [TESTING.md](./TESTING.md#still-to-check),
  then set the index Status.

## Later slices

Slices 2 to 6 (hosted HTML and Dossier documents, interactive pages with replies, and
containers) need Library schema changes and Kyle's approval. Do not start them from this
packet.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A phone on cellular opens an agent's link from a thread and lands on the running app.
- The same link pasted into a fresh browser shows "Open this link from Loom".
- Ending, expiring and restoring a link behave as [PRODUCT.md](./PRODUCT.md) says, including
  live WebSockets closing on end.
