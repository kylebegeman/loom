import {
  ProjectProfileError,
  type VarlockAvailability,
  type VarlockValidation,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as ProcessRunner from "../../processRunner.ts";
import { extractVarlockErrors } from "./varlock.ts";

export class VarlockRunner extends Context.Service<
  VarlockRunner,
  {
    readonly detect: Effect.Effect<VarlockAvailability>;
    readonly validate: (
      root: string,
      schemaPath?: string,
    ) => Effect.Effect<VarlockValidation, ProjectProfileError>;
  }
>()("t3/fork/project-profiles/VarlockRunner") {}
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const env = { VARLOCK_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" };
  let cached: { at: number; value: VarlockAvailability } | null = null;
  const detect = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (cached && now - cached.at < 60_000) return cached.value;
    const value = yield* runner
      .run({
        command: "varlock",
        args: ["--version"],
        env,
        timeout: "10 seconds",
        maxOutputBytes: 4000,
      })
      .pipe(
        Effect.map((result): VarlockAvailability => {
          const version = /\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/.exec(result.stdout)?.[0];
          return result.code === 0 && version
            ? { _tag: "available", version }
            : { _tag: "missing", installHint: "npm install -g varlock@1.20.0" };
        }),
        Effect.catch(() =>
          Effect.succeed<VarlockAvailability>({
            _tag: "missing",
            installHint: "npm install -g varlock@1.20.0",
          }),
        ),
      );
    cached = { at: now, value };
    return value;
  });
  const validate = Effect.fn("VarlockRunner.validate")(function* (
    root: string,
    schemaPath = ".env.schema",
  ) {
    if ((yield* detect)._tag === "missing")
      return yield* new ProjectProfileError({ reason: "varlock-missing" });
    const started = yield* Clock.currentTimeMillis;
    const result = yield* runner
      .run({
        command: "varlock",
        args: [
          "load",
          "--format",
          "json-full",
          "--agent",
          "--compact",
          ...(schemaPath === ".env.schema" ? [] : ["--path", schemaPath]),
        ],
        cwd: root,
        env,
        timeout: "60 seconds",
        maxOutputBytes: 2_000_000,
      })
      .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "varlock-failed" })));
    if (result.code !== 0 && result.code !== 1)
      return yield* new ProjectProfileError({ reason: "varlock-failed" });
    const elapsed = (yield* Clock.currentTimeMillis) - started;
    const json = yield* decodeJson(result.stdout).pipe(
      Effect.mapError(() => new ProjectProfileError({ reason: "varlock-failed" })),
    );
    return yield* Effect.try({
      try: () => {
        const report = extractVarlockErrors(json, elapsed);
        if (result.code === 1 && report.ok) throw new Error("No validation errors");
        return report;
      },
      catch: () => new ProjectProfileError({ reason: "varlock-failed" }),
    });
  });
  return VarlockRunner.of({ detect, validate });
});
export const layer = Layer.effect(VarlockRunner, make);
