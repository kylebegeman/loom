import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { LIBRARY_SIGN_IN_TARGET } from "./accessBlock";

export function LibrarySignInLink({
  label = "Sign in again",
  onClick,
}: {
  readonly label?: string;
  readonly onClick?: (() => void) | undefined;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      render={<Link to="/settings/connections" hash={LIBRARY_SIGN_IN_TARGET} />}
      {...(onClick ? { onClick } : {})}
    >
      {label}
    </Button>
  );
}
