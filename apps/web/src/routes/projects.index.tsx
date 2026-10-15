import { createFileRoute, redirect } from "@tanstack/react-router";
import { LibraryProjectsPage } from "~/fork/project-library/LibraryProjectsPage";

export const Route = createFileRoute("/projects/")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  component: LibraryProjectsPage,
});
