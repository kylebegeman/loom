import { createFileRoute } from "@tanstack/react-router";
import { LibraryProjectPage } from "~/fork/project-library/LibraryProjectPage";
export const Route = createFileRoute("/library/$projectId")({ component: Page });
function Page() {
  return <LibraryProjectPage projectId={Route.useParams().projectId} />;
}
