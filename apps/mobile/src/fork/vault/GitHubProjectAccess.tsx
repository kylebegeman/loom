import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  VaultGitHubInfo,
  VaultGrantBatchMutation,
  VaultGrantBatchPreview,
  VaultMigrationProject,
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
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { connectionAtomRuntime } from "../../connection/runtime";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useVaultTime } from "./useVaultTime";
import { scanGitHubProjectInventory } from "./githubProjectInventory";

const access = createVaultAccessAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const inventory = createVaultMigrationInventoryAtoms(connectionAtomRuntime);
const PROJECT_PAGE_SIZE = 12;
type Review = {
  input: VaultGrantBatchMutation;
  preview: VaultGrantBatchPreview;
  projects: ReadonlyArray<{
    projectId: string;
    label: string;
    repositories: readonly string[];
    alreadyAllowed: readonly string[];
  }>;
  revoking: boolean;
};

export function GitHubProjectAccess(props: {
  environmentId: EnvironmentId;
  connection: VaultGitHubInfo;
  connected: boolean;
  disabled: boolean;
}) {
  const config = useEnvironmentServerConfig(props.environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-grants-batch")) {
    return (
      <Text>
        Update this computer to configure project access here. Existing grants remain available in
        advanced Vault access.
      </Text>
    );
  }
  return (
    <ProjectAccess key={`${props.environmentId}:${props.connection.item.version}`} {...props} />
  );
}

function ProjectAccess({
  environmentId,
  connection,
  connected,
  disabled,
}: {
  environmentId: EnvironmentId;
  connection: VaultGitHubInfo;
  connected: boolean;
  disabled: boolean;
}) {
  const snapshot = useEnvironmentQuery(
    connected ? access.snapshot({ environmentId, input: {} }) : null,
  );
  const catalog = useEnvironmentQuery(
    connected ? access.catalog({ environmentId, input: {} }) : null,
  );
  const config = useEnvironmentServerConfig(environmentId);
  const matchingSupported = supportsLoomFeature(
    config?.environment.capabilities,
    "vault-migration-inventory",
  );
  const canScan = useAtomValue(inventory.inventory.permissionAtom(environmentId));
  const scan = useAtomCommand(inventory.inventory, { reportFailure: false });
  const canPreview = useAtomValue(access.previewBatch.permissionAtom(environmentId));
  const canApply = useAtomValue(access.applyBatch.permissionAtom(environmentId));
  const previewBatch = useAtomCommand(access.previewBatch, { reportFailure: false });
  const applyBatch = useAtomCommand(access.applyBatch, { reportFailure: false });
  const now = useVaultTime(
    snapshot.data?.grants.flatMap((grant) => [
      grant.definition.notBefore,
      grant.definition.expiresAt,
    ]) ?? [],
  );
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PROJECT_PAGE_SIZE);
  const [selections, setSelections] = useState<readonly VaultGitHubProjectSelection[]>([]);
  const [editingProjects, setEditingProjects] = useState<readonly string[]>([]);
  const [inventoryProjects, setInventoryProjects] = useState<readonly VaultMigrationProject[]>([]);
  const [scanProblem, setScanProblem] = useState<string | null>(null);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "complete" | "partial">("idle");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const policy = snapshot.error ? null : snapshot.data;
  const subjects = catalog.error ? null : catalog.data;
  const projects = subjects ? vaultGitHubProjects(subjects) : [];
  const existing =
    policy && subjects
      ? vaultGitHubProjectAccess({ connection, catalog: subjects, snapshot: policy, now })
      : [];
  const rules =
    policy?.grants.filter(
      (grant) => grant.state !== "revoked" && grant.definition.itemIds.includes(connection.item.id),
    ) ?? [];
  const matching = projects.filter((project) =>
    project.label.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const locked =
    disabled ||
    !connected ||
    busy ||
    !canPreview ||
    !canApply ||
    !policy ||
    !subjects ||
    snapshot.isPending ||
    catalog.isPending;
  const stale = !!review && (!policy || review.preview.policyRevision !== policy.revision);
  const refresh = () => {
    setReview(null);
    setError(null);
    snapshot.refresh();
    catalog.refresh();
  };
  const attempt = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update project access. Refresh access and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const findMatching = async () => {
    if (locked || !subjects || !matchingSupported || !canScan) return;
    setChoosing(true);
    setReview(null);
    setScanProblem(null);
    setInventoryProjects([]);
    setScanState("scanning");
    await attempt(async () => {
      const result = await scanGitHubProjectInventory(async (cursor) => {
        const page = await scan({ environmentId, input: { cursor } });
        if (page._tag === "Failure") throw squashAtomCommandFailure(page);
        return page.value;
      }, setInventoryProjects);
      const matches = matchVaultGitHubProjects(connection, subjects, result.projects);
      setSelections((previous) => {
        const merged = new Map(previous.map((selection) => [selection.projectId, selection]));
        for (const match of matches) {
          const selected = merged.get(match.projectId);
          merged.set(match.projectId, {
            ...match,
            repositories: [...new Set([...(selected?.repositories ?? []), ...match.repositories])],
          });
        }
        return [...merged.values()];
      });
      setScanProblem(result.incompleteReason);
      setScanState(result.incompleteReason === null ? "complete" : "partial");
      setNotice(
        matches.length > 0
          ? `Found repository matches for ${matches.length} projects. Review the selected projects and repositories before approving.`
          : "No matching GitHub repositories were detected in the checked metadata. Choose projects and repositories manually.",
      );
    });
  };
  const prepare = async (projectId?: string) => {
    if (locked || !policy || !subjects) return;
    await attempt(async () => {
      const plan =
        projectId === undefined
          ? makeVaultGitHubAccessPlan({
              connection,
              catalog: subjects,
              snapshot: policy,
              selections,
              now: Date.now(),
              newId,
            })
          : {
              changes: makeVaultGitHubAccessRevocation({
                connection,
                snapshot: policy,
                projectId,
                now: Date.now(),
                newId,
              }),
              projects: existing
                .filter((project) => project.projectId === projectId)
                .map((project) => ({ ...project, alreadyAllowed: [] })),
            };
      if (plan.changes.length === 0) {
        setNotice(
          projectId === undefined
            ? "These projects already have the selected repository access."
            : "No matching project access remains to revoke.",
        );
        return;
      }
      const input = {
        operationId: newId(),
        expectedRevision: policy.revision,
        changes: plan.changes,
      };
      const result = await previewBatch({ environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setReview({
        input,
        preview: result.value,
        projects: plan.projects,
        revoking: projectId !== undefined,
      });
      setChoosing(true);
    });
  };
  const apply = async () => {
    if (locked || !review || stale) return;
    await attempt(async () => {
      const result = await applyBatch({ environmentId, input: review.input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setNotice(
        review.revoking
          ? "Project use and inspection revoked. Other permissions are preserved. Already authenticated operations may still finish."
          : "Project access approved. It stays available to future threads and runs until revoked.",
      );
      setReview(null);
      setChoosing(false);
      setSelections([]);
      snapshot.refresh();
    });
  };
  const close = () => {
    if (busy) return;
    setChoosing(false);
    setReview(null);
    setError(null);
  };
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-t3-semibold">
        Project access
      </Text>
      <Text>
        Choose projects and exact repositories. All threads in each project can reuse approved
        access until you revoke it.
      </Text>
      {snapshot.isPending || catalog.isPending ? <Text>Loading project access…</Text> : null}
      {snapshot.error || catalog.error ? (
        <Text accessibilityRole="alert">{snapshot.error ?? catalog.error}</Text>
      ) : null}
      {policy && subjects && existing.length === 0 ? (
        <Text>Connection saved. No recurring project access is configured yet.</Text>
      ) : null}
      {existing.map((project) => (
        <View key={project.projectId} className="gap-2">
          <Text className="font-t3-medium">{project.label}</Text>
          <Text>{project.repositories.join(", ") || "Connection metadata only"}</Text>
          <Text className="text-foreground-muted">
            {project.expiresAt === null
              ? "Until revoked"
              : `Next access expiry ${new Date(project.expiresAt).toLocaleString()}`}
          </Text>
          <Button
            label={`Review revocation for ${project.label}`}
            tone="text"
            disabled={locked}
            onPress={() => void prepare(project.projectId)}
          />
        </View>
      ))}
      {matchingSupported ? (
        <Button
          label="Find matching projects"
          tone="primary"
          loading={scanState === "scanning"}
          disabled={locked || !canScan}
          onPress={() => void findMatching()}
        />
      ) : null}
      <Button
        label="Configure project access"
        tone={matchingSupported ? "secondary" : "primary"}
        disabled={locked}
        onPress={() => {
          setError(null);
          setNotice(null);
          setReview(null);
          setChoosing(true);
        }}
      />
      {!matchingSupported || !canScan ? (
        <Text className="text-foreground-muted">
          Automatic matching is unavailable for this connection. Choose projects and repositories
          manually.
        </Text>
      ) : null}
      <Button
        label="Refresh project access"
        tone="text"
        disabled={!connected || busy}
        onPress={refresh}
      />
      {error && !choosing ? <Text accessibilityRole="alert">{error}</Text> : null}
      {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
      {rules.length > 0 ? (
        <Button
          label={
            details ? "Hide saved access rules" : "Saved access rules, including custom grants"
          }
          tone="text"
          onPress={() => setDetails(!details)}
        />
      ) : null}
      {details
        ? rules.map((grant) => (
            <View key={grant.definition.id} className="gap-1">
              <Text className="font-t3-medium">
                {grant.definition.label} · {grant.state}
              </Text>
              <Text>
                {subjects?.subjects.find(
                  (subject) =>
                    subject.principal.kind === grant.definition.principal.kind &&
                    subject.principal.id === grant.definition.principal.id,
                )?.label ?? "Unavailable project or thread"}
              </Text>
              <Text>
                {grant.definition.actions.join(", ")} ·{" "}
                {grant.definition.destination ?? "No destination restriction"}
              </Text>
              <Text>
                {grant.definition.expiresAt === null
                  ? "Until revoked"
                  : `Expires ${new Date(grant.definition.expiresAt).toLocaleString()}`}
              </Text>
              <Text className="text-foreground-muted">
                Custom grants can be managed in advanced Vault access.
              </Text>
            </View>
          ))
        : null}
      {choosing ? (
        <Sheet
          title={
            review
              ? review.revoking
                ? "Review project revocation"
                : "Review project access"
              : "Choose project access"
          }
          dismissible={!busy}
          onClose={close}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 px-5 pb-8"
          >
            {scanState !== "idle" ? (
              <Text className="text-foreground-muted" accessibilityLiveRegion="polite">
                {scanState === "scanning"
                  ? "Finding matches"
                  : "Registered project metadata checked"}
                : {inventoryProjects.length} projects.
                {scanState === "complete"
                  ? " Matching uses reported repository remotes; included and global Git settings are not inspected."
                  : ""}
              </Text>
            ) : null}
            {scanProblem ? <Text accessibilityRole="alert">{scanProblem}</Text> : null}
            {review ? (
              <>
                <Text className="font-t3-semibold">
                  {review.revoking
                    ? "Revoke this connection's access for these projects"
                    : "Approve recurring access with this saved connection"}
                </Text>
                <Text>
                  {connection.item.label} · {connection.account}
                </Text>
                {review.projects.map((project) => (
                  <View key={project.projectId} className="gap-1">
                    <Text className="font-t3-semibold">{project.label}</Text>
                    <Text>{project.repositories.join(", ") || "Connection metadata only"}</Text>
                    {!review.revoking && project.alreadyAllowed.length > 0 ? (
                      <Text className="text-foreground-muted">
                        Already allowed: {project.alreadyAllowed.join(", ")}
                      </Text>
                    ) : null}
                  </View>
                ))}
                <Text>
                  {review.revoking
                    ? "Remove repository use and connection inspection for these projects. Other records and unrelated permissions are preserved. Already authenticated operations may finish."
                    : "Applies to all threads and future runs in these projects until revoked. Each repository gets exact use access, with separate access to inspect this connection's metadata. This adds no manage, reveal, export or delegate permissions."}
                </Text>
                <Text>
                  Current run transport readiness is checked separately in connection details.
                </Text>
                <Text className="text-foreground-muted">
                  {review.input.changes.length} access rule changes reviewed together.
                </Text>
                {review.preview.unknowns.map((unknown) => (
                  <Text key={unknown} accessibilityRole="alert">
                    {unknown}
                  </Text>
                ))}
                {stale ? (
                  <Text accessibilityRole="alert">
                    Access policy changed. Refresh and review again before approving.
                  </Text>
                ) : null}
                <Button
                  label={
                    review.revoking
                      ? "Revoke reviewed project access"
                      : "Approve recurring project access"
                  }
                  tone={review.revoking ? "danger" : "primary"}
                  loading={busy}
                  disabled={locked || stale}
                  onPress={() => void apply()}
                />
                <Button
                  label={review.revoking ? "Cancel revocation" : "Back to project selection"}
                  disabled={busy}
                  onPress={() => (review.revoking ? close() : setReview(null))}
                />
              </>
            ) : (
              <>
                <Text>
                  Select projects, then choose repositories for each one. You will review everything
                  before approving once.
                </Text>
                {matchingSupported ? (
                  <Button
                    label="Find matching projects"
                    disabled={locked || !canScan}
                    loading={scanState === "scanning"}
                    onPress={() => void findMatching()}
                  />
                ) : null}
                <TextInput
                  accessibilityLabel="Search projects for GitHub access"
                  placeholder="Search projects"
                  value={search}
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setSearch(value);
                    setLimit(PROJECT_PAGE_SIZE);
                  }}
                  editable={!busy}
                />
                {matching.slice(0, limit).map((project) => {
                  const selected = selections.some(
                    (selection) => selection.projectId === project.principal.id,
                  );
                  return (
                    <View
                      key={project.principal.id}
                      className="min-h-12 flex-row items-center justify-between gap-3"
                    >
                      <Text className="min-w-0 flex-1">{project.label}</Text>
                      <ThemedSwitch
                        accessibilityLabel={`Select project ${project.label}`}
                        value={selected}
                        disabled={locked}
                        onValueChange={(value) => {
                          setError(null);
                          const currentRepositories =
                            existing.find((entry) => entry.projectId === project.principal.id)
                              ?.repositories ?? [];
                          const suggested =
                            currentRepositories.length > 0
                              ? currentRepositories
                              : suggestVaultGitHubRepositories(
                                  project.label,
                                  connection.repositories,
                                );
                          if (value && suggested.length === 0)
                            setEditingProjects((previous) => [...previous, project.principal.id]);
                          setSelections((previous) =>
                            value
                              ? [
                                  ...previous,
                                  { projectId: project.principal.id, repositories: suggested },
                                ]
                              : previous.filter(
                                  (selection) => selection.projectId !== project.principal.id,
                                ),
                          );
                        }}
                      />
                    </View>
                  );
                })}
                {matching.length === 0 ? (
                  <Text>No matching projects. Try another search or refresh project access.</Text>
                ) : null}
                {matching.length > limit ? (
                  <Button
                    label={`Show more projects (${matching.length - limit} remaining)`}
                    disabled={busy}
                    onPress={() => setLimit(limit + PROJECT_PAGE_SIZE)}
                  />
                ) : null}
                {subjects?.truncated ? (
                  <Text accessibilityRole="alert">
                    The project catalog is incomplete. Refresh to find missing projects; only listed
                    projects can be authorized here.
                  </Text>
                ) : null}
                <Text className="font-t3-semibold">Selected projects ({selections.length})</Text>
                {selections.length === 0 ? <Text>Choose one or more projects above.</Text> : null}
                {selections.map((selection) => {
                  const label =
                    projects.find((project) => project.principal.id === selection.projectId)
                      ?.label ?? "Unavailable project";
                  const currentRepositories =
                    existing.find((entry) => entry.projectId === selection.projectId)
                      ?.repositories ?? [];
                  return (
                    <View key={selection.projectId} className="gap-2 rounded-2xl bg-subtle p-3">
                      <Text className="font-t3-semibold">{label}</Text>
                      <Text>
                        {selection.repositories.join(", ") ||
                          "Choose repositories for this project"}
                      </Text>
                      <Button
                        label={`${editingProjects.includes(selection.projectId) ? "Hide" : "Change"} repositories for ${label}`}
                        tone="text"
                        disabled={busy}
                        onPress={() =>
                          setEditingProjects((previous) =>
                            previous.includes(selection.projectId)
                              ? previous.filter((projectId) => projectId !== selection.projectId)
                              : [...previous, selection.projectId],
                          )
                        }
                      />
                      {editingProjects.includes(selection.projectId)
                        ? connection.repositories.map((repository) => (
                            <View
                              key={repository}
                              className="min-h-12 flex-row items-center justify-between gap-3"
                            >
                              <View className="min-w-0 flex-1">
                                <Text>{repository}</Text>
                                {currentRepositories.includes(repository) ? (
                                  <Text className="text-foreground-muted">Already authorized</Text>
                                ) : null}
                              </View>
                              <ThemedSwitch
                                accessibilityLabel={`${label}: allow ${repository}`}
                                value={
                                  currentRepositories.includes(repository) ||
                                  selection.repositories.includes(repository)
                                }
                                disabled={locked || currentRepositories.includes(repository)}
                                onValueChange={(value) => {
                                  setError(null);
                                  setSelections((previous) =>
                                    previous.map((entry) =>
                                      entry.projectId === selection.projectId
                                        ? {
                                            ...entry,
                                            repositories: value
                                              ? [...entry.repositories, repository]
                                              : entry.repositories.filter(
                                                  (repo) => repo !== repository,
                                                ),
                                          }
                                        : entry,
                                    ),
                                  );
                                }}
                              />
                            </View>
                          ))
                        : null}
                      <Button
                        label={`Remove ${label} from selection`}
                        tone="text"
                        disabled={busy}
                        onPress={() =>
                          setSelections((previous) =>
                            previous.filter((entry) => entry.projectId !== selection.projectId),
                          )
                        }
                      />
                    </View>
                  );
                })}
                {existing.length > 0 ? (
                  <Text className="text-foreground-muted">
                    Existing authorizations stay in place. Use Review revocation above to remove a
                    project's repository access.
                  </Text>
                ) : null}
                <Text>Until revoked. No temporary request or credential re-entry is needed.</Text>
                <Button
                  label="Review selected project access"
                  tone="primary"
                  loading={busy}
                  disabled={
                    locked ||
                    selections.length === 0 ||
                    selections.some((selection) => selection.repositories.length === 0)
                  }
                  onPress={() => void prepare()}
                />
                {selections.some((selection) => selection.repositories.length === 0) ? (
                  <Text>Select at least one repository for every selected project.</Text>
                ) : null}
              </>
            )}
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
            <Button
              label="Refresh access and review again"
              tone="text"
              disabled={!connected || busy}
              onPress={refresh}
            />
            <Button label="Cancel" tone="text" disabled={busy} onPress={close} />
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}
