# L01 seams

## Extension points created by this packet

Each one only if its existence check fails when implementation starts, created exactly as
EXTENSION-POINTS.md specifies, each in its own commit before any packet code:

| Extension point     | Marker                    | Upstream files it touches                                                                                                                                                         |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext-core`          | `fork: ext-core`          | `packages/contracts/package.json`, `packages/client-runtime/package.json` (no marker), `environment.ts`, `ServerEnvironment.ts`, `ws.ts`, `server.ts`, `protocol.ts`, `client.ts` |
| `ext-panels`        | `fork: ext-panels`        | `rightPanelStore.ts`, `RightPanelTabs.tsx`, `ChatView.tsx`                                                                                                                        |
| `ext-web-root`      | `fork: ext-web-root`      | `routes/__root.tsx`                                                                                                                                                               |
| `ext-keybindings`   | `fork: ext-keybindings`   | `packages/contracts/src/keybindings.ts`                                                                                                                                           |
| `ext-palette`       | `fork: ext-palette`       | `components/CommandPalette.tsx`                                                                                                                                                   |
| `ext-composer`      | `fork: ext-composer`      | `components/chat/ChatComposer.tsx`                                                                                                                                                |
| `ext-composer-menu` | `fork: ext-composer-menu` | `composer-logic.ts`, `components/chat/ComposerCommandMenu.tsx`, `components/chat/ChatComposer.tsx`                                                                                |

Record the commit hash of each one this packet created here when done.

Note on `ext-composer-menu`: EXTENSION-POINTS.md specifies its seams in prose and the
registry by shape (`{ id, detect(text, cursor), useItems(query), select(item, context) }`)
rather than as verbatim files. If this packet creates it, write the registry
(`apps/web/src/fork/composer/menu.ts`) and the three seams to that shape, then add the
exact code to EXTENSION-POINTS.md in the same commit (its rule 3) so later packets copy
the same bytes. Keep the registry generic: nothing snippet-specific in that commit.

## Packet seams

None. All packet code is in fork-owned paths:

- `packages/contracts/src/fork/snippets.ts`
- `packages/client-runtime/src/fork/snippets.ts`, `snippetsEngine.ts` (+ tests)
- `apps/server/src/fork/snippets/*`
- `apps/web/src/fork/snippets/*`
- `docs/fork/user/snippets.md`

Registration lines go into fork-owned registry files (`fork/rpc.ts`, `fork/index.ts`,
`ForkLayer.ts`, `ForkRuntime.ts`, `features.ts`, `persistence/migrations.ts`,
`fork/rpcAuthorization.ts`, `fork/panels/registry.ts`, `fork/ForkRoot.tsx`,
`fork/keybindings.ts` in contracts, `fork/commandPalette/registry.ts`,
`fork/composer/registry.tsx`, `fork/composer/menu.ts`). Those are not seams.

## Merge check

Run on the packet branch before asking for review:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit 0, or conflicts only in files listed in the table above, on
`fork: ext-*` lines. Record the tag and the result here.

## FORK.md rows

No "Packet seams" rows. If this packet created extension points, their rows go in the
"Extension point seams" table in the same commits (see CONVENTIONS.md, Updating FORK.md).
