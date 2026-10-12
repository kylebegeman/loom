// @effect-diagnostics nodeBuiltinImport:off - Process identity is sent to the optional local Mini admission helper.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProcessRunner from "../processRunner.ts";

export class NativeWorkloadResourceError extends Schema.TaggedError<NativeWorkloadResourceError>()(
  "NativeWorkloadResourceError",
  {
    stage: Schema.Literals(["configuration", "helper", "reply"]),
    helperCode: Schema.optional(Schema.NullOr(Schema.Int)),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return "The shared worker resource pool is unavailable. Check Mini storage, queue configuration and the Loom service slice.";
  }
}
export class NativeWorkloadResources extends Context.Service<
  NativeWorkloadResources,
  {
    readonly enabled: boolean;
    readonly acquire: (
      sessionId: string,
      turnKey: string,
      workspace: string | null,
    ) => Effect.Effect<void, NativeWorkloadResourceError>;
    readonly releaseIdle: (
      sessionId: string,
      busyTurns: ReadonlySet<string>,
    ) => Effect.Effect<void, NativeWorkloadResourceError>;
    readonly releaseSession: (
      sessionId: string,
    ) => Effect.Effect<void, NativeWorkloadResourceError>;
  }
>()("t3/orchestration-v2/NativeWorkloadResources") {}

const Reply = Schema.Struct({
  accepted: Schema.Boolean,
  reason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(80))),
});
const Header = Schema.Struct({
  schema_version: Schema.Literal(1),
  action: Schema.Literals(["native-acquire", "native-release"]),
  reservation_id: Schema.String,
  owner_pid: Schema.Int,
  workspace: Schema.optional(Schema.String),
});
const encodeHeader = Schema.encodeSync(Schema.fromJsonString(Header));
const decodeReply = Schema.decodeUnknownEffect(Schema.fromJsonString(Reply));
const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const runner = yield* ProcessRunner.ProcessRunner;
  const enabled =
    env.T3CODE_MINI_RESOURCE_ACCOUNTING !== undefined &&
    env.T3CODE_MINI_RESOURCE_ACCOUNTING !== "0";
  const owner = NodeCrypto.randomUUID();
  const reservations = new Map<string, Map<string, string>>();
  const lock = yield* Semaphore.make(1);
  const idFor = (sessionId: string, turnKey: string) =>
    NodeCrypto.createHash("sha256")
      .update(owner + "\n" + sessionId + "\n" + turnKey)
      .digest("hex");
  const request = Effect.fn("NativeWorkloadResources.request")(function* (
    action: "native-acquire" | "native-release",
    id: string,
    workspace?: string,
  ) {
    if (
      platform !== "linux" ||
      (env.T3CODE_MINI_RESOURCE_ACCOUNTING !== undefined &&
        !["0", "1"].includes(env.T3CODE_MINI_RESOURCE_ACCOUNTING))
    )
      return yield* new NativeWorkloadResourceError({ stage: "configuration" });
    const output = yield* runner
      .run({
        command: "/usr/local/bin/loom-mini",
        args: ["jobs", "rpc"],
        // Installed administration helpers must not import code from the project cwd.
        spawnCwd: "/",
        stdin:
          encodeHeader({
            schema_version: 1,
            action,
            reservation_id: id,
            owner_pid: process.pid,
            ...(workspace === undefined ? {} : { workspace }),
          }) + "\n",
        timeout: "10 seconds",
        maxOutputBytes: 65536,
      })
      .pipe(
        Effect.mapError((cause) => new NativeWorkloadResourceError({ stage: "helper", cause })),
      );
    if (output.code !== 0 || output.timedOut || output.stdoutTruncated || output.stdoutInvalidUtf8)
      return yield* new NativeWorkloadResourceError({
        stage: "helper",
        helperCode: output.code,
        cause: { stderr: output.stderr },
      });
    return yield* decodeReply(output.stdout).pipe(
      Effect.mapError((cause) => new NativeWorkloadResourceError({ stage: "reply", cause })),
    );
  });
  const release = Effect.fn("NativeWorkloadResources.release")(function* (
    sessionId: string,
    keep: ReadonlySet<string>,
  ) {
    if (!enabled) return;
    yield* lock.withPermit(
      Effect.gen(function* () {
        const entries = reservations.get(sessionId);
        if (!entries) return;
        for (const [key, id] of entries) {
          if (keep.has(key)) continue;
          const reply = yield* request("native-release", id);
          if (!reply.accepted)
            return yield* new NativeWorkloadResourceError({ stage: "configuration" });
          entries.delete(key);
        }
        if (entries.size === 0) reservations.delete(sessionId);
      }),
    );
  });
  const acquire = Effect.fn("NativeWorkloadResources.acquire")(function* (
    sessionId: string,
    turnKey: string,
    workspace: string | null,
  ) {
    if (!enabled) return;
    if (!workspace) return yield* new NativeWorkloadResourceError({ stage: "configuration" });
    const id = idFor(sessionId, turnKey);
    yield* lock.withPermit(
      Effect.sync(() => {
        const entries = reservations.get(sessionId) ?? new Map<string, string>();
        entries.set(turnKey, id);
        reservations.set(sessionId, entries);
      }),
    );
    yield* Effect.gen(function* () {
      while (!(yield* request("native-acquire", id, workspace)).accepted)
        yield* Effect.sleep("2 seconds");
    }).pipe(
      Effect.onExit((exit) => {
        if (exit._tag === "Success") return Effect.void;
        // The provider has not been invoked yet, so interrupted admission can
        // release even if the helper accepted a request whose reply was lost.
        return lock
          .withPermit(
            Effect.gen(function* () {
              const reply = yield* request("native-release", id);
              if (!reply.accepted)
                return yield* new NativeWorkloadResourceError({ stage: "configuration" });
              const entries = reservations.get(sessionId);
              entries?.delete(turnKey);
              if (entries?.size === 0) reservations.delete(sessionId);
            }),
          )
          .pipe(Effect.catchCause(() => Effect.logWarning("mini.native-admission-cleanup-failed")));
      }),
    );
  });
  return NativeWorkloadResources.of({
    enabled,
    acquire,
    releaseIdle: release,
    releaseSession: (id) => release(id, new Set()),
  });
});
export const layer = Layer.effect(NativeWorkloadResources, make);
