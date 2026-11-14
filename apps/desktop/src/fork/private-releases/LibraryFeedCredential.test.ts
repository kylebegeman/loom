import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { libraryComputerDirectory } from "@t3tools/shared/fork/library-computer";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopConfig from "../../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { libraryReleaseFeedUrl, makeLibraryFeedHeaders } from "./LibraryFeedCredential.ts";

const FEED = "https://library.example.test/api/loom/releases";
const COMPUTER = "environment-studio";

const credential = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    sourceEnvironmentId: COMPUTER,
    libraryEnvironmentId: "environment-library",
    libraryUrl: "https://library.example.test/",
    sessionId: "session-1",
    accessToken: "enrolled-token",
    expiresAt: "2026-12-01T00:00:00.000Z",
    ...overrides,
  });

const withComputer = <A, E>(
  use: (files: {
    readonly write: (
      which: "enrolled" | "legacy" | "environment-id",
      contents: string,
      mode?: number,
    ) => Effect.Effect<void, PlatformError.PlatformError>;
    readonly headers: (
      feedUrl: string | undefined,
    ) => Effect.Effect<{ readonly authorization: string } | null>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "loom-feed-credential-" });
    const layer = DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/src",
      homeDirectory: home,
      platform: "darwin",
      processArch: "arm64",
      appVersion: "1.2.3",
      appPath: "/repo",
      isPackaged: true,
      resourcesPath: "/missing/resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          DesktopConfig.layerTest({ T3CODE_HOME: path.join(home, ".t3") }),
        ),
      ),
    );
    const environment = yield* DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layer));
    const headers = yield* makeLibraryFeedHeaders.pipe(Effect.provide(layer));
    const target = {
      enrolled: path.join(libraryComputerDirectory(home, COMPUTER), "publisher.json"),
      legacy: path.join(environment.stateDir, "secrets", "library-publisher.json"),
      "environment-id": path.join(environment.stateDir, "environment-id"),
    };
    yield* TestClock.setTime(Date.parse("2026-11-14T00:00:00.000Z"));
    return yield* use({
      write: (which, contents, mode = 0o600) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(path.dirname(target[which]), { recursive: true });
          yield* fileSystem.writeFileString(target[which], contents);
          yield* fileSystem.chmod(target[which], mode);
        }),
      headers,
    });
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("Library feed credential", () => {
  it.effect("sends this computer's enrolled credential to its own Library's feed", () =>
    withComputer((files) =>
      Effect.gen(function* () {
        yield* files.write("environment-id", `${COMPUTER}\n`);
        yield* files.write("legacy", credential({ accessToken: "legacy-token" }));
        assert.deepStrictEqual(yield* files.headers(FEED), {
          authorization: "Bearer legacy-token",
        });
        yield* files.write("enrolled", credential());
        assert.deepStrictEqual(yield* files.headers(FEED), {
          authorization: "Bearer enrolled-token",
        });
        assert.isNull(yield* files.headers(undefined));
      }),
    ),
  );

  it.effect("sends nothing another Library, computer or expired sign-in would need", () =>
    withComputer((files) =>
      Effect.gen(function* () {
        yield* files.write("enrolled", credential());
        assert.isNull(yield* files.headers(FEED), "no environment id");
        yield* files.write("environment-id", COMPUTER);
        assert.isNull(yield* files.headers("https://other.example.test/api/loom/releases"));
        for (const [contents, mode] of [
          [credential({ sourceEnvironmentId: "environment-laptop" }), 0o600],
          [credential({ expiresAt: "2026-11-01T00:00:00.000Z" }), 0o600],
          [credential({ accessToken: "line\nbreak" }), 0o600],
          [credential(), 0o644],
          ["{", 0o600],
        ] as const) {
          yield* files.write("enrolled", contents, mode);
          yield* files.write("legacy", credential({ accessToken: "legacy-token" }));
          // An unusable enrolled credential is not replaced by the legacy copy, as on the server.
          assert.isNull(yield* files.headers(FEED), contents);
        }
      }),
    ),
  );
});

describe("Library release feed", () => {
  it("is the policy or packaged generic feed only when it is a Library's release route", () => {
    const packaged = (config: Record<string, string>) => Option.some(config);
    const none = Option.none<Record<string, string>>();
    assert.strictEqual(
      libraryReleaseFeedUrl({ mockUpdates: false, policyFeedUrl: FEED, appUpdateYml: none }),
      FEED,
    );
    assert.strictEqual(
      libraryReleaseFeedUrl({
        mockUpdates: false,
        policyFeedUrl: undefined,
        appUpdateYml: packaged({ provider: "generic", url: `${FEED}/` }),
      }),
      `${FEED}/`,
    );
    for (const input of [
      { mockUpdates: true, policyFeedUrl: FEED, appUpdateYml: none },
      {
        mockUpdates: false,
        policyFeedUrl: undefined,
        appUpdateYml: packaged({ provider: "github", owner: "kylebegeman", repo: "loom" }),
      },
      {
        mockUpdates: false,
        policyFeedUrl: "https://mirror.example.test/loom",
        appUpdateYml: packaged({ provider: "generic", url: FEED }),
      },
      {
        mockUpdates: false,
        policyFeedUrl: "http://library.example.test/api/loom/releases",
        appUpdateYml: none,
      },
    ]) {
      assert.isUndefined(libraryReleaseFeedUrl(input));
    }
  });
});
