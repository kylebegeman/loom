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
    const current = yield* Ref.make(config("Maple"));
    const changes = Stream.make("Maple", "Rack Mac", "Rack Mac", "Maple").pipe(
      Stream.tap((label) => Ref.set(current, config(label))),
      Stream.map((label) => ({
        name: label === "Maple" ? null : label,
        label,
        defaultLabel: "Maple",
      })),
    );
    const updates = yield* computerNameConfigUpdates(config("Maple"), () => Ref.get(current)).pipe(
      Effect.provideService(
        ComputerNaming.ComputerNaming,
        ComputerNaming.ComputerNaming.of({
          current: Effect.succeed({ name: null, label: "Maple", defaultLabel: "Maple" }),
          changes,
          rename: () => Effect.die("unused"),
        }),
      ),
    );
    const snapshots = yield* Stream.runCollect(updates);
    expect(snapshots.map((snapshot) => snapshot.config.environment.label)).toEqual([
      "Rack Mac",
      "Maple",
    ]);
    expect(
      snapshots.every((snapshot) => snapshot.type === "snapshot" && snapshot.version === 1),
    ).toBe(true);
    expect(snapshots.every((snapshot) => snapshot.config.cwd === "/workspace")).toBe(true);
  }),
);

it.effect("catches a rename between initial config acquisition and subscription", () =>
  Effect.gen(function* () {
    const renamed = { name: "Orange Pi", label: "Orange Pi", defaultLabel: "Maple" };
    const updates = yield* computerNameConfigUpdates(config("Maple"), () =>
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
