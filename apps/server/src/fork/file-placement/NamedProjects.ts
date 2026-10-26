import type { ProjectId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";

interface ProjectRoot {
  readonly id: ProjectId;
  readonly workspaceRoot: string;
}

/**
 * Projects Loom made from a name, with the folder it made. The Projects folder also holds the
 * user's own checkouts, so clients cannot tell the two apart by location.
 */
export class NamedProjects extends Context.Service<
  NamedProjects,
  {
    /** Record before the project exists, so its first shell update already carries the flag. */
    readonly record: (project: ProjectRoot) => Effect.Effect<void>;
    /** Undefined while the records are unreadable, so clients keep the location rule. */
    readonly matcher: Effect.Effect<(project: ProjectRoot) => boolean | undefined>;
  }
>()("t3/fork/file-placement/NamedProjects") {}

const Records = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const recordsPath = path.join(config.stateDir, "fork", "file-placement", "named-projects.json");
  const saved = yield* fs.readFileString(recordsPath).pipe(
    Effect.flatMap(Schema.decodeEffect(Records)),
    Effect.asSome,
    Effect.catchIf(
      (cause) => "reason" in cause && cause.reason._tag === "NotFound",
      () => Effect.succeedSome({}),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Ignoring unreadable named project records", {
        path: recordsPath,
        cause,
      }).pipe(Effect.as(Option.none())),
    ),
  );
  const readable = Option.isSome(saved);
  const roots = yield* Ref.make<ReadonlyMap<string, string>>(
    new Map(Object.entries(Option.getOrElse(saved, () => ({})))),
  );
  const lock = yield* Semaphore.make(1);

  const record = Effect.fn("NamedProjects.record")(function* (project: ProjectRoot) {
    const next = new Map(yield* Ref.get(roots)).set(
      project.id,
      path.resolve(project.workspaceRoot),
    );
    yield* Ref.set(roots, next);
    // Never overwrite records this server could not read.
    if (!readable) return;
    yield* Schema.encodeEffect(Records)(Object.fromEntries(next)).pipe(
      Effect.flatMap((contents) =>
        writeFileStringAtomically({ filePath: recordsPath, contents: `${contents}\n` }),
      ),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.catch((cause) =>
        Effect.logWarning("Could not save the named project record", {
          path: recordsPath,
          cause,
        }),
      ),
    );
  }, lock.withPermit);

  const matcher = Ref.get(roots).pipe(
    Effect.map(
      (current) => (project: ProjectRoot) =>
        readable ? current.get(project.id) === path.resolve(project.workspaceRoot) : undefined,
    ),
  );

  return NamedProjects.of({ record, matcher });
});

export const layer = Layer.effect(NamedProjects, make);

type Mark = <P extends ProjectRoot>(project: P) => P & { readonly namedProject?: boolean };

// Hosts without the service omit the flag, like older servers.
const mark: Effect.Effect<Mark> = Effect.serviceOption(NamedProjects).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed<Mark>((project) => project),
      onSome: (named) =>
        named.matcher.pipe(
          Effect.map((isNamed): Mark => (project) => {
            const namedProject = isNamed(project);
            return namedProject === undefined ? project : { ...project, namedProject };
          }),
        ),
    }),
  ),
);

export const markNamedProjects = <P extends ProjectRoot>(projects: ReadonlyArray<P>) =>
  Effect.map(mark, (apply) => projects.map(apply));

export const markNamedProject = <P extends ProjectRoot>(project: Option.Option<P>) =>
  Effect.map(mark, (apply) => Option.map(project, apply));

export const markNamedProjectsIn = <A extends { readonly projects: ReadonlyArray<ProjectRoot> }>(
  value: A,
) => Effect.map(markNamedProjects(value.projects), (projects) => ({ ...value, projects }));
