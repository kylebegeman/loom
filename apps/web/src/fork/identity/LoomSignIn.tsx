import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { isElectron } from "~/env";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary";
import { readLoomIdentity, loomBrowserLoginUrl, cancelLoomBrowserSignIn } from "~/rpc/loomIdentity";
import { useAtomCommand } from "~/state/use-atom-command";
import { loomSignInDestination } from "./returnTo";
import { connectLoomIdentity } from "./connection";

/** Keep Loom host authentication distinct from the existing T3 Connect account. */
export function LoomSignIn({
  baseUrl,
  expectedEnvironmentId,
  expectedIdentity,
  description = true,
  onConnected,
  showUnavailable = false,
  onAvailabilityChange,
}: {
  readonly baseUrl?: string;
  readonly expectedEnvironmentId?: EnvironmentId;
  readonly expectedIdentity?: import("@t3tools/contracts/fork").LoomIdentityAccount;
  readonly onAvailabilityChange?: (available: boolean) => void;
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
  const ownedSignIn = useRef<string | null>(null);
  const connect = useAtomCommand(connectLoomIdentity, { reportFailure: false });
  useEffect(
    () => () => {
      const target = ownedSignIn.current;
      if (!target || (baseUrl !== undefined && target !== baseUrl)) return;
      if (isElectron) void window.desktopBridge?.cancelLoomSignIn?.({ httpBaseUrl: target });
      else cancelLoomBrowserSignIn(target);
    },
    [baseUrl],
  );
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
          setIdentity(metadata ? { baseUrl: target, metadata } : null);
          onAvailabilityChange?.(
            Boolean(
              metadata?.enabled &&
              (isElectron
                ? metadata.nativeClientId && window.desktopBridge?.signInToLoom
                : metadata.browserLoginEnabled),
            ),
          );
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setChecked(target);
          setIdentity(null);
          onAvailabilityChange?.(false);
        }
      });
    return () => abort.abort();
  }, [baseUrl, checkAttempt, onAvailabilityChange]);
  const active = identity && (!baseUrl || identity.baseUrl === baseUrl) ? identity : null;
  const browserUrl = active
    ? loomBrowserLoginUrl(
        active.baseUrl,
        active.metadata,
        new URL(loomSignInDestination(window.location.href), window.location.href).href,
      )
    : null;
  const crossOriginUnavailable =
    !isElectron &&
    active &&
    new URL(active.baseUrl).origin !== window.location.origin &&
    (!active.metadata.sessionExchangeEnabled ||
      !active.metadata.browserOrigins?.includes(window.location.origin));
  const nativeEnabled =
    active?.metadata.enabled &&
    active.metadata.nativeClientId &&
    window.desktopBridge?.signInToLoom;
  if (!active || crossOriginUnavailable || (isElectron ? !nativeEnabled : !browserUrl))
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
    if (
      (expectedEnvironmentId && expectedEnvironmentId !== active.metadata.environmentId) ||
      (expectedIdentity && expectedIdentity.issuer !== active.metadata.issuer)
    ) {
      setError("This address or Identity provider changed. Review the saved computer connection.");
      return;
    }
    if (!isElectron && new URL(active.baseUrl).origin === window.location.origin) {
      if (browserUrl) window.location.assign(browserUrl);
      return;
    }
    const popup = isElectron
      ? undefined
      : window.open("about:blank", "_blank", "popup,width=520,height=720");
    if (!isElectron && !popup) {
      setError("Allow the sign-in window and try again.");
      return;
    }
    ownedSignIn.current = active.baseUrl;
    setBusy(true);
    setError(null);
    setConnected(false);
    const result = await connect({
      httpBaseUrl: active.baseUrl,
      ...(popup ? { popup } : {}),
      ...(expectedEnvironmentId ? { expectedEnvironmentId } : {}),
      ...(expectedIdentity ? { expectedIdentity } : {}),
    });
    ownedSignIn.current = null;
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
          {busy ? "Waiting for sign-in..." : "Sign in with Identity"}
        </Button>
        {busy ? (
          <Button
            variant="outline"
            onClick={() => {
              if (isElectron)
                void window.desktopBridge?.cancelLoomSignIn?.({ httpBaseUrl: active.baseUrl });
              else cancelLoomBrowserSignIn(active.baseUrl);
            }}
          >
            Cancel sign-in
          </Button>
        ) : null}
      </div>
      {description ? (
        <p className="max-w-lg text-xs text-muted-foreground">
          Use this computer's configured Identity account. When access expires, sign in again.
          Pairing links remain available. T3 Connect uses its own account.
        </p>
      ) : null}
      {connected ? (
        <p role="status" className="text-xs text-muted-foreground">
          Identity connected. This computer is saved on this device.
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
