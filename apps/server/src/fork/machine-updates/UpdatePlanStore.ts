import { UpdatePlan, UpdatePlanError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";

const MAX_PLAN_BYTES = 4096;
const json = Schema.fromJsonString(UpdatePlan);

export class UpdatePlanStore extends Context.Service<
  UpdatePlanStore,
  {
    readonly read: Effect.Effect<UpdatePlan | null, UpdatePlanError>;
    readonly write: (plan: UpdatePlan) => Effect.Effect<void, UpdatePlanError>;
  }
>()("t3/fork/machine-updates/UpdatePlanStore") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const directory = path.join(config.stateDir, "fork", "machine-updates");
  const target = path.join(directory, "plan.json");
  const read = Effect.gen(function* () {
    if (!(yield* fs.exists(target))) return null;
    const info = yield* fs.stat(target);
    if (info.size > BigInt(MAX_PLAN_BYTES)) return yield* new UpdatePlanError({ reason: "read" });
    return yield* Schema.decodeEffect(json)(yield* fs.readFileString(target));
  }).pipe(Effect.mapError((cause) => new UpdatePlanError({ reason: "read", cause })));
  const write = Effect.fn("UpdatePlanStore.write")(
    function* (plan: UpdatePlan) {
      const contents = yield* Schema.encodeEffect(json)(plan);
      yield* fs.makeDirectory(directory, { recursive: true });
      const temporary = path.join(directory, `${yield* crypto.randomUUIDv4()}.pending`);
      yield* Effect.gen(function* () {
        yield* fs.writeFileString(temporary, contents, { mode: 0o600, flag: "wx" });
        yield* Effect.scoped(fs.open(temporary).pipe(Effect.flatMap((file) => file.sync)));
        yield* fs.rename(temporary, target);
        yield* Effect.scoped(fs.open(directory).pipe(Effect.flatMap((file) => file.sync)));
      }).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
    },
    Effect.mapError((cause) => new UpdatePlanError({ reason: "write", cause })),
  );
  return UpdatePlanStore.of({ read, write });
});

export const layer = Layer.effect(UpdatePlanStore, make);
