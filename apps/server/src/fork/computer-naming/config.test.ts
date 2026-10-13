import { expect, it } from "@effect/vitest";
import type { ServerConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as ComputerNaming from "./ComputerNaming.ts";
import { computerNameConfigUpdates } from "./config.ts";

const config = (label: string) =>
  ({
    environment: { environmentId: "host", label },
    cwd: "/workspace",
  }) as ServerConfig;

it.effect("publishes rename and reset using snapshots existing clients understand", () =>
  Effect.gen(function* () {
    const current = yield* Ref.make(config("Dorothy"));
    const changes = Stream.make("Dorothy", "Rack Mac", "Rack Mac", "Dorothy").pipe(
      Stream.tap((label) => Ref.set(current, config(label))),
      Stream.map((label) => ({
        name: label === "Dorothy" ? null : label,
        label,
        defaultLabel: "Dorothy",
      })),
    );
    const updates = yield* computerNameConfigUpdates(config("Dorothy"), () =>
      Ref.get(current),
    ).pipe(
      Effect.provideService(
        ComputerNaming.ComputerNaming,
        ComputerNaming.ComputerNaming.of({
          current: Effect.succeed({ name: null, label: "Dorothy", defaultLabel: "Dorothy" }),
          changes,
          rename: () => Effect.die("unused"),
        }),
      ),
    );
    const snapshots = yield* Stream.runCollect(updates);
    expect(snapshots.map((snapshot) => snapshot.config.environment.label)).toEqual([
      "Rack Mac",
      "Dorothy",
    ]);
    expect(
      snapshots.every((snapshot) => snapshot.type === "snapshot" && snapshot.version === 1),
    ).toBe(true);
    expect(snapshots.every((snapshot) => snapshot.config.cwd === "/workspace")).toBe(true);
  }),
);

it.effect("catches a rename between initial config acquisition and subscription", () =>
  Effect.gen(function* () {
    const renamed = { name: "Orange Pi", label: "Orange Pi", defaultLabel: "Dorothy" };
    const updates = yield* computerNameConfigUpdates(config("Dorothy"), () =>
      Effect.succeed(config(renamed.label)),
    ).pipe(
      Effect.provideService(
        ComputerNaming.ComputerNaming,
        ComputerNaming.ComputerNaming.of({
          current: Effect.succeed(renamed),
          changes: Stream.make(renamed),
          rename: () => Effect.die("unused"),
        }),
      ),
    );
    expect(
      (yield* Stream.runCollect(updates)).map((snapshot) => snapshot.config.environment.label),
    ).toEqual(["Orange Pi"]);
  }),
);
