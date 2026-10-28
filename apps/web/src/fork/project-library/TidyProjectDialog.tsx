import { CopyRepairActions } from "./CopyRepairActions";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { BrushCleaningIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  type LibraryCopyHealth,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  libraryActiveCopies,
  libraryCopyRemovalPermission,
  libraryTidyReasonLabel,
  libraryTidySuggestions,
  runLibraryTidy,
  supportsLoomFeature,
  type LibraryTidyCopyResult,
  type LibraryTidyResult,
  type ProjectEntry,
} from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryErrorNotice } from "./LibraryControls";
import { ComputerLabel, PathLabel } from "./ProjectIdentity";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";

/** Sits above the card's open-project link, so it opens Tidy instead of the project. */
export function TidyChip({
  entry,
  onTidy,
}: {
  readonly entry: ProjectEntry;
  readonly onTidy: () => void;
}) {
  return (
    <span className="relative z-10 shrink-0">
      <Button
        shape="pill"
        size="xs"
        variant="outline"
        aria-label={`Tidy up ${entry.project.title}`}
        onClick={onTidy}
      >
        <BrushCleaningIcon aria-hidden />
        Tidy
      </Button>
    </span>
  );
}

function useRemovalPermissions(copies: readonly LibraryWorkingCopy[]) {
  const key = JSON.stringify([...new Set(copies.map((copy) => copy.environmentId))].sort());
  const atom = useMemo(
    () => libraryCopyRemovalPermission(projectLibrary, JSON.parse(key) as EnvironmentId[]),
    [key],
  );
  return useAtomValue(atom);
}

const commandValue = <A,>(result: AtomCommandResult<A, unknown>): A => {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
};

/**
 * Winds down a resting project in one confirmation: removes the copies that hold nothing unsaved
 * and archives the project if chosen. Every copy is checked again right before it is removed.
 */
export function TidyProjectDialog({
  entry,
  now,
  onChanged,
  onClose,
}: {
  readonly entry: ProjectEntry;
  readonly now: number;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const authority = useLibraryAuthority();
  const readHealth = useAtomCommand(projectLibrary.readCopyHealth, { reportFailure: false });
  const readStatus = useAtomCommand(projectLibrary.readCopyStatus, { reportFailure: false });
  const release = useAtomCommand(projectLibrary.releaseCopy, { reportFailure: false });
  const unregister = useAtomCommand(projectLibrary.unregisterCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const archive = useAtomCommand(projectLibrary.archiveProject, { reportFailure: false });
  const canRegister = useLibraryPermission(projectLibrary.registerCopy, authority.authorityId);
  const canArchive = useLibraryPermission(projectLibrary.archiveProject, authority.authorityId);
  const host = (id: EnvironmentId) =>
    authority.environments.find((environment) => environment.environmentId === id);
  const connected = (id: EnvironmentId) => host(id)?.connection.phase === "connected";
  const hostLabel = (id: EnvironmentId) =>
    host(id)?.label ??
    authority.computers.find((computer) => computer.environmentId === id)?.label ??
    "Saved computer";
  const [health, setHealth] = useState<readonly LibraryCopyHealth[] | null>(null);
  const [archiveChosen, setArchiveChosen] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<readonly LibraryTidyCopyResult[]>([]);
  const [result, setResult] = useState<LibraryTidyResult | null>(null);
  // Retrying a step after a lost reply reuses its request, so it is never applied twice.
  const requestIds = useRef(new Map<string, string>());
  const requestId = (key: string) => {
    const existing = requestIds.current.get(key);
    if (existing) return existing;
    const created = randomUUID();
    requestIds.current.set(key, created);
    return created;
  };

  const copies = libraryActiveCopies(entry.copies);
  const canRemove = useRemovalPermissions(copies);
  // Read once when the dialog opens, from the copies whose computer can answer.
  const [checkable] = useState(() =>
    copies.filter(
      (copy) =>
        copy.state === "ready" &&
        connected(copy.environmentId) &&
        supportsLoomFeature(
          host(copy.environmentId)?.serverConfig?.environment.capabilities,
          LIBRARY_COPY_HEALTH_FEATURE,
        ),
    ),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads working copy health from each server and drops stale results on change
  useEffect(() => {
    let cancelled = false;
    // An unreadable copy simply has no health, which keeps it out of the safe list.
    void Promise.all(
      checkable.map((copy) =>
        readHealth({ environmentId: copy.environmentId, input: { workingCopyId: copy.id } }).then(
          (read) => (read._tag === "Success" ? [read.value] : []),
        ),
      ),
    ).then((reads) => {
      if (!cancelled) setHealth(reads.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [checkable, readHealth]);

  const suggestions = libraryTidySuggestions({
    entry,
    health: health ?? [],
    connected,
    canRemove,
    now,
  });
  const willArchive = suggestions.suggestArchive && archiveChosen;
  const nothingToDo = !suggestions.safe.length && !willArchive;
  const blocked =
    !authority.authorityId ||
    !authority.connected ||
    (suggestions.safe.length > 0 && !canRegister) ||
    (willArchive && !canArchive);

  const confirm = async () => {
    const authorityId = authority.authorityId;
    if (!authorityId || running) return;
    setRunning(true);
    const outcome = await runLibraryTidy({
      copies: suggestions.safe,
      archive: willArchive,
      connected,
      canRemove,
      readStatus: async (copy) =>
        commandValue(
          await readStatus({
            environmentId: copy.environmentId,
            input: { workingCopyId: copy.id },
          }),
        ),
      remove: async (status, reviewToken) => {
        const remove = status.copy.ownership === "borrowed" ? unregister : release;
        return commandValue(
          await remove({
            environmentId: status.copy.environmentId,
            input: {
              requestId: requestId(`remove:${status.copy.id}`),
              workingCopyId: status.copy.id,
              reviewToken,
            },
          }),
        );
      },
      register: async (copy) => {
        await commandValue(
          await register({
            environmentId: authorityId,
            input: { requestId: requestId(`register:${copy.id}`), copy },
          }),
        );
      },
      archiveProject: async () => {
        await commandValue(
          await archive({
            environmentId: authorityId,
            input: {
              requestId: requestId("archive"),
              projectId: entry.project.id,
              expectedRevision: entry.project.revision,
              archived: true,
            },
          }),
        );
      },
      progress: setProgress,
    });
    setResult(outcome);
    setRunning(false);
    onChanged();
  };

  const settled = new Map(
    (result?.copies ?? progress).map((outcome) => [outcome.copy.id, outcome]),
  );
  const remaining = result?.copies.filter((outcome) => outcome.outcome !== "released") ?? [];
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
      title={`Tidy up ${entry.project.title}`}
      description={
        result
          ? remaining.length || result.archive?.ok === false
            ? "Some of this needs another look. Everything listed below was left as it was."
            : "Done. The project and its saved conversations stay in your Library."
          : "Remove copies that hold nothing unsaved. Quiet projects can also be archived if you are done with them for now."
      }
      actions={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" disabled={running} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={running || health === null || nothingToDo || blocked}
              onClick={() => void confirm()}
            >
              {running ? "Tidying..." : "Tidy up"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {suggestions.suggestArchive || result?.archive ? (
          <section className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm font-medium">
              <Checkbox
                checked={result ? result.archive !== null : archiveChosen}
                disabled={running || result !== null}
                onCheckedChange={(checked) => setArchiveChosen(checked === true)}
              />
              Archive the project
            </label>
            <p className="ps-6 text-xs text-muted-foreground">
              It leaves the project pickers and the current list. Its conversations stay readable,
              and you can restore it any time from Archived.
            </p>
            {result?.archive?.ok === false ? (
              <div className="ps-6">
                <LibraryErrorNotice error={result.archive.message} />
              </div>
            ) : null}
          </section>
        ) : null}
        {health === null && checkable.length ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking each copy for uncommitted and unpushed work...
          </p>
        ) : (
          <>
            <CopyGroup
              title="Safe to remove"
              hint="Nothing uncommitted or unpushed. Each copy is checked again just before it is removed."
              empty={
                copies.length
                  ? "No copy is safe to remove right now."
                  : "No copies on your computers."
              }
              rows={suggestions.safe.map((copy) => ({
                copy,
                detail: rowDetail(copy, settled.get(copy.id), running),
              }))}
              hostLabel={hostLabel}
            />
            {suggestions.attention.length ? (
              <CopyGroup
                title="Needs attention"
                hint="Tidy leaves these alone. Open the project to commit, push or remove them yourself."
                rows={suggestions.attention.map(({ copy, reasons }) => ({
                  copy,
                  detail: reasons.map(libraryTidyReasonLabel).join(" · "),
                  warning: true,
                }))}
                hostLabel={hostLabel}
                onOpen={onClose}
              />
            ) : null}
          </>
        )}
        {blocked && !result ? (
          <p className="text-xs text-muted-foreground">
            {authority.connected
              ? "You do not have permission to change this project."
              : "Connect to your Library to tidy this project."}
          </p>
        ) : null}
      </div>
    </LibraryDialog>
  );
}

function rowDetail(
  copy: LibraryWorkingCopy,
  outcome: LibraryTidyCopyResult | undefined,
  running: boolean,
): string {
  const borrowed = copy.ownership === "borrowed";
  if (!outcome)
    return running
      ? "Waiting..."
      : borrowed
        ? "Stops using this folder. Its files stay."
        : "Removes the files on this computer.";
  switch (outcome.outcome) {
    case "released":
      return borrowed ? "No longer used" : "Removed";
    case "kept":
      return `Kept: ${outcome.reasons.map(libraryTidyReasonLabel).join(" · ")}`;
    case "blocked":
      return `Kept: ${outcome.blockers.join(" ") || "It can't be removed right now."}`;
    case "failed":
      return `Not removed: ${outcome.message}`;
  }
}

function CopyGroup({
  title,
  hint,
  empty,
  rows,
  hostLabel,
  onOpen,
}: {
  readonly onOpen?: () => void;
  readonly title: string;
  readonly hint: string;
  readonly empty?: string;
  readonly rows: readonly {
    readonly copy: LibraryWorkingCopy;
    readonly detail: string;
    readonly warning?: boolean;
  }[];
  readonly hostLabel: (id: EnvironmentId) => string;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-medium">
        {title} <span className="tabular-nums text-muted-foreground">{rows.length}</span>
      </h3>
      <p className="text-xs text-muted-foreground">{rows.length ? hint : empty}</p>
      {rows.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map(({ copy, detail, warning }) => (
            <li key={copy.id} className="space-y-0.5 px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <ComputerLabel
                  environmentId={copy.environmentId}
                  label={hostLabel(copy.environmentId)}
                  className="max-w-40 text-foreground"
                />
                <PathLabel path={copy.rootPath} className="min-w-0" />
              </div>
              <p
                className={
                  warning ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"
                }
              >
                {detail}
              </p>
              {warning && onOpen ? <CopyRepairActions copy={copy} onOpen={onOpen} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
