import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../../persistence/Sqlite.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import { runForkMigrationSet } from "../../persistence/migrations.ts";
import { make } from "../fromThread/BotDrafts.ts";
import { BotsMigrations } from "../migrations.ts";

export const projectId = ProjectId.make("project-a");
export const scratchId = ProjectId.make("scratch");

let messageCount = 0;

export const message = (
  threadId: string,
  text: string,
  fields: Partial<OrchestrationV2ConversationMessage> & { readonly at?: string } = {},
): OrchestrationV2ConversationMessage => {
  const { at = "2026-10-20T10:00:00.000Z", ...rest } = fields;
  const createdAt = DateTime.makeUnsafe(at);
  messageCount += 1;
  return {
    id: MessageId.make(`message-${messageCount}`),
    threadId: ThreadId.make(threadId),
    runId: null,
    nodeId: null,
    role: "user",
    text,
    attachments: [],
    streaming: false,
    createdBy: "user",
    creationSource: "client",
    createdAt,
    updatedAt: createdAt,
    ...rest,
  } as OrchestrationV2ConversationMessage;
};

export const messageEvent = (payload: OrchestrationV2ConversationMessage) =>
  ({ type: "message.updated", threadId: payload.threadId, payload }) as OrchestrationV2DomainEvent;

/** Fake thread, launch and folder services for drafts and suggestions. */
export const makeDraftsHarness = Effect.sync(() => {
  const shells = new Map<string, Partial<OrchestrationV2ThreadShell>>();
  const messages = new Map<string, Array<OrchestrationV2ConversationMessage>>();
  const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];
  const interrupted: Array<string> = [];
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const state = {
    /** The drafting thread's reply; null leaves it without one. */
    reply: null as string | null,
    /** The drafting thread never ends on its own, so only the time limit stops it. */
    hang: false,
  };

  /** A thread whose messages are `thread` in order; the first is its brief. */
  const addThread = (
    threadId: string,
    thread: ReadonlyArray<OrchestrationV2ConversationMessage>,
    shell: Partial<OrchestrationV2ThreadShell> = {},
  ) => {
    shells.set(threadId, {
      id: ThreadId.make(threadId),
      projectId,
      title: "Review PR #12",
      modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" },
      runtimeMode: "full-access",
      interactionMode: "default",
      worktreePath: null,
      branch: null,
      deletedAt: null,
      archivedAt: null,
      ...shell,
    });
    messages.set(threadId, [...thread]);
  };

  const threads = {
    getThreadShell: (threadId: string) => Effect.sync(() => shells.get(threadId) ?? null),
    getProjectThreadRecords: (input: { readonly threadId: ThreadId }) =>
      Effect.sync(() => ({
        thread: { id: input.threadId },
        messages: messages.get(input.threadId) ?? [],
      })),
    waitForThread: (input: ThreadManagement.ThreadManagementWaitInput) =>
      state.hang && !interrupted.includes(input.threadId)
        ? Effect.sleep(input.timeoutMs).pipe(
            Effect.as({ threadId: input.threadId, run: null, timedOut: true }),
          )
        : Effect.succeed({
            threadId: input.threadId,
            run: { status: "completed" },
            timedOut: false,
          }),
    interruptThread: (input: ThreadManagement.ThreadManagementInterruptInput) =>
      Effect.sync(() => {
        interrupted.push(input.threadId);
        return {};
      }),
    dispatch: (command: OrchestrationV2ServerCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: dispatched.length };
      }),
  } as unknown as ThreadManagement.ThreadManagementService["Service"];

  const launchService = {
    launch: (input: ThreadLaunch.ThreadLaunchInput) =>
      Effect.sync(() => {
        launches.push(input);
        const threadId = input.threadId!;
        messages.set(threadId, [
          message(threadId, input.initialMessage?.text ?? ""),
          ...(state.reply === null ? [] : [message(threadId, state.reply, { role: "assistant" })]),
        ]);
        return { threadId, projection: { runs: [] }, resumed: false };
      }),
  } as unknown as ThreadLaunch.ThreadLaunchService["Service"];

  const folders = {
    ensureScratchProject: Effect.succeed({ projectId: scratchId }),
  } as unknown as ManagedProjectFolders.ManagedProjectFolders["Service"];

  const service = make.pipe(
    Effect.provideService(ThreadManagement.ThreadManagementService, threads),
    Effect.provideService(ThreadLaunch.ThreadLaunchService, launchService),
    Effect.provideService(ManagedProjectFolders.ManagedProjectFolders, folders),
  );

  return { addThread, launches, interrupted, dispatched, state, service };
});

export type DraftsHarness = Effect.Success<typeof makeDraftsHarness>;

export const withDraftsHarness = <A, E>(
  use: (harness: DraftsHarness) => Effect.Effect<A, E, SqlClient.SqlClient | Scope.Scope>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(BotsMigrations);
    return yield* use(yield* makeDraftsHarness);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory));
