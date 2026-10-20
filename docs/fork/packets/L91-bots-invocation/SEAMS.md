# L91 seams

## Extension points created by this packet

- `ext-composer` (EXTENSION-POINTS §11): four `fork: ext-composer` seams in
  `apps/web/src/components/chat/ChatComposer.tsx` (import, the `useForkComposer` call before
  `composerMenuItems`, the start of `restingBlockDefs`, the drawer after the stash drawer) and the
  registry `apps/web/src/fork/composer/registry.tsx`.
- `ext-composer-menu` (EXTENSION-POINTS §11b): four seams in `ChatComposer.tsx` (import, the
  `useForkSlashMenuItems` call, the append in the `slash-command` branch, the `loom` branch of
  `onSelectComposerItem`) and two in `ComposerCommandMenu.tsx` (import, item union). Registry
  `apps/web/src/fork/composer/menu.ts`.

Where the build differs from the plan above it, and why:

- No key handler seam. Nothing registers one; the first packet that needs one adds it.
- One `useForkComposer` hook returns the context, the drawer and the block definitions, a fixed
  composition rather than registry arrays, so hook order is stable without a loop over hooks.
  It sits before `composerMenuItems` so the menu seams can share its context.
- Fork blocks are prepended to `restingBlockDefs`. Upstream hides blocks from the end, so
  appended blocks would vanish first and push `mode` and `traits` into the compact menu sooner.
- The drawer receives no `replace`; it never edits the prompt.
- No `composer-logic.ts` seam and no `detectForkComposerTrigger`: `/bot:<id>` is an upstream
  slash token, so no fork trigger exists yet. The item carries `source` rather than `triggerId`,
  and `value` is a string.
- A bot with no inputs still opens the form, so the user can choose to have the result posted.
- Mobile is unchanged.

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

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had. `ChatComposer.tsx` and `ComposerCommandMenu.tsx` merge cleanly;
`orchestrationInstructions.ts` conflicts at the base already, on the `ext-vault` lines upstream
changed.

## FORK.md rows

- `orchestrationInstructions.ts`, slug `bots`, packet L91.
- `docs/fork/seams.tsv`: `packages/provider-core/src/server/orchestrationInstructions.ts	bots	2`,
  plus `ext-composer` (4) and `ext-composer-menu` (4 in `ChatComposer.tsx`, 2 in
  `ComposerCommandMenu.tsx`).
