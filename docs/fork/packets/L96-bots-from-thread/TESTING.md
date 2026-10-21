# L96 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `fromThread/draft.test.ts` (pure `draftFromBrief`):
  - "Review PR #412 and check apps/web/src/App.tsx" gives instructions with `{{pr}}` and
    `{{file}}`, a required `number` parameter `pr` and a required `string` parameter `file`, each
    with the original value in its description;
  - a path repeated twice becomes one placeholder used twice;
  - paths and numbers inside a fenced code block stay literal;
  - a URL is not treated as a path, except a pull request URL, which becomes `{{pr}}`;
  - the seventh value stays literal and a note says so;
  - a brief over 20,000 characters is cut, and the result decodes as `BotDefinitionInput`;
  - the name drops replaced values; the id follows `slugFromName` and gains `-2` when taken;
  - a worktree thread gives `worktree: true`; model, runtime mode and interaction mode are
    copied.
- `fromThread/briefShape.test.ts`: two briefs that differ only in file, PR number, other numbers
  and quoted strings have the same shape; different verbs give different shapes; the shape is at
  most 400 characters.
- `fromThread/BotDrafts.test.ts` with fake thread services:
  - a bot run thread and a thread without a user message are refused with `invalid`;
  - a scheduled task message and a notification message are skipped when finding the brief;
  - attachments give a note;
  - refinement launches `bot-run-draft-*` in the scratch project with `approval-required` and
    `plan`, merges only the four fields from a valid reply, keeps the original draft with a note
    on an unparseable reply or a merged draft that fails to decode, interrupts on the 180-second
    limit (test clock), and archives the drafting thread in every case.
- `fromThread/suggestions.test.ts` driving the reactor's handler with constructed
  `message.updated` events (no live stream):
  - three threads with the same shape within 14 days create one suggestion; three spread over
    20 days do not;
  - a second message in a counted thread and an edit of the first message do not count again;
  - streaming messages, assistant messages, scheduled task messages, bot run, draft and
    `bot-open-` threads are ignored;
  - a dismissed suggestion reopens once after 5 more threads, and not again;
  - retention deletes shapes idle for 30 days and keeps at most 2,000.
- Migration test passes with the new id.

## Clients

- The web mapping from `BotDraftResult` to `BotDraft` fills defaults and round-trips through the
  existing `draft.test.ts` helpers.
- `canSaveAsBot`: false without `bots-from-thread` and for bot run threads.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint changed
  files including the three seam files.

## Real client

When Kyle asks: open a thread with a PR number in its first message, choose Save as bot from the
header menu and from the sidebar menu, check the parameters, press Refine, save, and run the bot.
