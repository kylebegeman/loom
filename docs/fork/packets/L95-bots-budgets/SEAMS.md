# L95 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

| File                                          | Marker       | Lines | Why                                                          |
| --------------------------------------------- | ------------ | ----- | ------------------------------------------------------------ |
| `apps/web/src/components/usage/UsagePage.tsx` | `fork: bots` | 3     | Import and render the Bots section after the Totals section. |

The Totals section opens at `UsagePage.tsx:833` and closes after the Cache savings metric. The
seam renders one fork component with values the page already holds:

```tsx
{
  /* fork: bots - bot usage for the shown window */
}
<BotsUsageSection
  window={shownWindow}
  environmentIds={selectedEnvironmentIds}
  totalTokens={merged.totalTokens}
/>;
```

`shownWindow` is at `:219`, `merged` at `:218` and `selectedEnvironmentIds` at `:205`.
`BotsUsageSection` (`apps/web/src/fork/bots/BotsUsageSection.tsx`) returns null when no selected
environment supports `bots-budgets` and owns its own fetching, so an upstream change to the page
conflicts on these lines at most. The page has no section registry, which is why this is a seam
and not an extension point.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here when the packet lands.

## FORK.md rows

- `UsagePage.tsx`, slug `bots`, packet L95.
- `docs/fork/seams.tsv`: `apps/web/src/components/usage/UsagePage.tsx	bots	3`.
