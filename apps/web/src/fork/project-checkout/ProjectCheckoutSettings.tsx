import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
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

const RETENTION_LABELS = {
  inherit: "Use this computer's cleanup rules",
  keep: "Keep on this computer",
  "release-on-settle": "Release when settled",
} satisfies Record<Retention, string>;

function checkoutStateLabel(preview: ProjectCheckoutPreview) {
  switch (preview.state) {
    case "external":
      return "Folder opened outside Loom";
    case "managed":
      return preview.ownershipSource === "adopted"
        ? "Folder managed by Loom"
        : "Clone managed by Loom";
    case "released":
      return "Working copy released";
    case "blocked":
      return "Needs attention before Loom can manage it";
  }
}

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
    <SettingsSection id="project-checkout-storage" title="Project storage">
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
    ? "Connect this computer to review its project folder."
    : !supported
      ? "Update Loom on this computer to manage an existing project folder. Its files stay where they are."
      : !canRead
        ? "This connection cannot review project folders on this computer."
        : null;

  return reason ? (
    <SettingsRow
      title={computer}
      description={<span className="wrap-anywhere">{project.workspaceRoot}</span>}
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
    try {
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
        setMessage({ failed: false, text: `Saved: ${RETENTION_LABELS[saved.value.retention]}.` });
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
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <>
      <SettingsRow
        title={computer}
        description={
          <span className="wrap-anywhere">{preview?.workspaceRoot ?? project.workspaceRoot}</span>
        }
        status={
          preview
            ? `${checkoutStateLabel(preview)}${preview.ownershipSource ? ` · ${RETENTION_LABELS[preview.retention]}` : ""}`
            : result._tag === "Failure"
              ? "Could not review this folder. Retry to see its current state."
              : "Checking project storage…"
        }
        control={
          <Button size="sm" variant="outline" onClick={review} disabled={saving}>
            {result._tag === "Failure" ? "Retry review" : "Review storage"}
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
            <DialogTitle>Project storage</DialogTitle>
            <DialogDescription>
              Review this primary project folder and choose how Loom keeps its working files.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Computer</dt>
                <dd className="wrap-anywhere">{computer}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Folder</dt>
                <dd className="wrap-anywhere">{preview?.workspaceRoot ?? project.workspaceRoot}</dd>
              </div>
            </dl>
            {result.waiting || result._tag === "Initial" ? (
              <p role="status" className="text-sm text-muted-foreground">
                Refreshing folder review…
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
                <p className="text-sm">{checkoutStateLabel(preview)}</p>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Saved revision</dt>
                    <dd className="wrap-anywhere">
                      {preview.state === "released" ? (
                        "Available when the working folder is restored"
                      ) : (
                        <>
                          {preview.branch ?? "Detached revision"}
                          {preview.head ? ` · ${preview.head.slice(0, 12)}` : " · No commit"}
                        </>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Local files</dt>
                    <dd>
                      {preview.localFiles.trackedChanges} tracked changes,{" "}
                      {preview.localFiles.untrackedFiles} untracked files,{" "}
                      {preview.localFiles.ignoredFiles} ignored files
                      {preview.localFiles.truncated ? " (partial scan)" : ""}
                    </dd>
                  </div>
                </dl>
                {preview.blockers.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Currently protected</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {preview.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {preview.state !== "blocked" ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      These choices apply to the primary project folder. Worktree cleanup has
                      separate rules.
                    </p>
                    <RadioGroup
                      value={retention}
                      onValueChange={(value) => {
                        if (
                          value === "keep" ||
                          value === "release-on-settle" ||
                          (!external && value === "inherit")
                        )
                          setRetentionChoice(value);
                      }}
                      disabled={saving || result.waiting}
                      aria-label="Project folder retention"
                    >
                      <RetentionChoice
                        value="keep"
                        description={
                          preview.state === "released"
                            ? "Restore the primary project folder here and keep it until you change this choice. Setup runs when an agent next uses the project."
                            : "Keep the primary project folder here until you change this choice."
                        }
                      />
                      <RetentionChoice
                        value="release-on-settle"
                        description="Release the working copy after all conversations settle and the safety checks pass. Continuing restores it and runs setup."
                      />
                      {!external ? (
                        <RetentionChoice
                          value="inherit"
                          description="Follow this computer's project checkout cleanup settings."
                        />
                      ) : null}
                    </RadioGroup>
                    {external ? (
                      <p className="text-sm text-muted-foreground">
                        Loom will register this existing folder as managed. Its location, files and
                        conversation history stay together.
                      </p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      Release requires published work and keeps local files, pinned conversations,
                      active work and linked worktrees. The project and conversations remain
                      available.
                    </p>
                    {retention !== "keep" ? (
                      <p className="text-sm font-medium">
                        Saving can release an already settled, eligible working copy during the next
                        cleanup. Permanent application data must live outside the working folder and
                        its disposable lane.
                      </p>
                    ) : null}
                  </>
                ) : null}
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
                  ? "Manage this folder"
                  : preview?.state === "released" && retention === "keep"
                    ? "Restore and keep folder"
                    : "Save storage choice"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function RetentionChoice({ value, description }: { value: Retention; description: string }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3">
      <Radio value={value} />
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium">{RETENTION_LABELS[value]}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
