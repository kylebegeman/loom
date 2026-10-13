import type { ServerConfig, ServerConfigStreamSnapshotEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as ComputerNaming from "./ComputerNaming.ts";

/** Reuses the upstream snapshot event, which older clients already understand. */
export const computerNameConfigUpdates = Effect.fnUntraced(function* <E, R>(
  initial: ServerConfig,
  loadConfig: () => Effect.Effect<ServerConfig, E, R>,
) {
  const naming = yield* ComputerNaming.ComputerNaming;
  return Stream.concat(
    Stream.make(initial.environment.label),
    naming.changes.pipe(Stream.map((state) => state.label)),
  ).pipe(
    Stream.changes,
    Stream.drop(1),
    Stream.mapEffect(() => loadConfig()),
    Stream.map((config): ServerConfigStreamSnapshotEvent => ({
      version: 1,
      type: "snapshot",
      config,
    })),
  );
});
