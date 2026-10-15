import { libraryRouteParams, resolveLibrarySelection } from "./selection";
import { Link, useNavigate, useRouterState, useLocation } from "@tanstack/react-router";
import { FolderIcon, PlusIcon, MessageSquareIcon, HistoryIcon } from "lucide-react";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  useSidebar,
} from "~/components/ui/sidebar";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { SidebarChromeHeader, SidebarChromeFooter } from "~/components/sidebar/SidebarChrome";
import { isElectron } from "~/env";
import { useLibraryProjects, useLibraryProject, useSelectedLibraryProject } from "./state";
import { openLibraryAction } from "./actions";

/** Project navigation stays in one place; computers belong to conversations and working copies. */
export function LibrarySidebar() {
  const { setOpenMobile } = useSidebar();
  const closeNavigation = () => setOpenMobile(false);
  const pathname = useLocation({ select: (location) => location.pathname });
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
  const unrelatedThread =
    params.threadId &&
    params.environmentId &&
    library.threads.data !== null &&
    !library.threads.data.some(
      (thread) =>
        thread.threadId === params.threadId && thread.environmentId === params.environmentId,
    );
  const selected = unrelatedThread ? null : selectedProject;
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/library" onClick={closeNavigation} />}
              isActive={pathname === "/library" || pathname === "/library/"}
            >
              <FolderIcon />
              <span>Projects</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => {
                closeNavigation();
                openLibraryAction("create-project");
              }}
            >
              <PlusIcon />
              <span>New project</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mt-4">
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
              closeNavigation();
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
        </div>
        {projects.authorityId && !projects.connected ? (
          <p className="text-xs text-muted-foreground">Library offline</p>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {selected ? (
              <>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={
                      <Link
                        to="/library/$projectId"
                        params={{ projectId: selected.id }}
                        onClick={closeNavigation}
                      />
                    }
                    isActive={params.projectId === selected.id}
                  >
                    <FolderIcon />
                    <span>Project overview</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    disabled={selected.archived || !projects.connected}
                    onClick={() => {
                      closeNavigation();
                      openLibraryAction("new-conversation");
                    }}
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
                        onClick={closeNavigation}
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
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/local" onClick={closeNavigation} />}
                isActive={pathname === "/local" || !!unrelatedThread}
              >
                <HistoryIcon />
                <span>Computer conversations</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <p className="px-2 pt-1 text-xs leading-relaxed text-muted-foreground">
            Earlier work on your connected computers.
          </p>
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
