import { useState } from "react";
import type {
  ConnectionCatalogEntry,
  EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import { DIRECTORY_PAIRING_REASON_TEXT, savedIdentitySignIn } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { savedIdentitySignInPin } from "@t3tools/shared/fork/identity-grant";
import { Button } from "~/components/ui/button";
import { isElectron } from "~/env";
import { loomIdentityUrl } from "~/rpc/loomIdentity";
import { LoomSignIn } from "./LoomSignIn";
import { identityProfile } from "./identityProfile";
import { identityRenewalAvailable } from "./renewal";
import { useEnvironmentSessionState } from "~/state/session";

/**
 * Identity access lasts at most an hour. Once it lapses the open socket can stay up while the
 * server stops granting scopes, so the session check is the signal, not the connection phase.
 */
function useIdentityExpired(entry: ConnectionCatalogEntry, phase: EnvironmentConnectionPhase) {
  const session = useEnvironmentSessionState(entry.target.environmentId);
  return (
    identityProfile(entry) !== undefined &&
    entry.enabled &&
    (phase === "error" || (phase === "connected" && session.data?.authenticated === false))
  );
}

/**
 * Signs in again over the saved Identity route, pinned to its account and the resource it first
 * signed in with. A browser cannot sign in over a public reach address, so it offers pairing.
 */
function SavedIdentitySignIn({ entry }: { readonly entry: ConnectionCatalogEntry }) {
  const saved = savedIdentitySignIn(entry, isElectron ? "native" : "browser");
  if (saved === null)
    return (
      <p className="text-xs text-muted-foreground">
        {DIRECTORY_PAIRING_REASON_TEXT["reach-browser"]}
      </p>
    );
  return (
    <LoomSignIn
      baseUrl={saved.request.httpBaseUrl}
      expectedEnvironmentId={entry.target.environmentId}
      {...savedIdentitySignInPin(saved.profile)}
      description={false}
      showUnavailable
    />
  );
}

/** Shown on the computer's row so an expired sign-in is visible without opening its details. */
export function ExpiredComputerIdentity({
  entry,
  label,
  phase,
}: {
  readonly entry: ConnectionCatalogEntry;
  readonly label: string;
  readonly phase: EnvironmentConnectionPhase;
}) {
  const profile = identityProfile(entry);
  if (!useIdentityExpired(entry, phase) || !profile) return null;
  return (
    <div role="status" className="mt-1 max-w-md space-y-1 text-xs">
      <p className="text-destructive">Identity access expired</p>
      <p className="text-muted-foreground">
        {phase === "connected"
          ? `This device can still see ${label} but cannot make changes there. Sign in again to restore access.`
          : `Sign in again to reconnect to ${label}.`}
      </p>
      <SavedIdentitySignIn entry={entry} />
    </div>
  );
}

export function SavedComputerIdentity({
  entry,
  phase,
}: {
  readonly entry: ConnectionCatalogEntry;
  readonly phase: EnvironmentConnectionPhase;
}) {
  const profile = identityProfile(entry);
  const expired = useIdentityExpired(entry, phase);
  if (!profile) return null;
  return (
    <section aria-label="Identity access" className="space-y-2">
      <h3 className="text-xs font-medium">Identity access</h3>
      <p className="text-xs text-muted-foreground">
        {profile.identity!.issuer}.{" "}
        {expired
          ? "Access expired. Sign in again from the notice above."
          : identityRenewalAvailable()
            ? "Each sign-in lasts up to an hour. If this computer sets a sign-in limit, Loom renews it on its own until then. Removing this connection signs this device out."
            : "Each sign-in lasts up to an hour. Removing this connection revokes this device's active Identity session."}
      </p>
      {expired ? null : <SavedIdentitySignIn entry={entry} />}
    </section>
  );
}

/** The computer's Identity base URL, or null when the address is not a usable HTTP(S) URL. */
function computerIdentityUrl(address: string) {
  try {
    const value = address.trim();
    return loomIdentityUrl(value.includes("://") ? value : `https://${value}`, "/");
  } catch {
    return null;
  }
}

export function ComputerIdentityConnect({
  address,
  entry,
  onConnected,
}: {
  readonly address: string;
  readonly entry?: ConnectionCatalogEntry;
  readonly onConnected: (environmentId: EnvironmentId) => void;
}) {
  const [checked, setChecked] = useState<{ address: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profile = identityProfile(entry);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        If this computer has Identity configured, sign in using its address above. A pairing code is
        optional for Identity.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={!address.trim()}
        onClick={() => {
          const url = computerIdentityUrl(address);
          if (!url) {
            setError("Enter an HTTP or HTTPS computer address.");
            return;
          }
          setChecked({ address, url });
          setError(null);
        }}
      >
        Check Identity sign-in
      </Button>
      {checked?.address === address ? (
        <LoomSignIn
          key={checked.url}
          baseUrl={checked.url}
          {...(entry ? { expectedEnvironmentId: entry.target.environmentId } : {})}
          {...(profile ? savedIdentitySignInPin(profile) : {})}
          onConnected={onConnected}
          showUnavailable
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
