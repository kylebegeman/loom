# L91: Run bots from the composer, and teach agents to use them

Status: Selected; queued.

Kyle types `/` in any thread, sees his bots next to commands and skills, picks one, fills its
inputs in a small form above the composer and presses Enter. The run starts attached to the
current thread, a footer chip shows it while it runs, and Kyle can choose to have the result
posted back into the thread when it finishes. Agents get a short instruction to prefer a matching
bot over writing a fresh `delegate_task` brief, and an async bot run can wake the calling agent
when it completes, the way a delegated task does.

B03 | Complexity: Small to Medium | Impact: High | Depends on: L89

## Scope

- In: creating `ext-composer` and `ext-composer-menu` (EXTENSION-POINTS §11 and §11b), plus a
  slash-source hook in `ext-composer-menu` so fork items can join the upstream `/` list; bot items
  in the `/` menu; the inline bot form as a composer drawer; a footer chip listing runs attached to
  the thread; `callerThreadId` and `notify` on `loom.bots.run`; result delivery to the caller
  thread; the `LOOM_BOTS_INSTRUCTIONS` orchestration section; `notify` on `loom_bots_run`.
- Out: mobile composer (mobile has its own trigger copy in `packages/shared/src/composerTrigger.ts`
  and no Bots page yet); listing bots inside the instructions themselves (the sections are static,
  so agents call `loom_bots_list`); keyboard shortcuts per bot.

## Surfaces

Web and desktop: the composer `/` menu, drawer and footer chip in every thread. Mobile: nothing
new; a bot started from desktop and attached to a thread is invisible on mobile except for the
optional result message, which is an ordinary message. Remote: all RPC, so every connection mode
works. Gated on `bots-invocation`; an older server shows no bot items.

## Extension points used

None new (L89's) for the server. Creates `ext-composer` (5 seams in `ChatComposer.tsx`) and
`ext-composer-menu` (§11b seams plus one slash-source seam), each in its own commit before the
feature commit, the way L31 builds on L23. Capability sub-feature `bots-invocation`.

## Packet seams

- `packages/provider-core/src/server/orchestrationInstructions.ts`: import and list
  `LOOM_BOTS_INSTRUCTIONS` (2 lines, `fork: bots`), following the `ext-vault` precedent.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
