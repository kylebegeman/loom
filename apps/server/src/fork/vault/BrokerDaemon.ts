import { VaultBrokerError, VaultError } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Option from "effect/Option";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerRunner from "./BrokerRunner.ts";

const RENEW_INTERVAL_MS = 60_000;
const Report = Schema.Struct({
  protocol: Schema.Literal(1),
  machineId: Schema.String,
  environmentId: Schema.String,
  at: Schema.Int,
  state: Schema.Union([
    Schema.Literals(["online", "stopped"]),
    VaultError.fields.reason,
    VaultBrokerError.fields.reason,
  ]),
  source: Schema.Literals(["heartbeat", "backend", "broker", "process"]),
  leaseUntil: Schema.NullOr(Schema.Int),
  retryAfterMs: Schema.NullOr(Schema.Int),
});
type Report = typeof Report.Type;
/** A non-zero exit, so the service manager relaunches the broker from the updated install. */
export class BrokerExecutableReplaced extends Schema.TaggedError<BrokerExecutableReplaced>()(
  "BrokerExecutableReplaced",
  {},
) {
  override readonly [Runtime.errorExitCode] = 75;

  override get message() {
    return "The Loom executable running this broker was replaced or removed. Exiting so the service restarts it from the current install.";
  }
}
const decodeReport = Schema.decodeEffect(Schema.fromJsonString(Report));
const encodeReport = Schema.encodeEffect(Schema.fromJsonString(Report));
export class BrokerDaemon extends Context.Service<
  BrokerDaemon,
  {
    readonly run: (
      directory: string,
    ) => Effect.Effect<void, VaultBrokerError | BrokerExecutableReplaced>;
    readonly inspect: (directory: string) => Effect.Effect<
      {
        readonly custody: "owner-only-file";
        readonly localUnlock: "not-required";
        readonly backendUnlock: "managed-on-control-plane";
        readonly report: Report | null;
        readonly fresh: boolean;
      },
      VaultBrokerError
    >;
  }
>()("t3/fork/vault/BrokerDaemon") {}
const make = Effect.gen(function* () {
  const identity = yield* BrokerIdentity.BrokerIdentity,
    runner = yield* BrokerRunner.BrokerRunner,
    fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    uid = yield* HostProcess.UserId;
  const run = Effect.fn("BrokerDaemon.run")(function* (directory: string) {
    // Service startup never creates or replaces an enrollment identity.
    const key = yield* identity.read(directory, false),
      connection = yield* identity.connection(directory),
      executable = yield* HostProcess.ExecutablePath;
    // An app update swaps the bundle under a running process, which would otherwise keep
    // serving the old release from deleted files until the next login.
    const executableIdentity = fs.stat(executable).pipe(
      Effect.map((info) =>
        [info.dev, Option.getOrNull(info.ino), Option.getOrNull(info.mtime)?.getTime()].join(":"),
      ),
      Effect.option,
    );
    const started = yield* executableIdentity;
    const persist = Effect.fnUntraced(function* (report: Report) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* fs.makeTempFileScoped({
            directory: key.directory,
            prefix: ".status-",
          });
          yield* fs.chmod(temporary, 0o600);
          const json = yield* encodeReport(report);
          yield* fs.writeFileString(temporary, json);
          yield* fs.rename(temporary, path.join(key.directory, "status.json"));
          return json;
        }),
      ).pipe(
        Effect.flatMap(Console.log),
        Effect.mapError(() => new VaultBrokerError({ reason: "local-state" })),
      );
    });
    const report = (
      state: Report["state"],
      source: Report["source"],
      leaseUntil: number | null,
      retry: boolean,
    ) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((at) =>
          persist({
            protocol: 1,
            machineId: connection.machineId,
            environmentId: connection.environmentId,
            at,
            state,
            source,
            leaseUntil,
            retryAfterMs: retry ? RENEW_INTERVAL_MS : null,
          }),
        ),
      );
    yield* Effect.gen(function* () {
      while (true) {
        if (
          Option.isSome(started) &&
          Option.getOrNull(yield* executableIdentity) !== started.value
        ) {
          yield* report("stopped", "process", null, false);
          return yield* new BrokerExecutableReplaced();
        }
        const outcome = yield* runner.check(key.directory).pipe(Effect.result);
        if (outcome._tag === "Success") {
          yield* report("online", "heartbeat", outcome.success.leaseUntil, true);
        } else {
          const error = outcome.failure;
          const terminal =
            error._tag === "VaultBrokerError" &&
            ["disabled", "configuration", "local-state", "unsupported", "invalid-proof"].includes(
              error.reason,
            );
          yield* report(
            error.reason,
            error._tag === "VaultError" ? "backend" : "broker",
            null,
            !terminal,
          );
          // A successful exit prevents the manager from restarting a permanently denied identity.
          if (terminal) return;
        }
        yield* Effect.sleep(RENEW_INTERVAL_MS);
      }
    }).pipe(
      Effect.onInterrupt(() => report("stopped", "process", null, false).pipe(Effect.ignore)),
    );
  });
  const inspect = Effect.fn("BrokerDaemon.inspect")(function* (directory: string) {
    const key = yield* identity.read(directory, false),
      connection = yield* identity.connection(directory),
      file = path.join(key.directory, "status.json");
    const report = yield* Effect.gen(function* () {
      const info = yield* fs.stat(file);
      if (
        info.type !== "File" ||
        Number(info.size) > 4096 ||
        (info.mode & 0o077) !== 0 ||
        (uid !== undefined && Option.getOrNull(info.uid) !== uid) ||
        Option.isSome(yield* fs.readLink(file).pipe(Effect.option))
      )
        return null;
      return yield* decodeReport(yield* fs.readFileString(file));
    }).pipe(Effect.orElseSucceed(() => null));
    const now = yield* Clock.currentTimeMillis;
    const matched =
      report &&
      report.machineId === connection.machineId &&
      report.environmentId === connection.environmentId
        ? report
        : null;
    return {
      custody: "owner-only-file" as const,
      localUnlock: "not-required" as const,
      backendUnlock: "managed-on-control-plane" as const,
      report: matched,
      fresh:
        matched !== null &&
        matched.at <= now &&
        now - matched.at < 120_000 &&
        (matched.state !== "online" || (matched.leaseUntil !== null && matched.leaseUntil > now)),
    };
  });
  return BrokerDaemon.of({ run, inspect });
});
export const layer = Layer.effect(BrokerDaemon, make);
