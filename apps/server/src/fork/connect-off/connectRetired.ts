import { EnvironmentHttpForbiddenError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

// apps/server/vite.config.ts bakes true only from LOOM_CONNECT_RETIRED=1, which the publisher sets
// only when connect.json says "enabled": false. Other builds bake false and dev runs and tests
// leave it undefined; none of those may clear a computer's Connect link.
declare const __LOOM_CONNECT_RETIRED__: boolean | undefined;

const isConnectRetiredBuild = () =>
  typeof __LOOM_CONNECT_RETIRED__ !== "undefined" && __LOOM_CONNECT_RETIRED__ === true;

/** Whether this build retires T3 Connect. Tests provide it; the server reads the build. */
export class ConnectRetired extends Context.Reference<boolean>("loom/connect-off/ConnectRetired", {
  defaultValue: isConnectRetiredBuild,
}) {}

const CONNECT_RETIRED_LINK_MESSAGE =
  "This Loom build does not include T3 Connect, so this computer cannot be linked to it.";

/**
 * Startup cleanup alone would let a client that still has Connect re-link the computer, restarting
 * T3's tunnel until the next start and leaving T3 a record nothing here removes.
 */
export const refuseRetiredLink = Effect.gen(function* () {
  if (yield* ConnectRetired) {
    return yield* new EnvironmentHttpForbiddenError({ message: CONNECT_RETIRED_LINK_MESSAGE });
  }
});
