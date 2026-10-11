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
      expect((yield* store.get("a")).autoChecks).toEqual({ erc: false, drc: false });
      yield* Effect.all(
        [
          store.update("a", { threadId, autoChecks: { erc: true } }),
          store.update("a", { threadId, autoChecks: { drc: true } }),
          store.update("b", { threadId, autoChecks: { drc: true } }),
        ],
        { concurrency: "unbounded" },
      );
      expect((yield* store.get("a")).autoChecks).toEqual({ erc: true, drc: true });
      expect((yield* store.get("b")).autoChecks).toEqual({ erc: false, drc: true });
      const reopened = yield* makeProjectSettings(file);
      expect(yield* reopened.get("a")).toEqual(yield* store.get("a"));
      yield* fs.writeFileString(file, "broken");
      expect((yield* store.get("a")).autoChecks.drc).toBe(false);
      yield* store.update("a", { threadId, autoChecks: { erc: true } }).pipe(Effect.flip);
      expect(yield* fs.readFileString(file)).toBe("broken");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
