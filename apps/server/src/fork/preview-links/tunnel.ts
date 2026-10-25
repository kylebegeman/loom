import * as Effect from "effect/Effect";

import { makeCloudflaredRunner } from "../cloudflared/connector.ts";

/**
 * Keeps one cloudflared connector for the preview tunnel running until interrupted. It never
 * completes and never fails; problems surface through `onStatus` and the connector restarts with
 * backoff. The token reaches only the child's environment and is redacted from every message.
 */
export const runPreviewTunnel = makeCloudflaredRunner({
  run: Effect.fn("PreviewTunnel.run"),
  preferPinned: Effect.fn("PreviewTunnel.preferPinned"),
  label: "Preview tunnel",
});
