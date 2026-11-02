# L11 upstream integration

| Upstream file                                           | Marker              | Purpose                                                               |
| ------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| `apps/server/src/preview/ServerBrowser.ts`              | `browser-dev-tools` | Register a reader for existing Browser captures during its lifecycle. |
| `apps/web/src/components/preview/PreviewEmptyState.tsx` | `browser-dev-tools` | Open development controls beside existing Browser discovery.          |

All service, RPC, MCP, client state, panel and palette registration lives in existing
fork-owned registries. The feature adds no Electron collector or debugger attachment.
