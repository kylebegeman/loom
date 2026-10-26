import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { libraryProjectForLocalRefs, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useContext, useId, useRef, useState } from "react";
import { PROJECT_CHECKOUT_FEATURE, projectCheckouts } from "~/fork/project-checkout/state";
import { libraryFolderHolders } from "~/fork/project-library/folderProjectMatches";
import { projectLibrary, useLibraryAuthority } from "~/fork/project-library/state";
import { useEnvironment } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

type FolderTarget = {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly workspaceRoot: string;
  readonly isScratch?: boolean;
  readonly environmentLabel?: string | null | undefined;
};

export function ProjectFolderLocation({ project }: { readonly project: FolderTarget }) {
  const environment = useEnvironment(project.environmentId);
  const canUpdate = useAtomValue(projectEnvironment.update.permissionAtom(project.environmentId));
  const connected =
    environment?.entry.enabled === true && environment.connection.phase === "connected";
  const computer = environment?.label ?? project.environmentLabel ?? "this computer";
  const [open, setOpen] = useState(false);
  if (project.isScratch) return null;
  return (
    <>
      <Button
        size="xs"
        variant="link"
        disabled={!connected || !canUpdate}
        title={
          !connected
            ? "Connect this computer to update its folder location."
            : !canUpdate
              ? "This connection cannot change projects on this computer."
              : undefined
        }
        aria-label={`Update folder location on ${computer} at ${project.workspaceRoot}`}
        onClick={() => setOpen(true)}
      >
        Update folder location
      </Button>
      {open ? (
        <FolderLocationDialog
          key={`${project.environmentId}:${project.id}:${project.workspaceRoot}`}
          project={project}
          computer={computer}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function FolderLocationDialog({
  project,
  computer,
  onClose,
}: {
  readonly project: FolderTarget;
  readonly computer: string;
  readonly onClose: () => void;
}) {
  const registry = useContext(RegistryContext);
  const formId = useId();
  const inputId = useId();
  const environment = useEnvironment(project.environmentId);
  const authority = useLibraryAuthority();
  const canRead = useEnvironmentScope(project.environmentId, AuthOrchestrationReadScope);
  const canUpdate = useAtomValue(projectEnvironment.update.permissionAtom(project.environmentId));
  const connected =
    environment?.entry.enabled === true && environment.connection.phase === "connected";
  const supported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_CHECKOUT_FEATURE,
  );
  const copies = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.copies({
          environmentId: authority.authorityId,
          input: { includeReleased: true },
        })
      : null,
  );
  const checkout = useEnvironmentQuery(
    connected && supported && canRead
      ? projectCheckouts.preview({
          environmentId: project.environmentId,
          input: { projectId: project.id },
        })
      : null,
  );
  const libraryCopy = libraryFolderHolders(copies.data ?? []).find((copy) =>
    libraryProjectForLocalRefs(
      [],
      [{ environmentId: project.environmentId, projectId: project.id }],
      [copy],
      { includeInactiveCopies: true },
    ),
  );
  const reason = !connected
    ? "Connect this computer to update its folder location."
    : !canUpdate
      ? "This connection cannot change projects on this computer."
      : !canRead
        ? "This connection cannot check whether Loom manages this folder."
        : !supported
          ? "Update Loom on this computer before changing its folder location."
          : libraryCopy
            ? "Loom manages this location and its recovery. Open Project files to restore the files or choose another location."
            : authority.authorityId && (copies.error || !copies.isSuccess || copies.isPending)
              ? copies.error
                ? `Could not check Project working copies: ${copies.error}`
                : "Checking Project working copies…"
              : checkout.error || !checkout.isSuccess || checkout.isPending
                ? checkout.error
                  ? `Could not check folder management: ${checkout.error}`
                  : "Checking folder management…"
                : checkout.data?.projectId !== project.id ||
                    checkout.data.workspaceRoot !== project.workspaceRoot
                  ? "The saved folder changed. Close this dialog and try again."
                  : checkout.data.ownershipSource !== null
                    ? "Loom manages this folder's location and recovery. Use Working files to review or restore it. Its location cannot be changed here."
                    : null;
  const update = useOrchestrationCommand(projectEnvironment.update, { reportFailure: false });
  const [location, setLocation] = useState(project.workspaceRoot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const nextLocation = location.trim();
  const canSave =
    !reason && !saving && nextLocation !== "" && nextLocation !== project.workspaceRoot;
  const save = async () => {
    if (!canSave || savingRef.current) return;
    if (!registry.get(projectEnvironment.update.permissionAtom(project.environmentId))) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const result = await update({
      environmentId: project.environmentId,
      input: { projectId: project.id, workspaceRoot: nextLocation },
    });
    savingRef.current = false;
    setSaving(false);
    if (result._tag === "Success") onClose();
    else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error ? failure.message : "Could not update the folder location.",
      );
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !savingRef.current && onClose()}>
      <DialogPopup showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Update folder location</DialogTitle>
          <DialogDescription>
            If this folder was renamed or moved on {computer}, enter its current location. This
            changes the saved location only. Files stay in place, and your project and conversations
            are kept.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <p className="wrap-anywhere text-xs text-muted-foreground">
              Saved location: {project.workspaceRoot}
            </p>
            {reason ? (
              <p role="status" className="text-sm text-muted-foreground">
                {reason}
              </p>
            ) : (
              <div className="space-y-2">
                <label htmlFor={inputId} className="text-sm font-medium">
                  Folder location on {computer}
                </label>
                <Input
                  id={inputId}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  font="mono"
                  value={location}
                  disabled={saving}
                  onChange={(event) => setLocation(event.currentTarget.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The folder must already exist on {computer}. No folders will be created or moved.
                </p>
              </div>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {copies.error || checkout.error ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => {
                  copies.refresh();
                  checkout.refresh();
                }}
              >
                Retry checks
              </Button>
            ) : null}
            {libraryCopy ? (
              <Button
                variant="link"
                size="sm"
                render={
                  <Link
                    to="/library/$projectId"
                    params={{ projectId: libraryCopy.projectId }}
                    search={{ view: "computers" }}
                  />
                }
              >
                Open Project files
              </Button>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {saving ? "Saving…" : "Save folder location"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
