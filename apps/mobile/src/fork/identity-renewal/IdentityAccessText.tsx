import { identityRenewalText } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { AppText as Text } from "../../components/ui/AppText";
import { loadLibraryIdentity } from "../library/libraryIdentity";

/**
 * A saved computer's Identity account and how long a sign-in keeps this phone connected, from the
 * sign-in limit the computer publishes. Until the computer answers, it says nothing about renewal
 * rather than guess.
 */
export function IdentityAccessText(props: {
  readonly environmentId: EnvironmentId;
  readonly issuer: string;
  readonly httpBaseUrl: string | undefined;
}) {
  const { environmentId, httpBaseUrl } = props;
  const [renewal, setRenewal] = useState<{ httpBaseUrl: string; text: string } | null>(null);
  useEffect(() => {
    if (httpBaseUrl === undefined) return;
    const abort = new AbortController();
    loadLibraryIdentity(httpBaseUrl, environmentId, fetch, { signal: abort.signal }).then(
      (metadata) => {
        if (abort.signal.aborted) return;
        // The phone renews whenever the computer allows it.
        setRenewal({ httpBaseUrl, text: identityRenewalText({ metadata, renews: true }) });
      },
      () => undefined,
    );
    return () => abort.abort();
  }, [environmentId, httpBaseUrl]);
  const renewalText = renewal !== null && renewal.httpBaseUrl === httpBaseUrl ? renewal.text : null;
  return (
    <Text className="px-4 py-3 text-sm text-foreground-muted">
      {[`${props.issuer}.`, renewalText, "Sign in with the same account to reconnect."]
        .filter(Boolean)
        .join(" ")}
    </Text>
  );
}
