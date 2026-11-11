import { Link } from "@tanstack/react-router";
import type { LibraryAccessRepairDestination } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityAccount } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { SavedIdentitySignIn } from "~/fork/identity/ComputerIdentityAccess";
import { identityProfile } from "~/fork/identity/identityProfile";
import { useEnvironment } from "~/state/environments";
import { LIBRARY_SIGN_IN_TARGET, libraryAccessRepairLink } from "./accessBlock";

type LibrarySignInLinkProps = {
  readonly label?: string;
  readonly onClick?: (() => void) | undefined;
  readonly destination?: LibraryAccessRepairDestination | undefined;
  readonly expectedIdentity?: LoomIdentityAccount | null | undefined;
  readonly libraryEnvironmentId?: EnvironmentId | null | undefined;
};

export function LibrarySignInLink(props: LibrarySignInLinkProps) {
  if (props.destination) return <ContextualSignInLink {...props} destination={props.destination} />;
  return (
    <Button
      size="xs"
      variant="outline"
      render={<Link to="/settings/connections" hash={LIBRARY_SIGN_IN_TARGET} />}
      onClick={props.onClick}
    >
      {props.label ?? "Sign in again"}
    </Button>
  );
}

function ContextualSignInLink({
  label = "Sign in to Loom",
  onClick,
  destination,
  expectedIdentity,
  libraryEnvironmentId,
}: LibrarySignInLinkProps & { readonly destination: LibraryAccessRepairDestination }) {
  const environment = useEnvironment(destination.environmentId);
  const identity = environment ? identityProfile(environment.entry) : undefined;
  const signIn = destination.kind === "computer-sign-in" || destination.kind === "library-sign-in";
  const directSignIn = signIn && environment && identity && expectedIdentity;
  const target = libraryAccessRepairLink(destination, {
    libraryId: libraryEnvironmentId ?? null,
    saved: environment !== null,
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {directSignIn ? (
        <SavedIdentitySignIn
          entry={environment.entry}
          expectedIdentity={expectedIdentity}
          actionLabel={label}
          actionVariant="outline"
        />
      ) : null}
      <Button size="xs" variant="outline" render={<Link {...target} />} onClick={onClick}>
        {directSignIn ? "Review connection settings" : label}
      </Button>
    </div>
  );
}
