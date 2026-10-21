# L92 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. Rendering, decoding and storage live in `apps/server/src/fork/bots/`; chips and findings
in `apps/web/src/fork/bots/`.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had. The packet touches no upstream file.

## Where the build differs from the plan

- Persistence is migration 4 (`RunVerdicts`): `verdict` and `verdict_json` columns and the
  `fork_bots_runs_verdict` index. Migration 3 went to L91's run notify.
- Starters carry a revision each, not one `BOT_STARTERS_REVISION`; the reviewer and verifier move
  to revision 2.
- The editor's Reply control is the same select the other editor settings use, not a segmented
  control. It shows only when the server reports `bots-verdicts` or the bot already replies with
  a verdict. Text is the default and is never sent, so older servers accept the save.
- The filter row sits in the runs header on the Bots page. `applyRunChanges` takes the filter too,
  so watched updates keep a filtered page honest.
- The composer runs popover gets no chip: it lists only unfinished runs, which have no verdict.
  The posted result leads with the verdict instead.
- No contract tests: decoding and caps are covered in `verdict.test.ts`, and the store test reads a
  corrupt `verdict_json` back as `verdict: null`.

## FORK.md rows

None.
