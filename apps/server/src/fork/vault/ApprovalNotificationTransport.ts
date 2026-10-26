import type { ThreadId } from "@t3tools/contracts";
import type { VaultAccessAction, VaultError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * Carries one new pending request to its approvers. `stubbed` means no channel can carry it and
 * `delivered` that one accepted it. A failure is reported as unconfirmed and never retried.
 * The Library push adapter lives with that packet (library-push/VaultApprovalAlerts.ts).
 */
export class ApprovalNotificationTransport extends Context.Service<
  ApprovalNotificationTransport,
  {
    readonly pending: (notice: {
      readonly requestId: string;
      readonly threadId: ThreadId;
      readonly projectId: string;
      readonly itemId: string;
      readonly action: VaultAccessAction;
      readonly expiresAt: number;
    }) => Effect.Effect<"stubbed" | "delivered", VaultError>;
  }
>()("t3/fork/vault/ApprovalNotificationTransport") {}

export const stub = Layer.succeed(ApprovalNotificationTransport, {
  pending: () => Effect.succeed("stubbed" as const),
});
