import { libraryRouteParams, resolveLibrarySelection } from "./selection";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { FolderIcon, PlusIcon, MessageSquareIcon } from "lucide-react";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
} from "~/components/ui/sidebar";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { SidebarChromeHeader, SidebarChromeFooter } from "~/components/sidebar/SidebarChrome";
import { Button } from "~/components/ui/button";
import { isElectron } from "~/env";
import { useLibraryProjects, useLibraryProject, useSelectedLibraryProject } from "./state";
import { openLibraryAction } from "./actions";

/** Project navigation stays in one place; computers belong to conversations and working copies. */
export function LibrarySidebar() {
  const projects = useLibraryProjects(true);
  const [selectedId, selectProject] = useSelectedLibraryProject();
  const params = useRouterState({
    select: (state) => libraryRouteParams(state.matches.at(-1)?.params),
  });
  const effectiveId = params.projectId ?? selectedId;
  const library = useLibraryProject(effectiveId ?? "");
  const selection = resolveLibrarySelection({
    ...(params.projectId ? { routeProjectId: params.projectId } : {}),
    savedProjectId: selectedId,
    catalog: projects.query.data ?? [],
    detail: library.project.data,
  });
  const selectedProject = selection.project;
  const displayedProjects = selection.projects;
  const navigate = useNavigate();
  const selected =
    params.threadId &&
    params.environmentId &&
    !library.threads.data?.some(
      (thread) =>
        thread.threadId === params.threadId && thread.environmentId === params.environmentId,
    )
      ? null
      : selectedProject;
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarHeader>
        <Select
          value={selected?.id ?? "all"}
          items={[
            { value: "all", label: "All projects" },
            ...displayedProjects.map((project) => ({
              value: project.id,
              label: project.title,
            })),
          ]}
          onValueChange={(value) => {
            if (!value || value === "all") {
              selectProject(null);
              void navigate({ to: "/library" });
            } else {
              selectProject(value);
              void navigate({ to: "/library/$projectId", params: { projectId: value } });
            }
          }}
        >
          <SelectTrigger aria-label="Switch project">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">All projects</SelectItem>
            {displayedProjects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.title}
                {project.archived ? " (archived)" : ""}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {projects.authorityId && !projects.connected ? (
          <p className="text-xs text-muted-foreground">Library offline</p>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/library" />}>
                <FolderIcon />
                <span>All projects</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {selected ? (
              <>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link to="/library/$projectId" params={{ projectId: selected.id }} />}
                    isActive={params.projectId === selected.id}
                  >
                    <FolderIcon />
                    <span>Project overview</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    disabled={selected.archived || !projects.connected}
                    onClick={() => openLibraryAction("new-conversation")}
                  >
                    <PlusIcon />
                    <span>New conversation</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </>
            ) : null}
          </SidebarMenu>
        </SidebarGroup>
        {selected ? (
          <SidebarGroup>
            <h2 className="mb-2 px-2 text-xs font-medium text-muted-foreground">Conversations</h2>
            <SidebarMenu>
              {library.threads.data?.map((thread) => (
                <SidebarMenuItem key={thread.id}>
                  <SidebarMenuButton
                    render={
                      <Link
                        to="/library/conversations/$conversationId"
                        params={{ conversationId: thread.id }}
                      />
                    }
                    isActive={
                      params.conversationId === thread.id ||
                      (params.threadId === thread.threadId &&
                        params.environmentId === thread.environmentId)
                    }
                    tooltip={thread.title}
                  >
                    <MessageSquareIcon />
                    <span>{thread.title || "Untitled conversation"}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            {library.threads.data?.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">No conversations yet.</p>
            ) : null}
          </SidebarGroup>
        ) : null}
        <SidebarGroup>
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={!projects.authorityId || !projects.connected}
              onClick={() => openLibraryAction("create-project")}
            >
              New project
            </Button>
            <Button size="xs" variant="ghost" render={<Link to="/local" />}>
              Local conversations
            </Button>
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
