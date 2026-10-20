# L91 seams

## Extension points created by this packet

- `ext-composer` (EXTENSION-POINTS §11): five `fork: ext-composer` seams in
  `apps/web/src/components/chat/ChatComposer.tsx` and the registry
  `apps/web/src/fork/composer/registry.tsx`. The §11 line numbers are stale; current anchors are
  `onComposerCommandKey` :4147, `restingBlockDefs` :5051, the stash drawer render :6610 and
  `ComposerCommandMenuLayer` :977. Update §11 with them in the same commit.
- `ext-composer-menu` (EXTENSION-POINTS §11b): the three §11b seams (`composer-logic.ts`,
  `ComposerCommandMenu.tsx`, `ChatComposer.tsx`) plus one more `fork: ext-composer-menu` seam in
  the `slash-command` branch of `composerMenuItems` (`ChatComposer.tsx:2696-2700`) that appends
  `searchForkSlashItems(forkSlashItems, query)` to the upstream result, and the hook call that
  produces `forkSlashItems`. §11b today forbids fork items on `/` because `/` is an upstream
  trigger; the new seam joins items to the upstream trigger rather than detecting a new one, so the
  rule still holds for triggers. Replace the §11b outline with the verbatim code in the same
  commit, and add the slash-source seam to its seam list and check.

## Packet seams

| File                                                             | Marker       | Lines | Why                                                                                |
| ---------------------------------------------------------------- | ------------ | ----- | ---------------------------------------------------------------------------------- |
| `packages/provider-core/src/server/orchestrationInstructions.ts` | `fork: bots` | 2     | Import `LOOM_BOTS_INSTRUCTIONS` and list it after `LOOM_VAULT_INSTRUCTIONS` (:40). |

The sections array is static (`T3_CODE_ORCHESTRATION_SECTIONS`, :9), the same shape the
`ext-vault` seam uses at :1 and :40. Two marked lines, each conflicting on one line at most.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here when the packet lands.

## FORK.md rows

- `orchestrationInstructions.ts`, slug `bots`, packet L91.
- `docs/fork/seams.tsv`: `packages/provider-core/src/server/orchestrationInstructions.ts	bots	2`,
  plus the `ext-composer` (5) and `ext-composer-menu` rows the extension points define.
