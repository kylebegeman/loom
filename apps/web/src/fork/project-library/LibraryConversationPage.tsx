import { LibraryAttachment } from "./LibraryAttachment";
import { libraryArchiveMessages, shouldRefreshLibraryArchive } from "./libraryArchive";
import { LibraryUploadStatus } from "./LibraryUploadStatus";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import ChatMarkdown from "~/components/ChatMarkdown";
import { useEnvironmentQuery } from "~/state/query";
import {
  projectLibrary,
  useLibraryAuthority,
  useLibraryProject,
  useLibraryPermission,
  useSelectedLibraryProject,
} from "./state";
import { LibraryPageFrame } from "./LibraryPageFrame";
import { LibraryErrorNotice } from "./LibraryControls";
import { NewConversationDialog } from "./NewConversationDialog";

export function LibraryConversationPage({ conversationId }: { readonly conversationId: string }) {
  const authority = useLibraryAuthority();
  const [, selectProject] = useSelectedLibraryProject();
  const history = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.history({
          environmentId: authority.authorityId,
          input: { id: conversationId },
        })
      : null,
  );
  const library = useLibraryProject(history.data?.summary.projectId ?? "");
  const canContinue = useLibraryPermission(projectLibrary.registerThread, authority.authorityId);
  const [continuing, setContinuing] = useState(false);
  const [visibleMessages, setVisibleMessages] = useState(50);
  const archive = history.data;
  const messages = useMemo(
    () => (archive ? libraryArchiveMessages(archive.projection) : []),
    [archive],
  );
  const savedProjectId = archive?.summary.projectId;
  const listedThread = library.threads.data?.find((thread) => thread.id === conversationId);
  const refreshArchive = shouldRefreshLibraryArchive(archive?.summary ?? null, listedThread);
  const refreshSequence = refreshArchive
    ? `${conversationId}:${archive?.summary.sequence}:${listedThread?.sequence}`
    : null;
  const refreshHistory = history.refresh;
  useEffect(() => {
    if (refreshSequence !== null) refreshHistory();
  }, [refreshSequence, refreshHistory]);
  useEffect(() => {
    if (savedProjectId) selectProject(savedProjectId);
  }, [savedProjectId, selectProject]);
  const host = authority.environments.find(
    (entry) => entry.environmentId === archive?.summary.environmentId,
  );
  if (!archive)
    return (
      <LibraryPageFrame>
        <LibraryErrorNotice error={history.error} onRetry={history.refresh} />
        <p role="status" className="text-sm text-muted-foreground">
          {history.isPending
            ? "Loading saved conversation..."
            : "This conversation is not saved on this device yet. Connect your Library to load its history."}
        </p>
      </LibraryPageFrame>
    );
  return (
    <LibraryPageFrame title={archive.summary.title}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            to="/library/$projectId"
            params={{ projectId: archive.summary.projectId }}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            {library.project.data?.title ?? "Back to project"}
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{archive.summary.title}</h1>
          <p className="text-xs text-muted-foreground">
            Runs on {host?.label ?? "its original computer"}. Saved to Library{" "}
            {new Date(archive.summary.syncedAt).toLocaleString()}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {host?.connection.phase === "connected" ? (
            <Button
              variant="outline"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{
                    environmentId: archive.summary.environmentId,
                    threadId: archive.summary.threadId,
                  }}
                />
              }
            >
              Open live conversation
            </Button>
          ) : null}
          <Button
            disabled={
              !canContinue ||
              !authority.connected ||
              !library.project.data ||
              library.project.data.archived
            }
            onClick={() => setContinuing(true)}
          >
            Continue elsewhere
          </Button>
        </div>
      </div>
      {host?.connection.phase !== "connected" ? (
        <p className="text-sm text-muted-foreground">
          The original computer is offline. You can read saved history here, reconnect it, or
          continue in a linked conversation on another computer.
        </p>
      ) : null}
      {archive.summary.continuationOf ? (
        <p className="text-xs text-muted-foreground">
          Linked continuation from conversation {archive.summary.continuationOf.threadId}.
        </p>
      ) : null}
      {host?.connection.phase === "connected" ? (
        <LibraryUploadStatus
          environmentId={archive.summary.environmentId}
          threadId={archive.summary.threadId}
          onSynced={history.refresh}
        />
      ) : null}
      <LibraryErrorNotice error={history.error} onRetry={history.refresh} />
      {messages.length > visibleMessages ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVisibleMessages((count) => count + 50)}
          >
            Show earlier messages
          </Button>
          <p className="text-xs text-muted-foreground">
            Showing the most recent {visibleMessages} of {messages.length} saved messages.
          </p>
        </div>
      ) : null}
      <div className="divide-y divide-border">
        {messages.slice(-visibleMessages).map((message) => (
          <article key={message.id} className="space-y-3 py-5">
            <h2 className="text-xs font-semibold text-muted-foreground">
              {message.role === "user"
                ? "You"
                : message.role === "assistant"
                  ? "Agent"
                  : "Project context"}
            </h2>
            <ChatMarkdown text={message.text} cwd={undefined} />
            {authority.authorityId && (message.attachments?.length ?? 0) ? (
              <div className="flex flex-wrap gap-3">
                {message.attachments?.map((attachment) => (
                  <LibraryAttachment
                    key={attachment.id}
                    authorityId={authority.authorityId!}
                    sourceEnvironmentId={archive.summary.environmentId}
                    attachment={attachment}
                  />
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No messages yet. Open the live conversation to start.
        </p>
      ) : null}
      {continuing && library.project.data ? (
        <NewConversationDialog
          project={library.project.data}
          copies={library.copies.data ?? []}
          copiesQuery={library.copies}
          continuation={archive.summary}
          onChanged={library.refresh}
          onClose={() => setContinuing(false)}
        />
      ) : null}
    </LibraryPageFrame>
  );
}
