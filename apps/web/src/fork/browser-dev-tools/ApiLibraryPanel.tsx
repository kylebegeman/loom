import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { DevApiDetails, DevApiShare, DevApiShareResult } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { devEnvironment as dev, runDevCommand } from "./state";
import { randomUUID } from "~/lib/utils";
export default function ApiLibraryPanel({
  threadRef,
  details,
  disabled,
  onUpdated,
}: {
  threadRef: ScopedThreadRef;
  details: DevApiDetails | null;
  disabled: boolean;
  onUpdated: (details: DevApiDetails) => void;
}) {
  const permitted = useAtomValue(dev.apiLibrary.permissionAtom(threadRef.environmentId));
  const [shared, setShared] = useState<DevApiShareResult | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const act = async (action: DevApiShare["action"], sharedId?: string, reviewed = false) => {
    setBusy(true);
    setError("");
    setNote("");
    const input = {
      threadId: threadRef.threadId,
      action,
      ...(details
        ? { workspaceId: details.workspace.id, expectedLocalRevision: details.revision }
        : {}),
      ...(sharedId ? { sharedId } : {}),
      expectedSharedRevision:
        action === "publish"
          ? reviewed
            ? (shared?.catalog.revision ?? 0)
            : (details?.library?.sharedRevision ?? 0)
          : (shared?.catalog.entries.find((e) => e.id === sharedId)?.revision ??
            shared?.catalog.revision ??
            0),
      ...(reviewed && action === "pull" ? { keepLocalCopy: true } : {}),
    };
    const key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, requestId: randomUUID() };
    try {
      const value = await runDevCommand(dev.apiLibrary, {
        environmentId: threadRef.environmentId,
        input: { ...input, requestId: pending.current.requestId },
      });
      setShared(value);
      pending.current = null;
      if (value.details && (action === "publish" || action === "pull")) onUpdated(value.details);
      if (action === "publish")
        setNote(
          "Shared definitions saved to this project. Credential values stay on each computer.",
        );
      if (action === "pull")
        setNote(
          reviewed
            ? "Library version loaded. Your previous work is preserved as a separate local copy."
            : "Project API workspace loaded. Choose this computer's environment to continue.",
        );
      if (action === "remove") setNote("Removed from Library. Local workspaces remain available.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Library is unavailable. Your local workspace is preserved.",
      );
    }
    setBusy(false);
  };
  return (
    <details
      open={!details}
      className="border-b border-border px-4 py-3 text-xs"
      onToggle={(e) => {
        if (e.currentTarget.open && !shared && !busy && permitted) void act("list");
      }}
    >
      <summary className="cursor-pointer font-medium">
        Project APIs{details?.library ? ` · shared revision ${details.library.sharedRevision}` : ""}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">
          Library stores requests, folders, scripts, workflows and environment definitions with your
          project. Credential values, upload files and execution history stay on this computer.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !permitted}
            onClick={() => void act("list")}
          >
            Find project APIs
          </Button>
          {details ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || disabled || !permitted}
                onClick={() => void act("publish")}
              >
                {details.library ? "Publish changes" : "Share with project"}
              </Button>
              {details.library ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !permitted}
                  onClick={() => void act("read", details.library!.sharedId)}
                >
                  Compare with Library
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
        {shared ? (
          <div className="space-y-2">
            {shared.catalog.entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-3"
              >
                <p>
                  {entry.name} · revision {entry.revision}
                </p>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || disabled}
                    onClick={() => void act("read", entry.id)}
                  >
                    Review
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={
                      busy || disabled || Boolean(details && details.library?.sharedId !== entry.id)
                    }
                    onClick={() => void act("pull", entry.id)}
                  >
                    Open project API
                  </Button>
                </div>
              </div>
            ))}
            {shared.catalog.entries.length === 0 ? (
              <p>No API workspaces have been shared with this project yet.</p>
            ) : null}
          </div>
        ) : null}
        {shared?.catalog.selected ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="font-medium">
              {shared.catalog.selected.name} · Library revision {shared.catalog.revision}
            </p>
            {shared.differences.length ? (
              <ul className="max-h-52 space-y-1 overflow-auto">
                {shared.differences.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            ) : (
              <p>No request differences found.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  disabled ||
                  Boolean(details && details.library?.sharedId !== shared.catalog.selected.id)
                }
                onClick={() => void act("pull", shared.catalog.selected!.id, Boolean(details))}
              >
                {details ? "Keep local copy and load Library" : "Open workspace"}
              </Button>
              {details?.library?.sharedId === shared.catalog.selected.id ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => void act("publish", shared.catalog.selected!.id, true)}
                >
                  Replace shared definitions with this copy
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || disabled}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${shared.catalog.selected!.name} from this project's shared APIs? Local copies are preserved.`,
                    )
                  )
                    void act("remove", shared.catalog.selected!.id);
                }}
              >
                Remove from project
              </Button>
            </div>
          </div>
        ) : null}
        {!permitted ? (
          <p role="status">Project management permission is required to share API definitions.</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {note ? <p role="status">{note}</p> : null}
      </div>
    </details>
  );
}
