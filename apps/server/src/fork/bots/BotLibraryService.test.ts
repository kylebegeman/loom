import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  botRunThreadId,
  type BotLibraryStatusReport,
  type BotRemoteRunRequest,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { BotLibraryService, layer } from "./BotLibraryService.ts";
import { BotsMigrations } from "./migrations.ts";
import { model, reviewer } from "./testing/BotsHarness.ts";

const laptop = EnvironmentId.make("env-laptop");
const studio = EnvironmentId.make("env-studio");
const definition = reviewer();

const libraryLayer = (authority: boolean) =>
  Layer.effectDiscard(runForkMigrationSet(BotsMigrations)).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    (migrated) => layer.pipe(Layer.provideMerge(migrated)),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: authority ? "true" : "false" } }),
      ),
    ),
  );

const withLibrary = <A, E>(
  use: (library: BotLibraryService["Service"]) => Effect.Effect<A, E>,
  authority = true,
) => Effect.flatMap(BotLibraryService, use).pipe(Effect.provide(libraryLayer(authority)));

const report = (fields: Partial<BotLibraryStatusReport> = {}): BotLibraryStatusReport => ({
  label: "Studio",
  acceptRemote: true,
  runtimeModeCeiling: "auto",
  freeSlots: 4,
  bots: [{ libraryBotId: definition.id, revision: 1, ready: true, reasons: [] }],
  ...fields,
});

const request = (requestId = "run-1"): BotRemoteRunRequest => ({
  requestId,
  threadId: botRunThreadId(requestId),
  libraryBotId: definition.id,
  revision: 1,
  inputs: { file: "a.ts" },
  requesterLabel: "Laptop",
});

const publishFirst = (library: BotLibraryService["Service"]) =>
  library.publish(laptop, {
    definition,
    libraryProjectId: null,
    expectedRevision: null,
    label: "Laptop",
  });

describe("BotLibraryService", () => {
  it.effect("refuses every call on a computer that is not the Library", () =>
    withLibrary(
      (library) =>
        Effect.gen(function* () {
          expect(library.enabled).toBe(false);
          const error = yield* library.list(0).pipe(Effect.flip);
          expect(error.reason).toBe("unavailable");
        }),
      false,
    ),
  );

  it.effect("revises a shared bot only from the revision its editor last saw", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        const first = yield* publishFirst(library);
        expect(first.revision).toBe(1);
        const duplicate = yield* publishFirst(library).pipe(Effect.flip);
        expect(duplicate.reason).toBe("conflict");

        const second = yield* library.publish(studio, {
          definition: { ...definition, description: "Studio edit." },
          libraryProjectId: null,
          expectedRevision: 1,
          label: "Studio",
        });
        expect(second.revision).toBe(2);

        const stale = yield* library
          .publish(laptop, {
            definition: { ...definition, description: "Laptop edit." },
            libraryProjectId: null,
            expectedRevision: 1,
            label: "Laptop",
          })
          .pipe(Effect.flip);
        expect(stale.reason).toBe("conflict");
        expect(stale.message).toContain("Studio changed Reviewer");
      }),
    ),
  );

  it.effect("keeps the shared model when the editor runs the bot on its own", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        yield* publishFirst(library);
        const local = { ...model, model: "local-only" };
        const kept = yield* library.publish(studio, {
          definition: { ...definition, modelSelection: local, description: "New brief." },
          libraryProjectId: null,
          expectedRevision: 1,
          label: "Studio",
          keepModel: true,
        });
        expect(kept.definition?.modelSelection).toEqual(model);
        expect(kept.definition?.description).toBe("New brief.");
      }),
    ),
  );

  it.effect("lists changes after a cursor and keeps unshared bots as tombstones", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        yield* publishFirst(library);
        const page = yield* library.list(0);
        expect(page.records.map((record) => record.id)).toEqual([definition.id]);
        expect((yield* library.list(page.cursor)).records).toEqual([]);

        yield* library.unpublish(laptop, definition.id, "Laptop");
        const after = yield* library.list(page.cursor);
        expect(after.records).toHaveLength(1);
        expect(after.records[0]?.definition).toBeNull();
        expect(after.records[0]?.deletedAt).not.toBeNull();
      }),
    ),
  );

  it.effect("refuses a run for a computer that is offline, closed or not ready", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        const submit = library.submit(laptop, { targetEnvironmentId: studio, request: request() });
        expect((yield* Effect.flip(submit)).message).toContain("offline");

        yield* library.reportStatus(studio, report({ acceptRemote: false }));
        expect((yield* Effect.flip(submit)).message).toBe(
          "Studio does not run bots for other computers.",
        );

        yield* library.reportStatus(
          studio,
          report({
            bots: [
              {
                libraryBotId: definition.id,
                revision: 1,
                ready: false,
                reasons: ["Its model's provider is not set up on this computer."],
              },
            ],
          }),
        );
        expect((yield* Effect.flip(submit)).message).toBe(
          "Studio cannot run this bot. Its model's provider is not set up on this computer.",
        );

        const self = yield* library
          .submit(studio, { targetEnvironmentId: studio, request: request() })
          .pipe(Effect.flip);
        expect(self.reason).toBe("invalid");
      }),
    ),
  );

  it.effect("delivers a run to its target and returns a refusal as a failed result", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        yield* library.reportStatus(studio, report());
        yield* library.submit(laptop, { targetEnvironmentId: studio, request: request() });
        expect(yield* library.nextRequests(laptop, 0)).toEqual([]);

        const [delivery] = yield* library.nextRequests(studio, 0);
        expect(delivery?.fromEnvironmentId).toBe(laptop);
        expect(delivery?.message).toEqual({ _tag: "run", request: request() });
        // Leased, so a second poll before the ack does not deliver it twice.
        expect(yield* library.nextRequests(studio, 0)).toEqual([]);

        yield* library.ack(studio, { messageId: delivery!.messageId, refused: "Studio is busy." });
        const [result] = yield* library.nextResults(laptop, 0);
        expect(result?.requestId).toBe("run-1");
        expect(result?.seq).toBe(2);
        expect(result?.update).toMatchObject({
          _tag: "terminal",
          status: "failed",
          error: "Studio is busy.",
        });
        yield* library.ackResult(laptop, { requestId: "run-1", seq: 2 });
        expect(yield* library.nextResults(laptop, 0)).toEqual([]);
      }),
    ),
  );

  it.effect("cancels a run that was never picked up without asking its target", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        yield* library.reportStatus(studio, report());
        yield* library.submit(laptop, { targetEnvironmentId: studio, request: request() });
        yield* library.cancel(laptop, "run-1");
        expect(yield* library.nextRequests(studio, 0)).toEqual([]);
        const [result] = yield* library.nextResults(laptop, 0);
        expect(result?.update).toMatchObject({ _tag: "terminal", status: "cancelled" });
      }),
    ),
  );

  it.effect("forwards a cancel for a run its target picked up but has not acked", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        yield* library.reportStatus(studio, report());
        yield* library.submit(laptop, { targetEnvironmentId: studio, request: request() });
        yield* library.nextRequests(studio, 0);

        yield* library.cancel(laptop, "run-1");
        expect(yield* library.nextResults(laptop, 0)).toEqual([]);
        const deliveries = yield* library.nextRequests(studio, 0);
        expect(deliveries.map((delivery) => delivery.message)).toEqual([
          { _tag: "cancel", requestId: "run-1" },
        ]);
      }),
    ),
  );

  it.effect("forwards a cancel for a delivered run and only takes results from its target", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        yield* library.reportStatus(studio, report());
        yield* library.submit(laptop, { targetEnvironmentId: studio, request: request() });
        const [delivery] = yield* library.nextRequests(studio, 0);
        yield* library.ack(studio, { messageId: delivery!.messageId, refused: null });

        yield* library.cancel(laptop, "run-1");
        const [cancel] = yield* library.nextRequests(studio, 0);
        expect(cancel?.message).toEqual({ _tag: "cancel", requestId: "run-1" });

        const started = {
          requestId: "run-1",
          seq: 1 as const,
          update: {
            _tag: "started" as const,
            label: "Studio",
            startedAt: "2026-10-20T10:00:00.000Z",
          },
        };
        const stranger = yield* library.postResult(laptop, started).pipe(Effect.flip);
        expect(stranger.reason).toBe("not_found");
        yield* library.postResult(studio, started);
        expect((yield* library.nextResults(laptop, 0)).map((result) => result.seq)).toEqual([1]);
      }),
    ),
  );
});
