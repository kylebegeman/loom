import { createFileRoute, redirect } from "@tanstack/react-router";

// fork: project-home -- Files on computers moved into Settings; old links still land there.
export const Route = createFileRoute("/projects/storage")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/project-files", replace: true });
  },
});
