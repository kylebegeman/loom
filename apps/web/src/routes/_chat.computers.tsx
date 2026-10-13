import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/computers")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/connections", replace: true });
  },
});
