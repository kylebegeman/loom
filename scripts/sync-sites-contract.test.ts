import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { SitesContractDriftError, syncSitesContract } from "./sync-sites-contract.ts";

it.layer(NodeServices.layer)("Sites contract sync", (it) => {
  it.effect("preserves response bodies and checks drift without writing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const relativeFixture = "packages/contracts/src/fork/fixtures/begamin-sites.json";
      const fixture = yield* fs.readFileString(
        path.resolve(import.meta.dirname, "..", relativeFixture),
      );
      const rootDir = yield* fs.makeTempDirectoryScoped({ prefix: "loom-sites-contract-" });
      const source = path.join(rootDir, "sites-consumer.json");
      const destination = path.join(rootDir, relativeFixture);
      yield* fs.writeFileString(source, fixture);
      yield* syncSitesContract({ source, rootDir, check: false });
      assert.equal(yield* fs.readFileString(destination), fixture);
      yield* syncSitesContract({ source, rootDir, check: true });
      const staleFixture = fixture.replace('"begam.in"', '"Changed API"');
      yield* fs.writeFileString(destination, staleFixture);
      const error = yield* syncSitesContract({ source, rootDir, check: true }).pipe(Effect.flip);
      assert.instanceOf(error, SitesContractDriftError);
      assert.equal(yield* fs.readFileString(destination), staleFixture);
      assert.equal(yield* fs.readFileString(source), fixture);
      yield* syncSitesContract({ source, rootDir, check: false });
      assert.equal(yield* fs.readFileString(destination), fixture);
      yield* fs.writeFileString(
        source,
        fixture.replace('"formatVersion": 1', '"formatVersion": 2'),
      );
      yield* syncSitesContract({ source, rootDir, check: false }).pipe(Effect.flip);
      assert.equal(yield* fs.readFileString(destination), fixture);
    }),
  );
});
