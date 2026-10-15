import { useEffect, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { isElectron } from "~/env";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary";
import { readLoomIdentity, loomBrowserLoginUrl } from "~/rpc/loomIdentity";
import { useAtomCommand } from "~/state/use-atom-command";
import { connectLoomIdentity } from "./connection";

/** Keep Loom host authentication distinct from the existing T3 Connect account. */
export function LoomSignIn({
  baseUrl,
  description = true,
  onConnected,
  showUnavailable = false,
}: {
  readonly baseUrl?: string;
  readonly description?: boolean;
  readonly showUnavailable?: boolean;
  readonly onConnected?: (environmentId: EnvironmentId) => void;
}) {
  const [identity, setIdentity] = useState<{
    baseUrl: string;
    metadata: LoomIdentityMetadata;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const connect = useAtomCommand(connectLoomIdentity, { reportFailure: false });
  useEffect(() => {
    let target = baseUrl;
    try {
      target ??= resolvePrimaryEnvironmentHttpUrl("/");
    } catch {
      return;
    }
    const abort = new AbortController();
    void readLoomIdentity(target, abort.signal, checkAttempt > 0)
      .then((metadata) => {
        if (!abort.signal.aborted) {
          setChecked(target);
          if (metadata) setIdentity({ baseUrl: target, metadata });
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setChecked(target);
      });
    return () => abort.abort();
  }, [baseUrl, checkAttempt]);
  const active = identity && (!baseUrl || identity.baseUrl === baseUrl) ? identity : null;
  const browserUrl = active ? loomBrowserLoginUrl(active.baseUrl, active.metadata) : null;
  const nativeEnabled =
    active?.metadata.enabled &&
    active.metadata.nativeClientId &&
    window.desktopBridge?.signInToLoom;
  if (!active || (isElectron ? !nativeEnabled : !browserUrl))
    return showUnavailable ? (
      <div className="space-y-2">
        <p role="status" className="text-xs text-muted-foreground">
          {checked === baseUrl
            ? "Account sign-in is unavailable at this address. Check the address or use a pairing link."
            : "Checking account sign-in..."}
        </p>
        <Button
          size="xs"
          variant="outline"
          onClick={() => setCheckAttempt((attempt) => attempt + 1)}
        >
          Check again
        </Button>
      </div>
    ) : null;
  const signIn = async () => {
    if (!isElectron) {
      if (browserUrl) window.location.assign(browserUrl);
      return;
    }
    setBusy(true);
    setError(null);
    setConnected(false);
    const result = await connect({ httpBaseUrl: active.baseUrl });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not sign in to Loom.");
    } else {
      setConnected(true);
      onConnected?.(result.value);
    }
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void signIn()}>
          {busy ? "Waiting for sign-in..." : "Sign in to Loom"}
        </Button>
        {busy && window.desktopBridge?.cancelLoomSignIn ? (
          <Button
            variant="outline"
            onClick={() =>
              void window.desktopBridge?.cancelLoomSignIn?.({ httpBaseUrl: active.baseUrl })
            }
          >
            Cancel sign-in
          </Button>
        ) : null}
      </div>
      {description ? (
        <p className="max-w-lg text-xs text-muted-foreground">
          Use your Loom account to access this Library. Computer pairing and T3 Connect remain
          available.
        </p>
      ) : null}
      {connected ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loom account connected. You can select this server as your Library.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
