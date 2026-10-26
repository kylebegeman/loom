import { BackgroundCheckFailure } from "@t3tools/contracts/fork";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import type { TailscaleServeClaimError } from "@t3tools/tailscale";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../../config.ts";

type BackgroundCheck =
  | "tailscale-cli"
  | "tailscale-serve"
  | "directory-reporting"
  | "library-renewal"
  | "preview-registration"
  | "push-readiness";

/** A failure that only repeats is saved this often, so a check failing every 30 seconds rarely writes. */
const REPEAT_SAVE_MS = 15 * 60_000;

export class BackgroundChecks extends Context.Service<
  BackgroundChecks,
  {
    /** `message` is shown and saved as is, so it must not carry secrets, tokens or payloads. */
    readonly fail: (check: BackgroundCheck, message: string) => Effect.Effect<void>;
    /** The check passed, or no longer runs. */
    readonly clear: (check: BackgroundCheck) => Effect.Effect<void>;
    readonly failures: Effect.Effect<ReadonlyArray<BackgroundCheckFailure>>;
  }
>()("t3/fork/background-checks/BackgroundChecks") {}

const NOT_RECORDED = BackgroundChecks.of({
  fail: () => Effect.void,
  clear: () => Effect.void,
  failures: Effect.succeed([]),
});

/** Checks run in servers and tests that may not provide the record. */
export const recorder = Effect.serviceOption(BackgroundChecks).pipe(
  Effect.map(Option.getOrElse(() => NOT_RECORDED)),
);

const persisted = Schema.fromJsonString(Schema.Array(BackgroundCheckFailure));
const isoAt = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

/** The Tailscale package's messages name only commands, ports, exit codes and serve targets. */
export const tailscaleFailure = (error: TailscaleServeClaimError): string => {
  if (error._tag !== "TailscaleCliUnavailableError") return error.message;
  const denied = error.attempts.filter((attempt) => attempt.code === "EACCES");
  return denied.length === 0
    ? error.message
    : `Loom is not allowed to run the Tailscale CLI (${denied.map((attempt) => attempt.executable).join(", ")}). Check its file permissions.`;
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const file = path.join(config.stateDir, "fork", "background-checks", "failures.json");
  const saved = yield* fs.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeEffect(persisted)),
    Effect.catchIf(
      (cause) => "reason" in cause && cause.reason._tag === "NotFound",
      () => Effect.succeed([]),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Ignoring unreadable background check failures", {
        path: file,
        cause,
      }).pipe(Effect.as([])),
    ),
  );
  const recorded = new Map(saved.map((failure) => [failure.check, failure]));
  const lock = yield* Semaphore.make(1);
  let savedAt = 0;
  let unsaved = false;

  // Runs only while holding `lock`. A failed save stays unsaved, so the next one retries it.
  const save = Effect.gen(function* () {
    const contents = yield* Schema.encodeEffect(persisted)([...recorded.values()]);
    yield* writeFileStringAtomically({ filePath: file, contents: `${contents}\n` });
    savedAt = yield* Clock.currentTimeMillis;
    unsaved = false;
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.catch((cause) =>
      Effect.logWarning("Could not save background check failures", { path: file, cause }),
    ),
  );

  const fail = Effect.fn("BackgroundChecks.fail")(function* (
    check: BackgroundCheck,
    message: string,
  ) {
    yield* lock.withPermit(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const earlier = recorded.get(check);
        recorded.set(
          check,
          earlier === undefined
            ? { check, message, firstSeenAt: isoAt(now), lastSeenAt: isoAt(now), count: 1 }
            : { ...earlier, message, lastSeenAt: isoAt(now), count: earlier.count + 1 },
        );
        unsaved = true;
        if (earlier === undefined || earlier.message !== message || now - savedAt >= REPEAT_SAVE_MS)
          yield* save;
      }),
    );
  });

  // Passing checks run often, so this takes the lock only when there is a failure to drop.
  const clear = (check: BackgroundCheck) =>
    Effect.suspend(() =>
      recorded.has(check)
        ? lock.withPermit(
            Effect.suspend(() => {
              if (!recorded.delete(check)) return Effect.void;
              unsaved = true;
              return save;
            }),
          )
        : Effect.void,
    );

  yield* Effect.addFinalizer(() =>
    lock.withPermit(Effect.suspend(() => (unsaved ? save : Effect.void))),
  );

  return BackgroundChecks.of({
    fail,
    clear,
    failures: Effect.sync(() =>
      [...recorded.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    ),
  });
});

export const layer = Layer.effect(BackgroundChecks, make);
