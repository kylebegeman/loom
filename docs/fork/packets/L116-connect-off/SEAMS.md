# L116 seams

## Extension points created by this packet

None.

## Packet seams

| File                                            | Marker                | Lines | Why                                                                                       |
| ----------------------------------------------- | --------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `apps/server/src/telemetry/AnalyticsService.ts` | `fork: telemetry-off` | 1     | Product analytics to T3 default off; `T3CODE_TELEMETRY_ENABLED=true` still turns them on. |
| `docs/user/telemetry.md`                        | `fork: telemetry-off` | 1     | Say that Loom sends no product usage events by default.                                   |
| `docs/user/telemetry.md`                        | `fork: connect-off`   | 1     | Say that Loom builds carry no relay or mobile tracing credentials.                        |
| `apps/server/vite.config.ts`                    | `fork: connect-off`   | 1     | Bake `__LOOM_CONNECT_RETIRED__` from `LOOM_CONNECT_RETIRED=1`.                            |
| `apps/server/src/cloud/http.ts`                 | `fork: connect-off`   | 3     | Refuse link proof and relay config on a build that retires Connect.                       |

Relay tracing needs relay credentials baked in at build time, so it leaves Loom builds with
the relay config rather than through another seam.

The stale Connect cleanup is fork-owned (`apps/server/src/fork/connect-off/`) and is wired by
`StaleConnectLink.layer` in `apps/server/src/fork/ForkLayer.ts`, so it needs no upstream seam.

## FORK.md rows

Two paragraphs under "Packet seams", after the `directory-computers` entry: `telemetry-off`,
then `connect-off`.
