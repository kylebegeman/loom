import { useEnvironmentQuery } from "~/state/query";
import { useServerConfigs } from "~/state/entities";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { CHECKOUT_RESTORE_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { lanes } from "./state";

export function useThreadCheckoutReleased(threadRef: ScopedThreadRef | null) {
  const configs = useServerConfigs();
  const supported =
    threadRef !== null &&
    supportsLoomFeature(
      configs.get(threadRef.environmentId)?.environment.capabilities,
      CHECKOUT_RESTORE_FEATURE,
    );
  const status = useEnvironmentQuery(
    supported && threadRef
      ? lanes.status({ environmentId: threadRef.environmentId, input: {} })
      : null,
  );
  return status.data && threadRef
    ? (status.data.releasedCheckouts?.includes(threadRef.threadId) ?? false)
    : null;
}

export function CheckoutStatus({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  return useThreadCheckoutReleased(threadRef) ? (
    <span className="text-xs font-normal text-muted-foreground">Checkout released</span>
  ) : null;
}
