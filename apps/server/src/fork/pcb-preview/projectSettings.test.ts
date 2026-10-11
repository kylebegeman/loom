import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import { makeProjectSettings } from "./projectSettings.ts";
it.effect("defaults off, merges partial concurrent updates and preserves other projects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        dir = yield* fs.makeTempDirectoryScoped();
      const file = `${dir}/settings.json`,
        store = yield* makeProjectSettings(file);
      const threadId = ThreadId.make("thread");
      expect((yield* store.get("a")).autoChecks).toEqual({ erc: false, drc: false, review: false });
      yield* Effect.all(
        [
          store.update("a", { threadId, autoChecks: { erc: true } }),
          store.update("a", { threadId, autoChecks: { drc: true } }),
          store.update("b", { threadId, autoChecks: { drc: true } }),
        ],
        { concurrency: "unbounded" },
      );
      expect((yield* store.get("a")).autoChecks).toEqual({ erc: true, drc: true, review: false });
      expect((yield* store.get("b")).autoChecks).toEqual({ erc: false, drc: true, review: false });
      const reopened = yield* makeProjectSettings(file);
      expect(yield* reopened.get("a")).toEqual(yield* store.get("a"));
      yield* fs.writeFileString(file, "broken");
      expect((yield* store.get("a")).autoChecks.drc).toBe(false);
      yield* store.update("a", { threadId, autoChecks: { erc: true } }).pipe(Effect.flip);
      expect(yield* fs.readFileString(file)).toBe("broken");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "review updates merge rules and parameters and waivers reverse without changing auto policy",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          dir = yield* fs.makeTempDirectoryScoped();
        const store = yield* makeProjectSettings(`${dir}/settings.json`),
          threadId = ThreadId.make("one");
        yield* store.update("p", {
          threadId,
          autoChecks: { review: true },
          review: {
            rules: { "led-resistor": false },
            params: { decoupling: { maxDistanceMm: 2 } },
            waive: [{ designId: "a", findingId: "f", note: "one" }],
          },
        });
        const next = yield* store.update("p", {
          threadId,
          review: {
            rules: { "i2c-pullup": false },
            params: { decoupling: { future: 10 } },
            waive: [
              { designId: "a", findingId: "f", note: "updated" },
              { designId: "b", findingId: "f" },
            ],
          },
        });
        expect(next.review.rules).toEqual({ "led-resistor": false, "i2c-pullup": false });
        expect(next.review.params.decoupling).toEqual({ maxDistanceMm: 2, future: 10 });
        expect(next.review.waivers).toHaveLength(2);
        expect(next.review.waivers[0]?.note).toBe("updated");
        expect(next.autoChecks.review).toBe(true);
        const restored = yield* store.update("p", {
          threadId,
          review: { unwaive: [{ designId: "a", findingId: "f" }] },
        });
        expect(restored.review.waivers.map((w) => w.designId)).toEqual(["b"]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
