# L113 seams

## Extension points created by this packet

None. Shared logic lives in `packages/client-runtime/src/fork/directory-computers*.ts`; web
renders through the existing `fleet-connections` seam in `ComputerConnectionsHome`, and iPhone
through the fork Connections screen.

## Packet seams

| File                                                                | Marker                      | Lines | Why                                                                                                                                                          |
| ------------------------------------------------------------------- | --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/settings/ConnectionsSettings.tsx`          | `fork: directory-computers` | 7     | Open the pairing form for a Library row with its address, check the computer over remote and SSH, hide the unpinned sign-in, and clear the address on close. |
| `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx` | `fork: directory-computers` | 4     | Take a `libraryComputer` route param, check the computer before the code is spent, and hide the unpinned sign-in.                                            |
| `apps/mobile/src/features/connection/devAutoConnect.ts`             | `fork: directory-computers` | 3     | Check the same `libraryComputer` when a development pairing link connects by itself.                                                                         |
| `evals/mcp-tool-use/run.ts`                                         | `fork: directory-computers` | 2     | Load the real tool schema for focused agent evals.                                                                                                           |

The pairing forms' state lives in `ConnectionsSettings` and the iPhone pairing route, so a row
that falls back to pairing has to set it there.

## FORK.md rows

One paragraph under "Packet seams", after the `server-weight` entry.
