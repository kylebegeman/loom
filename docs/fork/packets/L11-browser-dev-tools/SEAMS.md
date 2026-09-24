# L11 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points created by this packet

Created exactly as [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) specifies when missing, each in
its own commit before packet code: `ext-core` (section 1), `ext-panels` (6), `ext-settings`
(7), `ext-palette` (8), `ext-web-root` (5), `ext-keybindings` (9), `ext-mcp` (10).

### `ext-desktop` (section 13)

Specified in full in [EXTENSION-POINTS.md, section 13](../EXTENSION-POINTS.md#13-desktop-ipc-ext-desktop-optional) (seams in
`packages/contracts/src/ipc.ts`, `apps/desktop/src/ipc/DesktopIpcHandlers.ts` and
`apps/desktop/src/preload.ts`, two marked lines each, plus three fork files). Phase 4 creates
it from there if its existence check fails, in its own commit, before any desktop code.

## Packet seams

| File                                              | Marker                    | Lines | Why                                         |
| ------------------------------------------------- | ------------------------- | ----- | ------------------------------------------- |
| `apps/web/src/components/preview/PreviewView.tsx` | `fork: browser-dev-tools` | 4     | Mounts the dev dock under the preview page. |

### `apps/web/src/components/preview/PreviewView.tsx`

Import after the `AgentBrowserCursor` import (line 65):

```diff
 import { AgentBrowserCursor } from "./AgentBrowserCursor";
+// fork: browser-dev-tools
+import { BrowserDevToolsDock } from "~/fork/browser-dev-tools/BrowserDevToolsDock";
```

The import is long enough that the formatter may wrap it, so the marker sits on its own line
above it (CONVENTIONS.md, "Seams").

After the content area's closing `</div>` (line 823) and before the root's closing `</div>`
(line 824):

```diff
         ) : null}
       </div>
+      {/* fork: browser-dev-tools */}
+      <BrowserDevToolsDock threadRef={threadRef} tabId={runtimeTabId} visible={visible} />
     </div>
   );
 }
```

`threadRef`, `runtimeTabId` (`PreviewView.tsx:143`) and `visible` are already in scope. The
dock renders `null` unless `window.desktopBridge?.fork?.browserDevTools` exists, so on web and
on upstream desktop builds nothing changes.

Why no extension point covers it: `ext-panels` adds panels next to the preview, but the dock must
share the preview's vertical space and follow its active tab. `PreviewChromeRow` has
`trailingActions`, but that slot is already used for `PreviewMoreMenu` (`PreviewView.tsx:
760-774`) and is a toolbar, not a drawer. The insertion is a pure addition at the end of the
component's root, which upstream rarely edits.

Merge risk: low. Two inserted lines at the end of the JSX root and a two-line import.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result. Allowed conflicts: `PreviewView.tsx` on the marked lines, and
extension point seams this packet created.

## FORK.md rows

"Packet seams":

| File                                              | Packet              | Why                                                                                                   |
| ------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/preview/PreviewView.tsx` | `browser-dev-tools` | Dev dock (console and network) under the preview page. See `docs/fork/packets/L11-browser-dev-tools`. |

"Extension point seams" rows for `ext-desktop` if this packet creates it:

| File                                         | Marker        | Why                                               |
| -------------------------------------------- | ------------- | ------------------------------------------------- |
| `packages/contracts/src/ipc.ts`              | `ext-desktop` | `DesktopBridge.fork` for Electron-only fork APIs. |
| `apps/desktop/src/ipc/DesktopIpcHandlers.ts` | `ext-desktop` | Installs fork main-process handlers.              |
| `apps/desktop/src/preload.ts`                | `ext-desktop` | Exposes `desktopBridge.fork`.                     |

## Fork-owned registration lines (not seams)

| Fork file                                    | Line added                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`       | `export * from "./browser-dev-tools.ts";`                                                                                              |
| `packages/contracts/src/fork/rpc.ts`         | `BrowserDevToolsRpcGroup,`; `watchServers` in `ForkSubscriptionRpcTag`; `composeAction`, `createDatabase` in `ForkStreamCommandRpcTag` |
| `packages/contracts/src/fork/desktop.ts`     | `browserDevTools?: BrowserDevToolsDesktopBridge;`                                                                                      |
| `packages/contracts/src/fork/keybindings.ts` | `loom.browser-dev-tools.open`, `.toggle-dock`                                                                                          |
| `apps/desktop/src/fork/ipc.ts`               | `yield* installBrowserDevToolsCollector();`                                                                                            |
| `apps/desktop/src/fork/preload.ts`           | `browserDevTools: makeBrowserDevToolsBridge(_ipcRenderer),`                                                                            |
| `apps/server/src/fork/*`                     | feature slug, service layer, `ForkServices` member, migrations, handlers, scopes, toolkit                                              |
| `apps/web/src/fork/*`                        | panel, settings section, palette source, `ForkRoot` shortcuts component                                                                |
