import { randomUUID } from "~/lib/utils";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  projectLibrary,
  useLibraryProject,
  useLibraryPermission,
  useSelectedLibraryProject,
} from "./state";
import { LibraryPageFrame } from "./LibraryPageFrame";
import { LibrarySetup } from "./LibrarySetup";
import { LibraryErrorNotice, LibrarySection } from "./LibraryControls";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { CopyDialog } from "./CopyDialog";
import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import { LibraryRecoveryDownload } from "./LibraryRecoveryDownload";
import { libraryCopyReadiness } from "./copyChoice";
import { NewConversationDialog } from "./NewConversationDialog";
import { isRepositoryResource, resourceLink } from "./resources";

export function LibraryProjectPage({ projectId }: { readonly projectId: string }) {
  const [showRemovedCopies, setShowRemovedCopies] = useState(false);
  const library = useLibraryProject(projectId, showRemovedCopies);
  const [, selectProject] = useSelectedLibraryProject();
  const [editing, setEditing] = useState(false);
  const [copyAction, setCopyAction] = useState<{
    strategy: "clone" | "reuse";
    hostId?: LibraryWorkingCopy["environmentId"];
    rootPath?: string;
  } | null>(null);
  const [releasing, setReleasing] = useState<LibraryWorkingCopy | null>(null);
  const [conversation, setConversation] = useState<{
    hostId?: LibraryWorkingCopy["environmentId"];
    copyId?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archive = useAtomCommand(projectLibrary.archiveProject, { reportFailure: false });
  const canEdit = useLibraryPermission(projectLibrary.updateProject, library.authorityId);
  const canArchive = useLibraryPermission(projectLibrary.archiveProject, library.authorityId);
  const canRegister = useLibraryPermission(projectLibrary.registerThread, library.authorityId);
  useEffect(() => {
    selectProject(projectId);
  }, [projectId, selectProject]);
  const project = library.project.data;
  const copiesReadiness = libraryCopyReadiness(library.copies);
  const hostLabel = (id: LibraryWorkingCopy["environmentId"]) =>
    library.environments.find((entry) => entry.environmentId === id)?.label ??
    library.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  const setArchived = async () => {
    if (!project || !library.authorityId) return;
    setError(null);
    const result = await archive({
      environmentId: library.authorityId,
      input: {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: project.revision,
        archived: !project.archived,
      },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not update this project.");
    } else library.refresh();
  };
  if (!library.authorityId)
    return (
      <LibraryPageFrame>
        <LibrarySetup />
      </LibraryPageFrame>
    );
  if (!project)
    return (
      <LibraryPageFrame>
        <LibraryErrorNotice error={library.project.error} onRetry={library.project.refresh} />
        <p role="status" className="text-sm text-muted-foreground">
          {library.project.isPending
            ? "Loading project..."
            : "This project is not saved on this device yet. Connect your Library to load it."}
        </p>
      </LibraryPageFrame>
    );
  const activeCopies =
    library.copies.data?.filter((copy) => copy.state !== "released" && copy.registered !== false) ??
    [];
  const visibleCopies = showRemovedCopies ? (library.copies.data ?? []) : activeCopies;
  return (
    <LibraryPageFrame title={project.title}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
          {project.archived ? (
            <p className="text-sm text-muted-foreground">
              Archived project. Restore it to start new work.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!canEdit || !library.connected}
            onClick={() => setEditing(true)}
          >
            Edit project
          </Button>
          <Button
            disabled={!canRegister || !library.connected || project.archived}
            onClick={() => setConversation({})}
          >
            New conversation
          </Button>
        </div>
      </div>
      <LibraryErrorNotice error={library.project.error} onRetry={library.project.refresh} />
      <LibraryErrorNotice error={error} />
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-8">
          <LibrarySection title="Conversations">
            <LibraryErrorNotice error={library.threads.error} onRetry={library.threads.refresh} />
            <div className="divide-y divide-border">
              {library.threads.data
                ?.filter((thread) => !thread.deleted)
                .map((thread) => (
                  <Link
                    key={thread.id}
                    to="/library/conversations/$conversationId"
                    params={{ conversationId: thread.id }}
                    className="block rounded-lg px-3 py-4 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <p className="text-base font-medium">
                      {thread.title || "Untitled conversation"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {hostLabel(thread.environmentId)} ·{" "}
                      {thread.resourceIds.length === 1
                        ? (project.resources.find(
                            (resource) => resource.id === thread.resourceIds[0],
                          )?.title ?? "Saved component")
                        : "Whole project"}{" "}
                      · {thread.status}
                      {thread.archived ? " · Archived" : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Saved to Library {new Date(thread.syncedAt).toLocaleString()}
                    </p>
                  </Link>
                ))}
            </div>
            {library.threads.data?.length === 0 ? (
              <div className="rounded-xl bg-muted/40 p-6">
                <h3 className="font-medium">Where should we start?</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Discuss the whole project, or focus on one component. Your brief goes with every
                  conversation.
                </p>
                <div className="mt-4">
                  <Button
                    size="sm"
                    disabled={!canRegister || !library.connected || project.archived}
                    onClick={() => setConversation({})}
                  >
                    Start a conversation
                  </Button>
                </div>
              </div>
            ) : null}
            {library.threads.isPending && !library.threads.data ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading conversations...
              </p>
            ) : null}
          </LibrarySection>
        </div>
        <aside className="min-w-0 space-y-8" aria-label="Project context">
          <LibrarySection title="Shared brief">
            <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {project.brief ||
                "Add a brief so every conversation starts with the same project context."}
            </p>
          </LibrarySection>
          <LibrarySection
            title="Components and references"
            action={
              <Button
                size="xs"
                variant="outline"
                disabled={!canEdit || !library.connected}
                onClick={() => setEditing(true)}
              >
                Edit components
              </Button>
            }
          >
            <div className="divide-y divide-border">
              {project.resources.map((resource) => {
                const href = resourceLink(resource);
                return (
                  <div
                    key={resource.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-border underline-offset-4"
                          >
                            {resource.title}
                          </a>
                        ) : (
                          resource.title
                        )}
                      </p>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {isRepositoryResource(resource)
                          ? `Folder: ${resource.relativePath}`
                          : resource.url}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {isRepositoryResource(resource) ? "Repository" : "Reference link"}
                    </span>
                  </div>
                );
              })}
            </div>
            {project.resources.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add repositories or reference links when the work needs them.
              </p>
            ) : null}
          </LibrarySection>
        </aside>
      </div>
      <details className="rounded-xl border border-border p-5">
        <summary className="cursor-pointer text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          Files on computers{" "}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {activeCopies.length
              ? `${activeCopies.length} available`
              : "Prepare when you start work"}
          </span>
        </summary>
        <div className="pt-5">
          <LibrarySection
            title="Files on computers"
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  aria-pressed={showRemovedCopies}
                  onClick={() => setShowRemovedCopies((value) => !value)}
                >
                  {showRemovedCopies ? "Hide removed copies" : "Show removed copies"}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!library.connected || project.archived}
                  onClick={() => setCopyAction({ strategy: "reuse" })}
                >
                  Use existing folder
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!library.connected || project.archived}
                  onClick={() => setCopyAction({ strategy: "clone" })}
                >
                  Clone project
                </Button>
              </div>
            }
          >
            <LibraryErrorNotice error={library.copies.error} onRetry={library.copies.refresh} />
            <div className="divide-y divide-border">
              {visibleCopies.map((copy) => {
                const removed = copy.state === "released" || copy.registered === false;
                const hostConnected = library.environments.some(
                  (entry) =>
                    entry.environmentId === copy.environmentId &&
                    entry.entry.enabled &&
                    entry.connection.phase === "connected",
                );
                return (
                  <div
                    key={copy.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">{hostLabel(copy.environmentId)}</p>
                      <p className="text-xs text-muted-foreground">
                        {copy.ownership === "borrowed" ? "Borrowed folder" : "Managed copy"} ·{" "}
                        {copy.registered === false
                          ? "Registration removed"
                          : copy.state === "released"
                            ? "Removed"
                            : copy.state}
                        {copy.projectRevision !== project.revision
                          ? " · Prepared with earlier project context"
                          : ""}
                      </p>
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Locations</summary>
                        <div className="mt-2 space-y-1 break-words font-mono">
                          <p>{copy.rootPath}</p>
                          {copy.repositories.map((repository) => (
                            <p key={repository.resourceId}>{repository.path}</p>
                          ))}
                        </div>
                      </details>
                      {removed && copy.ownership === "borrowed" ? (
                        <p className="max-w-xl text-xs text-muted-foreground">
                          Existing conversations can still use these files. Review the folder again
                          to use it for new work.
                          {!hostConnected
                            ? ` Reconnect ${hostLabel(copy.environmentId)} to review its files.`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {!removed ? (
                          <>
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={!library.connected || !canRegister || project.archived}
                              onClick={() =>
                                setConversation({ hostId: copy.environmentId, copyId: copy.id })
                              }
                            >
                              Start here
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={!library.connected}
                              onClick={() => setReleasing(copy)}
                            >
                              {copy.ownership === "borrowed"
                                ? "Remove registration"
                                : "Remove working copy"}
                            </Button>
                          </>
                        ) : copy.ownership === "borrowed" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={
                              !library.connected ||
                              !canRegister ||
                              project.archived ||
                              !hostConnected
                            }
                            onClick={() =>
                              setCopyAction({
                                strategy: "reuse",
                                hostId: copy.environmentId,
                                rootPath: copy.rootPath,
                              })
                            }
                          >
                            Review existing folder
                          </Button>
                        ) : null}
                      </div>
                      {removed && copy.ownership === "managed" ? (
                        copy.recovery ? (
                          <LibraryRecoveryDownload
                            authorityId={library.authorityId!}
                            connected={library.connected}
                            copy={copy}
                          />
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No verified recovery archive is saved for this copy.
                          </p>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {copiesReadiness === "ready" && visibleCopies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No working copies. The project and conversations stay here. Prepare files when you
                need to work on a computer.
              </p>
            ) : null}
            {copiesReadiness === "loading" ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading working copies...
              </p>
            ) : null}
          </LibrarySection>
        </div>
      </details>
      <div className="pt-2">
        <Button
          size="xs"
          variant="ghost"
          disabled={!canArchive || !library.connected}
          onClick={() => void setArchived()}
        >
          {project.archived ? "Restore project" : "Archive project"}
        </Button>
      </div>
      {editing ? (
        <ProjectEditorDialog
          project={project}
          authorityId={library.authorityId}
          onClose={() => {
            setEditing(false);
            library.refresh();
          }}
          onSaved={() => {
            setEditing(false);
            library.refresh();
          }}
        />
      ) : null}
      {copyAction ? (
        <CopyDialog
          project={project}
          strategy={copyAction.strategy}
          {...(copyAction.hostId ? { initialHostId: copyAction.hostId } : {})}
          {...(copyAction.rootPath ? { initialRootPath: copyAction.rootPath } : {})}
          onClose={() => setCopyAction(null)}
          onSaved={() => {
            setCopyAction(null);
            library.refresh();
          }}
        />
      ) : null}
      {releasing ? (
        <ReleaseCopyDialog
          copy={releasing}
          onClose={() => setReleasing(null)}
          onReleased={() => {
            setReleasing(null);
            library.refresh();
          }}
        />
      ) : null}
      {conversation ? (
        <NewConversationDialog
          project={project}
          copies={library.copies.data ?? []}
          copiesQuery={library.copies}
          {...(conversation.hostId ? { initialHostId: conversation.hostId } : {})}
          {...(conversation.copyId ? { initialCopyId: conversation.copyId } : {})}
          onChanged={library.refresh}
          onClose={() => setConversation(null)}
        />
      ) : null}
    </LibraryPageFrame>
  );
}
