import { Link } from "@tanstack/react-router";

import { Button } from "~/components/ui/button";

/** Return to the same project library from configuration and storage pages. */
export function BrowseProjectsButton({
  size = "sm",
  variant = "outline",
  label = "All projects",
}: {
  readonly size?: "sm" | "xs";
  readonly variant?: "outline" | "link";
  readonly label?: string;
}) {
  return (
    <Button
      size={size}
      variant={variant}
      render={
        <Link
          to="/settings/projects"
          search={{ project: undefined, machine: undefined, checkout: undefined }}
        />
      }
    >
      {label}
    </Button>
  );
}
