import {
  CommandId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import {
  BotDefinitionInput,
  BotParameter,
  BotsError,
  isBotRunThreadId,
  type BotDraftResult,
  type BotsDismissSuggestionInput,
  type BotsRefineDraftInput,
  type BotsSuggestionsInput,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import { forkParked } from "../../../serverActivation.ts";
import { checkParameters } from "../render.ts";
import { briefShape, shapeKey } from "./briefShape.ts";
import { draftFromBrief } from "./draft.ts";
import { makeSuggestionsStore } from "./SuggestionsStore.ts";

/** How long refinement may take before its drafting thread is stopped. */
export const REFINE_TIMEOUT_MS = 180_000;
const REFINE_GRACE_MS = 15_000;
const RESUBSCRIBE_AFTER = Duration.seconds(5);
export const UNUSABLE_REFINEMENT = "The model's draft was not usable; showing the original.";
/** Promoted runs (L94) are copies of a run, so their opening message is a bot's brief. */
const PROMOTED_RUN_THREAD_PREFIX = "bot-open-";
const DRAFT_THREAD_PREFIX = "bot-run-draft-";

export const REFINE_DRAFT_REQUEST = `You are helping turn a one-off request into a reusable bot: a fixed brief that runs again and again with different inputs.

Below are a draft bot as JSON and the original request it came from. Improve only these four fields:

- "name": a short name for the job, without any one run's inputs.
- "description": one or two sentences saying what the bot does and when to use it.
- "instructions": the brief, written so it works for any inputs. Refer to each input as {{name}}, using the parameter names. Keep everything the original asked for that applies to every run, and drop details that only applied to that one request.
- "parameters": the inputs each run supplies. Keep the existing ones unless they are wrong, and add any input the original hard-coded that should vary. Each parameter is {"name","label","description","type","required"}, where type is "string", "text", "number", "boolean" or "choice" ("choice" also needs "choices").

Do not run tools, read files or change anything. Reply with only a JSON object holding those four fields, with no prose before or after it.`;

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message !== "" ? error.message : String(error);

/** The request a thread opened with: its first user message that a person or agent wrote. */
export const briefMessage = (messages: ReadonlyArray<OrchestrationV2ConversationMessage>) =>
  messages.find(
    (message) =>
      message.role === "user" &&
      message.scheduledTaskId === undefined &&
      message.notification === undefined &&
      message.text.trim() !== "",
  );

/** Whether a message could open a thread worth counting toward a suggestion. */
const countable = (message: OrchestrationV2ConversationMessage) =>
  message.role === "user" &&
  !message.streaming &&
  (message.createdBy === "user" || message.createdBy === "agent") &&
  message.scheduledTaskId === undefined &&
  message.notification === undefined &&
  message.workflowScript !== true &&
  message.text.trim() !== "";

const countableThread = (threadId: ThreadId) =>
  !isBotRunThreadId(threadId) && !threadId.startsWith(PROMOTED_RUN_THREAD_PREFIX);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeParameter = Schema.decodeUnknownOption(BotParameter);
const decodeDefinition = Schema.decodeUnknownOption(BotDefinitionInput);
const encodeDraft = Schema.encodeSync(Schema.fromJsonString(BotDefinitionInput));

/**
 * Merges the four fields a refinement may change into the draft. Null when the reply holds no
 * usable object or the merged draft would not save.
 */
export const mergeRefinement = (
  draft: BotDefinitionInput,
  reply: string,
): BotDefinitionInput | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(reply));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const name = text(parsed.name);
  const instructions = text(parsed.instructions);
  const description = typeof parsed.description === "string" ? parsed.description.trim() : null;
  const parameters = Array.isArray(parsed.parameters)
    ? parsed.parameters.flatMap((value) => Option.toArray(decodeParameter(value)))
    : null;
  if (name === null && instructions === null && description === null && parameters === null)
    return null;
  const merged = Option.getOrNull(
    decodeDefinition({
      ...draft,
      ...(name === null ? {} : { name }),
      ...(description === null ? {} : { description }),
      ...(instructions === null ? {} : { instructions }),
      ...(parameters === null ? {} : { parameters }),
    }),
  );
  return merged === null || checkParameters(merged) !== null ? null : merged;
};

/**
 * Asks a model one question in a hidden thread that cannot change files, and returns its last
 * reply. Null when it took longer than `REFINE_TIMEOUT_MS`. The thread is archived afterwards.
 */
export const makeDraftingThread = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;

  const ask = Effect.fn("BotDrafts.ask")(function* (request: {
    readonly title: string;
    readonly modelSelection: ModelSelection;
    readonly text: string;
  }) {
    const scratch = yield* folders.ensureScratchProject.pipe(
      Effect.mapError((error) =>
        fail("launch", `Loom could not prepare a scratch folder: ${errorMessage(error)}`),
      ),
    );
    const id = yield* randomUuidV4;
    const threadId = ThreadId.make(`${DRAFT_THREAD_PREFIX}${id}`);
    const target = { projectId: scratch.projectId, threadId };
    const archive = threads
      .dispatch({
        type: "thread.archive",
        commandId: CommandId.make(`bot-draft:${id}:archive`),
        threadId,
      })
      .pipe(Effect.ignore({ log: true }));
    const interrupt = (reason: string) =>
      threads
        .interruptThread({
          ...target,
          commandId: CommandId.make(`bot-draft:${id}:interrupt`),
          reason,
        })
        .pipe(Effect.ignore({ log: true }));

    return yield* Effect.gen(function* () {
      yield* launches
        .launch({
          ...target,
          commandId: CommandId.make(`bot-draft:${id}`),
          title: request.title,
          generateTitle: false,
          modelSelection: request.modelSelection,
          // `plan` could answer with a proposed plan instead of a message, so the mode that
          // cannot change files without approval is what keeps the drafting agent read-only.
          runtimeMode: "approval-required",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: {
            text: request.text,
            attachments: [],
          },
          createdBy: "user",
          creationSource: "server",
        })
        .pipe(Effect.mapError((error) => fail("launch", errorMessage(error))));
      const waited = yield* threads
        .waitForThread({ ...target, timeoutMs: REFINE_TIMEOUT_MS })
        .pipe(Effect.mapError((error) => fail("launch", errorMessage(error))));
      if (waited.timedOut) {
        yield* interrupt("Drafting the bot took too long.");
        yield* threads.waitForThread({ ...target, timeoutMs: REFINE_GRACE_MS }).pipe(Effect.ignore);
        return null;
      }
      return yield* threads.getProjectThreadRecords(target, ["messages"]).pipe(
        Effect.map(
          (records) =>
            records.messages.findLast((message) => message.role === "assistant")?.text ?? null,
        ),
        Effect.orElseSucceed(() => null),
      );
    }).pipe(
      Effect.onInterrupt(() => interrupt("Drafting the bot was cancelled.")),
      Effect.ensuring(archive),
    );
  });

  return { ask };
});

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* makeSuggestionsStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const drafting = yield* makeDraftingThread;

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const storageError = (cause: unknown) =>
    Effect.logWarning("Bot suggestions storage failed", { cause }).pipe(
      Effect.andThen(Effect.fail(fail("storage", "Loom could not read or write bots storage."))),
    );

  const takenIds = sql<{ id: string }>`SELECT id FROM fork_bots_definitions`.pipe(
    Effect.map((rows) => new Set(rows.map((row) => row.id))),
    Effect.catch(storageError),
  );

  const readThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    if (isBotRunThreadId(threadId))
      return yield* fail("invalid", "A bot run cannot be saved as a bot; open its bot instead.");
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => fail("invalid", "Loom could not read the thread.")));
    if (shell === null || shell.deletedAt !== null)
      return yield* fail("not_found", "That thread no longer exists.");
    const records = yield* threads
      .getProjectThreadRecords({ projectId: shell.projectId, threadId }, ["messages"])
      .pipe(Effect.mapError(() => fail("invalid", "Loom could not read the thread.")));
    const brief = briefMessage(records.messages);
    if (brief === undefined)
      return yield* fail("invalid", "This thread has no request to turn into a bot.");
    return { shell, brief };
  });

  const draftFromThread = Effect.fn("BotDrafts.draftFromThread")(function* (threadId: ThreadId) {
    const { shell, brief } = yield* readThread(threadId);
    const scratch = yield* folders.ensureScratchProject.pipe(
      Effect.map((project) => project.projectId === shell.projectId),
      Effect.orElseSucceed(() => false),
    );
    const { draft, notes } = draftFromBrief(
      {
        brief: brief.text,
        attachments: brief.attachments.length,
        title: shell.title,
        projectId: shell.projectId,
        scratch,
        worktreePath: shell.worktreePath,
        modelSelection: shell.modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
      },
      yield* takenIds,
    );
    return { draft, sourceThreadId: threadId, notes } satisfies BotDraftResult;
  });

  /**
   * Asks the source thread's model to generalize a draft, in a hidden thread that cannot change
   * files. Only the four fields it may change are merged; anything else keeps the draft as it was.
   */
  const refine = Effect.fn("BotDrafts.refine")(function* (input: BotsRefineDraftInput) {
    const { shell, brief } = yield* readThread(input.threadId);
    const reply = yield* drafting.ask({
      title: `Refine ${input.draft.name}`,
      modelSelection: shell.modelSelection,
      text: `${REFINE_DRAFT_REQUEST}\n\n## Draft\n\n${encodeDraft(input.draft)}\n\n## Original request\n\n${brief.text}`,
    });

    const merged = reply === null ? null : mergeRefinement(input.draft, reply);
    return {
      draft: merged ?? input.draft,
      sourceThreadId: input.threadId,
      notes:
        reply === null
          ? ["The model took too long; showing the original."]
          : merged === null
            ? [UNUSABLE_REFINEMENT]
            : [],
    } satisfies BotDraftResult;
  });

  const suggestions = (input: BotsSuggestionsInput) =>
    store.list(input.dismissed === true).pipe(
      Effect.map((list) => ({ suggestions: list })),
      Effect.catch(storageError),
    );

  const dismissSuggestion = Effect.fn("BotDrafts.dismissSuggestion")(function* (
    input: BotsDismissSuggestionInput,
  ) {
    const suggestion = yield* store
      .setDismissed(input.suggestionId, input.dismissed, yield* nowIso)
      .pipe(Effect.catch(storageError));
    if (suggestion === null) return yield* fail("not_found", "That suggestion no longer exists.");
    return suggestion;
  });

  /** Counts a thread's opening brief toward its shape; anything else is ignored. */
  const considerMessage = Effect.fn("BotDrafts.considerMessage")(function* (
    message: OrchestrationV2ConversationMessage,
  ) {
    const threadId = message.threadId;
    if (!countable(message) || !countableThread(threadId)) return;
    if (yield* store.isThreadRecorded(threadId)) return;
    const shell = yield* threads.getThreadShell(threadId);
    if (shell === null) return;
    const records = yield* threads.getProjectThreadRecords(
      { projectId: shell.projectId, threadId },
      ["messages"],
    );
    const at = DateTime.formatIso(message.createdAt);
    const first = briefMessage(records.messages);
    // The opening brief came earlier, while Loom was not watching; never count this thread.
    if (first === undefined || first.id !== message.id) return yield* store.markSeen(threadId, at);
    const shape = briefShape(message.text);
    if (shape === "") return yield* store.markSeen(threadId, at);
    const counted = yield* store.recordBrief({
      threadId,
      key: shapeKey(shape),
      shape,
      at,
      by: message.createdBy === "agent" ? "agent" : "user",
    });
    if (counted) yield* store.prune(DateTime.toEpochMillis(yield* DateTime.now));
  });

  return {
    draftFromThread,
    refine,
    suggestions,
    dismissSuggestion,
    considerMessage,
  };
});

export class BotDrafts extends Context.Service<BotDrafts, Effect.Success<typeof make>>()(
  "t3/fork/bots/fromThread/BotDrafts",
) {}

export const layer = Layer.effect(BotDrafts, make);

export const handleDomainEvent = (
  drafts: Pick<BotDrafts["Service"], "considerMessage">,
  event: OrchestrationV2DomainEvent,
) =>
  event.type === "message.updated"
    ? drafts.considerMessage(event.payload).pipe(Effect.ignore({ log: true }))
    : Effect.void;

/**
 * Watches opening briefs for repeats. The stream is a live tail, so briefs sent while the server
 * was down are missed; that is fine for a hint, but a dead stream is invisible, so it resubscribes.
 */
export const BotSuggestionsReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const drafts = yield* BotDrafts;
    const threads = yield* ThreadManagement.ThreadManagementService;
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, (event) =>
        handleDomainEvent(drafts, event),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Bot suggestion stream failed; resubscribing", { cause }),
        ),
        Effect.andThen(Effect.sleep(RESUBSCRIBE_AFTER)),
        Effect.forever,
      ),
    );
  }),
);
