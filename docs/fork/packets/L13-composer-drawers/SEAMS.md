# L13 seams

## Extension points created by this packet

Each only if its existence check fails, created exactly as EXTENSION-POINTS.md specifies,
in its own commit before any packet code: `ext-composer`, `ext-core`, `ext-settings`,
`ext-web-root`, `ext-keybindings`, `ext-palette`. Record the commits here when done.

`ext-composer`'s drawer loop calls every registered drawer hook on every composer render
(EXTENSION-POINTS.md notes the React lint rules might object). If this packet is the first
drawer user and the lint rule fires, follow that section's instruction: replace the loop
with a fixed composition and update EXTENSION-POINTS.md in the same extension point commit.

## Packet seams

None. All code is in fork-owned paths:

- `packages/contracts/src/fork/composer-drawers.ts`
- `packages/client-runtime/src/fork/composer-drawers.ts`
- `apps/server/src/fork/composer-drawers/*`
- `apps/web/src/fork/composer-drawers/*`
- `docs/fork/user/composer-drawers.md`

Registration lines go into fork-owned registries (`fork/rpc.ts`, `fork/index.ts` in
contracts and client-runtime, `ForkLayer.ts`, `ForkRuntime.ts`, `features.ts`,
`rpcAuthorization.ts`, `fork/composer/registry.tsx`, `fork/ForkRoot.tsx`,
`fork/keybindings.ts`, `fork/commandPalette/registry.ts`, `fork/settings/registry.ts`).

Things this packet deliberately does not touch:

- `ChatView.tsx` send path: Once works through the composer draft store and existing
  thread commands, so no hook into `onSend` is needed.
- `packages/contracts/src/orchestration.ts`: no new command fields or events.
- `apps/desktop`: no IPC (clipboard reads use the renderer's clipboard API).

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit 0, or conflicts only on extension point lines. Record the tag and result.

Upstream changes that can break this packet without a merge conflict (check them after
each upstream merge, TESTING.md has the checks):

- The `ComposerThreadDraftState` fields Once snapshots (`modelSelectionByProvider`,
  `activeProvider`, `modelSelectionExplicit`, `runtimeMode`) and the sticky fields.
  Typecheck catches renames; behavior changes need the Once tests.
- `ChatComposerHandle` methods (`insertTextAtEnd`, `pasteTextAtEnd`, `readSnapshot`).
- `ProcessRunInput` options.

## FORK.md rows

None (no packet seams). Extension point rows only if this packet created them.
