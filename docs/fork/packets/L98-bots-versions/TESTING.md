# L98 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `BotsStore.versions.test.ts`:
  - each save writes one version row in the same transaction as the definition; a failing version
    insert leaves the old definition in place;
  - delete then recreate continues numbering past both recorded runs and stored versions, with no
    runs at all;
  - `changed` lists exactly the differing fields, including nested `workspace` changes;
  - retention keeps stable, trigger-pinned and run-referenced versions beyond 200.
- Migration test: an existing database gets one version row per definition; the migration runs
  with the next free id.
- `BotsService.versions.test.ts`: `restoreVersion` creates a new version with `restoredFrom` and
  rejects a stale `expectedVersion`; `setStable` does not bump the version; `definitionAt` of an
  archived bot refuses; `definitionAt("stable")` with none set falls back to latest.
- `BotReplays.test.ts` with fake launch and wait services:
  - a draft replay records `botVersion` 0 and validates like a save, including the runtime mode
    rank for agent callers;
  - inputs that no longer validate become `failed` items without launching;
  - comparisons: fail to pass is `fixed`, pass to fail is `broke`, equal verdicts `same`, text
    bots `same` or `changed`;
  - budget checked once for the whole replay;
  - restart with pending items starts them; cancel stops pending items and cancels running ones;
  - replay runs are not inbox items.
- `suggestEdit.test.ts`: the prompt includes down-rated runs and notes within the size caps; an
  unusable reply returns the current definition with a note.

## Clients

- Diff view model (pure): two definitions produce the instruction texts for `parseDiffFromFile`
  and Before and After rows for every other changed field.
- Replay summary formatting: "Fixed 2, broke 0, same 8".
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint changed
  files.

## Real client

When Kyle asks: edit a starter bot, compare it with the previous version, replay the draft on
three past runs, save, mark the old version stable, and see "v2, stable v1" in the list.
