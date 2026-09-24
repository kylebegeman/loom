# L14 implementation plan

Four independent parts. Build them in any order; each ends with its own commit and leaves
the tree compiling. The shared settings section and palette source are created by the
first part that needs them and extended by the others.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Work in a worktree; seed its `.t3` with a `VACUUM INTO` copy of real data (long
threads for find, a thread containing a Mermaid block). Ask Kyle before dev servers,
browsers, and before adding the `mermaid` dependency.

## File layout

```
apps/web/src/fork/chat-conveniences/settings.ts            # client preferences store
apps/web/src/fork/chat-conveniences/SettingsSection.tsx     # ext-settings section
apps/web/src/fork/chat-conveniences/palette.tsx             # ext-palette source
apps/web/src/fork/chat-conveniences/commands.ts             # onForkCommand handlers
apps/web/src/fork/chat-conveniences/find/timelineHandle.ts
apps/web/src/fork/chat-conveniences/find/FindInThreadHost.tsx
apps/web/src/fork/chat-conveniences/find/FindBar.tsx
apps/web/src/fork/chat-conveniences/find/findMatches.ts
apps/web/src/fork/chat-conveniences/find/findMatches.test.ts
apps/web/src/fork/chat-conveniences/find/highlight.ts
apps/web/src/fork/chat-conveniences/find/find.css
apps/web/src/fork/chat-conveniences/mermaid/LoomMermaidBlock.tsx
apps/web/src/fork/chat-conveniences/mermaid/renderMermaid.ts
apps/web/src/fork/chat-conveniences/mermaid/renderMermaid.test.ts
apps/web/src/fork/chat-conveniences/presets/presets.ts
apps/web/src/fork/chat-conveniences/presets/presets.test.ts
apps/web/src/fork/chat-conveniences/presets/PresetsBlock.tsx
packages/contracts/src/fork/chat-conveniences.ts
apps/server/src/fork/chat-conveniences/AskService.ts
apps/server/src/fork/chat-conveniences/AskService.test.ts
apps/server/src/fork/chat-conveniences/mcp.ts
docs/fork/user/chat-conveniences.md
```

## Part D: Ask without stopping (smallest; server only)

1. Extension points: `ext-core`, `ext-mcp` existence checks; create if missing.
2. Contracts: `packages/contracts/src/fork/chat-conveniences.ts` (tool schemas only);
   export from `fork/index.ts`.
3. `AskService.ts` (TECHNICAL.md, part D) and `AskService.test.ts` against an in-memory
   engine: use the orchestration test harness upstream uses for decider and engine tests
   (see `apps/server/src/orchestration/decider.userInputDismiss.test.ts` and
   `Layers/OrchestrationEngine.test.ts` for how they build a read model and dispatch).
4. `mcp.ts` toolkit and registration in `ForkMcpToolkitsLive`; service in
   `ForkServicesLive` and `ForkServices`; `"chat-conveniences"` in
   `LOOM_SERVER_FEATURES`.
5. Checks; commit `feat(fork-chat-conveniences): let agents ask a question and keep working`.

## Part A: Find in thread

1. Extension points: `ext-web-root`, `ext-keybindings`, `ext-palette`, `ext-settings`.
2. `findMatches.ts` + test first: text reduction, case rules, row filtering over a
   `MessagesTimelineRow[]` fixture.
3. `timelineHandle.ts`; apply the `ChatView.tsx` seam (SEAMS.md). `vp fmt` the file and
   check the marker placement.
4. `highlight.ts` (range building over a container, `CSS.highlights` feature check) and
   `find.css`. Use theme tokens from `apps/web/src/index.css` (`--warning`,
   `--warning-foreground` exist).
5. `FindBar.tsx` and `FindInThreadHost.tsx` (append to `FORK_ROOT_COMPONENTS`); the native
   `mod+F` listener with the focus rules; `loom.chat-conveniences.find` command; palette
   item; settings switch.
6. Checks; commit `feat(fork-chat-conveniences): find text in the current thread`.

## Part B: Mermaid diagrams

1. Ask Kyle to approve `mermaid`. Then `vp i` with the dependency added to
   `apps/web/package.json`; commit only the intended lockfile change.
2. `renderMermaid.ts`: lazy import, serialized render queue, timeout, LRU cache, size limit;
   `renderMermaid.test.ts` with the `mermaid` import mocked (queue order, cache hits,
   timeout, size limit). Do not test Mermaid's own output.
3. `LoomMermaidBlock.tsx`; `loomMermaidEnabled()` from `settings.ts`.
4. Apply the `ChatMarkdown.tsx` seam (SEAMS.md); `vp fmt`; check markers.
5. Build once (`vp run --filter @t3tools/web build`) and confirm `mermaid` is in its own
   chunk(s) and the entry chunk did not grow by more than a few KB.
6. Settings switch. Checks; commit `feat(fork-chat-conveniences): render Mermaid diagrams in messages`.

## Part C: Model presets

1. Extension points: `ext-composer`, `ext-keybindings`, `ext-palette`.
2. `presets.ts`: schema, storage, `inspectPreset`, `applyPreset`, `savePreset`, reorder,
   delete and undo. `presets.test.ts` covers inspection rules against fixtures built from
   upstream types, and storage edge cases.
3. `PresetsBlock.tsx` registered in `FORK_COMPOSER_BLOCKS` (id `model-presets`).
4. Palette items and the six keybinding commands; handlers in `commands.ts`.
5. Checks; commit `feat(fork-chat-conveniences): save and apply model presets`.

## After all parts

- `docs/fork/user/chat-conveniences.md`: find (and the `mod+F` switch), diagrams, presets
  (suggested bindings), how agents ask without stopping and how to answer or dismiss.
- FORK.md "Packet seams" rows for the parts built.
- Packet index Status (for example "In progress: A, D done").

## Pitfalls

- Part A: `scrollToIndex` resolves before the target row is measured in some cases; wait
  one animation frame after it resolves and, if the row element is still missing, retry a
  few frames (the anchor logic in `ChatView.tsx:5520-5550` retries up to 12 frames). Never
  use timers.
- Part A: ranges must be rebuilt after scrolling; keeping stale `Range` objects on
  recycled rows highlights the wrong text.
- Part A: the capture-phase `mod+F` listener must return early (without
  `preventDefault`) in every excluded context, or it breaks the browser's find on web and
  the terminal's own keys.
- Part B: `mermaid.render` touches `document.body` with temporary elements; serialize
  renders and always await the previous one, even on failure.
- Part B: revoke blob URLs on unmount; virtualization unmounts often.
- Part B: do not render while `isStreaming`; half a diagram is always a syntax error.
- Part C: keep `inspectPreset` in step with `onProviderModelSelect`
  (`ChatView.tsx:8838-8905`). Do not edit `ChatView.tsx` beyond the listed seam; put a
  pointer comment in `presets.ts` only, and add a test fixture for each rule so an
  upstream change in the shared helpers shows up in this test.
- Part D: never create a new activity kind or event type; the activity must decode as
  `UserInputRequestedPayload`, or answering fails with "This question has already been
  answered."
- Part D: the tool description is prompt text on every turn for every session; keep it
  as short as TECHNICAL.md has it.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done) for each
part built, plus:

- A: finds a message scrolled far out of view and highlights it; `mod+F` in the terminal
  or browser preview is untouched.
- B: no Mermaid code is downloaded until a diagram is shown.
- C: an unavailable preset explains itself and cannot be applied.
- D: a Claude session can post a question, keep working, and receive the answer as a
  message; dismiss works; the upstream mobile app shows and answers it.
