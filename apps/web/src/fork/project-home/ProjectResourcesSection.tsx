import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  PROJECT_RESOURCES_FEATURE,
  PROJECT_RESOURCES_LIMIT,
  type ProjectResource,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { ExternalLinkIcon, GitForkIcon, LinkIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { isWebUrl } from "~/browser/browserLinkTarget";
import { useOpenLink } from "~/browser/useOpenLink";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ensureLocalApi } from "~/localApi";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { randomUUID } from "~/lib/utils";
import { useEnvironment } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectResources } from "./projectResourcesState";

export function ProjectResourcesSection({
  project,
  onCloneResource,
}: {
  project: EnvironmentProject & { readonly environmentLabel?: string | null | undefined };
  onCloneResource: (resource: ProjectResource) => void;
}) {
  const environment = useEnvironment(project.environmentId);
  const canRead = useEnvironmentScope(project.environmentId, AuthOrchestrationReadScope);
  const connected = environment?.connection.phase === "connected";
  const supported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_RESOURCES_FEATURE,
  );
  const unavailable = !connected
    ? "Reconnect this computer to see and change its saved resources."
    : !supported
      ? "Update Loom on this computer to save project resources."
      : !canRead
        ? "This connection cannot read this project's resources."
        : null;
  const primary = project.repositoryIdentity;
  // The canonical locator can name upstream while this checkout belongs to a fork.
  const primaryUrl = primary?.origin
    ? primary.origin.canonicalKey.startsWith("github.com/")
      ? `https://${primary.origin.canonicalKey}`
      : null
    : (primary?.webUrl ?? primary?.locator.remoteUrl);
  return (
    <section aria-labelledby="project-resources-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="project-resources-heading" className="text-base font-semibold">
          Resources
        </h2>
        <p className="text-xs text-muted-foreground">
          Saved with this project on{" "}
          {environment?.label ?? project.environmentLabel ?? "this computer"}
        </p>
      </div>
      {primary && primaryUrl ? (
        <ResourceRow
          resource={{
            id: "primary-repository",
            kind: "repository",
            title: primary.origin?.displayName ?? primary.displayName ?? project.title,
            url: primaryUrl,
          }}
          webUrl={primaryUrl}
          primary
        />
      ) : null}
      {unavailable ? (
        <p role="status" className="text-sm text-muted-foreground">
          {unavailable}
        </p>
      ) : (
        <SavedResources
          key={`${project.environmentId}:${project.id}`}
          project={project}
          onCloneResource={onCloneResource}
        />
      )}
    </section>
  );
}

function SavedResources({
  project,
  onCloneResource,
}: {
  project: EnvironmentProject;
  onCloneResource: (resource: ProjectResource) => void;
}) {
  const registry = useContext(RegistryContext);
  const query = useMemo(
    () =>
      projectResources.get({
        environmentId: project.environmentId,
        input: { projectId: project.id },
      }),
    [project.environmentId, project.id],
  );
  const result = useAtomValue(query);
  const readFailure = result._tag === "Failure" ? Cause.squash(result.cause) : null;
  const snapshot =
    result._tag === "Success" && result.value.projectId === project.id ? result.value : null;
  const ready = snapshot !== null && !result.waiting;
  const canAdd = useAtomValue(projectResources.upsert.permissionAtom(project.environmentId));
  const canRemove = useAtomValue(projectResources.remove.permissionAtom(project.environmentId));
  const upsert = useAtomCommand(projectResources.upsert, { reportFailure: false });
  const remove = useAtomCommand(projectResources.remove, { reportFailure: false });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ProjectResource["kind"]>("repository");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const fieldId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = () => registry.refresh(query);
  const save = async () => {
    if (!ready || !snapshot || !canAdd || pendingRef.current || !title.trim() || !url.trim())
      return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await upsert({
        environmentId: project.environmentId,
        input: {
          projectId: project.id,
          expectedRevision: snapshot.revision,
          resource: { id: randomUUID(), kind, title: title.trim(), url: url.trim() },
        },
      });
      if (!mounted.current) return;
      if (response._tag === "Failure") {
        if (!isAtomCommandInterrupted(response)) {
          const failure = squashAtomCommandFailure(response);
          setError(
            failure instanceof Error ? failure.message : "Could not save the resource. Try again.",
          );
          refresh();
        }
        return;
      }
      setAdding(false);
      setTitle("");
      setUrl("");
      refresh();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error ? failure.message : "Could not save the resource. Try again.",
        );
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const removeResource = async (resource: ProjectResource) => {
    if (!ready || !snapshot || !canRemove || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Remove “${resource.title}” from this project's resources? Working files and conversations will stay in Loom.`,
      );
      if (!confirmed || !mounted.current) return;
      const response = await remove({
        environmentId: project.environmentId,
        input: {
          projectId: project.id,
          expectedRevision: snapshot.revision,
          resourceId: resource.id,
        },
      });
      if (!mounted.current) return;
      if (response._tag === "Failure" && !isAtomCommandInterrupted(response)) {
        const failure = squashAtomCommandFailure(response);
        setError(
          failure instanceof Error ? failure.message : "Could not remove the resource. Try again.",
        );
      }
      refresh();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error ? failure.message : "Could not remove the resource. Try again.",
        );
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <div className="space-y-3">
      {snapshot ? (
        <ul aria-label="Saved project resources" className="space-y-2">
          {snapshot.resources.map((resource) => (
            <li key={resource.id}>
              <ResourceRow
                resource={resource}
                onClone={
                  resource.kind === "repository" ? () => onCloneResource(resource) : undefined
                }
                onRemove={canRemove ? () => void removeResource(resource) : undefined}
                disabled={!ready || pending}
              />
            </li>
          ))}
        </ul>
      ) : result._tag === "Failure" ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {readFailure instanceof Error
              ? readFailure.message
              : "Could not load this project's resources."}
          </p>
          <Button size="sm" variant="outline" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Loading resources...
        </p>
      )}
      {ready && snapshot?.resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add repositories, GitHub links, design references or documentation to this project.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="max-w-xl space-y-3 rounded-xl bg-muted p-4"
        >
          <div role="group" aria-label="Resource type" className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant={kind === "repository" ? "secondary" : "ghost-muted"}
              aria-pressed={kind === "repository"}
              disabled={pending}
              onClick={() => setKind("repository")}
            >
              <GitForkIcon aria-hidden="true" />
              Repository
            </Button>
            <Button
              size="sm"
              variant={kind === "link" ? "secondary" : "ghost-muted"}
              aria-pressed={kind === "link"}
              disabled={pending}
              onClick={() => setKind("link")}
            >
              <LinkIcon aria-hidden="true" />
              Reference link
            </Button>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-title`} className="text-sm font-medium">
              Name
            </label>
            <Input
              nativeInput
              id={`${fieldId}-title`}
              value={title}
              maxLength={200}
              required
              disabled={pending}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder={kind === "repository" ? "Repository name" : "Reference name"}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-url`} className="text-sm font-medium">
              {kind === "repository" ? "Repository URL" : "Link URL"}
            </label>
            <Input
              nativeInput
              id={`${fieldId}-url`}
              value={url}
              maxLength={2048}
              required
              disabled={pending}
              onChange={(event) => setUrl(event.currentTarget.value)}
              placeholder={
                kind === "repository" ? "https://github.com/owner/repository" : "https://"
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!ready || !canAdd || pending || !title.trim() || !url.trim()}
            >
              {pending ? "Saving..." : "Add resource"}
            </Button>
            <Button
              size="sm"
              variant="ghost-muted"
              disabled={pending}
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : canAdd ? (
        <Button
          size="sm"
          variant="outline"
          disabled={
            !ready || pending || (snapshot?.resources.length ?? 0) >= PROJECT_RESOURCES_LIMIT
          }
          onClick={() => {
            setAdding(true);
            setError(null);
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add resource
        </Button>
      ) : null}
    </div>
  );
}

function ResourceRow({
  resource,
  primary = false,
  webUrl = resource.url,
  onClone,
  onRemove,
  disabled = false,
}: {
  resource: ProjectResource;
  primary?: boolean;
  webUrl?: string;
  onClone?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  disabled?: boolean;
}) {
  const openLink = useOpenLink(null);
  const [error, setError] = useState<string | null>(null);
  const Icon = resource.kind === "repository" ? GitForkIcon : LinkIcon;
  const open = async () => {
    setError(null);
    try {
      await openLink(webUrl);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not open this link.");
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-muted/50 px-3 py-2.5">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-icon-muted" />
        <div className="min-w-0 flex-1 basis-36">
          <p className="wrap-anywhere text-sm font-medium">{resource.title}</p>
          <p className="mt-0.5 wrap-anywhere text-xs text-muted-foreground">{resource.url}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {primary
              ? "Project repository"
              : resource.kind === "repository"
                ? "Repository"
                : "Reference link"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {isWebUrl(webUrl) ? (
            <Button
              size="xs"
              variant="ghost-muted"
              aria-label={`Open ${resource.title}`}
              onClick={() => void open()}
            >
              <ExternalLinkIcon aria-hidden="true" />
              Open
            </Button>
          ) : null}
          {onClone ? (
            <Button size="xs" variant="outline" disabled={disabled} onClick={onClone}>
              Clone
            </Button>
          ) : null}
          {onRemove ? (
            <Button
              size="icon-xs"
              variant="ghost-destructive"
              disabled={disabled}
              aria-label={`Remove ${resource.title} from project resources`}
              onClick={onRemove}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
