import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import {
  type ReachStoredComputer,
  ReachStore,
  attestedResource,
  isReachActive,
  layerAt,
  readyHostname,
} from "./ReachStore.ts";

const computer = (overrides: Partial<ReachStoredComputer> = {}): ReachStoredComputer => ({
  seq: 5,
  keyFingerprint: "f".repeat(64),
  hostname: "studio-loom.reach.example.test",
  tunnelId: "tunnel-1",
  dnsRecordId: "dns-1",
  origin: "http://127.0.0.1:3773",
  state: "ready",
  lastError: null,
  leftoverDnsRecordId: null,
  publisherSessionId: "session-1",
  updatedAt: "2026-10-24T12:00:00.000Z",
  lastEnsuredAt: "2026-10-24T12:00:00.000Z",
  identity: null,
  ...overrides,
});

const storeAt = (file: string) =>
  Layer.build(layerAt(file)).pipe(Effect.map((context) => Context.get(context, ReachStore)));

const withDirectory = <A, E>(
  use: (directory: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* use(yield* fs.makeTempDirectoryScoped({ prefix: "loom-reach-store-" }));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("ReachStore", () => {
  it.effect("starts empty without a file and keeps what it wrote across restarts", () =>
    withDirectory((directory) =>
      Effect.gen(function* () {
        const file = `${directory}/fork/reach/library.json`;
        const store = yield* storeAt(file);
        expect((yield* store.read).computers).toEqual({});
        yield* store.update((state) => ({
          ...state,
          computers: { "environment-studio": computer() },
        }));
        const restarted = yield* storeAt(file);
        expect((yield* restarted.read).computers["environment-studio"]).toEqual(computer());
      }),
    ),
  );

  it.effect("refuses to replace records it cannot read, and picks up a repaired file", () =>
    withDirectory((directory) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = `${directory}/library.json`;
        yield* fs.writeFileString(file, '{"version":1,"computers":"pinned-secret-ish"}');
        const logs: Array<string> = [];
        const logger = Logger.make(({ message }) => {
          logs.push(JSON.stringify(message));
        });
        const store = yield* storeAt(file);
        const refused = yield* store
          .update((state) => state)
          .pipe(Effect.flip, Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
        expect(refused.operation).toBe("read");
        expect(yield* fs.readFileString(file)).toContain("pinned-secret-ish");
        expect(logs.some((line) => line.includes("could not be read"))).toBe(true);
        expect(logs.some((line) => line.includes("pinned-secret-ish"))).toBe(false);

        yield* fs.writeFileString(
          file,
          JSON.stringify({ version: 1, zone: null, edge: null, computers: {} }),
        );
        expect((yield* store.read).computers).toEqual({});
      }),
    ),
  );

  it("attests, publishes and pins only what the record supports", () => {
    expect(attestedResource(undefined)).toBeNull();
    expect(
      attestedResource(
        computer({
          identity: {
            apiId: null,
            resource: "https://library.example.test/computers/environment-studio",
            state: "failed",
            lastError: "unavailable",
          },
        }),
      ),
    ).toBeNull();
    expect(
      attestedResource(
        computer({
          identity: {
            apiId: "api-1",
            resource: "https://library.example.test/computers/environment-studio",
            state: "failed",
            lastError: "denied",
          },
        }),
      ),
    ).toBe("https://library.example.test/computers/environment-studio");
    expect(readyHostname(computer())).toBe("studio-loom.reach.example.test");
    for (const state of ["provisioning", "removing", "removed", "failed"] as const) {
      expect(readyHostname(computer({ state }))).toBeNull();
    }
    expect(isReachActive(undefined)).toBe(false);
    expect(isReachActive(computer({ state: "failed" }))).toBe(true);
    expect(isReachActive(computer({ state: "removing" }))).toBe(true);
    expect(isReachActive(computer({ state: "removed" }))).toBe(false);
    expect(isReachActive(computer({ state: "removed-with-leftover" }))).toBe(false);
  });
});
