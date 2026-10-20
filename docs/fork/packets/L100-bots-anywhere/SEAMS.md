# L100 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. Every touch is fork code:

- Library routes live in `apps/server/src/fork/bots/libraryHttp.ts` and are registered in
  `apps/server/src/fork/ForkLayer.ts` beside `LibraryHttpRoutes` and `PageLibraryHttpRoutes`
  (`ForkLayer.ts:363-367`), the way the pages Library routes were added.
- The Library client uses `resolveLibraryConnection` and its `send`
  (`apps/server/src/fork/project-library/LibraryConnection.ts:34-55`), fork code.
- Vault links reach the provider through the existing `ext-vault-preflight` guard in
  `apps/server/src/orchestration-v2/ProviderTurnStartService.ts` (`:394-400`), which this packet
  calls through prompt text and does not edit.
- The directory listing, working copies, profile readiness and Vault references are fork
  services read as they are.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here when the packet lands.

## FORK.md rows

None.
