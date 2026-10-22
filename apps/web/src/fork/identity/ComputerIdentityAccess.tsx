import { useState } from "react";
import { connectionRoutes, type ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import type { EnvironmentId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { loomIdentityUrl } from "~/rpc/loomIdentity";
import { LoomSignIn } from "./LoomSignIn";

function identityProfile(entry?: ConnectionCatalogEntry) {
  return entry
    ? connectionRoutes(entry).flatMap((route) => {
        const profile = Option.getOrNull(route.profile);
        return profile?._tag === "BearerConnectionProfile" && profile.identity ? [profile] : [];
      })[0]
    : undefined;
}

export function SavedComputerIdentity({ entry }: { readonly entry: ConnectionCatalogEntry }) {
  const profile = identityProfile(entry);
  if (!profile) return null;
  return (
    <section aria-label="Identity access" className="space-y-2">
      <h3 className="text-xs font-medium">Identity access</h3>
      <p className="text-xs text-muted-foreground">
        {profile.identity!.issuer}. Sign in again when access expires. Removing this connection
        revokes this device's active Identity session.
      </p>
      <LoomSignIn
        baseUrl={profile.httpBaseUrl}
        expectedEnvironmentId={entry.target.environmentId}
        expectedIdentity={profile.identity!}
        description={false}
        showUnavailable
      />
    </section>
  );
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
          try {
            const value = address.trim();
            const url = loomIdentityUrl(value.includes("://") ? value : `https://${value}`, "/");
            if (!url) throw new Error("Enter an HTTP or HTTPS computer address.");
            setChecked({ address, url });
            setError(null);
          } catch {
            setError("Enter an HTTP or HTTPS computer address.");
          }
        }}
      >
        Check Identity sign-in
      </Button>
      {checked?.address === address ? (
        <LoomSignIn
          key={checked.url}
          baseUrl={checked.url}
          {...(entry ? { expectedEnvironmentId: entry.target.environmentId } : {})}
          {...(profile?.identity ? { expectedIdentity: profile.identity } : {})}
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
