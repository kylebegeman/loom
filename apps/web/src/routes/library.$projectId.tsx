import { createFileRoute } from "@tanstack/react-router";
import { LibraryProjectPage } from "~/fork/project-library/LibraryProjectPage";
import { validateProjectViewSearch } from "~/fork/project-library/projectViews";

export const Route = createFileRoute("/library/$projectId")({
  validateSearch: validateProjectViewSearch,
  component: Page,
});
function Page() {
  return (
    <LibraryProjectPage
      projectId={Route.useParams().projectId}
      view={Route.useSearch().view ?? "overview"}
    />
  );
}
