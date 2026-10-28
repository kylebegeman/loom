import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button, InlineButton } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import {
  WorkspacePageContainer,
  type WorkspacePageWidth,
} from "~/components/WorkspacePageContainer";
import { isElectron } from "~/env";
import { LibraryAccessNotice } from "./LibraryAccessNotice";
import { useLibraryAccessBlock, useLibraryAuthority } from "./state";

const PROJECTS_SECTION = { label: "Projects", to: "/projects" } as const;

export function LibraryPageFrame({
  title,
  heading = false,
  section = PROJECTS_SECTION,
  offlineNotice,
  libraryStatus = true,
  width = "wide",
  style,
  children,
}: {
  readonly title?: string;
  /** The current crumb is the page's h1, for pages with no heading of their own. */
  readonly heading?: boolean;
  /** The page's place in the Library, first in the breadcrumb. */
  readonly section?: { readonly label: string; readonly to: "/projects" | "/sites" | "/loom/bots" };
  /** What still works while the Library server is away. */
  readonly offlineNotice?: string;
  /** Off for pages that report their own connection, such as one served by another server. */
  readonly libraryStatus?: boolean;
  readonly width?: WorkspacePageWidth;
  /** Scopes `--project-color` for pages that are not about one project. */
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}) {
  const authority = useLibraryAuthority();
  // No commands, so this asks only whether the Library session works. An expired session can keep
  // the socket connected while every guarded action on the page turns off.
  const access = useLibraryAccessBlock(libraryStatus ? authority.authorityId : null, []);
  // An expired Identity sign-in can also fail the socket, so sign-in is offered here either way. Any
  // other disconnect keeps the offline line, which says what still works.
  const repairHere = !!access?.repair && (access.repair === "sign-in" || authority.connected);
  return (
    <SidebarInset style={style} className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel={`${section.label} breadcrumb`}>
          {title ? (
            <>
              <WorkspaceBreadcrumbItem>
                <Button size="xs" variant="link" render={<Link to={section.to} />}>
                  {section.label}
                </Button>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
            </>
          ) : null}
          <WorkspaceBreadcrumbItem current>
            {heading ? (
              <h1>
                <WorkspaceBreadcrumbText>{title || section.label}</WorkspaceBreadcrumbText>
              </h1>
            ) : (
              <WorkspaceBreadcrumbText>{title || section.label}</WorkspaceBreadcrumbText>
            )}
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width={width}>
          {repairHere ? (
            <LibraryAccessNotice block={access} />
          ) : libraryStatus && authority.authorityId && !authority.connected ? (
            <p role="status" className="text-xs text-muted-foreground">
              Library offline. {offlineNotice ?? "Saved projects and history remain available."}{" "}
              Reconnect {authority.environment?.label ?? "your Library server"} to save changes.
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
}: Pick<LinkProps, "to" | "params" | "search"> & { readonly children: ReactNode }) {
  return (
    <div className="mb-3 text-sm">
      <InlineButton tone="muted" render={<Link {...link} />}>
        <ArrowLeftIcon aria-hidden className="size-4" />
        {children}
      </InlineButton>
    </div>
  );
}
