import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { isElectron } from "~/env";

/** Project management will be designed separately from thread navigation. */
export function LibraryProjectsPage() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}
