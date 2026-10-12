import { createFileRoute } from "@tanstack/react-router";
import { MonitorIcon } from "lucide-react";
import { Computers } from "~/components/computers/Computers";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";

function ComputersPage() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel="Computers">
          <WorkspaceBreadcrumbItem current>
            <MonitorIcon aria-hidden className="mr-2 size-4 text-muted-foreground" />
            Computers
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer>
          <Computers />
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/computers")({ component: ComputersPage });
