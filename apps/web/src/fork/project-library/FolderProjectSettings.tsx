import { libraryProjectForLocalRefs } from "@t3tools/client-runtime/fork";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import type { SidebarProjectGroupMember } from "~/sidebarProjectGrouping";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary, useLibraryAccessBlock, useLibraryAuthority } from "./state";
import { libraryFolderHolders } from "./folderProjectMatches";
import { ImportProjectDialog } from "./ImportProjectDialog";
import { LibraryAccessNotice } from "./LibraryAccessNotice";

/** Removed managed files retain their explicit identity so settings still reach the same project. */
export function libraryProjectForFolderSettings(
  members: readonly { environmentId: string; id: string }[],
  copies: readonly LibraryWorkingCopy[],
) {
  return libraryProjectForLocalRefs(
    [],
    members.map((member) => ({
      environmentId: member.environmentId,
      projectId: member.id,
    })),
    libraryFolderHolders(copies),
    { includeInactiveCopies: true },
  );
}

export function FolderProjectSettings({
  members,
  explicitFolder,
  children,
}: {
  readonly members: readonly SidebarProjectGroupMember[];
  readonly explicitFolder: boolean;
  readonly children: ReactNode | ((projectId: string | null) => ReactNode);
}) {
  const authority = useLibraryAuthority();
  const navigate = useNavigate();
  const copies = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.copies({
          environmentId: authority.authorityId,
          input: { includeReleased: true },
        })
      : null,
  );
  const projectId = libraryProjectForFolderSettings(members, copies.data ?? []);
  // Adding ends by registering the folder with the Library.
  const access = useLibraryAccessBlock(authority.authorityId, [projectLibrary.registerCopy]);
  const [adding, setAdding] = useState<SidebarProjectGroupMember | null>(null);
  if (projectId && !explicitFolder)
    return (
      <Navigate
        to="/library/$projectId"
        params={{ projectId }}
        search={{ view: "setup" }}
        replace
      />
    );
  return (
    <>
      {authority.authorityId && members.length ? (
        <div className="mx-4 mt-4 space-y-2 rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">
            {projectId
              ? "These are this computer's folder settings. Shared project preferences and files are managed in Projects."
              : "Add this existing folder to Projects to use it from the project chooser and manage its files there."}
          </p>
          {projectId ? null : <LibraryAccessNotice block={access} />}
          <div className="flex flex-wrap gap-2">
            {projectId ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      to="/library/$projectId"
                      params={{ projectId }}
                      search={{ view: "setup" }}
                    />
                  }
                >
                  Project preferences
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  render={
                    <Link
                      to="/library/$projectId"
                      params={{ projectId }}
                      search={{ view: "computers" }}
                    />
                  }
                >
                  Project files
                </Button>
              </>
            ) : (
              members.map((member) => (
                <Button
                  key={member.physicalProjectKey}
                  variant="outline"
                  size="sm"
                  disabled={!authority.connected || access !== null || copies.isPending}
                  onClick={() => setAdding(member)}
                >
                  {members.length === 1 ? "Add folder to Projects" : `Add ${member.title}`}
                </Button>
              ))
            )}
          </div>
        </div>
      ) : null}
      {typeof children === "function" ? children(projectId) : children}
      {adding ? (
        <ImportProjectDialog
          initialHostId={adding.environmentId}
          initialRootPath={adding.workspaceRoot}
          initialTitle={adding.title}
          onClose={() => setAdding(null)}
          onSaved={(project) => {
            setAdding(null);
            copies.refresh();
            void navigate({
              to: "/library/$projectId",
              params: { projectId: project.id },
              search: { view: "setup" },
            });
          }}
        />
      ) : null}
    </>
  );
}
