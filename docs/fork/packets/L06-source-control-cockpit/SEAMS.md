# L06 seams

This packet touches no upstream file beyond the extension points. It reads upstream state
through exported modules (`useRightPanelStore`, `useComposerDraftStore`, `vcsEnvironment`,
`useOpenPrLink`, `resolveBranchSelectionTarget`, `useThreadShell`), which is an import, not a
seam.

## Extension points used

| Extension point   | Registration                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ext-core`        | `SourceControlCockpitRpcGroup`, service layer, handlers, scopes, `"source-control-cockpit"` in `LOOM_SERVER_FEATURES` |
| `ext-panels`      | `sourceControlCockpitPanel` in `FORK_PANELS` (id `source-control-cockpit`, shortcut `G`)                              |
| `ext-palette`     | `sourceControlCockpitPaletteSource` in `FORK_COMMAND_PALETTE_SOURCES`                                                 |
| `ext-web-root`    | `{ id: "source-control-cockpit-shortcuts", Component: SourceControlCockpitShortcutHost }`                             |
| `ext-keybindings` | `"loom.source-control-cockpit.toggle"` in `FORK_KEYBINDING_COMMANDS`                                                  |

The panel needs a view switch from palette items ("Show CI checks" opens the Checks view).
Keep it inside the packet: a tiny module-level store in
`apps/web/src/fork/source-control-cockpit/viewStore.ts` that the palette writes before
calling `openSurface`, and the panel reads on mount.

## Extension points created by this packet

Any of the above that is missing when the packet starts, created exactly as
EXTENSION-POINTS.md specifies, one commit each. Record the commits here, or "None: all
existed".

## Packet seams

None.

Considered and rejected:

- A conflict flag in upstream's `VcsStatusLocalShape` (`packages/contracts/src/git.ts:214`):
  an upstream wire schema change that older clients would decode differently.
- A dirty guard inside upstream's `switchRef` (`apps/server/src/vcs/GitVcsDriverCore.ts:3451`):
  a behavior change on a hot upstream path; the preflight covers it from the fork.
- Returning git's stderr from `executeGit` (`GitVcsDriverCore.ts:940-953`): useful upstream,
  but a seam in a 3.6k-line file. Worth proposing upstream instead.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: conflicts only on extension point seams (for example `ChatView.tsx` for
`ext-panels`), none from this packet. Record the tag and result here.

## FORK.md rows

None for packet seams. Extension point rows only if this packet created one.
