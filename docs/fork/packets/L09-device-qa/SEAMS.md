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

| File                                             | Marker            | Lines | Why                                                                                                                   |
| ------------------------------------------------ | ----------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/device/DevicePanel.tsx` | `fork: device-qa` | 4     | "Capture screenshot" and "Open Device QA" buttons in the upstream Device panel toolbar, for the device being watched. |

### `apps/web/src/components/device/DevicePanel.tsx`

Import, after the `DeviceToolsPanel` import (line 36):

```diff
 import { DeviceToolsPanel } from "./DeviceToolsPanel";
+// fork: device-qa
+import { DeviceQaToolbarActions } from "~/fork/device-qa/DeviceToolbarActions";
```

The marker sits on its own line because the import is near the formatter's wrap width
(CONVENTIONS.md, "Seams"). `DevicePanel.tsx` already imports through the `~/` alias.

Toolbar, directly before the Tools toggle (line 227), inside the `activeDevice ? (<>...</>)`
fragment, so the buttons only exist while a device is shown:

```diff
               </DeviceButton>
             )}
+            {/* fork: device-qa */}
+            <DeviceQaToolbarActions threadRef={props.threadRef} device={activeDevice} />
             <Toggle
               aria-label="Tools"
```

`activeDevice` is a `DeviceSummary` (`DevicePanel.tsx:85-89`); `props.threadRef` is the panel's
`ScopedThreadRef` (`:46-50`). `DeviceQaToolbarActions` renders `null` when the environment lacks
`device-qa` in `loomFeatures`, so an upstream server shows the toolbar unchanged.

Why no extension point covers it: `ext-panels` adds new right-panel surfaces but reaches no
upstream panel's internals, and the Device panel toolbar has no slot or `trailingActions` prop
(the preview's chrome row has one; the device toolbar is inline JSX,
`DevicePanel.tsx:186-247`). Without the seam, capture works from the Device QA panel, the
palette and a keybinding; the seam only puts it next to the device.

Merge risk: low to medium. The seam is two inserted lines in a toolbar that upstream changes
occasionally, plus a two-line import next to a stable import; all are insertions.

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

| Fork file                                            | Line added                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`               | `export * from "./device-qa.ts";`                                                                                               |
| `packages/contracts/src/fork/rpc.ts`                 | `DeviceQaRpcGroup,`; `watchRuns` and `watchEvidence` tags in `ForkSubscriptionRpcTag`; `runEvents` in `ForkStreamCommandRpcTag` |
| `packages/contracts/src/fork/keybindings.ts`         | `loom.device-qa.toggle`, `loom.device-qa.capture`, `loom.device-qa.run-last-flow`                                               |
| `packages/client-runtime/src/fork/index.ts`          | `export * from "./device-qa.ts";`                                                                                               |
| `apps/server/src/fork/features.ts`                   | `"device-qa"`                                                                                                                   |
| `apps/server/src/fork/ForkRuntime.ts`                | `\| DeviceQaService`                                                                                                            |
| `apps/server/src/fork/ForkLayer.ts`                  | `DeviceQaService.layer,` and `DeviceQaCleanupReactorLive,`                                                                      |
| `apps/server/src/fork/persistence/migrations.ts`     | `DeviceQaMigrations,`                                                                                                           |
| `apps/server/src/fork/rpc.ts`, `rpcAuthorization.ts` | handlers spread and one scope per tag                                                                                           |
| `apps/server/src/fork/mcp/index.ts`                  | `DeviceQaToolkitRegistrationLive,`                                                                                              |
| `apps/web/src/fork/panels/registry.ts`               | `deviceQaPanel,`                                                                                                                |
| `apps/web/src/fork/settings/registry.ts`             | `deviceQaSettings,`                                                                                                             |
| `apps/web/src/fork/commandPalette/registry.ts`       | `deviceQaPaletteSource,`                                                                                                        |
| `apps/web/src/fork/ForkRoot.tsx`                     | `{ id: "device-qa-shortcuts", Component: DeviceQaShortcuts }`                                                                   |
