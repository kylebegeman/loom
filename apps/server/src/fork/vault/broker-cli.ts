import * as WorkloadRunner from "./WorkloadRunner.ts";
import * as BrokerHttpClient from "./BrokerHttpClient.ts";
import { Argument, Command, Flag } from "effect/cli";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as BrokerRunner from "./BrokerRunner.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";
const runtime = Layer.mergeAll(BrokerRunner.layer, WorkloadRunner.layer).pipe(
  Layer.provide(
    Layer.mergeAll(
      BrokerHttpClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      BrokerCrypto.layer,
      BrokerIdentity.layer.pipe(Layer.provide(BrokerCrypto.layer)),
    ),
  ),
);
const stateDir = Flag.String("state-dir").pipe(Flag.withDefault(""));
const encodeEffectJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const print = (value: unknown) =>
  encodeEffectJson(value).pipe(Effect.flatMap((encoded) => Console.log(encoded)));
export const brokerCommand = Command.make("broker").pipe(
  Command.withDescription(
    "Run a Loom Vault broker with a private machine identity. Foreground macOS/Linux mode; no boot service is installed.",
  ),
  Command.withSubcommands([
    ...(["check", "release"] as const).map((operation) =>
      Command.make(`workload-${operation}`, {
        stateDir,
        workloadStateDir: Flag.String("workload-state-dir"),
        sessionFile: Argument.String("session-file"),
      }).pipe(
        Command.withHandler(({ stateDir, workloadStateDir, sessionFile }) =>
          Effect.flatMap(WorkloadRunner.WorkloadRunner, (runner) =>
            operation === "check"
              ? runner.check(stateDir, workloadStateDir, sessionFile).pipe(Effect.flatMap(print))
              : runner.release(stateDir, workloadStateDir, sessionFile).pipe(Effect.flatMap(print)),
          ).pipe(Effect.provide(runtime)),
        ),
      ),
    ),
    Command.make("identity", { stateDir }).pipe(
      Command.withHandler(({ stateDir }) =>
        Effect.flatMap(BrokerRunner.BrokerRunner, (runner) => runner.identity(stateDir)).pipe(
          Effect.flatMap(print),
          Effect.provide(runtime),
        ),
      ),
    ),
    Command.make("enroll", {
      stateDir,
      server: Flag.String("server"),
      invitation: Argument.String("invitation-file"),
    }).pipe(
      Command.withHandler(({ stateDir, server, invitation }) =>
        Effect.flatMap(BrokerRunner.BrokerRunner, (runner) =>
          runner.enroll(stateDir, server, invitation),
        ).pipe(Effect.flatMap(print), Effect.provide(runtime)),
      ),
    ),
    Command.make("check", { stateDir }).pipe(
      Command.withHandler(({ stateDir }) =>
        Effect.flatMap(BrokerRunner.BrokerRunner, (runner) => runner.check(stateDir)).pipe(
          Effect.flatMap(print),
          Effect.provide(runtime),
        ),
      ),
    ),
    Command.make("run", { stateDir }).pipe(
      Command.withHandler(({ stateDir }) =>
        Effect.gen(function* () {
          const runner = yield* BrokerRunner.BrokerRunner;
          const iteration = runner.check(stateDir).pipe(
            Effect.flatMap(print),
            Effect.catchTags({
              VaultError: (error) =>
                print({
                  state: error.reason,
                  credentialDelivery: "unsupported",
                  retryAfterMs: 60_000,
                }),
              VaultBrokerError: (error) =>
                ["disabled", "configuration", "local-state", "unsupported"].includes(error.reason)
                  ? Effect.fail(error)
                  : print({
                      state: error.reason,
                      credentialDelivery: "unsupported",
                      retryAfterMs: 60_000,
                    }),
            }),
          );
          return yield* iteration.pipe(Effect.andThen(Effect.sleep("60 seconds")), Effect.forever);
        }).pipe(Effect.provide(runtime)),
      ),
    ),
  ]),
);
