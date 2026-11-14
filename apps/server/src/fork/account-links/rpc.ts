import { ACCOUNT_LINK_WS_METHODS as LINKS, type AccountLinkPolicy } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { AccountLinkAuthority } from "./AccountLinkAuthority.ts";
import { AccountLinks } from "./AccountLinks.ts";

export const makeAccountLinksRpcHandlers = Effect.fn("AccountLinks.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
  session: AuthenticatedSession,
) {
  const authority = yield* AccountLinkAuthority;
  const links = yield* AccountLinks;
  return {
    [LINKS.policy]: () => auth.effect(LINKS.policy, authority.policy(session)),
    [LINKS.setPolicy]: (input: AccountLinkPolicy) =>
      auth.effect(LINKS.setPolicy, authority.setPolicy(session, input)),
    [LINKS.status]: () => auth.effect(LINKS.status, links.status),
  };
});
