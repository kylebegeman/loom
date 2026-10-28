import {
  SkillRegistryError,
  SkillRegistryInstall,
  SkillRegistrySource,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as ServerConfig from "../../config.ts";
import { fail } from "./SkillFiles.ts";

const StoredInstall = Schema.Struct({
  ...SkillRegistryInstall.fields,
  removedAt: Schema.NullOr(Schema.String),
});
const State = Schema.Struct({
  version: Schema.Literal(1),
  sources: Schema.Array(SkillRegistrySource),
  installs: Schema.Array(StoredInstall),
});
export type SkillState = typeof State.Type;
const isSkillError = Schema.is(SkillRegistryError);
const codec = Schema.fromJsonString(State);
const decode = Schema.decodeUnknownEffect(codec);
const encode = Schema.encodeEffect(codec);
export class SkillStore extends Context.Service<
  SkillStore,
  {
    readonly root: string;
    readonly read: Effect.Effect<SkillState, SkillRegistryError>;
    readonly update: (
      change: (state: SkillState) => SkillState,
    ) => Effect.Effect<SkillState, SkillRegistryError>;
  }
>()("t3/fork/skill-registry/SkillStore") {}
const make = Effect.gen(function* () {
  const runtime = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const root = path.join(config.stateDir, "fork", "skill-registry");
  const file = path.join(root, "registry.json");
  const lock = yield* Semaphore.make(1);
  const read = Effect.fn("SkillStore.read")(function* () {
    if (!(yield* fs.exists(file)))
      return { version: 1 as const, sources: [], installs: [] } satisfies SkillState;
    return yield* fs.readFileString(file).pipe(
      Effect.flatMap(decode),
      Effect.mapError(() =>
        fail(
          "io",
          "Skill registry metadata could not be read. Restore its registry.json before making changes.",
        ),
      ),
    );
  });
  const update = Effect.fn("SkillStore.update")(function* (
    change: (state: SkillState) => SkillState,
  ) {
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const next = change(yield* read());
        yield* writeFileStringAtomically({ filePath: file, contents: yield* encode(next) }).pipe(
          Effect.provideContext(runtime),
        );
        return next;
      }),
    );
  });
  return SkillStore.of({
    root,
    read: read().pipe(
      Effect.mapError(() => fail("io", "Skill registry metadata could not be read.")),
    ),
    update: Effect.fn("SkillStore.save")((change) =>
      update(change).pipe(
        Effect.mapError((cause) =>
          isSkillError(cause) ? cause : fail("io", "Skill registry metadata could not be saved."),
        ),
      ),
    ),
  });
});
export const layer = Layer.effect(SkillStore, make);
