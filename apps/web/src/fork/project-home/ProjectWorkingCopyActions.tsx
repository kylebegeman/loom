import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  projectStorageRolloutLocalFilesLabel,
  projectWorkingCopyActionBlocker,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  PROJECT_CHECKOUT_ACTIONS_FEATURE,
  PROJECT_CHECKOUT_FEATURE,
  type ProjectCheckoutPreview,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect, useMemo, useRef, useState } from "react";

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
import { projectCheckouts } from "~/fork/project-checkout/state";
import type { SidebarProjectGroupMember } from "~/sidebarProjectGrouping";
import { useEnvironment } from "~/state/environments";
import { environmentPresentations } from "~/state/presentation";
import { environmentProjects } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { validateProjectHomeSearch } from "./routeSearch";

type Props = {
  readonly project: SidebarProjectGroupMember;
  readonly projectKey: string | null;
  readonly connected: boolean;
};
type WorkingCopyAction = "release" | "restore";

/** A copy is always reviewed and changed on the computer that owns it. */
export function ProjectWorkingCopyActions(props: Props) {
  const environment = useEnvironment(props.project.environmentId);
  const supported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_CHECKOUT_FEATURE,
  );
  const actionsSupported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_CHECKOUT_ACTIONS_FEATURE,
  );
  const canRead = useEnvironmentScope(props.project.environmentId, AuthOrchestrationReadScope);
  const canRelease = useAtomValue(
    projectCheckouts.release.permissionAtom(props.project.environmentId),
  );
  const canRestore = useAtomValue(
    projectCheckouts.restore.permissionAtom(props.project.environmentId),
  );
  return (
    <WorkingCopyActions
      key={`${props.project.environmentId}:${props.project.id}:${props.project.workspaceRoot}:${props.connected}:${supported}:${actionsSupported}:${canRead}:${canRelease}:${canRestore}`}
      {...props}
      supported={supported}
      actionsSupported={actionsSupported}
      canRead={canRead}
      canRelease={canRelease}
      canRestore={canRestore}
    />
  );
}

function WorkingCopyActions(
  props: Props & {
    readonly supported: boolean;
    readonly actionsSupported: boolean;
    readonly canRead: boolean;
    readonly canRelease: boolean;
    readonly canRestore: boolean;
  },
) {
  const { project } = props;
  const computer = project.environmentLabel ?? "this computer";
  const registry = useContext(RegistryContext);
  const previewAtom = useMemo(
    () =>
      projectCheckouts.preview({
        environmentId: project.environmentId,
        input: { projectId: project.id },
      }),
    [project.environmentId, project.id],
  );
  const ready = props.connected && props.supported && props.canRead;
  const query = useEnvironmentQuery(ready ? previewAtom : null);
  const preview =
    query.data?.projectId === project.id && query.data.workspaceRoot === project.workspaceRoot
      ? query.data
      : null;
  const reviewCopy = useAtomQueryRunner(projectCheckouts.preview, {
    refresh: true,
    reportFailure: false,
  });
  const release = useAtomCommand(projectCheckouts.release, { reportFailure: false });
  const restore = useAtomCommand(projectCheckouts.restore, { reportFailure: false });
  const search = useLocation({ select: (location) => validateProjectHomeSearch(location.search) });
  const selected = search.computer === project.environmentId && search.checkoutId === project.id;
  const [action, setAction] = useState<WorkingCopyAction | null>(null);
  const [review, setReview] = useState<ProjectCheckoutPreview | null>(null);
  const [pending, setPending] = useState<"review" | "save" | null>(null);
  const [message, setMessage] = useState<{ failed: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);

  function assertAccess(operation: WorkingCopyAction) {
    const current = registry.get(environmentPresentations.presentationAtom(project.environmentId));
    const currentProject = registry.get(
      environmentProjects.projectAtom({
        environmentId: project.environmentId,
        projectId: project.id,
      }),
    );
    if (!mounted.current || currentProject?.workspaceRoot !== project.workspaceRoot)
      throw new Error("This working copy changed. Open its current location and review it again.");
    if (
      current?.entry.enabled !== true ||
      current.connection.phase !== "connected" ||
      !supportsLoomFeature(
        current.serverConfig?.environment.capabilities,
        PROJECT_CHECKOUT_ACTIONS_FEATURE,
      ) ||
      !readEnvironmentScope(project.environmentId, AuthOrchestrationReadScope)
    )
      throw new Error(
        "This computer's connection or access changed. Reconnect and review the working copy again.",
      );
    if (!registry.get(projectCheckouts[operation].permissionAtom(project.environmentId)))
      throw new Error("This connection does not have permission to change this working copy.");
  }

  async function begin(next: WorkingCopyAction) {
    if (busy.current || !ready || !props.actionsSupported) return;
    busy.current = true;
    const request = ++generation.current;
    setAction(next);
    setReview(null);
    setPending("review");
    setMessage(null);
    try {
      assertAccess(next);
      const result = await reviewCopy({
        environmentId: project.environmentId,
        input: { projectId: project.id },
      });
      if (!mounted.current || request !== generation.current) return;
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      assertAccess(next);
      if (
        result.value.projectId !== project.id ||
        result.value.workspaceRoot !== project.workspaceRoot
      )
        throw new Error("This working copy moved. Open its current location and review it again.");
      setReview(result.value);
    } catch (error) {
      if (mounted.current && request === generation.current)
        setMessage({
          failed: true,
          text:
            error instanceof Error
              ? error.message
              : "This working copy could not be reviewed. Try again.",
        });
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  async function confirm() {
    if (busy.current || !action || !review || projectWorkingCopyActionBlocker(review, action))
      return;
    busy.current = true;
    setPending("save");
    setMessage(null);
    try {
      assertAccess(action);
      const current = registry.get(previewAtom);
      if (
        current._tag !== "Success" ||
        current.waiting ||
        current.value.reviewToken !== review.reviewToken
      )
        throw new Error(
          "The working copy changed since this review. Review it again before confirming.",
        );
      const request = {
        environmentId: project.environmentId,
        input: { projectId: project.id, reviewToken: review.reviewToken! },
      };
      const result = action === "release" ? await release(request) : await restore(request);
      if (!mounted.current) return;
      if (isAtomCommandInterrupted(result)) return;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if ("outcome" in result.value && result.value.outcome !== "removed") {
        setReview(null);
        setMessage({ failed: true, text: result.value.reason });
      } else {
        setAction(null);
        setReview(null);
        setMessage({
          failed: false,
          text:
            action === "release"
              ? "Working copy removed. Your project and conversations are still here."
              : "Working copy restored and ready to use.",
        });
      }
      query.refresh();
    } catch (error) {
      if (mounted.current) {
        setReview(null);
        setMessage({
          failed: true,
          text:
            error instanceof Error
              ? error.message
              : "The working copy could not be changed. Review it again.",
        });
        query.refresh();
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  const unavailable = !props.connected
    ? `Reconnect ${computer} to use or change this copy.`
    : !props.supported || !props.actionsSupported
      ? "Update Loom on this computer to clone or remove its working copy."
      : !props.canRead
        ? "Project read access is required to review this working copy."
        : null;
  const released = preview?.state === "released";
  const releaseBlocker = preview ? projectWorkingCopyActionBlocker(preview, "release") : null;
  const reviewBlocker = action && review ? projectWorkingCopyActionBlocker(review, action) : null;
  const changing = pending !== null || query.isPending;
  const preferences = props.projectKey ? (
    <Link
      to="/settings/projects"
      search={{
        project: props.projectKey,
        machine: project.environmentId,
        checkout: project.physicalProjectKey,
      }}
      hash="project-checkout-storage"
    />
  ) : null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-muted-foreground" role="status">
          {unavailable ??
            (query.error
              ? "Could not review this working copy."
              : !preview
                ? "Reviewing working copy..."
                : released
                  ? "Removed from this computer"
                  : preview.state === "blocked"
                    ? "Needs attention"
                    : `${preview.ownershipSource ? "Ready to use" : "Existing folder"}${preview.branch ? ` (${preview.branch})` : ""}`)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {props.projectKey && !released ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!props.connected || changing || selected}
              render={
                <Link
                  to="/projects/$projectKey"
                  params={{ projectKey: props.projectKey }}
                  search={{ computer: project.environmentId, checkoutId: project.id }}
                  replace
                  resetScroll={false}
                />
              }
            >
              {selected ? "Selected" : "Use working copy"}
            </Button>
          ) : null}
          {ready && props.actionsSupported ? (
            released ? (
              <Button
                size="xs"
                variant="outline"
                disabled={!props.canRestore || changing}
                onClick={() => void begin("restore")}
              >
                Restore working copy
              </Button>
            ) : (
              <Button
                size="xs"
                variant="ghost-muted"
                disabled={!props.canRelease || changing || !preview || releaseBlocker !== null}
                title={
                  releaseBlocker ??
                  (!props.canRelease ? "This connection cannot remove working copies" : undefined)
                }
                onClick={() => void begin("release")}
              >
                Remove working copy
              </Button>
            )
          ) : null}
          {ready &&
          (query.error ||
            released ||
            (preview?.ownershipSource != null && releaseBlocker !== null)) ? (
            <Button
              size="xs"
              variant="outline"
              disabled={changing}
              onClick={() => {
                setMessage(null);
                query.refresh();
              }}
            >
              Review again
            </Button>
          ) : null}
          {!props.connected ? (
            <Button size="xs" variant="link" render={<Link to="/settings/connections" />}>
              Connections
            </Button>
          ) : null}
        </div>
      </div>
      {preview?.state === "external" && preferences ? (
        <p className="text-xs text-muted-foreground">
          Review file management before removing this existing folder.{" "}
          <Button size="xs" variant="link" render={preferences}>
            Review file management
          </Button>
        </p>
      ) : releaseBlocker && !released ? (
        <p className="text-xs text-muted-foreground">{releaseBlocker}</p>
      ) : null}
      {!action && message ? (
        <p
          role={message.failed ? "alert" : "status"}
          className={message.failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {message.text}
        </p>
      ) : null}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && pending !== "save") {
            generation.current++;
            setAction(null);
            setReview(null);
          }
        }}
      >
        <DialogPopup showCloseButton={pending !== "save"}>
          <DialogHeader>
            <DialogTitle>
              {action === "release" ? "Remove working copy?" : "Restore working copy?"}
            </DialogTitle>
            <DialogDescription>
              {action === "release"
                ? "Your project, resources and conversations stay in Loom. Local changes and unpublished work prevent removal."
                : `Restore the working copy on ${computer}. Your automatic cleanup preference stays the same.`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-1">
              <p className="text-sm font-medium">{computer}</p>
              <p className="wrap-anywhere text-xs text-muted-foreground">{project.workspaceRoot}</p>
            </div>
            {pending === "review" ? (
              <p role="status" className="text-sm text-muted-foreground">
                Reviewing the current working copy...
              </p>
            ) : null}
            {review ? (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>{projectStorageRolloutLocalFilesLabel(review)}</p>
                {review.blockers.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4">
                    {review.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {reviewBlocker ? (
              <p role="status" className="text-sm text-muted-foreground">
                {reviewBlocker}
              </p>
            ) : null}
            {message ? (
              <p role="alert" className="text-sm text-destructive">
                {message.text}
              </p>
            ) : null}
            {pending === null && action && (!review || reviewBlocker) ? (
              <Button size="sm" variant="outline" onClick={() => void begin(action)}>
                Review again
              </Button>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending === "save"}
              onClick={() => {
                generation.current++;
                setAction(null);
                setReview(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={action === "release" ? "destructive" : "default"}
              disabled={pending !== null || !review || reviewBlocker !== null}
              onClick={() => void confirm()}
            >
              {pending === "save"
                ? action === "release"
                  ? "Removing..."
                  : "Restoring..."
                : action === "release"
                  ? "Remove working copy"
                  : "Restore working copy"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
