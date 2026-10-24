import type { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityAccount } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ConnectionAttemptError } from "../connection/model.ts";

export interface IdentityRenewalRequest {
  readonly httpBaseUrl: string;
  readonly environmentId: EnvironmentId;
  readonly identity: LoomIdentityAccount;
  /** The computer carries its open WebSocket over from this session to the renewed one. */
  readonly currentToken: string | null;
}

export type IdentityRenewalOutcome =
  | { readonly _tag: "Renewed"; readonly token: string; readonly expiresAt: number }
  | { readonly _tag: "SignInRequired"; readonly reason: string };

/**
 * Renews a saved Identity connection from the device's refresh grant, and forgets that grant
 * when the connection goes. A plain browser never sees Identity tokens, so it leaves this null
 * and its sign-ins stay manual.
 */
export class IdentityRenewal extends Context.Reference<{
  readonly renew: (
    request: IdentityRenewalRequest,
  ) => Effect.Effect<IdentityRenewalOutcome, ConnectionAttemptError>;
  readonly forget: (request: Omit<IdentityRenewalRequest, "currentToken">) => Effect.Effect<void>;
} | null>("@t3tools/client-runtime/fork/identity-renewal/IdentityRenewal", {
  defaultValue: () => null,
}) {}
