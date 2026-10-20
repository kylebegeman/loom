#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Fixture state is isolated before opening SQLite.
import { isProtectedFixturePath } from "../src/fork/dev-fixtures/fixtureHome.ts"; // fork: dev-fixtures
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveWorktreeT3Home } from "@t3tools/shared/devHome";
import { CommandId, EventId, ProjectId, OrchestrationV2DomainEventJson } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import * as EventSink from "../src/orchestration-v2/EventSink.ts";
import * as EventStore from "../src/orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../src/orchestration-v2/ProjectionStore.ts";
import * as ApplicationEvents from "../src/persistence/OrchestrationEventStore.ts";
import * as Sqlite from "../src/persistence/Sqlite.ts";
import { ensureDevDbNotInUse } from "./migrate-dev-db.ts";

const Scenario = Schema.Literals(["empty", "sample", "large"]);
type Scenario = typeof Scenario.Type;
const Marker = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    scenario: Scenario,
  }),
);
const MARKER_FILE = "dev-fixture.json";
const CREATED_AT = "2026-01-01T12:00:00.000Z";
const decodeEvent = Schema.decodeUnknownSync(OrchestrationV2DomainEventJson);

export class SeedDevDbError extends Schema.TaggedError<SeedDevDbError>()("SeedDevDbError", {
  reason: Schema.Literals(["shared-home", "outside-home", "not-fixture", "failed"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "shared-home":
        return "Fixture state cannot be created in the installed T3 home.";
      case "outside-home":
        return "The fixture database must stay inside its isolated home.";
      case "not-fixture":
        return "Reset is only allowed for a database created by seed-dev-db.";
      case "failed":
        return "Development fixture initialization failed.";
    }
  }
}

/** Resolve missing descendants too, so a symlinked parent cannot redirect fixture writes. */
async function canonicalPath(path: string): Promise<string> {
  try {
    return await NodeFSP.realpath(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    const parent = NodePath.dirname(path);
    if (parent === path) throw cause;
    return NodePath.join(await canonicalPath(parent), NodePath.basename(path));
  }
}

const contains = (parent: string, child: string) => {
  const relative = NodePath.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
};
const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new SeedDevDbError({ reason: "failed", cause }),
  });

/** Seed through the event sink so persisted history and projections agree on every host. */
const writeFixture = Effect.fn("writeDevelopmentFixture")(function* (
  scenario: Scenario,
  workspaceRoot: string,
) {
  const sink = yield* EventSink.EventSinkV2;
  const count = scenario === "empty" ? 0 : scenario === "large" ? 100 : 3;
  if (count === 0) return { projects: 0, threads: 0 };
  const projectId = ProjectId.make("fixture:project");
  const commandId = CommandId.make("fixture:project:create");
  yield* sink.commitProjectCommand({
    commandId,
    projectId,
    commandType: "project.create",
    acceptedAt: DateTime.makeUnsafe(CREATED_AT),
    event: {
      eventId: EventId.make("fixture:project:created"),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: CREATED_AT,
      commandId,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: "Sample project",
        workspaceRoot,
        defaultModelSelection: null,
        scripts: [],
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    },
  });
  const providerInstanceId = "codex";
  const titles = ["Explore the sample project", "Add an empty state", "Review a conversation"];
  for (let index = 0; index < count; index++) {
    const threadId = `fixture:thread:${index + 1}`;
    yield* sink.write({
      events: [
        decodeEvent({
          id: `fixture:event:${index}:created`,
          type: "thread.created",
          threadId,
          occurredAt: CREATED_AT,
          payload: {
            id: threadId,
            projectId,
            title: titles[index % titles.length] + (index >= 3 ? ` ${index + 1}` : ""),
            createdBy: "user",
            creationSource: "web",
            providerInstanceId,
            modelSelection: { instanceId: providerInstanceId, model: "gpt-6.1-sol" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            // Fixed fixture dates should remain visible under the normal inactivity policy.
            autoSettleDisabledAt: CREATED_AT,
            lastVisitedAt: null,
            deletedAt: null,
          },
        }),
        ...(["user", "assistant"] as const).flatMap((role) => {
          const createdAt = role === "user" ? CREATED_AT : "2026-01-01T12:00:01.000Z";
          const text =
            role === "user"
              ? "Read README.md and confirm this is a synthetic sample project. Do not modify files or start other work."
              : "This is synthetic development history. No provider has run and no personal data was copied.";
          return [
            decodeEvent({
              id: `fixture:event:${index}:${role}`,
              type: "message.updated",
              threadId,
              occurredAt: createdAt,
              payload: {
                id: `fixture:message:${index}:${role}`,
                threadId,
                runId: null,
                nodeId: null,
                role,
                createdBy: role === "user" ? "user" : "system",
                creationSource: "web",
                text,
                attachments: [],
                streaming: false,
                createdAt,
                updatedAt: createdAt,
              },
            }),
            decodeEvent({
              id: `fixture:event:${index}:${role}:item`,
              type: "turn-item.updated",
              threadId,
              occurredAt: createdAt,
              payload: {
                id: `fixture:item:${index}:${role}`,
                threadId,
                runId: null,
                nodeId: null,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: role === "user" ? 0 : 1,
                status: "completed",
                title: null,
                startedAt: createdAt,
                completedAt: createdAt,
                updatedAt: createdAt,
                messageId: `fixture:message:${index}:${role}`,
                text,
                ...(role === "user"
                  ? {
                      type: "user_message",
                      inputIntent: "turn_start",
                      attachments: [],
                      createdBy: "user",
                      creationSource: "web",
                    }
                  : { type: "assistant_message", streaming: false }),
              },
            }),
          ];
        }),
      ],
    });
  }
  return { projects: 1, threads: count };
});

/** Existing state is preserved; explicit reset only replaces a marked, stopped fixture database. */
export const runSeedDevDb = Effect.fn("runSeedDevDb")(function* (
  input: {
    readonly baseDir?: string | undefined;
    readonly scenario?: Scenario | undefined;
    readonly reset?: boolean | undefined;
  },
  options: { readonly sharedHome?: string | undefined } = {},
) {
  // fork: dev-fixtures
  const worktreeHome = yield* resolveWorktreeT3Home(process.cwd());
  const requestedHome =
    input.baseDir ??
    worktreeHome ??
    NodePath.resolve(import.meta.dirname, "../../..", ".t3-fixtures");
  const [baseDir, sharedHome] = yield* io(() =>
    Promise.all([
      canonicalPath(NodePath.resolve(requestedHome)),
      canonicalPath(NodePath.resolve(options.sharedHome ?? NodePath.join(NodeOS.homedir(), ".t3"))),
    ]),
  );
  // fork: dev-fixtures
  const recognizedHome =
    worktreeHome === undefined
      ? null
      : yield* io(async () =>
          NodePath.join(await canonicalPath(NodePath.dirname(worktreeHome)), ".t3"),
        );
  // fork: dev-fixtures
  if (isProtectedFixturePath(baseDir, sharedHome, baseDir, recognizedHome))
    return yield* new SeedDevDbError({ reason: "shared-home" });
  const stateDir = NodePath.join(baseDir, "userdata");
  const databasePath = NodePath.join(stateDir, "statev2.sqlite");
  const markerPath = NodePath.join(stateDir, MARKER_FILE);
  const workspaceRoot = NodePath.join(baseDir, "fixtures", "sample-project");
  for (const target of [stateDir, databasePath, markerPath, workspaceRoot]) {
    const resolved = yield* io(() => canonicalPath(target));
    // fork: dev-fixtures
    if (isProtectedFixturePath(resolved, sharedHome, baseDir, recognizedHome))
      return yield* new SeedDevDbError({ reason: "shared-home" });
    if (!contains(baseDir, resolved)) return yield* new SeedDevDbError({ reason: "outside-home" });
  }
  const exists = yield* io(() =>
    NodeFSP.stat(databasePath).then(
      () => true,
      (cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw cause;
      },
    ),
  );
  if (exists && !input.reset)
    return { status: "existing" as const, databasePath, projects: null, threads: null };
  if (exists) {
    const marker = yield* io(() => NodeFSP.readFile(markerPath, "utf8")).pipe(
      Effect.flatMap(Schema.decodeEffect(Marker)),
      Effect.option,
    );
    if (Option.isNone(marker)) return yield* new SeedDevDbError({ reason: "not-fixture" });
  }
  yield* ensureDevDbNotInUse(databasePath);
  const scenario = input.scenario ?? "sample";
  yield* io(() => NodeFSP.mkdir(stateDir, { recursive: true }));
  const temporaryPath = NodePath.join(stateDir, `seed-${NodeCrypto.randomUUID()}.sqlite`);
  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(ApplicationEvents.layer),
  );
  const sinkLayer = EventSink.layer.pipe(
    Layer.provide(stores),
    Layer.provide(Sqlite.layerFromPath(temporaryPath)),
  );
  const counts = yield* Effect.gen(function* () {
    const counts = yield* writeFixture(scenario, workspaceRoot).pipe(Effect.provide(sinkLayer));
    if (counts.projects > 0) {
      yield* io(async () => {
        await NodeFSP.mkdir(workspaceRoot, { recursive: true });
        // Never overwrite changes someone made while exploring the sample project.
        await NodeFSP.writeFile(
          NodePath.join(workspaceRoot, "README.md"),
          "# Sample project\n\nSynthetic Loom development fixture. This folder is disposable.\n",
          { flag: "wx" },
        ).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code !== "EEXIST") throw cause;
        });
      });
    }
    // A hard link publishes fresh state atomically without replacing a database another
    // preparation created meanwhile. Only an explicit reset may replace existing state.
    if (exists) yield* ensureDevDbNotInUse(databasePath);
    const published = yield* io(async () => {
      // fork: dev-fixtures: Never expose a partially written completion marker.
      await NodeFSP.writeFile(
        `${temporaryPath}.marker`,
        JSON.stringify({ version: 1, scenario }) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      if (exists) {
        for (const suffix of ["-wal", "-shm"])
          await NodeFSP.rm(`${databasePath}${suffix}`, { force: true });
        await NodeFSP.rename(temporaryPath, databasePath);
      } else {
        try {
          await NodeFSP.link(temporaryPath, databasePath);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === "EEXIST") return false;
          throw cause;
        }
      }
      // fork: dev-fixtures
      await NodeFSP.rename(`${temporaryPath}.marker`, markerPath);
      return true;
    });
    return { ...counts, published };
  }).pipe(
    Effect.ensuring(
      io(async () => {
        // fork: dev-fixtures
        for (const suffix of ["", "-wal", "-shm", ".marker"])
          await NodeFSP.rm(`${temporaryPath}${suffix}`, { force: true });
      }).pipe(Effect.ignore),
    ),
  );
  if (!counts.published)
    return { status: "existing" as const, databasePath, projects: null, threads: null };
  return {
    status: "seeded" as const,
    databasePath,
    projects: counts.projects,
    threads: counts.threads,
  };
});

const command = Command.make(
  "seed-dev-db",
  {
    baseDir: Flag.String("base-dir").pipe(
      Flag.optional,
      Flag.withDescription(
        "Isolated T3 home. Defaults to .t3 in a linked worktree, otherwise this checkout's .t3-fixtures.",
      ),
    ),
    scenario: Flag.Literals("scenario", Scenario.literals).pipe(Flag.withDefault("sample")),
    reset: Flag.Boolean("reset").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Replace a stopped fixture database. Existing unmarked databases are protected.",
      ),
    ),
  },
  ({ baseDir, scenario, reset }) =>
    Effect.gen(function* () {
      const started = performance.now();
      const result = yield* runSeedDevDb({
        baseDir: Option.getOrUndefined(baseDir),
        scenario,
        reset,
      });
      yield* Console.log(
        result.status === "existing"
          ? "Existing development data preserved."
          : `Development data ready: ${result.projects} project, ${result.threads} stopped threads (${Math.round(performance.now() - started)} ms).`,
      );
    }),
).pipe(
  Command.withDescription(
    "Initialize reproducible synthetic development state without copying personal data.",
  ),
);

if (import.meta.main)
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
