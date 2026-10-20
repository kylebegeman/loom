import {
  PREVIEW_LINKS_WS_METHODS as PL,
  type PreviewLinkLifetimeInput,
  type PreviewLinkOpenInput,
  type PreviewLinkShareInput,
  type PreviewLinksConfigureInput,
  type PreviewPageUpdateInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { PreviewPagesService } from "../preview-pages/PreviewPagesService.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { PreviewLinksService, type PreviewLinkActor } from "./PreviewLinksService.ts";

// The WebSocket refuses MCP credentials, so every caller here is a person in a Loom client,
// who sees and changes every page and link of this computer.
const owner: PreviewLinkActor = { _tag: "Owner" };

export const makePreviewLinksRpcHandlers = (auth: ForkRpcAuth, session: AuthenticatedSession) =>
  Effect.gen(function* () {
    const service = yield* PreviewLinksService;
    const pages = yield* PreviewPagesService;
    return {
      // The pages revision rides on the links snapshot so the pages list needs no polling.
      [PL.watch]: () =>
        auth.stream(
          PL.watch,
          service.changes.pipe(
            Stream.zipLatestWith(pages.revisions, (snapshot, pagesRevision) => ({
              ...snapshot,
              pagesRevision,
            })),
          ),
        ),
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
      // Links sign out first; the pages half is best effort and never fails the request.
      [PL.signOutBrowsers]: () =>
        auth.effect(
          PL.signOutBrowsers,
          service.signOutBrowsers.pipe(Effect.andThen(pages.signOutReaders)),
        ),
      [PL.pagesList]: () => auth.effect(PL.pagesList, pages.list()),
      [PL.pagesUpdate]: (input: PreviewPageUpdateInput) =>
        auth.effect(PL.pagesUpdate, pages.update(input)),
    };
  });
