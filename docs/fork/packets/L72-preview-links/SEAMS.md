# L72 seams

## Extension points created by this packet

None: all existed. The mobile screen uses packet seams like other mobile features, because
the optional `ext-mobile-settings` point
([EXTENSION-POINTS.md, section 14](../EXTENSION-POINTS.md#14-mobile-ext-mobile-settings-optional))
was never created.

## Packet seams

Every marker is `fork: preview-links`. Lines are the counts `docs/fork/seams.tsv` expects.

| File                                                                     | Lines | Why                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/browser/browserTargetResolver.ts`                          | 5     | Exports `reachesEnvironmentLoopback`, leaves discovered loopback URLs unmapped for environments that advertise links, and points the unreachable error at Settings > Loom > Previews. |
| `apps/web/src/browser/browserTargetResolver.test.ts`                     | 15    | Mocks the advertised check, updates the error text and adds the loopback case.                                                                                                        |
| `apps/web/src/browser/openFileInPreview.ts`                              | 4     | `openUrlInPreview` (chat links) resolves through `navigablePreviewUrlFor` and stops when it returns null.                                                                             |
| `apps/web/src/components/preview/openPreviewSession.ts`                  | 5     | Opening a preview session with a URL resolves it through `navigablePreviewUrlFor`.                                                                                                    |
| `apps/web/src/components/preview/openTerminalLinkInPreview.ts`           | 5     | Terminal links resolve through `navigablePreviewUrlFor`.                                                                                                                              |
| `apps/web/src/browser/useOpenLink.ts`                                    | 2     | A thread's link opens through `openEnvironmentUrlExternally`, so a port this client cannot reach opens through a preview link.                                                        |
| `apps/web/src/components/ChatMarkdown.tsx`                               | 4     | Plain clicks, Alt-clicks and the link menu on an unreachable loopback link open through a preview link (`takeUnreachableLoopbackClick`, `openEnvironmentUrlExternally`).              |
| `apps/web/src/components/ThreadTerminalDrawer.tsx`                       | 2     | Terminal links sent to the system browser open through `openEnvironmentUrlExternally`.                                                                                                |
| `apps/web/src/components/preview/PreviewView.tsx`                        | 9     | Server and desktop navigation resolve first, so a link or loopback address gets a fresh entry. "Open in system browser" and "Open in browser" call `openPreviewInSystemBrowser`.      |
| `apps/web/src/components/preview/PreviewLocalServerCard.tsx`             | 3     | Wraps the server row in `PreviewLinkCardActions` for **Copy preview link** and **Open in browser**.                                                                                   |
| `apps/web/src/localApi.ts`                                               | 3     | Imports and one line in `shell.openExternal` that opens a preview link through a fresh entry (`openPreviewLinkExternally`).                                                           |
| `apps/mobile/src/Stack.tsx`                                              | 2     | Import and the `PreviewLinks` settings screen (`linking: "previews"`, title "Previews").                                                                                              |
| `apps/mobile/src/features/settings/components/settings-sheet-targets.ts` | 1     | The `"PreviewLinks"` target.                                                                                                                                                          |
| `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`              | 1     | The "Previews" row after Maintenance.                                                                                                                                                 |
| `apps/mobile/src/lib/openExternalUrl.ts`                                 | 2     | Import and one line in `tryOpenExternalUrl` that swaps a preview link for a fresh entry link before it leaves the app.                                                                |
| `apps/mobile/src/native/useOpenPullRequest.ts`                           | 2     | Import and one line that opens a thread's non-pull-request link through `openThreadUrlExternally`, so a port the phone cannot reach opens through a preview link.                     |
| `apps/mobile/src/features/threads/HtmlRenderWebView.tsx`                 | 4     | Import, an optional `environmentId` prop that `ThreadHtmlRender` passes, and `onOpenWindow` opening through `openThreadUrlExternally`.                                                |
| `apps/mobile/src/features/threads/McpAppWebView.tsx`                     | 2     | Import, and an MCP app's `openLink` opening through `openThreadUrlExternally`.                                                                                                        |
| `apps/mobile/src/features/files/FileMarkdownPreview.tsx`                 | 3     | Import, a link tap opening through `openThreadUrlExternally`, and its hook dependency.                                                                                                |

Why seams and not extension points: web preview navigation has no extension point, and each
navigation path had to resolve a URL before loading it. The navigation seams are one call
to `navigablePreviewUrlFor` plus a null check, so the logic stays in
`packages/client-runtime/src/fork/preview-link-navigation.ts`, which web and mobile wrap in
their own `navigation.ts`. Neither client has an external-link extension
point, and mobile has no settings one.

## Registrations (fork-owned files only)

Contracts and shared client code:

| File                                                  | Entry                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/contracts/src/fork/rpc.ts`                  | `PreviewLinksRpcGroup` in `ForkRpcGroup`; `watch` in `ForkSubscriptionRpcTag`. |
| `packages/contracts/src/fork/index.ts`                | `export * from "./preview-links.ts"`.                                          |
| `packages/contracts/src/fork/clientRpcPermissions.ts` | Client guards for the eight mutations.                                         |
| `packages/client-runtime/src/fork/index.ts`           | `export * from "./preview-links.ts"`.                                          |
| `apps/server/src/fork/rpcAuthorization.ts`            | Scopes for all nine tags.                                                      |
| `apps/server/src/fork/features.ts`                    | `"preview-links"` in `LOOM_SERVER_FEATURES`.                                   |

Server and clients:

| File                                           | Entry                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/server/src/fork/ForkLayer.ts`            | `PreviewLinks.layer`, given `ProjectLifecycle.layer` over `ProjectStore.layer`. |
| `apps/server/src/fork/ForkRuntime.ts`          | `PreviewLinksService` in `ForkServices`.                                        |
| `apps/server/src/fork/rpc.ts`                  | `makePreviewLinksRpcHandlers(auth, session)` under `withForkRuntime`.           |
| `apps/server/src/fork/mcp/index.ts`            | `PreviewLinksToolkit` entry in `FORK_MCP_TOOLKITS`.                             |
| `apps/web/src/fork/settings/registry.ts`       | `{ id: "preview-links", title: "Previews" }` in `FORK_SETTINGS_SECTIONS`.       |
| `apps/web/src/fork/ForkRoot.tsx`               | `{ id: "preview-links-host", Component: PreviewLinksHost }`.                    |
| `apps/web/src/fork/commandPalette/registry.ts` | `previewLinksPaletteSource` in `FORK_COMMAND_PALETTE_SOURCES`.                  |

## Merge check

Last run 2026-10-19 against `v0.1.1-nightly.20261019.3360`: `main` already conflicts with
that tag in 59 files, and the packet adds three. Each is a thread-link seam upstream has
since rewritten, and each conflict holds only marker lines and the upstream lines around
them:

- `apps/web/src/browser/useOpenLink.ts`: upstream dropped `useCallback`. Keep upstream's body
  and put the marker line `if (targetThreadRef) return openEnvironmentUrlExternally(...)`
  before `await api.shell.openExternal(url)`.
- `apps/mobile/src/features/files/FileMarkdownPreview.tsx`: upstream compiles the screen with
  the React Compiler. Take upstream's plain functions and its `FONT_FAMILIES` import, keep
  the marker import, and make `onLinkPress` call
  `openThreadUrlExternally(props.environmentId, href, "markdown-link")`. The hook dependency
  marker goes away, so its row in `docs/fork/seams.tsv` drops from 3 to 2.
- `apps/mobile/src/native/useOpenPullRequest.ts`: upstream moved the fallback into
  `useNavigateToPullRequest(url, context)`, which a thread's pull request sheet also uses.
  The marker line moves there as
  `if (!params) return openThreadUrlExternally(context?.environmentId, url, "pull-request")`.

Run it again before landing:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Compare the list with the same command run on `$(git merge-base main HEAD)`. Conflicts the
packet adds must fall only on the lines above. `check_seams` passes with the rows in
`docs/fork/seams.tsv`.

## FORK.md rows

One paragraph in "Packet seams" (FORK.md uses prose there), listing the nineteen files with
their marker counts and linking here and to the user guide. No "Extension point seams" rows.
