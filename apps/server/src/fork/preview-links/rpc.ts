import {
  PREVIEW_LINKS_WS_METHODS as PL,
  type PreviewLinkLifetimeInput,
  type PreviewLinkOpenInput,
  type PreviewLinkShareInput,
  type PreviewLinksConfigureInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { PreviewLinksService, type PreviewLinkActor } from "./PreviewLinksService.ts";

// The WebSocket refuses MCP credentials, so every caller here is a person in a Loom client.
const owner: PreviewLinkActor = { _tag: "Owner" };

export const makePreviewLinksRpcHandlers = (auth: ForkRpcAuth, session: AuthenticatedSession) =>
  Effect.gen(function* () {
    const service = yield* PreviewLinksService;
    return {
      [PL.watch]: () => auth.stream(PL.watch, service.changes),
      [PL.configure]: (input: PreviewLinksConfigureInput) =>
        auth.effect(PL.configure, service.configure(input)),
      [PL.share]: (input: PreviewLinkShareInput) =>
        auth.effect(PL.share, service.share(input, owner)),
      [PL.open]: (input: PreviewLinkOpenInput) =>
        auth.effect(PL.open, service.open(input, session)),
      [PL.extend]: (input: PreviewLinkLifetimeInput) =>
        auth.effect(PL.extend, service.extend(input)),
      [PL.revoke]: (input: { linkId: string }) =>
        auth.effect(PL.revoke, service.revoke(input.linkId, owner)),
      [PL.restore]: (input: PreviewLinkLifetimeInput) =>
        auth.effect(PL.restore, service.restore(input)),
      [PL.revokeAll]: () => auth.effect(PL.revokeAll, service.revokeAll),
      [PL.signOutBrowsers]: () => auth.effect(PL.signOutBrowsers, service.signOutBrowsers),
    };
  });
