import { AuthSettingsWriteScope } from "@t3tools/contracts";
import {
  ACCOUNT_JOIN_START,
  ACCOUNT_JOIN_STEP,
  ComputerJoinPrompt,
  ComputerJoinProgress,
  LibraryError,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readLiveServerRuntimeState } from "../serverRuntimeState.ts";
import { authLocationFlags, resolveCliAuthConfig } from "./config.ts";

const decodePrompt = Schema.decodeUnknownEffect(ComputerJoinPrompt);
const decodeProgress = Schema.decodeUnknownEffect(ComputerJoinProgress);
const isLibraryError = Schema.is(LibraryError);
const decodeError = Schema.decodeUnknownOption(
  Schema.Struct({ message: Schema.String.check(Schema.isMaxLength(2048)) }),
);
const failed = () =>
  new LibraryError({
    reason: "io",
    detail: "Computer setup could not be confirmed. Run the same join command to resume.",
  });

const join = Effect.fn("cli.joinComputer")(function* (input: {
  readonly libraryUrl: string;
  readonly restart: boolean;
}) {
  const config = yield* ServerConfig.ServerConfig;
  const state = yield* readLiveServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(state))
    return yield* new LibraryError({
      reason: "blocked",
      detail:
        "Loom is not running on this computer. Start its server, then run this join command again.",
    });
  const origin = yield* Effect.try({
    try: () => {
      const url = new URL(state.value.origin);
      if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        throw new Error("Not a local server");
      return url.origin;
    },
    catch: failed,
  });
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const http = yield* HttpClient.HttpClient;
  const issued = yield* Effect.acquireRelease(
    auth.issueSession({
      ttl: Duration.minutes(20),
      scopes: [AuthSettingsWriteScope],
      label: "Loom computer setup",
    }),
    (session) => auth.revokeSession(session.sessionId).pipe(Effect.ignore({ log: true })),
  );
  const post = Effect.fn("cli.joinRequest")(function* (route: string, payload: unknown) {
    const response = yield* http
      .execute(
        HttpClientRequest.post(`${origin}${route}`).pipe(
          HttpClientRequest.setHeader("authorization", `Bearer ${issued.token}`),
          HttpClientRequest.bodyJsonUnsafe(payload),
        ),
      )
      .pipe(Effect.timeout("30 seconds"), Effect.mapError(failed));
    const body = yield* response.json.pipe(Effect.mapError(failed));
    if (response.status !== 200) {
      const message = decodeError(body);
      return yield* new LibraryError({
        reason: "io",
        detail: Option.isSome(message) ? message.value.message : failed().message,
      });
    }
    return body;
  });
  const prompt = yield* post(ACCOUNT_JOIN_START, input).pipe(
    Effect.flatMap(decodePrompt),
    Effect.mapError((error) => (isLibraryError(error) ? error : failed())),
  );
  let progress = yield* post(ACCOUNT_JOIN_STEP, {}).pipe(
    Effect.flatMap(decodeProgress),
    Effect.mapError((error) => (isLibraryError(error) ? error : failed())),
  );
  if (progress === "pending")
    yield* Console.log(
      `On a signed-in phone or computer, open Account > Add computer and enter:\n\n  ${prompt.review.code}\n\nApprove only if the code and computer name match this terminal.\nComputer: ${prompt.review.label}\nAccount: ${prompt.libraryUrl}\nWaiting for approval. Ctrl+C stops waiting; the same command resumes this request.`,
    );
  while (progress === "pending") {
    if ((yield* Clock.currentTimeMillis) >= prompt.review.expiresAt)
      return yield* new LibraryError({
        reason: "request-conflict",
        detail: "The approval code expired. Run the join command again for a new code.",
      });
    yield* Effect.sleep("3 seconds");
    progress = yield* post(ACCOUNT_JOIN_STEP, {}).pipe(
      Effect.flatMap(decodeProgress),
      Effect.mapError((error) => (isLibraryError(error) ? error : failed())),
    );
  }
  if (progress === "denied")
    return yield* new LibraryError({
      reason: "blocked",
      detail: "This computer was not approved. Run join with --restart to request a new code.",
    });
  yield* Console.log("Computer added to your account. Remote access starts automatically.");
});

export const joinCommand = Command.make("join", {
  ...authLocationFlags,
  libraryUrl: Argument.String("library-url").pipe(
    Argument.withDescription("Your Loom account's HTTPS Library address."),
  ),
  restart: Flag.Boolean("restart").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Start a new approval request instead of resuming the saved one."),
  ),
}).pipe(
  Command.withDescription(
    "Add this computer to your Loom account with approval from a signed-in device.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      return yield* join(flags).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            EnvironmentAuth.layerRuntime.pipe(
              Layer.provide(ServerConfig.layer(config)),
              Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
            ),
            ServerConfig.layer(config),
            FetchHttpClient.layer,
          ),
        ),
      );
    }),
  ),
);
