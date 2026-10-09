# L09 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points created by this packet

Whichever of these are missing when work starts, created exactly as
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md) specifies, each in its own commit before packet
code: `ext-core` (section 1), `ext-panels` (6), `ext-settings` (7), `ext-palette` (8),
`ext-web-root` (5), `ext-keybindings` (9), `ext-mcp` (10). Record the commit of each one this
packet created here.

## Packet seams

Reviewed against `e73fc8faca2cfbf1e1b0fafa1cd85ce37c508fff` on 2026-09-27. The older
DeviceToolsPanel import and inline Tools toggle are gone from DevicePanel. Do not apply the
previous line-numbered patch.

| File                                             | Marker            | Insertion                              | Why                                                         |
| ------------------------------------------------ | ----------------- | -------------------------------------- | ----------------------------------------------------------- |
| `apps/web/src/components/device/DevicePanel.tsx` | `fork: device-qa` | Import and active-device render branch | Put thread-evidence actions beside the device being viewed. |

Import the fork-owned `DeviceQaToolbarActions` component. In the existing
`activeDevice && activeSession` branch, render a small action row immediately before
DeviceWorkspace, within a layout wrapper as required by the current flex container. Pass
`threadRef={props.threadRef}` and `device={activeDevice}`. Keep DeviceWorkspace's existing
props and its environment/device key intact. Mark each insertion, including any wrapper,
and record the actual formatted marker count in the seam manifest during implementation.

The fork component owns layout and the two actions: "Capture evidence" and "Open Device QA".
It renders nothing when the server lacks `device-qa`; ensure its wrapper also leaves no
empty row or changed device layout in that case. Capture saves to the thread's evidence
list. DeviceWorkspace's existing screenshot download remains available and unchanged.

Implemented with 2 formatted marker lines: the import and the comment on the column
wrapper. The wrapper re-indents DeviceWorkspace's props, so the diff is 21 added and 13
removed lines, all inside that branch.

This stays a single-file packet integration. Do not add a generic device-toolbar extension
point for one consumer or reach into DeviceControlsRail. Capture remains reachable from the
Device QA panel, palette and keybinding as specified. Verify normal and floating panel
layouts using the same DevicePanel path.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result. Allowed conflicts: the lines above and extension point seams this
packet created.

## FORK.md rows

"Packet seams" table (create the table if it does not exist yet, with columns `File`, `Packet`,
`Why`):

| File                                             | Packet      | Why                                                                                                         |
| ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/device/DevicePanel.tsx` | `device-qa` | Device toolbar buttons for evidence capture and the Device QA panel. See `docs/fork/packets/L09-device-qa`. |

Plus the "Extension point seams" rows of any extension point this packet created.

## Fork-owned registration lines (not seams)

| Fork file                                             | Line added                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`                | `export * from "./device-qa.ts";`                                                                                               |
| `packages/contracts/src/fork/rpc.ts`                  | `DeviceQaRpcGroup,`; `watchRuns` and `watchEvidence` tags in `ForkSubscriptionRpcTag`; `runEvents` in `ForkStreamCommandRpcTag` |
| `packages/contracts/src/fork/keybindings.ts`          | `loom.device-qa.toggle`, `loom.device-qa.capture`, `loom.device-qa.run-last-flow`                                               |
| `packages/client-runtime/src/fork/index.ts`           | `export * from "./device-qa.ts";`                                                                                               |
| `packages/contracts/src/fork/clientRpcPermissions.ts` | one scope per mutating tag                                                                                                      |
| `apps/server/src/fork/features.ts`                    | `"device-qa"`                                                                                                                   |
| `apps/server/src/fork/ForkRuntime.ts`                 | `\| DeviceQaService`                                                                                                            |
| `apps/server/src/fork/ForkLayer.ts`                   | `DeviceQaCleanupLive` provided with `DeviceQa.layer` (one entry)                                                                |
| `apps/server/src/fork/persistence/migrations.ts`      | `DeviceQaMigrations,`                                                                                                           |
| `apps/server/src/fork/rpc.ts`, `rpcAuthorization.ts`  | handlers spread and one scope per tag                                                                                           |
| `apps/server/src/fork/mcp/index.ts`                   | `{ toolkit: DeviceQaToolkit, handlers: deviceQaHandlers, register }` entry                                                      |
| `apps/web/src/fork/panels/registry.ts`                | `deviceQaPanel,`                                                                                                                |
| `apps/web/src/fork/settings/registry.ts`              | `{ id: "device-qa", title: "Device QA", Component: DeviceQaSettingsSection }`                                                   |
| `apps/web/src/fork/commandPalette/registry.ts`        | `deviceQaPaletteSource,`                                                                                                        |
| `apps/web/src/fork/ForkRoot.tsx`                      | `{ id: "device-qa-shortcuts", Component: DeviceQaShortcuts }`                                                                   |
