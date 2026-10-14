import { createFileRoute, redirect } from "@tanstack/react-router";
import { ProjectStoragePage } from "~/fork/project-home/ProjectStoragePage"; // fork: project-home

export const Route = createFileRoute("/projects/storage")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  component: ProjectStoragePage,
});
