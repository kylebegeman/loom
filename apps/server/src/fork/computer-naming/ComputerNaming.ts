import {
  ComputerName,
  ComputerNamingError,
  ComputerRenameRequest,
  type ComputerNamingState,
} from "@t3tools/contracts/fork";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ServerConfig from "../../config.ts";
import { resolveServerEnvironmentLabel } from "../../environment/ServerEnvironmentLabel.ts";

export class ComputerNaming extends Context.Service<
  ComputerNaming,
  {
    readonly current: Effect.Effect<ComputerNamingState>;
    readonly changes: Stream.Stream<ComputerNamingState>;
    readonly rename: (input: {
      readonly name: string | null;
    }) => Effect.Effect<ComputerNamingState, ComputerNamingError>;
  }
>()("t3/fork/computer-naming/ComputerNaming") {}

const isComputerName = Schema.is(ComputerName);
const persistedName = Schema.fromJsonString(ComputerRenameRequest);
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const settingsPath = path.join(config.stateDir, "fork", "computer-naming", "settings.json");
  const defaultLabel = yield* resolveServerEnvironmentLabel({
    cwdBaseName: path.basename(config.cwd),
  });
  const saved = yield* fs.readFileString(settingsPath).pipe(
    Effect.flatMap(Schema.decodeEffect(persistedName)),
    Effect.catchIf(
      (cause) => "reason" in cause && cause.reason._tag === "NotFound",
      () => Effect.succeed({ name: null }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Ignoring unreadable computer name settings", {
        path: settingsPath,
        cause,
      }).pipe(Effect.as({ name: null })),
    ),
  );
  const state = yield* SubscriptionRef.make<ComputerNamingState>({
    name: saved.name,
    label: saved.name ?? defaultLabel,
    defaultLabel,
  });
  const lock = yield* Semaphore.make(1);
  const rename = Effect.fn("ComputerNaming.rename")(function* (input: {
    readonly name: string | null;
  }) {
    const name = input.name === null ? null : input.name.trim();
    if (name !== null && !isComputerName(name)) {
      return yield* new ComputerNamingError({ operation: "validate" });
    }
    const current = yield* SubscriptionRef.get(state);
    if (current.name === name) return current;
    const contents = yield* Schema.encodeEffect(persistedName)({ name }).pipe(
      Effect.mapError((cause) => new ComputerNamingError({ operation: "validate", cause })),
    );
    yield* writeFileStringAtomically({
      filePath: settingsPath,
      contents: `${contents}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new ComputerNamingError({ operation: "write", cause })),
    );
    const next = { name, label: name ?? defaultLabel, defaultLabel };
    yield* SubscriptionRef.set(state, next);
    return next;
  }, lock.withPermit);
  return ComputerNaming.of({
    current: SubscriptionRef.get(state),
    changes: SubscriptionRef.changes(state),
    rename,
  });
});
export const layer = Layer.effect(ComputerNaming, make);
