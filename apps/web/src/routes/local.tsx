import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { LibraryPageFrame } from "~/fork/project-library/LibraryPageFrame";
import { Button } from "~/components/ui/button";
export const Route = createFileRoute("/local")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  component: LocalConversations,
});
function LocalConversations() {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  return (
    <LibraryPageFrame title="Local conversations">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Local conversations</h1>
        <p className="text-sm text-muted-foreground">
          Existing computer history remains available here. Add its folder to a Library project when
          you want to organize future work.
        </p>
      </div>
      {projects.map((project) => (
        <section key={`${project.environmentId}:${project.id}`} className="space-y-3">
          <h2 className="text-base font-semibold">
            {project.title}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {environments.find((entry) => entry.environmentId === project.environmentId)?.label}
            </span>
          </h2>
          <div className="divide-y divide-border">
            {threads
              .filter(
                (thread) =>
                  thread.environmentId === project.environmentId && thread.projectId === project.id,
              )
              .map((thread) => (
                <div key={thread.id} className="py-2">
                  <Button
                    variant="link"
                    size="sm"
                    render={
                      <Link
                        to="/$environmentId/$threadId"
                        params={{ environmentId: thread.environmentId, threadId: thread.id }}
                      />
                    }
                  >
                    {thread.title || "Untitled conversation"}
                  </Button>
                </div>
              ))}
          </div>
        </section>
      ))}
    </LibraryPageFrame>
  );
}
