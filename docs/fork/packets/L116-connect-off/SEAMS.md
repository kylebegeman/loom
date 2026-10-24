# L116 seams

## Extension points created by this packet

None.

## Packet seams

| File                                            | Marker                | Lines | Why                                                                                       |
| ----------------------------------------------- | --------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `apps/server/src/telemetry/AnalyticsService.ts` | `fork: telemetry-off` | 1     | Product analytics to T3 default off; `T3CODE_TELEMETRY_ENABLED=true` still turns them on. |
| `docs/user/telemetry.md`                        | `fork: telemetry-off` | 1     | Say that Loom sends no product usage events by default.                                   |

Relay tracing needs relay credentials baked in at build time, so it leaves Loom builds with
the relay config rather than through another seam.

## FORK.md rows

One paragraph under "Packet seams", after the `directory-computers` entry.
