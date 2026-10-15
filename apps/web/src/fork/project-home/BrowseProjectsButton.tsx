import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";

/** Projects is a stable destination from every utility page. */
export function BrowseProjectsButton({
  size = "sm",
  variant = "outline",
  label = "Browse projects",
}: {
  readonly size?: "sm" | "xs";
  readonly variant?: "outline" | "link";
  readonly label?: string;
}) {
  return (
    <Button size={size} variant={variant} render={<Link to="/library" />}>
      {label}
    </Button>
  );
}
