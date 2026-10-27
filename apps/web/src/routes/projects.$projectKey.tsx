import { createFileRoute, redirect } from "@tanstack/react-router";
import { ProjectHomePage } from "~/fork/project-home/ProjectHomePage"; // fork: project-home
import {
  validateProjectHomeSearch,
  projectHomeDestinationFromSearch,
} from "~/fork/project-home/routeSearch";

export const Route = createFileRoute("/projects/$projectKey")({
  // fork: project-home
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    // fork: project-home -- the route renders ProjectHomePage, not a settings redirect
  },
  // fork: project-home
  validateSearch: validateProjectHomeSearch,
  component: ProjectHomeRoute,
});

// fork: project-home
function ProjectHomeRoute() {
  const { projectKey } = Route.useParams();
  const search = Route.useSearch();
  return (
    <ProjectHomePage
      projectKey={projectKey}
      chosenProjectRef={projectHomeDestinationFromSearch(search)}
    />
  );
}
