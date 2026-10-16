import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import {
  WorkspacePageContainer,
  type WorkspacePageWidth,
} from "~/components/WorkspacePageContainer";
import { isElectron } from "~/env";
import { useLibraryAuthority } from "./state";

export function LibraryPageFrame({
  title,
  width = "wide",
  children,
}: {
  readonly title?: string;
  readonly width?: WorkspacePageWidth;
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
        <WorkspacePageContainer width={width}>
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

/** Sits above a page title; the extra space below separates the way out from the heading. */
export function LibraryBackLink({
  children,
  ...link
}: Pick<LinkProps, "to" | "params"> & { readonly children: ReactNode }) {
  return (
    <Link
      {...link}
      className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      {children}
    </Link>
  );
}
