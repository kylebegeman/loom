import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import { TailscaleCliUnavailableError } from "@t3tools/tailscale";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as ServerConfig from "../../config.ts";
import * as BackgroundChecks from "./BackgroundChecks.ts";

const NOW = Date.parse("2026-10-26T09:00:00Z");
const iso = (time: number) => DateTime.formatIso(DateTime.makeUnsafe(time));
const decode = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));

/** One server run: the record is loaded at start and flushed when the run stops. */
const run = <A, E, R>(
  use: (checks: BackgroundChecks.BackgroundChecks["Service"]) => Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(BackgroundChecks.BackgroundChecks, use).pipe(
    Effect.provide(BackgroundChecks.layer),
  );

it.effect("keeps the latest failure across restarts until its check passes", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const file = `${config.stateDir}/fork/background-checks/failures.json`;
    const denied = "Loom is not allowed to run the Tailscale CLI (tailscale).";

    yield* run((checks) =>
      Effect.gen(function* () {
        yield* checks.fail("tailscale-cli", denied);
        yield* TestClock.adjust("30 seconds");
        yield* checks.fail("tailscale-cli", denied);
        // A repeat is saved later, so a check failing every 30 seconds does not write each time.
        expect(decode(yield* fs.readFileString(file))).toMatchObject([{ count: 1 }]);
        yield* checks.fail("library-renewal", "The Library did not answer.");
        yield* checks.clear("library-renewal");
      }),
    );

    expect(yield* run((checks) => checks.failures)).toEqual([
      {
        check: "tailscale-cli",
        message: denied,
        firstSeenAt: iso(NOW),
        lastSeenAt: iso(NOW + 30_000),
        count: 2,
      },
    ]);
    yield* run((checks) => checks.clear("tailscale-cli"));
    expect(yield* run((checks) => checks.failures)).toEqual([]);
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "background-checks-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);

it("names the Tailscale executables Loom was denied", () => {
  const error = new TailscaleCliUnavailableError({
    subcommand: "status",
    attempts: [
      { executable: "tailscale", code: "ENOENT" },
      { executable: "/Applications/Tailscale.app", code: "EACCES" },
    ],
  });
  expect(BackgroundChecks.tailscaleFailure(error)).toBe(
    "Loom is not allowed to run the Tailscale CLI (/Applications/Tailscale.app). Check its file permissions.",
  );
  expect(
    BackgroundChecks.tailscaleFailure(
      new TailscaleCliUnavailableError({
        subcommand: "status",
        attempts: [{ executable: "tailscale", code: "ENOENT" }],
      }),
    ),
  ).toBe(error.message);
});
