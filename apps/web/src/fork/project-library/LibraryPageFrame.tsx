import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import {
  WorkspacePageContainer,
  type WorkspacePageWidth,
} from "~/components/WorkspacePageContainer";
import { isElectron } from "~/env";
import { useLibraryAuthority } from "./state";

const PROJECTS_SECTION = { label: "Projects", to: "/projects" } as const;

export function LibraryPageFrame({
  title,
  section = PROJECTS_SECTION,
  offlineNotice,
  width = "wide",
  style,
  children,
}: {
  readonly title?: string;
  /** The page's place in the Library, first in the breadcrumb. */
  readonly section?: { readonly label: string; readonly to: "/projects" | "/sites" | "/loom/bots" };
  /** What still works while the Library server is away. */
  readonly offlineNotice?: string;
  readonly width?: WorkspacePageWidth;
  /** Scopes `--project-color` for pages that are not about one project. */
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}) {
  const authority = useLibraryAuthority();
  return (
    <SidebarInset style={style} className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <WorkspacePageHeader electron={isElectron}>
        {title ? (
          <Button size="xs" variant="link" render={<Link to={section.to} />}>
            {section.label}
          </Button>
        ) : (
          <span className="text-sm font-medium">{section.label}</span>
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
