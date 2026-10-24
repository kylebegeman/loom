# L113 seams

## Extension points created by this packet

None. Shared logic lives in `packages/client-runtime/src/fork/directory-computers*.ts`; web
renders through the existing `fleet-connections` seam in `ComputerConnectionsHome`, and iPhone
through the fork Connections screen.

## Packet seams

| File                                                       | Marker                      | Lines | Why                                                                                                          |
| ---------------------------------------------------------- | --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/settings/ConnectionsSettings.tsx` | `fork: directory-computers` | 5     | Open the pairing form for a Library row with its address, check the computer, and hide the unpinned sign-in. |

The pairing form's state lives in `ConnectionsSettings`, so a row that falls back to pairing has
to set it there.

## FORK.md rows

One paragraph under "Packet seams", after the `server-weight` entry.
