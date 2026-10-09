import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import type { DeviceQaEvidence } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { expiryCutoff, makeEvidenceStore } from "./evidenceStore.ts";
import { DeviceQaMigrations } from "./migrations.ts";

export const evidence = (
  id: string,
  createdAt: string,
  fields: Partial<DeviceQaEvidence> = {},
): DeviceQaEvidence => ({
  id,
  threadId: ThreadId.make("thread-a"),
  kind: "screenshot",
  status: "ready",
  target: { hostId: "local", deviceId: "SIM-1", platform: "ios" },
  deviceName: "iPhone 17",
  label: null,
  path: `/evidence/thread-a/${id}.png`,
  mimeType: "image/png",
  sizeBytes: 1000,
  width: 1206,
  height: 2622,
  durationMs: null,
  detail: null,
  createdBy: "user",
  createdAt,
  ...fields,
});

const withStore = <A, E>(
  use: (
    store: Effect.Success<typeof makeEvidenceStore>,
  ) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(DeviceQaMigrations);
    return yield* use(yield* makeEvidenceStore);
  }).pipe(Effect.provide(SqlitePersistenceMemory));

describe("DeviceQaEvidenceStore", () => {
  it.effect("lists a thread's items newest first with totals over all of them", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insert(evidence("dqe_1", "2026-10-08T10:00:00.000Z"));
        yield* store.insert(
          evidence("dqe_2", "2026-10-08T11:00:00.000Z", {
            kind: "install",
            path: null,
            mimeType: null,
            sizeBytes: null,
            width: null,
            height: null,
            detail: "com.example.app",
          }),
        );
        yield* store.insert(
          evidence("dqe_3", "2026-10-08T12:00:00.000Z", { sizeBytes: 500, label: "Home" }),
        );
        yield* store.insert(
          evidence("dqe_4", "2026-10-08T09:00:00.000Z", {
            kind: "flow-report",
            path: "/runs/dqa_1/report.json",
            mimeType: "application/json",
            sizeBytes: 700,
            width: null,
            height: null,
            detail: "dqa_1",
          }),
        );
        yield* store.insert(
          evidence("dqe_other", "2026-10-08T12:00:00.000Z", {
            threadId: ThreadId.make("thread-b"),
          }),
        );
        expect((yield* store.listForThread("thread-a")).map((item) => item.id)).toEqual([
          "dqe_3",
          "dqe_2",
          "dqe_1",
          "dqe_4",
        ]);
        expect((yield* store.listForThread("thread-a", 2)).map((item) => item.id)).toEqual([
          "dqe_3",
          "dqe_2",
        ]);
        // A flow report's file belongs to its run and outlives the item, so it frees nothing.
        expect(yield* store.totals("thread-a")).toEqual({ totalCount: 4, totalBytes: 1500 });
        expect(yield* store.totals("thread-none")).toEqual({ totalCount: 0, totalBytes: 0 });
        expect((yield* store.threadIds()).toSorted()).toEqual(["thread-a", "thread-b"]);
      }),
    ),
  );

  it.effect("updates a capture as it finishes and deletes by item or thread", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const recording = evidence("dqe_rec", "2026-10-08T10:00:00.000Z", {
          kind: "recording",
          status: "recording",
          path: null,
          sizeBytes: null,
        });
        yield* store.insert(recording);
        yield* store.save({
          ...recording,
          status: "ready",
          path: "/evidence/thread-a/dqe_rec.mp4",
          mimeType: "video/mp4",
          sizeBytes: 4096,
          durationMs: 10_250.4,
        });
        expect(yield* store.get("dqe_rec")).toMatchObject({
          status: "ready",
          sizeBytes: 4096,
          durationMs: 10_250,
        });
        yield* store.insert(evidence("dqe_2", "2026-10-08T11:00:00.000Z"));
        yield* store.delete("dqe_2");
        expect(yield* store.get("dqe_2")).toBeNull();
        yield* store.deleteForThread("thread-a");
        expect(yield* store.allForThread("thread-a")).toEqual([]);
      }),
    ),
  );

  it.effect("selects only settled items older than the cutoff for expiry", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insert(evidence("dqe_old", "2026-09-01T00:00:00.000Z"));
        yield* store.insert(
          evidence("dqe_old_failed", "2026-09-01T00:00:00.000Z", { status: "failed" }),
        );
        yield* store.insert(
          evidence("dqe_old_recording", "2026-09-01T00:00:00.000Z", {
            kind: "recording",
            status: "recording",
          }),
        );
        yield* store.insert(evidence("dqe_new", "2026-10-07T00:00:00.000Z"));
        expect(
          (yield* store.expired("2026-10-01T00:00:00.000Z")).map((item) => item.id).toSorted(),
        ).toEqual(["dqe_old", "dqe_old_failed"]);
      }),
    ),
  );

  it("computes the expiry cutoff in whole days from now", () => {
    expect(expiryCutoff(Date.parse("2026-10-08T12:00:00.000Z"), 7)).toBe(
      "2026-10-01T12:00:00.000Z",
    );
  });

  it.effect("fails recordings the previous server left open", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insert(
          evidence("dqe_rec", "2026-10-08T10:00:00.000Z", {
            kind: "recording",
            status: "finalizing",
          }),
        );
        expect((yield* store.failStaleRecordings()).map((item) => item.id)).toEqual(["dqe_rec"]);
        expect(yield* store.get("dqe_rec")).toMatchObject({
          status: "failed",
          detail: "The server stopped during the recording.",
        });
      }),
    ),
  );
});
