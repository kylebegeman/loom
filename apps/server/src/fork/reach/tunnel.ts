import * as Effect from "effect/Effect";

import { makeCloudflaredRunner } from "../cloudflared/connector.ts";

/**
 * Keeps this computer's reach connector running until interrupted. It never completes and never
 * fails; problems surface through `onStatus` and the connector restarts with backoff. Reach always
 * passes `tokenFile`, so the token reaches the child only through an owner-only file.
 */
export const runReachTunnel = makeCloudflaredRunner({
  run: Effect.fn("ReachTunnel.run"),
  preferPinned: Effect.fn("ReachTunnel.preferPinned"),
  label: "Reach",
});
