import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { loomIdentityUrl } from "~/rpc/loomIdentity";
import { LoomSignIn } from "./LoomSignIn";

/** The Library's Identity base URL, or null when the address is not a usable HTTP(S) URL. */
function libraryIdentityUrl(address: string) {
  try {
    return loomIdentityUrl(address.trim(), "/");
  } catch {
    return null;
  }
}

/** Native clients can enroll a Library account before they have a saved computer connection. */
export function LoomLibraryAddress({
  onConnected,
}: {
  readonly onConnected: (environmentId: EnvironmentId) => void;
}) {
  const [address, setAddress] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <details className="space-y-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Sign in to a Library address
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const url = libraryIdentityUrl(address);
          if (!url) {
            setError("Enter an http or https Library address.");
            return;
          }
          setTarget(url);
          setError(null);
        }}
      >
        <label className="grid gap-2">
          Library address
          <Input
            value={address}
            placeholder="https://library.example.com"
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <Button size="sm" variant="outline" type="submit">
          Check sign-in
        </Button>
      </form>
      {target ? (
        <LoomSignIn baseUrl={target} typedAddress onConnected={onConnected} showUnavailable />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </details>
  );
}
