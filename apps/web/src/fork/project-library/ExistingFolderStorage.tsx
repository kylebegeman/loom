import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useEnvironment } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { PROJECT_CHECKOUT_FEATURE, projectCheckouts } from "../project-checkout/state";
import { LibraryDialog, LibraryErrorNotice } from "./LibraryControls";

type Props = {
  readonly copy: LibraryWorkingCopy;
  readonly online: boolean;
  readonly canAct: boolean;
  readonly onChanged: () => void;
};

function failureMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Could not update these files. Check their status and try again.";
}

export function ExistingFolderStorage({ copy, online, canAct, onChanged }: Props) {
  const environment = useEnvironment(copy.environmentId);
  const canRead = useEnvironmentScope(copy.environmentId, AuthOrchestrationReadScope);
  const supported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_CHECKOUT_FEATURE,
  );
  // A component repository cannot stand in for the project's main folder.
  const projectId =
    copy.rootLocalProjectId ??
    copy.repositories.find((repository) => repository.path === copy.rootPath)?.localProjectId;
  const reason =
    !online || environment?.connection.phase !== "connected"
      ? "Connect this computer to check its files and restore them if needed."
      : !supported
        ? "Update Loom on this computer to manage these files."
        : !canRead
          ? "This connection cannot check files on this computer."
          : !projectId
            ? "This folder cannot be managed here. Its files stay in place."
            : null;
  if (reason || !projectId) return <p className="text-xs text-muted-foreground">{reason}</p>;
  return (
    <FolderStorage
      key={`${copy.id}:${copy.environmentId}:${projectId}:${copy.rootPath}:${canAct}`}
      copy={copy}
      projectId={projectId}
      canAct={canAct}
      onChanged={onChanged}
    />
  );
}

function FolderStorage({
  copy,
  projectId,
  canAct,
  onChanged,
}: Omit<Props, "online"> & { readonly projectId: ProjectId }) {
  const registry = useContext(RegistryContext);
  const query = projectCheckouts.preview({
    environmentId: copy.environmentId,
    input: { projectId },
  });
  const result = useAtomValue(query);
  const preview = result._tag === "Success" ? result.value : null;
  const adoptPermission = projectCheckouts.adopt.permissionAtom(copy.environmentId);
  const retentionPermission = projectCheckouts.setRetention.permissionAtom(copy.environmentId);
  const canAdopt = useAtomValue(adoptPermission);
  const canSetRetention = useAtomValue(retentionPermission);
  const adopt = useAtomCommand(projectCheckouts.adopt, { reportFailure: false });
  const setRetention = useAtomCommand(projectCheckouts.setRetention, { reportFailure: false });
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const consentRef = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks mount state so async storage work skips updates after unmount
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      consentRef.current = false;
    };
  }, []);

  const matches = preview?.projectId === projectId && preview.workspaceRoot === copy.rootPath;
  const external = preview?.state === "external" && preview.ownershipSource === null;
  const released = preview?.state === "released";
  const allowed = canAct && (external ? canAdopt : canSetRetention);
  const ready =
    matches &&
    result._tag === "Success" &&
    !result.waiting &&
    preview.reviewToken !== null &&
    preview.state !== "blocked";
  const kept = preview?.ownershipSource === null || preview?.retention === "keep";
  const refresh = () => registry.refresh(query);
  const closeConfirmation = () => {
    if (savingRef.current) return;
    consentRef.current = false;
    setConfirming(false);
  };
  const save = async (keep: boolean) => {
    if (
      !mounted.current ||
      savingRef.current ||
      !ready ||
      !preview ||
      !allowed ||
      !registry.get(external ? adoptPermission : retentionPermission) ||
      (external && (keep || !consentRef.current))
    )
      return;
    const current = registry.get(query);
    if (
      current._tag !== "Success" ||
      current.waiting ||
      current.value.reviewToken !== preview.reviewToken ||
      current.value.projectId !== projectId ||
      current.value.workspaceRoot !== copy.rootPath
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const input = { projectId, reviewToken: preview.reviewToken! };
    const saved = external
      ? await adopt({
          environmentId: copy.environmentId,
          input: { ...input, retention: "release-on-settle" },
        })
      : await setRetention({
          environmentId: copy.environmentId,
          input: { ...input, retention: keep ? "keep" : "release-on-settle" },
        });
    savingRef.current = false;
    if (!mounted.current) return;
    setSaving(false);
    if (saved._tag === "Success") {
      consentRef.current = false;
      setConfirming(false);
      refresh();
      onChanged();
    } else if (!isAtomCommandInterrupted(saved)) {
      const failure = squashAtomCommandFailure(saved);
      setError(
        typeof failure === "object" &&
          failure !== null &&
          "reason" in failure &&
          failure.reason === "stale-review"
          ? "The folder changed. Check the refreshed details before trying again."
          : failureMessage(failure),
      );
      refresh();
    }
  };
  const change = (keep: boolean) => {
    if (!mounted.current || savingRef.current || !ready || !allowed) return;
    if (external && !keep) {
      setError(null);
      consentRef.current = true;
      setConfirming(true);
      refresh();
    } else if (!external) {
      void save(keep);
    }
  };

  const queryError =
    result._tag === "Failure"
      ? failureMessage(Cause.squash(result.cause))
      : preview && !matches
        ? "This project's file location changed. Refresh the project before changing its files."
        : null;
  return (
    <div className="space-y-2">
      {preview && matches ? (
        released ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Files were removed from this computer. Your project and conversations stay available.
            </p>
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={saving || !ready || !allowed}
              onClick={() => void save(true)}
            >
              {saving ? "Restoring..." : "Restore files"}
            </Button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-start gap-3">
            <Switch
              checked={kept}
              mixed={preview.ownershipSource !== null && preview.retention === "inherit"}
              disabled={saving || !ready || !allowed}
              onCheckedChange={change}
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Keep files on this computer</span>
              <span className="block max-w-lg text-xs leading-relaxed text-muted-foreground">
                {preview.state === "blocked"
                  ? "These files need attention before their storage setting can change."
                  : external
                    ? "This folder stays in place until you allow Loom to manage its files."
                    : kept
                      ? "Files stay available until you change this setting."
                      : preview.retention === "inherit"
                        ? "Using this computer's default. Turn on to keep files here."
                        : "Loom frees space once all work is finished and safely saved. Your project and conversations stay available."}
              </span>
            </span>
          </label>
        )
      ) : null}
      {preview && matches && preview.blockers.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {preview.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
      {preview && matches && !allowed ? (
        <p className="text-xs text-muted-foreground">
          This connection needs permission to change files on this computer.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {result.waiting || result._tag === "Initial" ? (
          <span role="status" className="text-xs text-muted-foreground">
            Checking files...
          </span>
        ) : null}
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          disabled={saving || result.waiting}
          onClick={refresh}
        >
          Check files
        </Button>
      </div>
      <LibraryErrorNotice error={confirming ? null : (queryError ?? error)} />
      <LibraryDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) closeConfirmation();
        }}
        title="Let Loom free space here?"
        description="Loom will manage this folder and may remove its files once all work is finished and safely saved. If work is already finished, cleanup can happen right away. Your project and conversations stay available."
        actions={
          <>
            <Button variant="outline" disabled={saving} onClick={closeConfirmation}>
              Cancel
            </Button>
            <Button
              disabled={saving || !ready || !allowed || !external}
              onClick={() => void save(false)}
            >
              {saving ? "Saving..." : "Allow Loom to manage files"}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="wrap-anywhere">{copy.rootPath}</p>
          <p className="text-muted-foreground">
            Unpublished changes and local-only files keep this folder here. You can restore removed
            files here or resume work to restore them. Setup runs when work resumes.
          </p>
          {preview && matches ? (
            <p className="text-xs text-muted-foreground">
              {preview.localFiles.trackedChanges} tracked changes,{" "}
              {preview.localFiles.untrackedFiles} untracked files, {preview.localFiles.ignoredFiles}{" "}
              ignored files{preview.localFiles.truncated ? " (partial scan)" : ""}
            </p>
          ) : null}
          {preview && matches && preview.blockers.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {preview.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
          {released ? (
            <p role="status">
              Files have already been removed. Cancel, then choose Restore files to bring them back.
            </p>
          ) : preview?.state === "managed" ? (
            <p role="status">The file setting changed. Cancel to see its current setting.</p>
          ) : null}
          {result.waiting ? <p role="status">Checking files...</p> : null}
          <LibraryErrorNotice error={queryError ?? error} onRetry={refresh} />
        </div>
      </LibraryDialog>
    </div>
  );
}
