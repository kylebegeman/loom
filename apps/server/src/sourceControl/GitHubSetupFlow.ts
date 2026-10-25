import { GitHubSetupFlowError, type GitHubSetupState } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Setup from "./GitHubHostSetup.ts";

const isHostSetupError = Schema.is(Setup.GitHubHostSetupError);

const active = (state: GitHubSetupState) =>
  ["checking", "installing", "waiting", "configuring"].includes(state.phase);

/** One host-owned setup survives client reconnects. Codes disappear when the request finishes. */
export class GitHubSetupFlow extends Context.Service<
  GitHubSetupFlow,
  {
    readonly start: (input: { readonly requestId: string }) => Effect.Effect<GitHubSetupState>;
    readonly cancel: (input: {
      readonly requestId: string;
    }) => Effect.Effect<GitHubSetupState, GitHubSetupFlowError>;
    readonly snapshot: Effect.Effect<GitHubSetupState>;
    readonly changes: Stream.Stream<GitHubSetupState>;
  }
>()("t3/sourceControl/GitHubSetupFlow") {}

export const make = Effect.gen(function* () {
  const setup = yield* Setup.GitHubHostSetup;
  const scope = yield* Effect.scope;
  const gate = yield* Semaphore.make(1);
  const state = yield* SubscriptionRef.make<GitHubSetupState>({
    requestId: null,
    phase: "idle",
    deviceCode: null,
    message: null,
  });
  let job: Fiber.Fiber<void> | undefined;
  const start = (input: { readonly requestId: string }) =>
    gate
      .withPermit(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state);
          if (active(current) || current.requestId === input.requestId) return current;
          const initial: GitHubSetupState = {
            requestId: input.requestId,
            phase: "checking",
            deviceCode: null,
            message: null,
          };
          yield* SubscriptionRef.set(state, initial);
          const work = setup
            .setup({
              interactive: true,
              onProgress: (progress) =>
                SubscriptionRef.set(state, {
                  ...initial,
                  phase: progress.phase,
                  deviceCode: progress.deviceCode ?? null,
                }),
            })
            .pipe(
              Effect.exit,
              Effect.flatMap((result) => {
                if (Exit.isSuccess(result))
                  return SubscriptionRef.set(state, {
                    ...initial,
                    phase: "ready",
                  } satisfies GitHubSetupState);
                if (Cause.hasInterrupts(result.cause)) return Effect.void;
                const error = Cause.findErrorOption(result.cause);
                const message =
                  Option.isSome(error) && isHostSetupError(error.value)
                    ? error.value.reason === "sign-in-required"
                      ? "GitHub approval expired or was not completed. Start setup again to request a new code."
                      : error.value.message
                    : "GitHub setup could not finish. Try again.";
                return SubscriptionRef.set(state, { ...initial, phase: "error", message });
              }),
            );
          job = yield* work.pipe(Effect.forkIn(scope));
          return initial;
        }),
      )
      .pipe(Effect.uninterruptible);
  const cancel = (input: { readonly requestId: string }) =>
    gate
      .withPermit(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state);
          if (current.requestId !== input.requestId) return yield* new GitHubSetupFlowError();
          if (!active(current)) return current;
          if (job) yield* Fiber.interrupt(job);
          const cancelled: GitHubSetupState = {
            ...current,
            phase: "cancelled",
            deviceCode: null,
            message: "Setup stopped. Any saved GitHub authorization is kept.",
          };
          yield* SubscriptionRef.set(state, cancelled);
          return cancelled;
        }),
      )
      .pipe(Effect.uninterruptible);
  // fork: github-host-setup
  const snapshot = gate.withPermit(
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state);
      if (current.phase !== "idle" || current.message !== null) return current;
      const checked = yield* setup.status().pipe(
        Effect.map((status): GitHubSetupState => ({
          ...current,
          phase: status.state === "signed-in" || status.state === "git-ready" ? "ready" : "idle",
          message:
            status.state === "signed-in" || status.state === "git-ready"
              ? `GitHub signed in${status.account ? ` as ${status.account}` : ""}. Run setup to verify Git credential configuration.`
              : status.state === "missing-cli"
                ? "GitHub CLI is missing. Start setup to install it and sign in."
                : "GitHub sign-in required on this computer. Start setup to connect.",
        })),
        Effect.catchTags({
          GitHubHostSetupError: (error) =>
            Effect.succeed({ ...current, phase: "error" as const, message: error.message }),
        }),
      );
      yield* SubscriptionRef.set(state, checked);
      return checked;
    }),
  );
  return GitHubSetupFlow.of({
    start,
    cancel,
    // fork: github-host-setup
    snapshot,
    changes: Stream.unwrap(snapshot.pipe(Effect.as(SubscriptionRef.changes(state)))),
  });
});
export const layer = Layer.effect(GitHubSetupFlow, make);
