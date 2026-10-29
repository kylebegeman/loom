import { useState } from "react";
import { MessageSquareIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { LIBRARY_DELETED_FEATURE, type LibraryThreadSummary } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { requestConfirmDialog } from "~/confirmDialog";
import { randomUUID } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";
import { LibraryErrorNotice } from "./LibraryControls";

const PAGE_SIZE = 25;
export function useRecentlyDeletedSupported() {
  const authority = useLibraryAuthority();
  return supportsLoomFeature(
    authority.environment?.serverConfig?.environment.capabilities,
    LIBRARY_DELETED_FEATURE,
  );
}

export function RecentlyDeletedConversations({
  projectId,
  sidebar = false,
}: {
  readonly projectId?: string;
  readonly sidebar?: boolean;
}) {
  const authority = useLibraryAuthority();
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets.at(-1) ?? 0;
  const query = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.threadIndex({
          environmentId: authority.authorityId,
          input: { deleted: true, limit: PAGE_SIZE, offset, ...(projectId ? { projectId } : {}) },
        })
      : null,
  );
  return (
    <div className={sidebar ? "space-y-0.5" : "flex flex-col gap-3"}>
      <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
      {query.isPending ? (
        <p
          role="status"
          className={cn(
            "text-muted-foreground",
            sidebar ? "px-(--sidebar-row-content-inset) py-2 text-xs" : "text-sm",
          )}
        >
          Loading recently deleted conversations...
        </p>
      ) : null}
      {query.isSuccess && !query.data?.threads.length ? (
        <p
          className={cn(
            "text-muted-foreground",
            sidebar ? "px-(--sidebar-row-content-inset) py-2 text-xs" : "text-sm",
          )}
        >
          No recently deleted conversations.
        </p>
      ) : null}
      {(query.data?.threads ?? []).map((thread) => (
        <Link
          key={thread.id}
          to="/library/conversations/$conversationId"
          params={{ conversationId: thread.id }}
          className={cn(
            "flex items-start gap-2 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            sidebar
              ? "px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-sidebar-foreground hover:bg-sidebar-row-hover"
              : "px-3 py-2 hover:bg-muted",
          )}
        >
          {sidebar ? (
            <MessageSquareIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-sidebar-muted-foreground"
            />
          ) : null}
          <span className="min-w-0 truncate">{thread.title || "Untitled conversation"}</span>
        </Link>
      ))}
      <div className={cn("flex gap-2", sidebar && "px-(--sidebar-row-content-inset)")}>
        {offsets.length > 1 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={query.isPending}
            onClick={() => setOffsets(offsets.slice(0, -1))}
          >
            Previous
          </Button>
        ) : null}
        {query.data?.nextOffset != null ? (
          <Button
            size="sm"
            variant="outline"
            disabled={query.isPending}
            onClick={() => setOffsets([...offsets, query.data!.nextOffset!])}
          >
            More deleted conversations
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EraseLibraryConversation({ thread }: { readonly thread: LibraryThreadSummary }) {
  const authority = useLibraryAuthority();
  const navigate = useNavigate();
  const allowed = useLibraryPermission(projectLibrary.eraseConversation, authority.authorityId);
  const erase = useAtomCommand(projectLibrary.eraseConversation, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = useRecentlyDeletedSupported();
  if (!supported || !thread.deleted) return null;
  const submit = async () => {
    if (!authority.authorityId || !allowed || busy) return;
    const confirmed = await requestConfirmDialog(
      `Erase "${thread.title || "Untitled conversation"}" from your Library?\nThis permanently removes its saved history and attachments that no other conversation uses.`,
      { variant: "destructive", confirmLabel: "Erase now" },
    );
    if (confirmed !== true) return;
    setBusy(true);
    setError(null);
    const result = await erase({
      environmentId: authority.authorityId,
      input: { requestId: randomUUID(), id: thread.id },
    }).finally(() => setBusy(false));
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not finish erasing this conversation. Retry to finish cleanup.",
      );
      return;
    }
    await navigate({
      to: "/library/$projectId",
      params: { projectId: thread.projectId },
      search: { view: "conversations" },
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="destructive"
        disabled={!allowed || !authority.connected || busy}
        onClick={() => void submit()}
      >
        {busy ? "Erasing..." : "Erase now"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function LibraryDeletedSettings() {
  const authority = useLibraryAuthority();
  const supported = useRecentlyDeletedSupported();
  const query = useEnvironmentQuery(
    supported && authority.authorityId
      ? projectLibrary.deletedPreferences({ environmentId: authority.authorityId, input: {} })
      : null,
  );
  if (!supported) return null;
  return (
    <SettingsRow
      title="Recently deleted"
      description="Deleted conversations stay readable in your Library until this period ends."
    >
      <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
      {query.data ? (
        <RetentionForm key={query.data.retentionDays} days={query.data.retentionDays} />
      ) : (
        <p role="status">Loading retention setting...</p>
      )}
    </SettingsRow>
  );
}

function RetentionForm({ days }: { readonly days: number }) {
  const authority = useLibraryAuthority();
  const allowed = useLibraryPermission(projectLibrary.setDeletedPreferences, authority.authorityId);
  const save = useAtomCommand(projectLibrary.setDeletedPreferences, { reportFailure: false });
  const [value, setValue] = useState(String(days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = Number(value);
  const submit = async () => {
    if (!authority.authorityId || !Number.isInteger(count) || count < 1 || count > 3650) return;
    setBusy(true);
    setError(null);
    const result = await save({
      environmentId: authority.authorityId,
      input: { requestId: randomUUID(), retentionDays: count },
    }).finally(() => setBusy(false));
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not save the retention setting.");
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Erase deleted conversations after
        <div className="w-24">
          <Input
            aria-label="Days before erasing deleted conversations"
            type="number"
            min={1}
            max={3650}
            value={value}
            disabled={!allowed || busy || !authority.connected}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>{" "}
        days
      </label>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={
            !allowed ||
            busy ||
            !authority.connected ||
            !Number.isInteger(count) ||
            count < 1 ||
            count > 3650 ||
            count === days
          }
          onClick={() => void submit()}
        >
          {busy ? "Saving..." : "Save retention"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
