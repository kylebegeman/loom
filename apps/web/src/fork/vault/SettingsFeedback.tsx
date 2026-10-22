import type { ReactNode } from "react";
import type { AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { LoomSettingsActions, LoomSettingsNotice } from "~/fork/settings/parts";

export function VaultQueryFeedback({
  result,
  loading,
  error,
  onRetry,
}: {
  result: Pick<AsyncResult.AsyncResult<unknown, unknown>, "_tag" | "waiting">;
  loading: string;
  error: ReactNode;
  onRetry: () => void;
}) {
  if (result._tag === "Failure") {
    return (
      <LoomSettingsNotice role="alert">
        <div className="flex min-w-0 flex-col items-start gap-3">
          <p>{error}</p>
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={result.waiting}
              onClick={onRetry}
            >
              {result.waiting ? "Retrying…" : "Retry"}
            </Button>
          </LoomSettingsActions>
        </div>
      </LoomSettingsNotice>
    );
  }
  if (result._tag === "Initial" || result.waiting) {
    return <LoomSettingsNotice role="status">{loading}</LoomSettingsNotice>;
  }
  return null;
}
