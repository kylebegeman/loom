import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import {
  libraryActiveCopies,
  libraryProjectTimeline,
  type LibraryProjectEvent,
} from "@t3tools/client-runtime/fork";
import { ChevronDownIcon, EllipsisIcon, MonitorIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryErrorNotice, LibrarySection } from "./LibraryControls";
import { LibraryRecoveryDownload } from "./LibraryRecoveryDownload";

export type CopyRequest = {
  readonly strategy: "clone" | "reuse";
  readonly hostId?: EnvironmentId;
  readonly rootPath?: string;
};

const STATE_LABEL: Record<LibraryWorkingCopy["state"], string> = {
  preparing: "Preparing",
  ready: "Ready",
  missing: "Folder missing",
  failed: "Copy failed",
  released: "Removed",
};

/**
 * Where the project currently lives on disk. A copy is disposable: get one to work, remove it
 * when done. Conversations and the project itself never depend on a copy staying around.
 */
export function ProjectCopies({
  project,
  copies,
  loading,
  error,
  onRetry,
  canAct,
  canStart,
  hostLabel,
  hostConnected,
  onGetCopy,
  onStart,
  onRemove,
}: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly canAct: boolean;
  readonly canStart: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly onGetCopy: (request: CopyRequest) => void;
  readonly onStart: (copy: LibraryWorkingCopy) => void;
  readonly onRemove: (copy: LibraryWorkingCopy) => void;
}) {
  const active = libraryActiveCopies(copies);
  const { copyToClipboard } = useCopyToClipboard<string>({
    onCopy: (path) =>
      toastManager.add({ type: "success", title: "Path copied", description: path }),
  });
  return (
    <LibrarySection
      title="On your computers"
      action={
        canAct ? (
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" />}>
              Get a copy
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              <MenuItem onClick={() => onGetCopy({ strategy: "clone" })}>
                Clone to a computer
              </MenuItem>
              <MenuItem onClick={() => onGetCopy({ strategy: "reuse" })}>
                Use a folder I already have
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null
      }
    >
      <LibraryErrorNotice error={error} onRetry={onRetry} />
      {active.length ? (
        <ul className="divide-y divide-border">
          {active.map((copy) => {
            const online = hostConnected(copy.environmentId);
            return (
              <li key={copy.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <MonitorIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {hostLabel(copy.environmentId)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {online ? STATE_LABEL[copy.state] : "Offline"}
                      {copy.projectRevision !== project.revision && copy.state === "ready"
                        ? " · from an earlier version of the project"
                        : ""}
                    </span>
                  </p>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {copy.rootPath}
                  </p>
                </div>
                {copy.state === "ready" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canStart || !online}
                    onClick={() => onStart(copy)}
                  >
                    Start conversation here
                  </Button>
                ) : null}
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Actions for the copy on ${hostLabel(copy.environmentId)}`}
                      />
                    }
                  >
                    <EllipsisIcon />
                  </MenuTrigger>
                  <MenuPopup side="bottom" align="end">
                    <MenuItem onClick={() => copyToClipboard(copy.rootPath, copy.rootPath)}>
                      Copy path
                    </MenuItem>
                    <MenuItem
                      variant="destructive"
                      disabled={!canAct}
                      onClick={() => onRemove(copy)}
                    >
                      {copy.ownership === "borrowed" ? "Stop using this folder" : "Remove copy"}
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </li>
            );
          })}
        </ul>
      ) : loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking your computers...
        </p>
      ) : error ? null : (
        <p className="text-sm text-muted-foreground">
          No copies right now. Get one on any computer when you want to work, and remove it when
          you're done. Conversations stay here either way.
        </p>
      )}
    </LibrarySection>
  );
}

/** A quiet record of copies coming and going, folded away until someone needs it. */
export function ProjectHistory({
  project,
  copies,
  authorityId,
  connected,
  canAct,
  hostLabel,
  hostConnected,
  onReuse,
}: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly canAct: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly onReuse: (request: CopyRequest) => void;
}) {
  const events = libraryProjectTimeline(project, copies);
  const anyRemoved = events.some((event) => event.kind === "copy-removed");
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronDownIcon
          aria-hidden
          className="size-4 -rotate-90 transition-transform group-open:rotate-0"
        />
        History
      </summary>
      <ol className="mt-3 space-y-3 pl-5.5">
        {events.map((event) => (
          <li key={`${event.kind}:${"copy" in event ? event.copy.id : ""}`} className="space-y-1.5">
            <p className="text-sm">
              {describe(event, hostLabel)}
              <span className="ml-2 text-xs text-muted-foreground">
                {formatRelativeTimeLabel(event.at)}
              </span>
            </p>
            {"copy" in event ? (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {event.copy.rootPath}
              </p>
            ) : null}
            {event.kind === "copy-removed" &&
            event.copy.ownership === "managed" &&
            event.copy.recovery ? (
              <LibraryRecoveryDownload
                authorityId={authorityId}
                connected={connected}
                copy={event.copy}
              />
            ) : null}
            {event.kind === "copy-removed" && event.copy.ownership === "borrowed" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={!canAct || !hostConnected(event.environmentId)}
                onClick={() =>
                  onReuse({
                    strategy: "reuse",
                    hostId: event.environmentId,
                    rootPath: event.copy.rootPath,
                  })
                }
              >
                Use this folder again
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      {anyRemoved ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Removing a copy never touches conversations. Folders you brought stay on disk.
        </p>
      ) : null}
    </details>
  );
}

function describe(event: LibraryProjectEvent, hostLabel: (id: EnvironmentId) => string) {
  switch (event.kind) {
    case "created":
      return "Project created";
    case "copy-added":
      return event.copy.ownership === "borrowed"
        ? `Started using a folder on ${hostLabel(event.environmentId)}`
        : `Cloned to ${hostLabel(event.environmentId)}`;
    case "copy-removed":
      return event.copy.ownership === "borrowed"
        ? `Stopped using the folder on ${hostLabel(event.environmentId)}`
        : `Removed the copy from ${hostLabel(event.environmentId)}`;
    case "copy-failed":
      return `Copy failed on ${hostLabel(event.environmentId)}`;
  }
}
