import * as BrokerService from "./BrokerService.ts";
import * as BrokerDaemon from "./BrokerDaemon.ts";
import * as ProcessRunner from "../../processRunner.ts";
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
  Layer.provideMerge(
    Layer.mergeAll(
      BrokerHttpClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      BrokerCrypto.layer,
      BrokerIdentity.layer.pipe(Layer.provide(BrokerCrypto.layer)),
    ),
  ),
);
const daemonRuntime = BrokerDaemon.layer.pipe(Layer.provideMerge(runtime));
const serviceRuntime = BrokerService.layer.pipe(
  Layer.provide(Layer.mergeAll(daemonRuntime, ProcessRunner.layer)),
);
const stateDir = Flag.String("state-dir").pipe(Flag.withDefault(""));
const encodeEffectJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const print = (value: unknown) =>
  encodeEffectJson(value).pipe(Effect.flatMap((encoded) => Console.log(encoded)));
export const brokerCommand = Command.make("broker").pipe(
  Command.withDescription(
    "Run a Loom Vault broker with a private machine identity. Foreground and managed macOS/Linux user services.",
  ),
  Command.withSubcommands([
    Command.make("service").pipe(
      Command.withDescription(
        "Manage the broker on this host. Installation does not start it; macOS requires login and Linux boot continuity requires systemd linger.",
      ),
      Command.withSubcommands([
        Command.make("plan", { stateDir, executable: Flag.String("executable") }).pipe(
          Command.withHandler(({ stateDir, executable }) =>
            Effect.flatMap(BrokerService.BrokerService, (service) =>
              service.plan(stateDir, executable),
            ).pipe(Effect.flatMap(print), Effect.provide(serviceRuntime)),
          ),
        ),
        Command.make("install", { stateDir, executable: Flag.String("executable") }).pipe(
          Command.withHandler(({ stateDir, executable }) =>
            Effect.flatMap(BrokerService.BrokerService, (service) =>
              service.manage(stateDir, "install", executable),
            ).pipe(Effect.flatMap(print), Effect.provide(serviceRuntime)),
          ),
        ),
        Command.make("status", { stateDir }).pipe(
          Command.withHandler(({ stateDir }) =>
            Effect.flatMap(BrokerService.BrokerService, (service) => service.status(stateDir)).pipe(
              Effect.flatMap(print),
              Effect.provide(serviceRuntime),
            ),
          ),
        ),
        ...(["start", "stop", "restart", "uninstall"] as const).map((action) =>
          Command.make(action, { stateDir }).pipe(
            Command.withHandler(({ stateDir }) =>
              Effect.flatMap(BrokerService.BrokerService, (service) =>
                service.manage(stateDir, action),
              ).pipe(Effect.flatMap(print), Effect.provide(serviceRuntime)),
            ),
          ),
        ),
      ]),
    ),
    Command.make("ssh-exec", {
      stateDir,
      workloadStateDir: Flag.String("workload-state-dir"),
      sessionFile: Argument.String("session-file"),
      commandFile: Argument.String("command-file"),
    }).pipe(
      Command.withDescription(
        "Execute a bounded command from the Loom server using a pinned host and Vault SSH key. Remote effects may survive cancellation; retries require a fresh signed request.",
      ),
      Command.withHandler(({ stateDir, workloadStateDir, sessionFile, commandFile }) =>
        Effect.flatMap(WorkloadRunner.WorkloadRunner, (runner) =>
          runner.ssh(stateDir, workloadStateDir, sessionFile, commandFile),
        ).pipe(Effect.flatMap(print), Effect.provide(runtime)),
      ),
    ),
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
        Effect.flatMap(BrokerDaemon.BrokerDaemon, (daemon) => daemon.run(stateDir)).pipe(
          Effect.provide(daemonRuntime),
        ),
      ),
    ),
  ]),
);
