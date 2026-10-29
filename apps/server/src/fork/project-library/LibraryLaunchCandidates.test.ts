import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { LibraryError, type LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { copyFor, resource } from "./Library.testkit.ts";
import * as LibraryLaunchCandidates from "./LibraryLaunchCandidates.ts";
import * as LibraryService from "./LibraryService.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

const assets = Layer.succeed(Assets.LibraryAssetService, {
  mode: "local",
  removeUnused: () => Effect.void,
  find: () => Effect.fail(new LibraryError({ reason: "not-found" })),
  read: () => Effect.fail(new LibraryError({ reason: "not-found" })),
  put: () => Effect.fail(new LibraryError({ reason: "io" })),
  url: () => Effect.succeed(null),
});
const libraryLayer = (isAuthority: boolean) =>
  LibraryService.layer.pipe(
    Layer.provide(assets),
    Layer.provide(
      Layer.succeed(ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("authority")),
      }),
    ),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: String(isAuthority) } }),
      ),
    ),
  );
const run = <A, E>(
  isAuthority: boolean,
  use: (services: {
    readonly library: LibraryService.LibraryService["Service"];
    readonly launch: LibraryLaunchCandidates.LibraryLaunchCandidates["Service"];
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const services = yield* Effect.all({
      library: LibraryService.LibraryService,
      launch: LibraryLaunchCandidates.LibraryLaunchCandidates,
    }).pipe(
      Effect.provide(
        LibraryLaunchCandidates.layer.pipe(Layer.provideMerge(libraryLayer(isAuthority))),
      ),
    );
    return yield* use(services);
  }).pipe(Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped);

const BOOK = EnvironmentId.make("book");
const STUDIO = EnvironmentId.make("studio");

describe("LibraryLaunchCandidates", () => {
  it.effect("ranks the Library's computers the way the New conversation dialog does", () =>
    run(true, ({ library, launch }) =>
      Effect.gen(function* () {
        const project = yield* library.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const authority = yield* library.info;
        const register = (environmentId: EnvironmentId, label: string) =>
          library.registerComputer({
            authorityId: authority.authorityId,
            authorityEpoch: authority.authorityEpoch,
            computer: {
              environmentId,
              label,
              platform: { os: "darwin", arch: "arm64" },
              appVersion: "0.0.58",
              supportsExecution: true,
              endpoints: [],
            },
          });
        yield* register(STUDIO, "Studio");
        // The Studio goes quiet; the MacBook reports in after it and holds a copy.
        yield* TestClock.adjust(Duration.minutes(10));
        yield* register(BOOK, "MacBook");
        const copy: LibraryWorkingCopy = {
          ...copyFor(project),
          id: "book-copy",
          environmentId: BOOK,
        };
        yield* library.registerCopy({ requestId: "copy", copy });

        const whole = yield* launch.candidates({ projectId: project.id });
        expect(
          whole.candidates.map((candidate) => [candidate.environmentId, candidate.kind]),
        ).toEqual([
          [BOOK, "copy"],
          [STUDIO, "get-copy"],
        ]);
        expect(whole.candidates[0]).toMatchObject({
          copyId: "book-copy",
          online: true,
          freshness: "unknown",
          reasons: ["online", "not checked"],
          preselected: true,
          placement: {
            action: "use",
            rootPath: copy.rootPath,
            ownership: copy.ownership,
            copyId: "book-copy",
          },
        });
        expect(whole.candidates[1]?.placement).toBeUndefined();
        expect(whole.candidates[1]).toMatchObject({
          online: false,
          reasons: ["offline", "no copy yet"],
          preselected: false,
        });

        // A component the copy does not hold leaves every computer needing a copy.
        const elsewhere = yield* launch.candidates({ projectId: project.id, resourceIds: ["web"] });
        expect(elsewhere.candidates.every((candidate) => candidate.kind === "get-copy")).toBe(true);

        // Once the MacBook stops reporting too, nothing is preselected.
        yield* TestClock.adjust(Duration.minutes(10));
        const quiet = yield* launch.candidates({ projectId: project.id });
        expect(quiet.candidates.some((candidate) => candidate.preselected)).toBe(false);
      }),
    ),
  );

  it.effect("refuses an archived project until it is restored", () =>
    run(true, ({ library, launch }) =>
      Effect.gen(function* () {
        const project = yield* library.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const archived = yield* library.archiveProject({
          requestId: "archive",
          projectId: project.id,
          expectedRevision: project.revision,
          archived: true,
        });
        const error = yield* Effect.flip(launch.candidates({ projectId: project.id }));
        expect(error).toMatchObject({ reason: "blocked" });
        expect(error.message).toContain("AspectAvy is archived. Restore it");
        yield* library.archiveProject({
          requestId: "restore",
          projectId: project.id,
          expectedRevision: archived.revision,
          archived: false,
        });
        expect((yield* launch.candidates({ projectId: project.id })).projectId).toBe(project.id);
      }),
    ),
  );

  it.effect("fails away from the Library, like the other catalog reads", () =>
    run(false, ({ launch }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(launch.candidates({ projectId: "anything" }));
        expect(error.reason).toBe("not-authority");
      }),
    ),
  );
});
