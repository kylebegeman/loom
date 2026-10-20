import type { VaultApprovalRequest, VaultError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class ApprovalNotifications extends Context.Service<
  ApprovalNotifications,
  {
    readonly pending: (request: VaultApprovalRequest) => Effect.Effect<void, VaultError>;
  }
>()("t3/fork/vault/ApprovalNotifications") {}

// Delivery is intentionally absent. The committed inbox is authoritative even without a transport.
export const stub = Layer.succeed(
  ApprovalNotifications,
  ApprovalNotifications.of({ pending: () => Effect.void }),
);
