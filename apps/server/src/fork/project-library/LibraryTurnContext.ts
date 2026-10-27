import type {
  MessageId,
  OrchestrationV2ProviderThread,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

interface Prompt {
  readonly text: string;
}
type Projection = OrchestrationV2ThreadProjection;

// A command name is one word, so a prompt opening with a path such as /Users/... is not one.
export const isSlashCommand = (prompt: Prompt) =>
  /^\/[^\s/]+(?:\s|$)/u.test(prompt.text.trimStart());

/**
 * The binding whose context opens a native thread's first turn, or null. Slash commands such as
 * /goal and /compact work only at the start of a prompt, so they go verbatim and the next turn
 * carries it. The turn-start projection lacks earlier prompts, so they are read oldest first.
 */
export const libraryTurnContextBinding = Effect.fn("LibraryTurnContext.binding")(function* <
  Binding,
  BindingError,
  ReadError,
>(input: {
  readonly projection: {
    readonly providerTurns: ReadonlyArray<
      Pick<Projection["providerTurns"][number], "providerThreadId" | "runAttemptId">
    >;
    readonly attempts: ReadonlyArray<
      Pick<Projection["attempts"][number], "id" | "runId" | "nativeThreadId">
    >;
    readonly runs: ReadonlyArray<Pick<Projection["runs"][number], "id" | "userMessageId">>;
  };
  readonly providerThread: Pick<OrchestrationV2ProviderThread, "id" | "nativeThreadRef">;
  readonly prompt: Prompt;
  readonly getBinding: Effect.Effect<Binding | null, BindingError>;
  readonly readPrompt: (id: MessageId) => Effect.Effect<Prompt | undefined, ReadError>;
}) {
  if (isSlashCommand(input.prompt)) return null;
  const native = input.providerThread.nativeThreadRef;
  if (native !== null) {
    const attempts = new Map(input.projection.attempts.map((attempt) => [attempt.id, attempt]));
    const runs = new Map(input.projection.runs.map((run) => [run.id, run]));
    const earlierPromptIds = input.projection.providerTurns.flatMap((turn) => {
      if (turn.providerThreadId !== input.providerThread.id) return [];
      const attempt = turn.runAttemptId === null ? undefined : attempts.get(turn.runAttemptId);
      // Attempts recorded before nativeThreadId existed belong to the current native thread.
      if (attempt?.nativeThreadId !== undefined && attempt.nativeThreadId !== native.nativeId)
        return [];
      return [attempt === undefined ? undefined : runs.get(attempt.runId)?.userMessageId];
    });
    // A turn whose prompt cannot be found counts as having carried the context.
    if (!earlierPromptIds.every(Predicate.isNotUndefined)) return null;
    for (const id of new Set(earlierPromptIds)) {
      const prompt = yield* input.readPrompt(id);
      if (prompt === undefined || !isSlashCommand(prompt)) return null;
    }
  }
  return yield* input.getBinding;
});
