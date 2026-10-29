import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import { identityRenewalText } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { identityResourceRefusal } from "@t3tools/shared/fork/identity-grant";
import { Button } from "~/components/ui/button";
import { isElectron } from "~/env";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary";
import { readLibraryAuthorityId } from "~/fork/project-library/state";
import {
  LoomAccessRequiredError,
  readLoomIdentity,
  loomBrowserLoginUrl,
  cancelLoomBrowserSignIn,
} from "~/rpc/loomIdentity";
import { useAtomCommand } from "~/state/use-atom-command";
import { loomSignInDestination } from "./returnTo";
import { connectLoomIdentity } from "./connection";
import { identityRenewalAvailable } from "./renewal";

/** Keep Loom host authentication distinct from the existing T3 Connect account. */
interface LoomSignInProps {
  readonly baseUrl?: string;
  readonly expectedEnvironmentId?: EnvironmentId;
  readonly expectedIdentity?: import("@t3tools/contracts/fork").LoomIdentityAccount;
  /**
   * The user typed `baseUrl`. Desktop then refuses a computer that claims to be one your Library
   * knows at other addresses, since anyone can serve a copy of a computer's public metadata.
   */
  readonly typedAddress?: boolean;
  readonly onAvailabilityChange?: (available: boolean) => void;
  readonly description?: boolean;
  readonly showUnavailable?: boolean;
  /** Say how long a sign-in keeps this device connected, from the computer's sign-in limit. */
  readonly renewal?: boolean;
  readonly actionLabel?: string;
  readonly actionVariant?: "default" | "outline";
  readonly onConnected?: (environmentId: EnvironmentId) => void;
}

export function LoomSignIn(props: LoomSignInProps) {
  return <LoomSignInTarget key={props.baseUrl} {...props} />;
}

function LoomSignInTarget({
  baseUrl,
  expectedEnvironmentId,
  expectedIdentity,
  typedAddress = false,
  description = true,
  onConnected,
  showUnavailable = false,
  renewal = false,
  actionLabel = "Sign in with Identity",
  actionVariant = "default",
  onAvailabilityChange,
}: LoomSignInProps) {
  const [identity, setIdentity] = useState<{
    baseUrl: string;
    metadata: LoomIdentityMetadata;
  } | null>(null);
  const [accessTarget, setAccessTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const attempt = useRef(0);
  const ownedSignIn = useRef<string | null>(null);
  const ownedAbort = useRef<AbortController | null>(null);
  const connect = useAtomCommand(connectLoomIdentity, { reportFailure: false });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels this component's pending Loom sign-in through the desktop bridge or browser on unmount or base url change
  useEffect(
    () => () => {
      attempt.current += 1;
      ownedAbort.current?.abort();
      const target = ownedSignIn.current;
      if (!target || (baseUrl !== undefined && target !== baseUrl)) return;
      if (isElectron) void window.desktopBridge?.cancelLoomSignIn?.({ httpBaseUrl: target });
      else cancelLoomBrowserSignIn(target);
    },
    [baseUrl],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches Loom identity metadata from the server, aborting on change or unmount
  useEffect(() => {
    let target = baseUrl;
    try {
      target = target ?? resolvePrimaryEnvironmentHttpUrl("/");
    } catch {
      return;
    }
    const abort = new AbortController();
    void readLoomIdentity(target, abort.signal, checkAttempt > 0)
      .then((metadata) => {
        if (!abort.signal.aborted) {
          setAccessTarget(null);
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
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          const accessRequired = isElectron && cause instanceof LoomAccessRequiredError;
          setAccessTarget(accessRequired ? target : null);
          setChecked(target);
          setIdentity(null);
          onAvailabilityChange?.(accessRequired);
        }
      });
    return () => abort.abort();
  }, [baseUrl, checkAttempt, onAvailabilityChange]);
  const active = identity && (!baseUrl || identity.baseUrl === baseUrl) ? identity : null;
  const nativeAccessTarget =
    isElectron && accessTarget && (!baseUrl || accessTarget === baseUrl) ? accessTarget : null;
  const target = active?.baseUrl ?? nativeAccessTarget;
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
    (nativeAccessTarget || (active?.metadata.enabled && active.metadata.nativeClientId)) &&
    window.desktopBridge?.signInToLoom;
  if (!target || crossOriginUnavailable || (isElectron ? !nativeEnabled : !browserUrl))
    return showUnavailable ? (
      <div className="space-y-2">
        <p role="status" className="text-xs text-muted-foreground">
          {checked !== null && (!baseUrl || checked === baseUrl)
            ? "Account sign-in is unavailable at this address. Check the address or use a pairing link."
            : "Checking account sign-in..."}
        </p>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setChecked(null);
            setCheckAttempt((attempt) => attempt + 1);
          }}
        >
          Check again
        </Button>
      </div>
    ) : null;
  const signIn = async () => {
    if (
      active &&
      ((expectedEnvironmentId && expectedEnvironmentId !== active.metadata.environmentId) ||
        (expectedIdentity && expectedIdentity.issuer !== active.metadata.issuer))
    ) {
      setError("This address or Identity provider changed. Review the saved computer connection.");
      return;
    }
    const resourceRefusal = active ? identityResourceRefusal(active.metadata) : null;
    if (resourceRefusal !== null) {
      setError(resourceRefusal);
      return;
    }
    if (!isElectron && new URL(target).origin === window.location.origin) {
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
    ownedSignIn.current = target;
    setBusy(true);
    setError(null);
    setConnected(false);
    const current = ++attempt.current;
    const abort = new AbortController();
    ownedAbort.current = abort;
    const result = await connect({
      httpBaseUrl: target,
      ...(popup ? { popup } : {}),
      ...(expectedEnvironmentId ? { expectedEnvironmentId } : {}),
      ...(expectedIdentity ? { expectedIdentity } : {}),
      ...(typedAddress ? { typedAddressLibrary: readLibraryAuthorityId() } : {}),
      signal: abort.signal,
    });
    if (current !== attempt.current) return;
    ownedSignIn.current = null;
    ownedAbort.current = null;
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
        <Button variant={actionVariant} disabled={busy} onClick={() => void signIn()}>
          {busy ? "Waiting for sign-in..." : actionLabel}
        </Button>
        {busy ? (
          <Button
            variant="outline"
            onClick={() => {
              ownedAbort.current?.abort();
              if (isElectron)
                void window.desktopBridge?.cancelLoomSignIn?.({ httpBaseUrl: target });
              else cancelLoomBrowserSignIn(target);
            }}
          >
            Cancel sign-in
          </Button>
        ) : null}
      </div>
      {renewal && active ? (
        <p className="max-w-lg text-xs text-muted-foreground">
          {identityRenewalText({ metadata: active.metadata, renews: identityRenewalAvailable() })}
        </p>
      ) : null}
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
