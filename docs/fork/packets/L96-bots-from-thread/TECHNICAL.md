# L96 technical design

## Overview

```text
Save as bot (menu, palette) / loom_bots_draft_from_thread
   loom.bots.draftFromThread { threadId }
      getProjectThreadRecords(thread, ["messages"]) ─▶ first user message + thread settings
      draftFromBrief (pure) ─▶ placeholders, parameters, name, id
   ─▶ BotDefinitionInput draft (not saved) ─▶ editor ─▶ loom.bots.save (L89)

Refine with model
   loom.bots.refineDraft { threadId, draft } ─▶ hidden drafting thread (bot-run-draft-<id>)
      reply JSON ─▶ lenient decode ─▶ merged draft ─▶ editor

Suggestions (under forkParked)
   streamDomainEvents: message.updated (first user message of a thread)
      briefShape (pure) ─▶ fork_bots_brief_shapes ─▶ 3 threads in 14 days ─▶ fork_bots_suggestions
```

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BOTS_FROM_THREAD_FEATURE = "bots-from-thread"`.
- `BotDraftResult = { draft: BotDefinitionInput, sourceThreadId, notes: Array(String) }`. `notes`
  explains choices the editor should show ("2 values became parameters", "The thread used a
  worktree, so the bot does too").
- `BotSuggestion = { id, shape (at most 400 characters, with placeholders), threadIds (newest
first, at most 10), count, firstSeenAt, lastSeenAt, startedBy: BotCreator, dismissedAt }`.

| Tag                           | Payload                                   | Success           | Scope                   |
| ----------------------------- | ----------------------------------------- | ----------------- | ----------------------- |
| `loom.bots.draftFromThread`   | `{ threadId }`                            | `BotDraftResult`  | `orchestration:read`    |
| `loom.bots.refineDraft`       | `{ threadId, draft: BotDefinitionInput }` | `BotDraftResult`  | `orchestration:operate` |
| `loom.bots.suggestions`       | `{ dismissed? }`                          | `{ suggestions }` | `orchestration:read`    |
| `loom.bots.dismissSuggestion` | `{ suggestionId, dismissed }`             | `BotSuggestion`   | `orchestration:operate` |

`draftFromThread` only reads, so it is a read scope; `refineDraft` starts provider work, so it
is operate.

## Deterministic draft

`apps/server/src/fork/bots/fromThread/BotDrafts.ts` resolves the thread's project with
`getThreadShell` and reads `ThreadManagementService.getProjectThreadRecords({ projectId,
threadId }, ["messages"])` (`apps/server/src/orchestration-v2/ThreadManagementService.ts:350`),
which returns the `thread` with the messages. It refuses bot run threads (`isBotRunThreadId`) and
threads with no user message.

The brief is the first message with `role: "user"`
(`packages/contracts/src/orchestrationV2.ts:1099`) and no `scheduledTaskId` or `notification`
(`:1086-1088`). Attachments are not
carried over; `notes` says so when the message had any.

`draftFromBrief(brief, thread)` in `fromThread/draft.ts`, pure:

1. **Placeholders**, in this order, each value replaced everywhere it appears:
   - pull request references: `#123`, `PR 123`, and pull request URLs ending in `/pull/123`
     become `{{pr}}`, parameter type `number`;
   - repository-relative paths: tokens containing `/` and a file extension, not starting with
     `http`, not inside a fenced code block, become `{{file}}`, then `{{file2}}`, type `string`;
   - at most 6 placeholders; further values stay literal and `notes` says so.
     Each parameter is `required: true` with the original value in its `description` ("For example
     apps/web/src/App.tsx"). Fenced code blocks are left untouched, because code in a brief is an
     example, not an input.
2. **Instructions**: the rewritten brief, trimmed, cut to the 20,000-character limit.
3. **Name**: the thread title (`packages/contracts/src/orchestrationV2.ts:360`), with the
   replaced values removed, cut to 120 characters. **Id**: `slugFromName` semantics (the web
   editor's helper in `apps/web/src/fork/bots/draft.ts:103`, moved to contracts so server and
   web agree), suffixed `-2`, `-3` when the id is taken.
4. **Settings** from the thread (`:362-366`): `modelSelection`, `runtimeMode`,
   `interactionMode`; workspace `{ type: "project", projectId: thread.projectId, worktree:
thread.worktreePath !== null }`; `scopeProjectId: thread.projectId`; L89 defaults for timeout
   (30 minutes) and concurrency (2).

The draft is returned, never saved. The web editor maps it with the existing `botDraft`
(`apps/web/src/fork/bots/draft.ts:76`) after filling the fields `BotDefinition` adds.

## Refinement

`BotDrafts.refine({ threadId, draft }, caller)` launches one hidden thread and waits:

- thread id `bot-run-draft-<uuid>`, which `isBotRunThreadId` hides like any run thread, launched
  through `ThreadLaunchService.launch` in the scratch project
  (`ManagedProjectFolders.ensureScratchProject`, as L89 uses for scratch bots), with the source
  thread's model, `runtimeMode: "approval-required"` and `interactionMode: "plan"`, so the
  drafting agent cannot change files;
- the prompt is `REFINE_DRAFT_REQUEST` (in `fromThread/refine.ts`) plus the draft as JSON and the
  original brief, asking for a JSON reply with `name`, `description`, `instructions` and
  `parameters` only;
- `waitForThread` with 180 seconds, then `interruptThread` on timeout; the reply is decoded with
  `extractJsonObject` (`packages/shared/src/schemaJson.ts:192`) and a lenient schema, the same
  approach as L92's verdicts;
- only those four fields are merged into the draft, and the merged draft must still decode as
  `BotDefinitionInput`; otherwise the original draft returns with a note ("The model's draft was
  not usable; showing the original.");
- the drafting thread is archived with `thread.archive`
  (`packages/contracts/src/orchestrationV2.ts:2578`) afterwards.

This is not a bot run: there is no run row, no inbox item and no usage. A server restart during
refinement leaves an archived-or-hidden drafting thread and the RPC fails; Kyle presses Refine
again. Cancel interrupts the RPC fiber, which interrupts the thread.

Why a thread and not text generation: `ProviderTextGeneration`
(`packages/provider-core/src/server/textGeneration.ts:96`) exposes five fixed operations (commit
message, PR content, branch name, thread title, review guide). A sixth would be an upstream
change, and refinement is rare enough that launch overhead does not matter.

## Suggestions

### Shape

`briefShape(text)`, pure in `fromThread/briefShape.ts`: apply the same placeholder rules as the
draft, then lowercase, collapse whitespace, replace remaining numbers with `{{n}}` and quoted
strings with `{{text}}`, and keep the first 400 characters. Two briefs with equal shapes ask for
the same job on different inputs. The key is a SHA-256 of the shape.

### Reactor

A `Layer.effectDiscard` under `forkParked`, the same shape as the Library brief suggestions
reactor (`apps/server/src/fork/project-library/LibraryBriefSuggestions.ts:344-362`):
`Stream.runForEach(threads.streamDomainEvents, ...)` handling `message.updated` events
(`packages/contracts/src/orchestrationV2.ts:1693`) where the message:

- has `role: "user"`, `streaming: false`, `createdBy` `user` or `agent`, and none of
  `scheduledTaskId`, `notification` or `workflowScript` (all on the message struct,
  `packages/contracts/src/orchestrationV2.ts:1085-1094`);
- belongs to a thread that is not a bot run, draft or promoted run (`bot-open-` from L94);
- is the first user message of its thread: the reactor records thread ids it has counted in
  `fork_bots_brief_threads`, so later messages and edits of the same thread are ignored.

`streamDomainEvents` is a live tail (`apps/server/src/orchestration-v2/Orchestrator.ts:11744-11760`):
it does not replay history and misses briefs sent while the server was down. That is acceptable
for a hint. It does not drop events under load, unlike `streamStoredEventsFrom`, which is bounded
for RPC subscribers (`:11735-11736`). The Library reactor only logs when its stream fails; this
one logs and resubscribes after 5 seconds, because a dead suggestion stream is invisible.

When a shape reaches 3 threads with `lastSeenAt - firstSeenAt` within 14 days, a suggestion row
is created (or updated with the new thread). `startedBy` is `agent` when most of the threads came
from agents. Dismissed suggestions are not shown again unless the shape gains 5 more threads,
which reopens them once.

### Retention

Shapes older than 30 days without a new thread are deleted by the reactor after each insert, at
most 100 rows per pass. At most 2,000 shape rows and 200 suggestion rows are kept, oldest first
out.

## Storage

Migration 8 `Suggestions` (next free id if another bots migration landed first):

- `fork_bots_brief_threads(thread_id TEXT PRIMARY KEY, shape_key TEXT NOT NULL, created_at TEXT
NOT NULL)`.
- `fork_bots_brief_shapes(shape_key TEXT PRIMARY KEY, shape TEXT NOT NULL, thread_ids_json TEXT
NOT NULL, user_count INTEGER NOT NULL, agent_count INTEGER NOT NULL, first_seen_at TEXT NOT
NULL, last_seen_at TEXT NOT NULL)`.
- `fork_bots_suggestions(id TEXT PRIMARY KEY, shape_key TEXT NOT NULL UNIQUE, created_at TEXT NOT
NULL, updated_at TEXT NOT NULL, dismissed_at TEXT, reopened INTEGER NOT NULL DEFAULT 0)`.

Brief text is not stored beyond the 400-character shape, which already has inputs replaced.

## Clients

- `apps/web/src/fork/bots/fromThread/state.ts`: `canSaveAsBot`, `openSaveAsBot(threadRef)`
  (calls `draftFromThread`, then navigates to `/loom/bots` with the draft in the editor's state),
  and the refine command.
- `BotEditor.tsx` accepts an initial draft and shows `notes` above the form, plus the Refine
  button when the draft came from a thread.
- Bots page: a Suggestions strip above the list when suggestions exist, each with Create (calls
  `draftFromThread` on the newest thread) and Dismiss, and a "Dismissed" link that lists and
  restores them.
- Palette: "Save this thread as a bot" in `botsPaletteSource`
  (`apps/web/src/fork/bots/palette.tsx:29`) when a thread is active and supports the feature.

## Agent-facing tools

- `loom_bots_draft_from_thread` (read): `{ threadId }` (defaults to the caller's thread),
  returns `BotDraftResult`. The agent edits and saves it with `loom_bots_define`.
- `loom_bots_suggestions` (read): open suggestions, so an orchestrator can see which of its own
  briefs repeat.

Refinement is not on MCP: an agent can refine a draft itself.

## Performance

The reactor does one shape computation and at most three indexed writes per first user message.
`draftFromThread` reads one thread's messages on demand.

## Alternatives considered

- **Draft in the browser.** No new RPC, but agents could not use it, and the thread's settings
  and full first message would need extra client reads.
- **Title-based detection.** Thread titles are often generated later and vary; the first user
  message is what repeats.
- **Use every message as instructions.** Captures corrections, but most later messages are
  specific to that thread.
