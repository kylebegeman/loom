import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { isElectron } from "~/env";
import { useLibraryAuthority } from "./state";

export function LibraryPageFrame({
  title,
  children,
}: {
  readonly title?: string;
  readonly children: ReactNode;
}) {
  const authority = useLibraryAuthority();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <WorkspacePageHeader electron={isElectron}>
        {title ? (
          <Button size="xs" variant="link" render={<Link to="/projects" />}>
            Projects
          </Button>
        ) : (
          <span className="text-sm font-medium">Projects</span>
        )}
        {title ? (
          <>
            <span aria-hidden="true" className="text-icon-muted">
              /
            </span>
            <span className="min-w-0 truncate text-sm font-medium">{title}</span>
          </>
        ) : null}
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="wide">
          {authority.authorityId && !authority.connected ? (
            <p role="status" className="text-xs text-muted-foreground">
              Library offline. Saved projects and history remain available. Reconnect{" "}
              {authority.environment?.label ?? "your Library server"} to save changes.
            </p>
          ) : null}
          {children}
        </WorkspacePageContainer>
      </main>
    </SidebarInset>
  );
}
