# L14 testing

## Automated tests

Part A, `apps/web/src/fork/chat-conveniences/find/findMatches.test.ts` (pure):

- Only `message` rows with role user or assistant are searched; work rows are skipped.
- Case-insensitive by default; "Match case" respected.
- Markdown reduction: `**bold**`, inline code, link targets and headings do not create or
  hide matches (a search for "bold" matches `**bold**`; a search for "https" does not
  match a link whose visible text lacks it).
- Order follows the row order; next and previous wrap.
- Empty and whitespace queries return no results.

Part A highlighting: the web unit tests run in Node without a DOM
(`apps/web/vite.config.ts`, project `unit`), so split `highlight.ts` into a pure
`matchSpans(segments: string[], query, matchCase)` that returns
`{ segment, start, end }` spans across consecutive text segments (a match may cross a
segment boundary, for example `**bo**ld`), tested in `findMatches.test.ts`, and a thin DOM
layer (TreeWalker, `Range`, `CSS.highlights`) verified manually.

Part B, `mermaid/renderMermaid.test.ts` (with `mermaid` mocked):

- Renders are serialized (a second render starts only after the first settles, including
  after a rejection).
- Cache hit returns the same SVG without calling `render`; the LRU evicts the oldest past
  50 entries.
- A render slower than the timeout rejects with a timeout error; a later render still runs.
- Source over 20,000 characters is rejected before loading Mermaid.
- The module is imported once however many renders run.

Part C, `presets/presets.test.ts`:

- Storage: decode drops invalid entries; at most 9; order preserved; storage that throws
  yields an empty list without errors.
- `inspectPreset`: unknown instance; model no longer available; thread locked to another
  driver; started session in another continuation group; available case.
- `applyPreset` against the real `useComposerDraftStore`: the thread's draft selection and
  sticky selection equal the preset afterwards, with `replaceOptions` semantics (the
  preset's effort replaces the previous effort).

Part D, `apps/server/src/fork/chat-conveniences/AskService.test.ts` (in-memory
orchestration, no provider):

- Posting appends exactly one `thread.activity-appended` event with a
  `user-input.requested` activity whose payload decodes as `UserInputRequestedPayload`
  with `responseMode: "message"`, and `turnId` equal to the thread's latest turn (or null).
- The existing `thread.user-input.respond` command on that request id succeeds and
  produces a `thread.turn.start` whose message text contains the question and the answer
  (this proves the whole answer path with upstream's decider).
- `thread.user-input.dismiss` on it succeeds.
- A fourth open question on one thread fails with `too-many-open`; answering one frees a
  slot.
- Unknown and archived threads fail with their reasons.
- The fork tool name starts with `loom_` and is unique (ext-mcp's registry test).

Registry invariants (keybinding commands, palette values, settings ids) run with the
extension points' tests.

## Commands

```sh
vp test run apps/web/src/fork/chat-conveniences/find/findMatches.test.ts \
  apps/web/src/fork/chat-conveniences/mermaid/renderMermaid.test.ts \
  apps/web/src/fork/chat-conveniences/presets/presets.test.ts \
  apps/server/src/fork/chat-conveniences/AskService.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork/chat-conveniences apps/server/src/fork/chat-conveniences \
  packages/contracts/src/fork apps/web/src/components/ChatView.tsx \
  apps/web/src/components/ChatMarkdown.tsx
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck                  # part D
vp run --filter @t3tools/contracts typecheck  # parts A, C (keybindings) and D
vp run --filter @t3tools/mobile typecheck     # contracts changed
```

Part B also: `vp run --filter @t3tools/web build` once, to check chunking (see
IMPLEMENTATION.md).

## Manual check

With Kyle's permission, `test-t3-app` on web, then the desktop dev app, with seeded data:

A. In a long thread, `mod+F`, type a word from an early message: the counter updates, Enter
scrolls to it and highlights it; Shift+Enter goes back; Escape clears. While a turn
streams, find still moves (live follow stops). With older turns, "Load earlier" loads
them and the count grows. Focus the terminal and press `mod+F`: nothing from Loom. On
web with the setting off, the browser's find opens.
B. Ask an agent for a Mermaid flowchart: code while streaming, diagram after; toggle Code;
copy source; switch the app theme: the diagram re-renders in the other theme; a broken
diagram shows its error and code. The network panel shows the Mermaid chunk loading only
then. Turn the setting off: code blocks only.
C. Save two presets (different accounts and efforts), apply each from the popover, the
palette and a bound key; the composer's model and effort follow; on a thread locked to
Codex, a Claude preset is dimmed with the reason; delete and undo.
D. In a Claude thread, ask the agent to "ask me which option I prefer using the Loom ask
tool and keep going": the tool call returns at once, the question panel shows, the
agent continues; answer it: the answer appears as a user message and reaches the agent.
Dismiss another. Repeat on Cursor or OpenCode if available. Open the thread in
upstream's mobile app: the pending question shows and can be answered.

Upstream-server case: A, B, C work; the agent tool list has no `loom_` tool.

## Merge safety

`git merge-tree` preview (SEAMS.md) on the branch; `scripts/fork/loom.sh integrate
nightly --dry-run` after merging to `main`. `ChatView.tsx` and `ChatMarkdown.tsx`
conflicts are expected occasionally; reapply at the quoted anchors.

## Acceptance criteria

- Each built part meets its PRODUCT.md behavior and states on web and desktop (D on every
  client).
- No new orchestration event types; no new wire schemas on upstream methods.
- Mermaid is absent from the initial bundle; find costs nothing while closed.
