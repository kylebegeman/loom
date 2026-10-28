import { useEffect, useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  VaultGitHubInfo,
  VaultGrantBatchMutation,
  VaultGrantBatchPreview,
} from "@t3tools/contracts/fork";
import {
  createVaultAccessAtoms,
  createVaultMigrationInventoryAtoms,
  matchVaultGitHubProjects,
  makeVaultGitHubAccessPlan,
  makeVaultGitHubAccessRevocation,
  suggestVaultGitHubRepositories,
  supportsLoomFeature,
  vaultGitHubProjectAccess,
  vaultGitHubProjects,
  type VaultGitHubProjectSelection,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { connectionAtomRuntime } from "~/connection/runtime";
import { randomUUID } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { useVaultTime } from "./useVaultTime";
import { VaultFold } from "./VaultFold";
import { runVault } from "./state";
import { collectGitHubProjectInventory } from "./github-project-inventory";

const access = createVaultAccessAtoms(connectionAtomRuntime);
const inventory = createVaultMigrationInventoryAtoms(connectionAtomRuntime);
const newId = () => randomUUID().replaceAll("-", "");
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not update project access. Refresh access and try again.";
const durations = [
  { value: "recurring", label: "Until revoked", ms: null },
  { value: "hour", label: "For 1 hour", ms: 3_600_000 },
  { value: "day", label: "For 1 day", ms: 86_400_000 },
  { value: "week", label: "For 7 days", ms: 604_800_000 },
] as const;
type ReviewContent = {
  input: VaultGrantBatchMutation;
  projects: ReturnType<typeof makeVaultGitHubAccessPlan>["projects"];
  expiresAt: number | null;
} & ({ action: "grant" } | { action: "revoke"; projectId: string });
type Review = ReviewContent & { preview: VaultGrantBatchPreview };

function prepareAccessReview(
  input: Omit<Parameters<typeof makeVaultGitHubAccessPlan>[0], "now" | "newId" | "expiresAt">,
  duration: string,
): ReviewContent {
  const now = Date.now();
  const expiry = durations.find((option) => option.value === duration)?.ms ?? null;
  const expiresAt = expiry === null ? null : now + expiry;
  const plan = makeVaultGitHubAccessPlan({ ...input, now, newId, expiresAt });
  return {
    action: "grant",
    input: {
      operationId: newId(),
      expectedRevision: input.snapshot.revision,
      changes: plan.changes,
    },
    projects: plan.projects,
    expiresAt,
  };
}

function prepareAccessRevocation(
  input: Omit<Parameters<typeof makeVaultGitHubAccessRevocation>[0], "now" | "newId">,
): VaultGrantBatchMutation {
  return {
    operationId: newId(),
    expectedRevision: input.snapshot.revision,
    changes: makeVaultGitHubAccessRevocation({ ...input, now: Date.now(), newId }),
  };
}

export function GitHubProjectAccess(props: {
  environmentId: EnvironmentId;
  connection: VaultGitHubInfo;
  disabled: boolean;
  initiallyOpen?: boolean;
}) {
  const configs = useServerConfigs();
  if (
    !supportsLoomFeature(
      configs.get(props.environmentId)?.environment.capabilities,
      "vault-grants-batch",
    )
  )
    return (
      <p className="text-sm text-muted-foreground">
        Update this computer to configure project access here.
      </p>
    );
  return <ProjectAccess {...props} />;
}

function ProjectAccess({
  environmentId,
  connection,
  disabled,
  initiallyOpen = false,
}: {
  environmentId: EnvironmentId;
  connection: VaultGitHubInfo;
  disabled: boolean;
  initiallyOpen?: boolean;
}) {
  const field = useId();
  const configs = useServerConfigs();
  const inventoryAllowed = useAtomValue(inventory.inventory.permissionAtom(environmentId));
  const inventorySupported = supportsLoomFeature(
    configs.get(environmentId)?.environment.capabilities,
    "vault-migration-inventory",
  );
  const snapshotAtom = access.snapshot({ environmentId, input: {} });
  const catalogAtom = access.catalog({ environmentId, input: {} });
  const snapshotResult = useAtomValue(snapshotAtom);
  const catalogResult = useAtomValue(catalogAtom);
  const previewAllowed = useAtomValue(access.previewBatch.permissionAtom(environmentId));
  const applyAllowed = useAtomValue(access.applyBatch.permissionAtom(environmentId));
  const snapshot =
    snapshotResult._tag === "Failure" ? null : Option.getOrNull(AsyncResult.value(snapshotResult));
  const catalog =
    catalogResult._tag === "Failure" ? null : Option.getOrNull(AsyncResult.value(catalogResult));
  const [editing, setEditing] = useState(initiallyOpen);
  const [search, setSearch] = useState("");
  const [selections, setSelections] = useState<readonly VaultGitHubProjectSelection[]>([]);
  const [duration, setDuration] = useState("recurring");
  const [pending, setPending] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<AbortController | null>(null);
  const [scanWarnings, setScanWarnings] = useState<readonly string[]>([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- aborts the in-flight repository scan when it is replaced or on unmount
  useEffect(() => () => scan?.abort(), [scan]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const now = useVaultTime([
    ...(snapshot?.grants.flatMap((grant) => [
      grant.definition.notBefore,
      grant.definition.expiresAt,
    ]) ?? []),
    pending?.expiresAt ?? null,
  ]);
  const projects = catalog ? vaultGitHubProjects(catalog) : [];
  const current =
    snapshot && catalog ? vaultGitHubProjectAccess({ connection, snapshot, catalog, now }) : [];
  const expiredReview =
    pending?.action === "grant" && pending.expiresAt !== null && pending.expiresAt <= now;
  const loading = snapshotResult.waiting || catalogResult.waiting;
  const failed = snapshotResult._tag === "Failure" || catalogResult._tag === "Failure";
  const locked =
    disabled ||
    busy ||
    scan !== null ||
    loading ||
    !snapshot ||
    !catalog ||
    !previewAllowed ||
    !applyAllowed;
  const active = connection.item.state === "active";
  const stale =
    expiredReview ||
    (pending !== null && snapshot !== null && pending.input.expectedRevision !== snapshot.revision);
  const matching = projects.filter((project) =>
    project.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const refresh = () => {
    if (busy || scan) return;
    setPending(null);
    setError(null);
    appAtomRegistry.refresh(snapshotAtom);
    appAtomRegistry.refresh(catalogAtom);
  };
  const findProjects = async () => {
    if (locked || !catalog || !inventorySupported || !inventoryAllowed || !active) return;
    const controller = new AbortController();
    setScan(controller);
    setScanWarnings([]);
    setError(null);
    setNotice(null);
    const result = await collectGitHubProjectInventory(
      (cursor) => runVault(inventory.inventory, { environmentId, input: { cursor } }),
      controller.signal,
    );
    const detected = matchVaultGitHubProjects(connection, catalog, result.projects);
    const merged = new Map(selections.map((selection) => [selection.projectId, selection]));
    for (const selection of detected) {
      const previous = merged.get(selection.projectId)?.repositories ?? [];
      merged.set(selection.projectId, {
        ...selection,
        repositories: [...new Set([...previous, ...selection.repositories])],
      });
    }
    setSelections([...merged.values()]);
    setScanWarnings(result.warnings);
    setNotice(
      detected.length > 0
        ? `Found matching repositories for ${detected.length} ${detected.length === 1 ? "project" : "projects"}. Review the selections below.`
        : "No matching repositories were found in the checked project metadata. Select projects and repositories manually.",
    );
    setScan(null);
  };
  const configure = () => {
    setSelections(current.map(({ projectId, repositories }) => ({ projectId, repositories })));
    setSearch("");
    setScanWarnings([]);
    setDuration("recurring");
    setPending(null);
    setError(null);
    setNotice(null);
    setEditing(true);
  };
  const preview = async (review: ReviewContent) => {
    if (locked) return;
    setBusy(true);
    setPending(null);
    setError(null);
    setNotice(null);
    const result = await access.previewBatch.run(appAtomRegistry, {
      environmentId,
      input: review.input,
    });
    if (result._tag === "Failure") setError(message(Cause.squash(result.cause)));
    else setPending({ ...review, preview: result.value });
    setBusy(false);
  };
  const reviewAccess = () => {
    if (locked || !snapshot || !catalog) return;
    let review: ReviewContent;
    try {
      review = prepareAccessReview({ connection, catalog, snapshot, selections }, duration);
    } catch (cause) {
      setError(message(cause));
      return;
    }
    if (review.input.changes.length === 0) {
      setError(null);
      setNotice("Already configured. These projects already have the selected repository access.");
      return;
    }
    void preview(review);
  };
  const reviewRevocation = (projectId: string) => {
    if (locked || !snapshot) return;
    const project = current.find((entry) => entry.projectId === projectId);
    if (!project) return;
    let input: VaultGrantBatchMutation;
    try {
      input = prepareAccessRevocation({ connection, snapshot, projectId });
    } catch (cause) {
      setError(message(cause));
      return;
    }
    if (input.changes.length === 0) {
      setNotice("This project has no repository access to revoke.");
      return;
    }
    setEditing(false);
    void preview({
      action: "revoke",
      projectId,
      input,
      projects: [{ ...project, alreadyAllowed: project.repositories }],
      expiresAt: null,
    });
  };
  const approve = async () => {
    if (locked || !pending || stale) return;
    setBusy(true);
    setError(null);
    const result = await access.applyBatch.run(appAtomRegistry, {
      environmentId,
      input: pending.input,
    });
    if (result._tag === "Failure") setError(message(Cause.squash(result.cause)));
    else {
      setNotice(
        pending.action === "grant"
          ? "Project access approved."
          : "Project repository access revoked. Credentials already issued may remain valid until GitHub expires or revokes them.",
      );
      setPending(null);
      setEditing(false);
      setSelections([]);
      appAtomRegistry.refresh(snapshotAtom);
    }
    setBusy(false);
  };
  const relevantGrantIds = new Set(
    snapshot?.grants
      .filter((grant) => grant.definition.itemIds.includes(connection.item.id))
      .map((grant) => grant.definition.id) ?? [],
  );
  const summarizedGrantIds = new Set(current.flatMap((project) => project.grantIds));
  const otherGrants =
    snapshot?.grants.filter(
      (grant) =>
        grant.definition.itemIds.includes(connection.item.id) &&
        grant.definition.principal.kind === "project" &&
        grant.state !== "revoked" &&
        !summarizedGrantIds.has(grant.definition.id),
    ) ?? [];
  const history =
    snapshot?.audit.filter(
      (event) =>
        event.type === "grant-change" &&
        (event.itemId === connection.item.id ||
          (event.grantId !== null && relevantGrantIds.has(event.grantId))),
    ) ?? [];
  return (
    <section aria-labelledby={`${field}-heading`} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${field}-heading`} className="text-sm font-medium">
          Project access
        </h4>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={busy || scan !== null} onClick={refresh}>
            Refresh access
          </Button>
          {!editing && !pending ? (
            <Button size="sm" disabled={locked || !active} onClick={configure}>
              Configure project access
            </Button>
          ) : null}
        </div>
      </div>
      {loading ? (
        <p role="status" className="text-sm">
          Loading project access…
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm">
          Could not load project access. Refresh access to try again.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {scanWarnings.length > 0 ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          {scanWarnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {snapshot && catalog && current.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {active
            ? "Connection saved. No project repository access is configured here yet."
            : "No current project repository access."}
        </p>
      ) : null}
      {current.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {current.map((project) => {
            return (
              <li key={project.projectId} className="flex min-w-0 flex-col gap-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{project.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {project.expiresAt === null
                        ? "Until revoked"
                        : `Next access expiry ${new Date(project.expiresAt).toLocaleString()}`}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={locked || pending !== null}
                    aria-label={`Revoke repository access for ${project.label}`}
                    onClick={() => reviewRevocation(project.projectId)}
                  >
                    Revoke access
                  </Button>
                </div>
                <ul className="flex flex-col gap-1 text-sm">
                  {project.repositories.map((repository) => (
                    <li key={repository} className="break-words">
                      {repository}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}
      {editing && !pending ? (
        <div className="flex min-w-0 flex-col gap-4 rounded-lg bg-muted p-3 sm:p-4">
          <p className="max-w-prose text-sm">
            Choose projects, then select the repositories each project may use. Access covers
            current and future threads in each project.
          </p>
          {inventorySupported ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={locked || !inventoryAllowed || !active}
                  onClick={() => void findProjects()}
                >
                  {scan ? "Finding matching projects…" : "Find matching projects"}
                </Button>
                {scan ? (
                  <Button size="sm" variant="outline" onClick={() => scan.abort()}>
                    Cancel search
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Match repositories using registered projects’ local Git remotes, then review the
                selections. You can also choose projects manually.
              </p>
              {!inventoryAllowed ? (
                <p className="text-sm">
                  Project metadata is unavailable with your current permissions. Choose projects
                  manually.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Automatic matching is unavailable on this computer. Choose projects and repositories
              below.
            </p>
          )}
          <label htmlFor={`${field}-search`} className="flex flex-col gap-1 text-sm">
            Search projects
            <Input
              id={`${field}-search`}
              type="search"
              value={search}
              maxLength={200}
              disabled={busy || scan !== null}
              placeholder="Project name"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {catalog?.truncated ? (
            <p className="text-sm text-muted-foreground">
              This computer returned a partial project list. A missing project cannot be authorized
              here.
            </p>
          ) : null}
          {catalog && projects.length === 0 ? (
            <p className="text-sm">
              No projects are available on this computer. Add a project, then refresh access.
            </p>
          ) : null}
          {projects.length > 0 && matching.length === 0 ? (
            <p className="text-sm">No projects match “{search}”. Try another name.</p>
          ) : null}
          <div className="max-h-56 overflow-y-auto">
            <ul className="flex flex-col gap-1">
              {matching.map((project) => {
                const projectId = project.principal.id;
                const selected = selections.some((selection) => selection.projectId === projectId);
                const existing =
                  current.find((entry) => entry.projectId === projectId)?.repositories ?? [];
                return (
                  <li key={projectId}>
                    <label className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md p-2 text-sm hover:bg-accent">
                      <Checkbox
                        checked={selected}
                        disabled={locked}
                        onCheckedChange={(checked) => {
                          setError(null);
                          setNotice(null);
                          setSelections(
                            checked
                              ? [
                                  ...selections,
                                  {
                                    projectId,
                                    repositories:
                                      existing.length > 0
                                        ? existing
                                        : suggestVaultGitHubRepositories(
                                            project.label,
                                            connection.repositories,
                                          ),
                                  },
                                ]
                              : selections.filter((selection) => selection.projectId !== projectId),
                          );
                        }}
                      />
                      <span className="min-w-0 break-words">
                        {project.label}
                        {existing.length > 0 ? (
                          <span className="ml-2 text-xs text-muted-foreground">Has access</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          {selections.map((selection) => {
            const project = projects.find((entry) => entry.principal.id === selection.projectId);
            if (!project) return null;
            const existing =
              current.find((entry) => entry.projectId === selection.projectId)?.repositories ?? [];
            return (
              <VaultFold
                key={selection.projectId}
                open={selections.length === 1}
                title={
                  <>
                    <span className="block break-words">{project.label}</span>
                    <span className="mt-1 block break-words text-xs font-normal text-muted-foreground">
                      {selection.repositories.length > 0
                        ? selection.repositories.join(", ")
                        : "Select repositories"}
                    </span>
                  </>
                }
              >
                <fieldset className="min-w-0" disabled={locked}>
                  <legend className="sr-only">Repositories for {project.label}</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {connection.repositories.map((repository) => {
                      const alreadyAllowed = existing.includes(repository);
                      return (
                        <label
                          key={repository}
                          className="flex min-w-0 cursor-pointer items-start gap-2 py-1 text-sm"
                        >
                          <Checkbox
                            checked={alreadyAllowed || selection.repositories.includes(repository)}
                            disabled={locked || alreadyAllowed}
                            onCheckedChange={(checked) => {
                              setError(null);
                              setNotice(null);
                              setSelections(
                                selections.map((entry) =>
                                  entry.projectId !== selection.projectId
                                    ? entry
                                    : {
                                        ...entry,
                                        repositories: checked
                                          ? [...entry.repositories, repository]
                                          : entry.repositories.filter(
                                              (repo) => repo !== repository,
                                            ),
                                      },
                                ),
                              );
                            }}
                          />
                          <span className="min-w-0 break-words">
                            {repository}
                            {alreadyAllowed ? (
                              <span className="block text-xs text-muted-foreground">
                                Already authorized
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {selection.repositories.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Select at least one repository for this project.
                    </p>
                  ) : null}
                </fieldset>
              </VaultFold>
            );
          })}
          {current.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Existing authorizations stay in place. Use Revoke access above to remove a project’s
              repository access.
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            New access lasts until you revoke it. Threads still follow their configured permissions.
          </p>
          <VaultFold title="Optional access duration">
            <div>
              <label htmlFor={`${field}-duration`} className="flex flex-col gap-1 text-sm">
                New access lasts
                <Select
                  value={duration}
                  disabled={locked}
                  onValueChange={(value) => {
                    if (value) setDuration(value);
                  }}
                >
                  <SelectTrigger id={`${field}-duration`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {durations.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
            </div>
          </VaultFold>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={
                locked ||
                !active ||
                selections.length === 0 ||
                selections.some((selection) => selection.repositories.length === 0)
              }
              onClick={reviewAccess}
            >
              {busy ? "Preparing review…" : "Review project access"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || scan !== null}
              onClick={() => {
                setEditing(false);
                setSelections([]);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {pending ? (
        <section
          role="region"
          aria-labelledby={`${field}-review`}
          className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted p-3 sm:p-4"
        >
          <h5 id={`${field}-review`} className="font-medium">
            {pending.action === "grant" ? "Review project access" : "Review access revocation"}
          </h5>
          <p className="break-words text-sm">
            {pending.action === "grant"
              ? `Allow these projects to use ${connection.item.label} for the repositories below.`
              : `Remove these projects’ repository access through ${connection.item.label}.`}
          </p>
          <ul className="flex flex-col gap-3">
            {pending.projects.map((project) => (
              <li key={project.projectId} className="min-w-0">
                <p className="break-words text-sm font-medium">{project.label}</p>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {project.repositories.map((repository) => (
                    <li key={repository} className="break-words">
                      {repository}
                      {pending.action === "grant" && project.alreadyAllowed.includes(repository)
                        ? " (already authorized)"
                        : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            {pending.action === "grant"
              ? pending.expiresAt === null
                ? "New access continues across runs until revoked."
                : `New access expires ${new Date(pending.expiresAt).toLocaleString()}.`
              : "New use will be blocked. Credentials already issued may remain valid until GitHub expires or revokes them."}
          </p>
          {pending.action === "grant" ? (
            <p className="text-sm text-muted-foreground">
              Threads in these projects can find this connection and use it only for their selected
              repositories. GitHub permissions and each thread’s execution permissions still apply.
            </p>
          ) : null}
          {stale ? (
            <p role="alert" className="text-sm">
              {expiredReview
                ? "The chosen access duration has elapsed. Review again to start a new duration."
                : "Project access changed after this review. Review the current policy before approving."}
            </p>
          ) : null}
          {pending.preview.unknowns.length > 0 ? (
            <VaultFold title="Limits of this review">
              <ul className="flex flex-col gap-2 text-xs text-muted-foreground">
                {pending.preview.unknowns.map((unknown) => (
                  <li key={unknown}>{unknown}</li>
                ))}
              </ul>
            </VaultFold>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {stale ? (
              <Button
                size="sm"
                disabled={locked}
                onClick={() =>
                  pending.action === "grant" ? reviewAccess() : reviewRevocation(pending.projectId)
                }
              >
                Review current access
              </Button>
            ) : (
              <Button
                size="sm"
                variant={pending.action === "revoke" ? "destructive" : "default"}
                disabled={locked || (pending.action === "grant" && !active)}
                onClick={() => void approve()}
              >
                {busy
                  ? "Saving access…"
                  : pending.action === "grant"
                    ? "Approve project access"
                    : "Revoke project access"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (pending.action === "grant") setEditing(true);
                setPending(null);
                setError(null);
              }}
            >
              {pending.action === "grant" ? "Back to selection" : "Cancel"}
            </Button>
          </div>
        </section>
      ) : null}
      {otherGrants.length > 0 ? (
        <VaultFold title={`Other saved grants (${otherGrants.length})`}>
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">
              Review custom, scheduled or inherited grants in Vault project access &amp; approvals.
            </p>
            {otherGrants.map((grant) => (
              <p key={grant.definition.id} className="break-words">
                {grant.definition.label} · {grant.state}
              </p>
            ))}
          </div>
        </VaultFold>
      ) : null}
      <VaultFold title="Project access history">
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          {history.length === 0 ? (
            <p>No recent project-access changes for this connection.</p>
          ) : (
            history.map((event) => (
              <p key={event.id} className="break-words">
                {new Date(event.at).toLocaleString()} · {event.reason}
              </p>
            ))
          )}
          <p>
            History is limited to retained policy changes. It does not confirm successful GitHub
            operations.
          </p>
        </div>
      </VaultFold>
    </section>
  );
}
