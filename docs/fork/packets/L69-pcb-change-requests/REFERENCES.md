# L69 references

## Prior art

- **Altium comments.** Altium Designer and the Altium 365 viewer attach a review comment to an
  object (a component), a point, or a rectangular area on a PCB document, and filter comments by
  resolved or unresolved. Focusing a comment restores the reviewer's view and layers. That is the
  same three-way anchor model this packet uses (component and net instead of "object", plus area).
  Verified: [Document Commenting](https://www.altium.com/documentation/altium-designer/comments-panel),
  [Commenting in Your Design](https://my.altium.com/altium-designer/getting-started/commenting-your-design),
  [Interactive Commenting in Altium 365](https://resources.altium.com/p/interactive-commenting-altium-365).
  Proprietary; ideas only.
- **L23 markup** (`apps/web/src/fork/model-preview-3d/MarkupSection.tsx`,
  `useModelEditing.ts:171-185`). Pinned requests with a marked capture added to the composer,
  "When requested" and "Now" images, accept and reopen. This packet keeps the flow and wording and
  changes the meaning of `review` (see PRODUCT.md).
- **Code review "resolve conversation".** Hosted code review tools let a thread be marked resolved
  and later unresolved; who may resolve varies by tool. Unverified for any specific product here;
  cited only as the familiar pattern behind accept and reopen.

## Facts relied on

- `git commit-tree` creates a commit object from a tree without updating `HEAD`, branches or the
  index; the caller records it with `git update-ref`. Upstream `CheckpointStore` builds its
  commits this way over a temporary `GIT_INDEX_FILE`
  (`apps/server/src/vcs/GitVcsDriver.ts:811-860`). Verified:
  [git-commit-tree](https://git-scm.com/docs/git-commit-tree),
  [git-update-ref](https://git-scm.com/docs/git-update-ref).
- Refs are stored as files in subdirectories of `refs/` (or in `packed-refs`), and objects they
  reach survive pruning. Verified:
  [gitrepository-layout](https://git-scm.com/docs/gitrepository-layout) ("refs"). That a ref
  cannot also be a directory of refs (`refs/x/<id>` beside `refs/x/<id>/base`) follows from the
  file layout and is Git's long-standing "cannot lock ref" behavior; not quoted from the docs.
  Hence two leaf names under one directory.
- With the default `push.default=simple`, `git push` sends only the current branch. `--mirror`
  (or `remote.<name>.mirror`) pushes every ref under `refs/`, which would include these refs.
  Verified: [git-push](https://git-scm.com/docs/git-push).
- The compare engine resolves any `<ref>^{commit}` and rejects refs starting with `-` or
  containing whitespace or NUL (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1938-1945`).
- The composer accepts at most `PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 100` attachments per turn and
  10 MiB per image (`packages/contracts/src/chatAttachment.ts:14-15`); captures are compressed to
  fit by `attachModelImage` (`apps/web/src/fork/model-preview-3d/capture.ts:19-50`).

## Licences

No third-party code is used. Git is GPL-2.0 and runs as an external program already required by
T3 checkpoints.
