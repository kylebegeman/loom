import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS,
  projectStorageRolloutStateLabel,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import { Link } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useEnvironment } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { PROJECT_CHECKOUT_FEATURE, projectCheckouts } from "./state";

type CheckoutTarget = {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly environmentLabel?: string | null | undefined;
};

type Retention = ProjectCheckoutPreview["retention"];

function failureMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "The computer could not complete this request. Try reviewing the folder again.";
}

/** Every physical checkout gets its own reviewed choice, even in a grouped project. */
export function ProjectCheckoutSettings({ projects }: { projects: ReadonlyArray<CheckoutTarget> }) {
  return (
    <SettingsSection
      id="project-checkout-storage"
      title="Working files"
      headerAction={
        <Button
          size="xs"
          variant="link"
          render={
            <Link
              to="/settings/project-files"
              search={{ project: undefined, machine: undefined, checkout: undefined }}
            />
          }
        >
          Review all working files
        </Button>
      }
    >
      {projects.map((project) => (
        <CheckoutSetting
          key={`${project.environmentId}:${project.id}:${project.workspaceRoot}`}
          project={project}
        />
      ))}
    </SettingsSection>
  );
}

function CheckoutSetting({ project }: { project: CheckoutTarget }) {
  const environment = useEnvironment(project.environmentId);
  const canRead = useEnvironmentScope(project.environmentId, AuthOrchestrationReadScope);
  const computer = environment?.label ?? project.environmentLabel ?? "This computer";
  const connected = environment?.connection.phase === "connected";
  const supported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_CHECKOUT_FEATURE,
  );
  const reason = !connected
    ? "Connect this computer to review its project files."
    : !supported
      ? "Update Loom on this computer to manage its project files. They stay in their current location."
      : !canRead
        ? "This connection cannot review project files on this computer."
        : null;

  return reason ? (
    <SettingsRow
      title={`Working files on ${computer}`}
      description={
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="block truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            Location: {project.workspaceRoot}
          </TooltipTrigger>
          <TooltipPopup>
            <span className="wrap-anywhere">{project.workspaceRoot}</span>
          </TooltipPopup>
        </Tooltip>
      }
      status={reason}
    />
  ) : (
    <ManagedCheckoutSetting project={project} computer={computer} />
  );
}

function ManagedCheckoutSetting({
  project,
  computer,
}: {
  project: CheckoutTarget;
  computer: string;
}) {
  const registry = useContext(RegistryContext);
  const query = useMemo(
    () =>
      projectCheckouts.preview({
        environmentId: project.environmentId,
        input: { projectId: project.id },
      }),
    [project.environmentId, project.id],
  );
  const result = useAtomValue(query);
  const preview = result._tag === "Success" ? result.value : null;
  const canAdopt = useAtomValue(projectCheckouts.adopt.permissionAtom(project.environmentId));
  const canSetRetention = useAtomValue(
    projectCheckouts.setRetention.permissionAtom(project.environmentId),
  );
  const adopt = useAtomCommand(projectCheckouts.adopt, { reportFailure: false });
  const setRetention = useAtomCommand(projectCheckouts.setRetention, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [retention, setRetentionChoice] = useState<Retention>("keep");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ failed: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const reviewOpenRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reviewOpenRef.current = false;
    };
  }, []);

  const refresh = () => {
    registry.refresh(query);
  };
  const review = () => {
    setMessage(null);
    setRetentionChoice(preview?.ownershipSource ? preview.retention : "keep");
    reviewOpenRef.current = true;
    setOpen(true);
    refresh();
  };
  const external = preview?.ownershipSource === null;
  const canSave = external ? canAdopt : canSetRetention;
  const reviewReady =
    result._tag === "Success" &&
    !result.waiting &&
    preview?.projectId === project.id &&
    preview.reviewToken !== null &&
    preview.state !== "blocked";

  const save = async () => {
    if (
      !mounted.current ||
      !reviewOpenRef.current ||
      savingRef.current ||
      !reviewReady ||
      !preview ||
      !canSave
    )
      return;
    if (external && retention === "inherit") return;
    const current = registry.get(query);
    if (
      current._tag !== "Success" ||
      current.waiting ||
      current.value.reviewToken !== preview.reviewToken
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    const input = { projectId: project.id, reviewToken: preview.reviewToken! };
    const savePreference = async () => {
      const saved = external
        ? await adopt({
            environmentId: project.environmentId,
            input: { ...input, retention: retention === "release-on-settle" ? retention : "keep" },
          })
        : await setRetention({
            environmentId: project.environmentId,
            input: { ...input, retention },
          });
      if (!mounted.current) return;
      if (saved._tag === "Success") {
        reviewOpenRef.current = false;
        setOpen(false);
        setMessage({
          failed: false,
          text: `Saved: ${PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[saved.value.retention]}.`,
        });
        refresh();
      } else if (!isAtomCommandInterrupted(saved)) {
        const error = squashAtomCommandFailure(saved);
        const stale =
          typeof error === "object" &&
          error !== null &&
          "reason" in error &&
          error.reason === "stale-review";
        setMessage({
          failed: true,
          text: stale
            ? "The folder changed since this review. Check the refreshed details before confirming again."
            : failureMessage(error),
        });
        refresh();
      }
    };
    await savePreference().finally(() => {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    });
  };

  return (
    <>
      <SettingsRow
        title={`Working files on ${computer}`}
        description={
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="block truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              Location: {preview?.workspaceRoot ?? project.workspaceRoot}
            </TooltipTrigger>
            <TooltipPopup>
              <span className="wrap-anywhere">
                {preview?.workspaceRoot ?? project.workspaceRoot}
              </span>
            </TooltipPopup>
          </Tooltip>
        }
        status={
          preview
            ? `${projectStorageRolloutStateLabel(preview)}${preview.ownershipSource ? ` · ${PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[preview.retention]}` : ""}`
            : result._tag === "Failure"
              ? "Could not review these files. Retry to see their current state."
              : "Checking working files…"
        }
        control={
          <Button size="sm" variant="outline" onClick={review} disabled={saving}>
            {result._tag === "Failure" ? "Retry review" : "Review working files"}
          </Button>
        }
      >
        {!open && message ? (
          <p
            role={message.failed ? "alert" : "status"}
            className="pb-2 text-xs text-muted-foreground"
          >
            {message.text}
          </p>
        ) : null}
      </SettingsRow>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!savingRef.current) {
            reviewOpenRef.current = next;
            setOpen(next);
          }
        }}
      >
        <DialogPopup showCloseButton={!saving}>
          <DialogHeader>
            <DialogTitle>Working files on {computer}</DialogTitle>
            <DialogDescription>
              These are the files you work on. Your project and conversations stay in Loom, even
              when its working files are removed from this computer.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-1">
              <p className="text-sm font-medium">Location</p>
              <p className="wrap-anywhere text-xs text-muted-foreground">
                {preview?.workspaceRoot ?? project.workspaceRoot}
              </p>
            </div>
            {result.waiting || result._tag === "Initial" ? (
              <p role="status" className="text-sm text-muted-foreground">
                Refreshing file review…
              </p>
            ) : null}
            {result._tag === "Failure" ? (
              <div className="space-y-3">
                <p role="alert" className="text-sm text-destructive">
                  {failureMessage(Cause.squash(result.cause))}
                </p>
                <Button size="sm" variant="outline" onClick={refresh}>
                  Retry review
                </Button>
              </div>
            ) : null}
            {preview ? (
              <>
                <SettingsSection title="Working files" hideTitle>
                  <SettingsRow
                    title={projectStorageRolloutStateLabel(preview)}
                    description={`${preview.localFiles.trackedChanges} tracked changes, ${preview.localFiles.untrackedFiles} untracked files, ${preview.localFiles.ignoredFiles} ignored files${preview.localFiles.truncated ? " (partial scan)" : ""}`}
                  />
                  {preview.state !== "blocked" ? (
                    <SettingsRow
                      title="Files on this computer"
                      description={
                        retention === "keep"
                          ? preview.state === "released"
                            ? "Restore this working copy here and keep it available. Setup runs when work resumes."
                            : "Keep these files at this location until you change this choice."
                          : retention === "release-on-settle"
                            ? "After all work settles, Loom may remove this safe, published working copy. Resume work to restore it."
                            : "Follow this computer's default for keeping or freeing working files."
                      }
                      control={
                        <div className="w-52 max-w-full">
                          <Select
                            value={retention}
                            items={Object.entries(PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS)
                              .filter(([value]) => !external || value !== "inherit")
                              .map(([value, label]) => ({ value, label }))}
                            onValueChange={(value) => {
                              if (
                                value === "keep" ||
                                value === "release-on-settle" ||
                                (!external && value === "inherit")
                              )
                                setRetentionChoice(value);
                            }}
                            disabled={saving || result.waiting}
                          >
                            <SelectTrigger size="sm" aria-label="Working files preference">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectPopup>
                              <SelectItem value="keep">
                                {PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS.keep}
                              </SelectItem>
                              <SelectItem value="release-on-settle">
                                {PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS["release-on-settle"]}
                              </SelectItem>
                              {!external ? (
                                <SelectItem value="inherit">
                                  {PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS.inherit}
                                </SelectItem>
                              ) : null}
                            </SelectPopup>
                          </Select>
                        </div>
                      }
                    />
                  ) : null}
                </SettingsSection>
                {preview.blockers.length > 0 ? (
                  <div className="space-y-1 text-xs">
                    <p className="font-medium">What keeps these files here</p>
                    <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                      {preview.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {preview.state !== "blocked" ? (
                  <>
                    {external ? (
                      <p className="text-xs text-muted-foreground">
                        Allow Loom to manage files at this existing location before it can free
                        space here. This keeps the location and links to your project.
                      </p>
                    ) : null}
                    {retention !== "keep" ? (
                      <p className="text-xs font-medium">
                        If work is already settled, saving may free space during the next cleanup.
                        Loom keeps unpublished changes and local-only files on this computer.
                      </p>
                    ) : null}
                  </>
                ) : null}
                <details className="text-xs text-muted-foreground">
                  <summary className="w-fit cursor-pointer rounded-sm py-1 text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    File safety details
                  </summary>
                  <div className="space-y-2 pt-1">
                    <p className="wrap-anywhere">
                      {preview.state === "released"
                        ? "The saved revision will be restored when you resume work."
                        : `${preview.branch ?? "Detached revision"} · ${preview.head?.slice(0, 12) ?? "No commit"}`}
                    </p>
                    <p>
                      Loom only removes a safe, published working copy. Unpublished changes,
                      local-only files, pinned conversations and active work keep it here. Cleanup
                      checks again before removing anything; this review does not guarantee space
                      can be freed.
                    </p>
                    <p>
                      This choice covers the project's main file location. Additional worktrees have
                      separate cleanup rules. Keep permanent application data outside disposable
                      working copies.
                    </p>
                  </div>
                </details>
              </>
            ) : null}
            {message ? (
              <p
                role={message.failed ? "alert" : "status"}
                className={`text-sm ${message.failed ? "text-destructive" : "text-muted-foreground"}`}
              >
                {message.text}
              </p>
            ) : null}
            {!canSave ? (
              <p className="text-sm text-muted-foreground">
                This connection needs permission to change settings on {computer}.
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                reviewOpenRef.current = false;
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button disabled={saving || !reviewReady || !canSave} onClick={() => void save()}>
              {saving
                ? "Saving…"
                : external
                  ? "Allow Loom to manage files"
                  : preview?.state === "released" && retention === "keep"
                    ? "Restore and keep files"
                    : "Save file preference"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
