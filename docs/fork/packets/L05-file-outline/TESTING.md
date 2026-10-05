# L05 verification

Verification uses the smallest affected scope. No repo-wide suite or live database mutation.

## Automated checks

```sh
vp test run apps/web/src/fork/file-outline \
  apps/web/src/fork/commandPalette/registry.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork/file-outline apps/web/src/fork/ForkRoot.tsx \
  apps/web/src/fork/commandPalette/registry.ts \
  apps/web/src/components/files/FilePreviewPanel.tsx \
  packages/contracts/src/fork/keybindings.ts
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/contracts --filter @t3tools/client-runtime typecheck
vp run --filter t3 --filter @t3tools/desktop --filter @t3tools/mobile typecheck
```

The fixtures cover all eight language IDs and supported extensions, comments and literals,
real nesting, skipped locals/callbacks/JSX arrows, Go receiver grouping, inherent and trait
Rust implementations, Kotlin interpolation, Markdown fences, CRLF, same-line ID collisions,
empty declarations and TS object return types. A 1 MB sample guards against quadratic scans.
Cache, persistence, storage failures, filtering, context gating, full-title palette search,
repeat line reveals and existing registry/keybinding invariants are covered.

Result: 65 tests across eight files pass. All six affected package typechecks pass. Focused
lint reports no errors. One existing warning in `FilePreviewPanel.tsx` flags the unchanged
breadcrumb effect's dependency; the same effect exists at the implementation base.
`pnpm-lock.yaml` is untouched. Formatting, whitespace and seam checks pass.

Manual extraction against the repository's FilePreviewPanel, CommandPalette and ChatView
sources returned their declaration lists in roughly 7, 8 and 38 ms respectively. The largest
sample was approximately 462 KB; these are local observations, not performance guarantees.

## Integrated client pass

Kyle approved `test-t3-app`. The isolated worktree server uses `.t3/userdata/statev2.sqlite`,
web port 8308 and server port 16348. A small `/tmp/loom-file-outline-qa` project and stopped
thread were created through normal application commands. No provider turn was started.
The live V1 database was not copied or modified.

Verified in Loom's Browser panel:

- TypeScript, JavaScript, Swift, Python, Go, Rust, Kotlin and Markdown symbol lists.
- Header opening and persistent open state across browser reloads.
- Click and keyboard jumps, ancestor-preserving subsequence filtering and Escape returning
  focus into the source editor's shadow root.
- Unsaved editable-source changes update the outline through the existing query cache.
- Palette commands found by displayed title; symbol submenu navigation uses real reveals.
- A Markdown heading opens source view at its line.
- Empty file state and a 2,100-declaration sample capped at 2,000 symbols, with approximately
  31 initially mounted outline rows.
- Outline and explorer coexist within their percentage width caps.

The Browser automation host disconnected twice. Assigning a shortcut in Settings, explicit
narrow-viewport layout, absolute host-file jumps, repeated scrolling in the virtualized list,
media/table suppression and a separate remote/upstream-server client pass remain unverified
in the live client. Contract, source, parser and contextual palette tests cover those relevant
boundaries; they do not substitute for claiming these manual checks passed.

The isolated test server and state remain available for continuation. Desktop consumes the
same bundle; no separate packaged desktop launch or mobile UI pass was performed.

## Merge safety

`FilePreviewPanel.tsx` has exactly three registered markers. The manifest check passes.
The complete committed change passes `git merge-tree --write-tree --name-only --no-messages`
against `v0.0.46-nightly.20261004.2657` with exit status 0 and no conflicts.
The result is recorded in [SEAMS.md](./SEAMS.md). A release build and the clean-main integration rehearsal are outside
this task's focused checks.
