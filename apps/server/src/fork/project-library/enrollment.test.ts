import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { readLibraryDestination } from "./enrollment.ts";

it.effect("returns only public Library destination metadata from private source enrollment", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "library-destination-" });
    const file = `${root}/publisher.json`;
    const sourceEnvironmentId = EnvironmentId.make("source");
    const write = (url: string, source = "source") =>
      fs.writeFileString(
        file,
        JSON.stringify({
          version: 1,
          sourceEnvironmentId: source,
          libraryEnvironmentId: "library",
          libraryUrl: url,
          expiresAt: "2027-01-01T00:00:00Z",
          accessToken: "private-publisher-credential",
          sessionId: "private-session",
        }),
        { mode: 0o600 },
      );
    const read = readLibraryDestination({ sourceEnvironmentId, credentialPaths: [file] });
    yield* write("https://library.example.test");
    expect(yield* read).toEqual({ environmentId: "library", url: "https://library.example.test/" });
    yield* write("https://library.example.test", "other-computer");
    expect(yield* read).toBeUndefined();
    for (const url of [
      "http://public.example.test",
      "https://user:password@example.test",
      "https://example.test?token=private",
    ]) {
      yield* write(url);
      expect(yield* read).toBeUndefined();
    }
    yield* write("https://library.example.test");
    yield* fs.chmod(file, 0o644);
    expect(yield* read).toBeUndefined();
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
