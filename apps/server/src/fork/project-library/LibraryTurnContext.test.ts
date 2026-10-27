import { it } from "@effect/vitest";
import {
  MessageId,
  ProviderDriverKind,
  ProviderThreadId,
  RunAttemptId,
  RunId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { expect, vi } from "vite-plus/test";

import { libraryTurnContextBinding } from "./LibraryTurnContext.ts";

const claude = ProviderThreadId.make("claude-thread");
const codex = ProviderThreadId.make("codex-thread");

interface EarlierTurn {
  readonly prompt: string | null;
  readonly providerThreadId?: ProviderThreadId;
  readonly nativeThreadId?: string;
}

const decide = Effect.fnUntraced(function* (input: {
  readonly prompt: string;
  readonly goalDriver?: boolean;
  readonly nativeId?: string | null;
  readonly earlier?: ReadonlyArray<EarlierTurn>;
}) {
  const earlier = input.earlier ?? [];
  const prompts = new Map(
    earlier.flatMap((turn, index) =>
      turn.prompt === null ? [] : [[MessageId.make(`prompt-${index}`), turn.prompt] as const],
    ),
  );
  const readPrompt = vi.fn((id: MessageId) => {
    const text = prompts.get(id);
    return Effect.succeed(text === undefined ? undefined : { text });
  });
  const getBinding = vi.fn(() => "binding" as const);
  const nativeId = input.nativeId === undefined ? "native-1" : input.nativeId;
  const result = yield* libraryTurnContextBinding({
    projection: {
      providerTurns: earlier.map((turn, index) => ({
        providerThreadId: turn.providerThreadId ?? codex,
        runAttemptId: turn.prompt === null ? null : RunAttemptId.make(`attempt-${index}`),
      })),
      attempts: earlier.map((turn, index) => ({
        id: RunAttemptId.make(`attempt-${index}`),
        runId: RunId.make(`run-${index}`),
        ...(turn.nativeThreadId === undefined ? {} : { nativeThreadId: turn.nativeThreadId }),
      })),
      runs: earlier.map((_, index) => ({
        id: RunId.make(`run-${index}`),
        userMessageId: MessageId.make(`prompt-${index}`),
      })),
    },
    providerThread: {
      id: codex,
      nativeThreadRef:
        nativeId === null
          ? null
          : { driver: ProviderDriverKind.make("codex"), nativeId, strength: "strong" },
    },
    prompt: { text: input.prompt },
    goalDriver: input.goalDriver ?? true,
    getBinding: Effect.sync(getBinding),
    readPrompt,
  });
  return { result, readPrompt, getBinding };
});

it.effect("sends a goal command verbatim without reading anything", () =>
  Effect.gen(function* () {
    const { result, readPrompt, getBinding } = yield* decide({ prompt: "/goal Ship it" });
    expect(result).toBeNull();
    expect(readPrompt).not.toHaveBeenCalled();
    expect(getBinding).not.toHaveBeenCalled();
  }),
);

it.effect("opens a native thread's first turn without reading earlier prompts", () =>
  Effect.gen(function* () {
    expect((yield* decide({ prompt: "Plan the work" })).result).toBe("binding");
    const replaced = yield* decide({
      prompt: "Plan the work",
      nativeId: null,
      earlier: [{ prompt: "Earlier work" }],
    });
    expect(replaced.result).toBe("binding");
    expect(replaced.readPrompt).not.toHaveBeenCalled();
  }),
);

it.effect("carries the context on the first turn after goal turns", () =>
  Effect.gen(function* () {
    const { result, readPrompt } = yield* decide({
      prompt: "Implement the next step",
      earlier: [{ prompt: "/goal Ship it" }, { prompt: "/goal Ship it faster" }],
    });
    expect(result).toBe("binding");
    expect(readPrompt).toHaveBeenCalledTimes(2);
  }),
);

it.effect("reads only the oldest prompt once the native thread has had an ordinary turn", () =>
  Effect.gen(function* () {
    const { result, readPrompt, getBinding } = yield* decide({
      prompt: "Implement the next step",
      earlier: [{ prompt: "Plan the work" }, { prompt: "/goal Ship it" }, { prompt: "More" }],
    });
    expect(result).toBeNull();
    expect(readPrompt).toHaveBeenCalledOnce();
    expect(getBinding).not.toHaveBeenCalled();
  }),
);

it.effect("gives a new provider's native thread the context after its goal turn", () =>
  Effect.gen(function* () {
    const { result } = yield* decide({
      prompt: "Implement the next step",
      earlier: [
        { prompt: "Plan the work", providerThreadId: claude },
        { prompt: "/goal Ship it", providerThreadId: codex },
      ],
    });
    expect(result).toBe("binding");
  }),
);

it.effect("ignores turns an earlier native thread of the same provider received", () =>
  Effect.gen(function* () {
    const { result } = yield* decide({
      prompt: "Implement the next step",
      earlier: [{ prompt: "Plan the work", nativeThreadId: "native-0" }],
    });
    expect(result).toBe("binding");
  }),
);

it.effect("counts a turn whose prompt is unknown as having carried the context", () =>
  Effect.gen(function* () {
    const { result, readPrompt } = yield* decide({
      prompt: "Implement the next step",
      earlier: [{ prompt: null }],
    });
    expect(result).toBeNull();
    expect(readPrompt).not.toHaveBeenCalled();
  }),
);

it.effect("keeps the first-turn rule for drivers that do not read /goal", () =>
  Effect.gen(function* () {
    expect((yield* decide({ prompt: "/goal Ship it", goalDriver: false })).result).toBe("binding");
    const later = yield* decide({
      prompt: "Implement the next step",
      goalDriver: false,
      earlier: [{ prompt: "/goal Ship it" }],
    });
    expect(later.result).toBeNull();
    expect(later.readPrompt).not.toHaveBeenCalled();
  }),
);
