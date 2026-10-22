import { ProjectProfileError, type EnvReport } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import {
  currentEnvFor,
  envImports,
  inspectEnv,
  parseEnvSource,
  type EnvSource,
} from "./envInspector.ts";

export class EnvInspector extends Context.Service<
  EnvInspector,
  {
    readonly inspect: (
      root: string,
      schemaPath: string,
    ) => Effect.Effect<Omit<EnvReport, "varlock">, ProjectProfileError>;
  }
>()("t3/fork/project-profiles/EnvInspectorLive/EnvInspector") {}
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const inspect = Effect.fn("EnvInspector.inspect")(function* (root: string, schemaPath: string) {
    const realRoot = yield* fs
      .realPath(root)
      .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })));
    const within = (candidate: string) => {
      const relative = path.relative(realRoot, candidate);
      return (
        relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      );
    };
    const read = Effect.fn("EnvInspector.read")(function* (relative: string) {
      if (path.isAbsolute(relative) || !within(path.resolve(realRoot, relative)))
        return yield* new ProjectProfileError({ reason: "path-outside-checkout" });
      const candidate = path.resolve(realRoot, relative);
      const exists = yield* fs
        .exists(candidate)
        .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })));
      if (!exists) return null;
      const real = yield* fs
        .realPath(candidate)
        .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })));
      if (!within(real)) return yield* new ProjectProfileError({ reason: "path-outside-checkout" });
      const stat = yield* fs
        .stat(real)
        .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })));
      if (stat.size > 256 * 1024)
        return yield* new ProjectProfileError({ reason: "file-too-large" });
      const source = yield* fs
        .readFileString(real)
        .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })));
      if (new TextEncoder().encode(source).byteLength > 256 * 1024)
        return yield* new ProjectProfileError({ reason: "file-too-large" });
      return source;
    });
    const schemaSource = yield* read(schemaPath);
    const envSources: EnvSource[] = [];
    for (const file of [".env", ".env.local"]) {
      const source = yield* read(file);
      if (source !== null) envSources.push({ path: file, source });
    }
    let schema = null;
    let currentEnv: string | null = null;
    try {
      schema = schemaSource === null ? null : parseEnvSource(schemaSource);
      currentEnv = schema ? currentEnvFor(schema, envSources, process.env) : null;
    } catch {
      /* inspectEnv reports a value-free parse location. */
    }
    if (currentEnv)
      for (const file of [`.env.${currentEnv}`, `.env.${currentEnv}.local`]) {
        const source = yield* read(file);
        if (source !== null) envSources.push({ path: file, source });
      }
    const imports: EnvSource[] = [];
    if (schema)
      for (const imported of envImports(schema).slice(0, 20)) {
        // Remote imports and globs require varlock; the preview follows local files only.
        if (/^[a-z]+:|[*?]/i.test(imported)) continue;
        const relative = path.join(path.dirname(schemaPath), imported);
        const source = yield* read(relative);
        if (source !== null) imports.push({ path: relative, source });
      }
    const report = inspectEnv({
      root,
      schemaPath,
      schemaSource,
      imports,
      envSources,
      processEnv: process.env,
    });
    if (report.items.length > 1000 || report.unschematizedKeys.length > 1000)
      return yield* new ProjectProfileError({ reason: "file-too-large" });
    return report;
  });
  return EnvInspector.of({ inspect });
});
export const layer = Layer.effect(EnvInspector, make);
