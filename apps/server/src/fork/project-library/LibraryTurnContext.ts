import {
  parseGoalCommand,
  type MessageId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

type Prompt = Parameters<typeof parseGoalCommand>[0];
type Projection = OrchestrationV2ThreadProjection;

/**
 * The binding whose context opens a native thread's first turn, or null. Codex and Claude read
 * /goal only at the start of a prompt, so their goal turns go verbatim and the next turn carries
 * it. The turn-start projection lacks earlier prompts, so they are read oldest first.
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
  readonly goalDriver: boolean;
  readonly getBinding: Effect.Effect<Binding | null, BindingError>;
  readonly readPrompt: (id: MessageId) => Effect.Effect<Prompt | undefined, ReadError>;
}) {
  const isGoal = (prompt: Prompt) => input.goalDriver && parseGoalCommand(prompt) !== null;
  if (isGoal(input.prompt)) return null;
  const native = input.providerThread.nativeThreadRef;
  const earlierPromptIds =
    native === null
      ? []
      : input.projection.providerTurns.flatMap((turn) => {
          if (turn.providerThreadId !== input.providerThread.id) return [];
          const attempt = input.projection.attempts.find((entry) => entry.id === turn.runAttemptId);
          // Attempts recorded before nativeThreadId existed belong to the current native thread.
          if (attempt?.nativeThreadId !== undefined && attempt.nativeThreadId !== native.nativeId)
            return [];
          return [
            input.projection.runs.find((entry) => entry.id === attempt?.runId)?.userMessageId,
          ];
        });
  // A turn whose prompt cannot be found counts as having carried the context, as before /goal.
  if (
    earlierPromptIds.length > 0 &&
    (!input.goalDriver || !earlierPromptIds.every(Predicate.isNotUndefined))
  )
    return null;
  for (const id of new Set(earlierPromptIds.filter(Predicate.isNotUndefined))) {
    const prompt = yield* input.readPrompt(id);
    if (prompt === undefined || !isGoal(prompt)) return null;
  }
  return yield* input.getBinding;
});
