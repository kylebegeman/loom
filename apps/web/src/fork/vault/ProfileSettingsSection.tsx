import { VaultQueryFeedback } from "./SettingsFeedback";
import { VaultGitHubConnectionPicker } from "./GitHubConnectionPicker";
import { VaultProfileHistory } from "./ProfileHistory";
import { VaultRequirementImport, VaultRequirementExport } from "./ProfileTransfer";
import { vaultProfileTarget } from "./profile-navigation";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  ProjectId,
  ThreadId,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  VaultProfileDefinition,
  type VaultProfileMutation,
  type VaultProfilePreview,
} from "@t3tools/contracts/fork";
import {
  createVaultProfileAtoms,
  createVaultAccessAtoms,
  supportsLoomFeature,
  vaultProfileBindingMessage,
} from "@t3tools/client-runtime/fork";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
import { VaultReferencePicker, VaultBoundReference } from "./ReferencePicker";
const profiles = createVaultProfileAtoms(connectionAtomRuntime),
  access = createVaultAccessAtoms(connectionAtomRuntime);
const newId = () => randomUUID().replaceAll("-", "");
type ProfileEditor = Omit<VaultProfileDefinition, "bindings"> & {
  bindings: ReadonlyArray<VaultProfileDefinition["bindings"][number] & { rowId: string }>;
};
const decode = Schema.decodeUnknownOption(VaultProfileDefinition);
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The profile operation failed. Refresh and try again.";
const data = <A, E>(r: AsyncResult.AsyncResult<A, E>) => Option.getOrNull(AsyncResult.value(r));
const failure = <A, E>(r: AsyncResult.AsyncResult<A, E>) =>
  r._tag === "Failure" ? message(Cause.squash(r.cause)) : null;
export function VaultProfileSettingsSection() {
  const { environment, target } = useSettingsScope(),
    configs = useServerConfigs();
  const requested = useAtomValue(vaultProfileTarget);
  const initialProject =
    target?.projectId ??
    (requested?.environmentId === environment?.environmentId && requested?.section === "profiles"
      ? (requested.projectId ?? null)
      : null);
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-profiles",
    )
  )
    return (
      <LoomSettingsNotice>
        Project profiles need a server with Vault profile support.
      </LoomSettingsNotice>
    );
  if (!canRead)
    return (
      <LoomSettingsNotice>Your connection does not include Vault inspection.</LoomSettingsNotice>
    );
  return (
    <ProfileProjects
      key={`${environment.environmentId}:${initialProject}:${canWrite}`}
      environmentId={environment.environmentId}
      initialProject={initialProject}
      canWrite={canWrite}
    />
  );
}
function ProfileProjects({
  environmentId,
  initialProject,
  canWrite,
}: {
  environmentId: EnvironmentId;
  initialProject: ProjectId | null;
  canWrite: boolean;
}) {
  const atom = access.catalog({ environmentId, input: {} }),
    result = useAtomValue(atom),
    catalog = data(result);
  const [selected, setSelected] = useState<ProjectId | null>(initialProject);
  const projects = catalog?.subjects.filter((s) => s.principal.kind === "project") ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Profiles are optional shortcuts that give SSH, Git and GitHub connections stable names.
        Owner access works without a profile. Profiles hold references and grant no access. Each run
        keeps the revision and key versions it first resolves; changes apply to later runs.
      </p>
      <LoomSettingsPanel
        title="Project profiles"
        description="Choose a project to manage its development connections and default profile."
      >
        <LoomSettingsField label="Project">
          <Select
            value={selected ?? ""}
            onValueChange={(value) => setSelected(value ? ProjectId.make(value) : null)}
          >
            <SelectTrigger aria-label="Vault profile project">
              <SelectValue>
                {projects.find((s) => s.principal.id === selected)?.label ??
                  (selected ? `Unavailable project (${selected})` : "Choose a project")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="">Choose a project</SelectItem>
              {projects.map((s) => (
                <SelectItem key={s.principal.id} value={s.principal.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LoomSettingsField>
        <VaultQueryFeedback
          result={result}
          loading="Loading projects…"
          error={failure(result)}
          onRetry={() => appAtomRegistry.refresh(atom)}
        />
        {catalog && !projects.length && !result.waiting ? (
          <LoomSettingsNotice>
            No projects available. Add a project on this computer before creating a profile.
          </LoomSettingsNotice>
        ) : null}
        {catalog?.truncated ? (
          <LoomSettingsNotice>
            Only the first 250 projects and threads are available here.
          </LoomSettingsNotice>
        ) : null}
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() => appAtomRegistry.refresh(atom)}
          >
            Refresh projects
          </Button>
        </LoomSettingsActions>
      </LoomSettingsPanel>
      {selected ? (
        <ProfileManager
          key={selected}
          environmentId={environmentId}
          projectId={selected}
          canWrite={canWrite}
          threads={
            catalog?.subjects
              .filter((s) => s.principal.kind === "thread" && s.projectId === selected)
              .map((s) => ({ id: s.principal.id, label: s.label })) ?? []
          }
        />
      ) : (
        <LoomSettingsNotice>Choose a project to manage its profiles.</LoomSettingsNotice>
      )}
    </div>
  );
}
function ProfileManager({
  environmentId,
  projectId,
  canWrite,
  threads,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  canWrite: boolean;
  threads: ReadonlyArray<{ id: string; label: string }>;
}) {
  const configs = useServerConfigs();
  const supportsGitHub = supportsLoomFeature(
    configs.get(environmentId)?.environment.capabilities,
    "vault-profile-github",
  );
  const atom = profiles.list({ environmentId, input: { projectId } }),
    result = useAtomValue(atom),
    snapshot = data(result);
  const [editing, setEditing] = useState<ProfileEditor | null>(null),
    [thread, setThread] = useState<ThreadId | null>(null),
    [review, setReview] = useState<VaultProfilePreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    }
    setBusy(false);
  };
  const apply = (change: VaultProfileMutation["change"]) =>
    act(async () => {
      if (!snapshot) return;
      await runVault(profiles.apply, {
        environmentId,
        input: { projectId, operationId: newId(), expectedRevision: snapshot.revision, change },
      });
      setEditing(null);
      setReview(null);
    });
  const edit = (p: VaultProfileDefinition) => {
    setEditing({ ...p, bindings: p.bindings.map((b) => ({ ...b, rowId: newId() })) });
    setReview(null);
    setError(null);
  };
  const update = (p: ProfileEditor) => {
    setEditing(p);
    setReview(null);
  };
  const preview = () =>
    act(async () => {
      const parsed = decode(editing);
      if (Option.isNone(parsed))
        throw new Error(
          "Use a label, unique lowercase binding names and valid Git paths or GitHub owner/repository names. Add at least one requirement.",
        );
      setReview(
        await runVault(profiles.preview, {
          environmentId,
          input: { projectId, profile: parsed.value, threadId: thread },
        }),
      );
    });
  const stale = result.waiting || result._tag === "Failure";
  const locked = !canWrite || busy || stale;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          disabled={locked || !snapshot || !!editing || snapshot.profiles.length >= 32}
          onClick={() =>
            edit({
              id: newId(),
              label: "",
              bindings: [{ name: "server", kind: "ssh", itemId: null, repository: null }],
            })
          }
        >
          Create profile
        </Button>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setReview(null);
            appAtomRegistry.refresh(atom);
          }}
        >
          Refresh profiles
        </Button>
      </LoomSettingsActions>
      {!canWrite ? (
        <LoomSettingsNotice>
          Your connection can inspect profiles but cannot change them.
        </LoomSettingsNotice>
      ) : null}
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      <VaultQueryFeedback
        result={result}
        loading="Loading profiles…"
        error={failure(result)}
        onRetry={() => {
          setReview(null);
          appAtomRegistry.refresh(atom);
        }}
      />
      {editing ? (
        <section aria-label="Profile editor" className="min-w-0">
          <LoomSettingsPanel
            title={editing.label ? `Edit ${editing.label}` : "New project profile"}
            description="Name each requirement, choose its operation and bind the key or connection it should use."
          >
            <p role="status" className="text-sm text-muted-foreground">
              Draft changes. Review the profile before saving.
            </p>
            <LoomSettingsField label="Profile label">
              <Input
                aria-label="Profile label"
                autoFocus
                value={editing.label}
                maxLength={120}
                disabled={locked}
                onChange={(e) => update({ ...editing, label: e.target.value })}
              />
            </LoomSettingsField>
            {editing.bindings.map((b, i) => (
              <fieldset
                key={b.rowId}
                className="flex min-w-0 flex-col gap-4 border-t border-border pt-4"
              >
                <legend className="pr-3 text-sm font-medium">Requirement {i + 1}</legend>
                <div className="grid min-w-0 gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                  <LoomSettingsField
                    label="Requirement name"
                    description="Use a unique lowercase name."
                  >
                    <Input
                      aria-label={`Requirement ${i + 1} name`}
                      value={b.name}
                      maxLength={64}
                      disabled={locked}
                      onChange={(e) =>
                        update({
                          ...editing,
                          bindings: editing.bindings.map((old, n) =>
                            n === i ? { ...old, name: e.target.value } : old,
                          ),
                        })
                      }
                    />
                  </LoomSettingsField>
                  <LoomSettingsField label="Operation">
                    <Select
                      disabled={locked}
                      value={b.kind}
                      onValueChange={(value) =>
                        value &&
                        update({
                          ...editing,
                          bindings: editing.bindings.map((old, n) =>
                            n === i
                              ? {
                                  ...old,
                                  kind:
                                    value === "github" ? "github" : value === "git" ? "git" : "ssh",
                                  itemId: null,
                                  repository: null,
                                }
                              : old,
                          ),
                        })
                      }
                    >
                      <SelectTrigger aria-label={`Requirement ${i + 1} operation`}>
                        <SelectValue>
                          {b.kind === "github"
                            ? "GitHub operations"
                            : b.kind === "git"
                              ? "Git repository over SSH"
                              : "SSH command"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="ssh">SSH command</SelectItem>
                        <SelectItem value="git">Git repository over SSH</SelectItem>
                        {supportsGitHub ? (
                          <SelectItem value="github">GitHub operations</SelectItem>
                        ) : null}
                      </SelectPopup>
                    </Select>
                  </LoomSettingsField>
                </div>
                {b.kind !== "ssh" ? (
                  <LoomSettingsField
                    label={b.kind === "github" ? "GitHub repository" : "Repository path"}
                  >
                    <Input
                      value={b.repository ?? ""}
                      aria-label={`Requirement ${i + 1} repository`}
                      placeholder={b.kind === "github" ? "owner/repository" : "team/repo.git"}
                      disabled={locked}
                      onChange={(e) =>
                        update({
                          ...editing,
                          bindings: editing.bindings.map((old, n) =>
                            n === i ? { ...old, repository: e.target.value || null } : old,
                          ),
                        })
                      }
                    />
                  </LoomSettingsField>
                ) : null}
                <p className="wrap-anywhere text-sm leading-relaxed">
                  {b.kind === "github" ? "Selected connection: " : "Selected key: "}
                  {b.itemId ? (
                    <VaultBoundReference environmentId={environmentId} id={b.itemId} />
                  ) : b.kind === "github" ? (
                    "No connection bound"
                  ) : (
                    "No key bound"
                  )}
                </p>
                <LoomSettingsDetails
                  title={
                    b.kind === "github"
                      ? "Choose or replace GitHub connection"
                      : "Choose or replace SSH key"
                  }
                >
                  {b.kind === "github" ? (
                    <VaultGitHubConnectionPicker
                      environmentId={environmentId}
                      disabled={locked}
                      onSelect={(itemId, repository) =>
                        update({
                          ...editing,
                          bindings: editing.bindings.map((old, n) =>
                            n === i ? { ...old, itemId, repository } : old,
                          ),
                        })
                      }
                    />
                  ) : (
                    <VaultReferencePicker
                      environmentId={environmentId}
                      kind="ssh-key"
                      disabled={locked}
                      onSelect={(ref) =>
                        update({
                          ...editing,
                          bindings: editing.bindings.map((old, n) =>
                            n === i ? { ...old, itemId: ref.item.id } : old,
                          ),
                        })
                      }
                    />
                  )}
                </LoomSettingsDetails>
                <LoomSettingsActions>
                  <Button
                    size="sm-multiline"
                    variant="outline"
                    disabled={locked || !b.itemId}
                    onClick={() =>
                      update({
                        ...editing,
                        bindings: editing.bindings.map((old, n) =>
                          n === i ? { ...old, itemId: null } : old,
                        ),
                      })
                    }
                  >
                    {b.kind === "github" ? "Unbind connection" : "Unbind key"}
                  </Button>
                  <Button
                    size="sm-multiline"
                    variant="outline"
                    disabled={locked || editing.bindings.length === 1}
                    onClick={() =>
                      update({ ...editing, bindings: editing.bindings.filter((_, n) => n !== i) })
                    }
                  >
                    Remove requirement {i + 1}
                  </Button>
                </LoomSettingsActions>
              </fieldset>
            ))}
            <LoomSettingsActions>
              <Button
                size="sm-multiline"
                variant="outline"
                disabled={locked || editing.bindings.length >= 16}
                onClick={() =>
                  update({
                    ...editing,
                    bindings: [
                      ...editing.bindings,
                      {
                        rowId: newId(),
                        name: `requirement_${editing.bindings.length + 1}`,
                        kind: "ssh",
                        itemId: null,
                        repository: null,
                      },
                    ],
                  })
                }
              >
                Add requirement
              </Button>
            </LoomSettingsActions>
            <LoomSettingsField
              label="Check access for thread"
              description="Choose a thread to include its use grants in the review."
            >
              <Select
                disabled={locked}
                value={thread ?? ""}
                onValueChange={(value) => {
                  setThread(value ? ThreadId.make(value) : null);
                  setReview(null);
                }}
              >
                <SelectTrigger aria-label="Preview thread">
                  <SelectValue>
                    {threads.find((t) => t.id === thread)?.label ??
                      (thread ? `Unavailable thread (${thread})` : "Host checks only")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">Host checks only</SelectItem>
                  {threads.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </LoomSettingsField>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              Review checks saved configuration and use grants. GitHub API health and GH CLI
              availability are checked separately. Incomplete profiles can be saved for later
              repair.
            </p>
            {review ? (
              <div
                role="region"
                aria-label="Profile review"
                className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted/40 p-4"
              >
                <p className="wrap-anywhere text-sm font-medium">Review {editing.label}</p>
                {review.bindings.map((b) => (
                  <p key={b.name} className="wrap-anywhere text-sm leading-relaxed">
                    {b.name}: {vaultProfileBindingMessage(b.state)}
                    {b.destination ? ` · ${b.destination}` : ""}
                  </p>
                ))}
              </div>
            ) : null}
            <LoomSettingsActions>
              {review ? (
                <Button
                  size="sm-multiline"
                  disabled={locked}
                  onClick={() => void apply({ type: "save", profile: editing })}
                >
                  {busy ? "Saving profile…" : "Save reviewed profile"}
                </Button>
              ) : (
                <Button size="sm-multiline" disabled={locked} onClick={() => void preview()}>
                  {busy ? "Reviewing profile…" : "Review profile"}
                </Button>
              )}
              <Button
                size="sm-multiline"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setReview(null);
                }}
              >
                Cancel profile editing
              </Button>
            </LoomSettingsActions>
          </LoomSettingsPanel>
        </section>
      ) : null}
      {snapshot && !editing ? (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Saved profiles</h3>
          <p className="text-sm text-muted-foreground">
            {snapshot.profiles.length} profiles. Choose a default for new runs or edit a profile's
            requirements.
          </p>
        </div>
      ) : null}
      {snapshot?.profiles.length === 0 ? (
        <LoomSettingsNotice>
          No profiles yet. Create one for this project's development environment.
        </LoomSettingsNotice>
      ) : null}
      {snapshot?.activeProfileId ? (
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={locked || !!editing}
            onClick={() => void apply({ type: "activate", id: null })}
          >
            Clear default for new runs
          </Button>
        </LoomSettingsActions>
      ) : null}
      {snapshot?.profiles.map((p) => (
        <LoomSettingsPanel key={p.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 wrap-anywhere text-sm font-medium">{p.label}</h3>
            <div className="flex flex-wrap gap-2">
              {snapshot.activeProfileId === p.id ? (
                <Badge variant="info">Default for new runs</Badge>
              ) : null}
              {p.state === "archived" ? <Badge variant="secondary">Archived</Badge> : null}
            </div>
          </div>
          <p className="wrap-anywhere text-sm leading-relaxed text-muted-foreground">
            {p.bindings.map((b) => b.name).join(", ")}
          </p>
          <p className="text-xs text-muted-foreground">Version {p.version}</p>
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={locked || !!editing || p.state === "archived"}
              aria-label={`Edit ${p.label}`}
              onClick={() => edit(p)}
            >
              Edit
            </Button>
            {p.state === "active" && snapshot.activeProfileId !== p.id ? (
              <Button
                size="sm-multiline"
                variant="outline"
                disabled={locked || !!editing}
                aria-label={`Use ${p.label} by default`}
                onClick={() => void apply({ type: "activate", id: p.id })}
              >
                Use by default
              </Button>
            ) : null}
          </LoomSettingsActions>
          <LoomSettingsDetails title="Profile maintenance">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Archiving blocks further profile use. Restoring does not restore the project default.
            </p>
            <LoomSettingsActions>
              <Button
                size="sm-multiline"
                variant="outline"
                disabled={locked || !!editing || (snapshot?.profiles.length ?? 0) >= 32}
                aria-label={`Clone ${p.label}`}
                onClick={() => edit({ ...p, id: newId(), label: `${p.label} copy` })}
              >
                Clone
              </Button>
              <Button
                size="sm-multiline"
                variant="outline"
                disabled={locked || !!editing}
                aria-label={`${p.state === "active" ? "Archive" : "Restore"} ${p.label}`}
                onClick={() =>
                  void apply({
                    type: "state",
                    id: p.id,
                    state: p.state === "active" ? "archived" : "active",
                  })
                }
              >
                {p.state === "active" ? "Archive" : "Restore"}
              </Button>
            </LoomSettingsActions>
            <VaultRequirementExport profile={p} />
          </LoomSettingsDetails>
        </LoomSettingsPanel>
      ))}
      <VaultRequirementImport
        supportsGitHub={supportsGitHub}
        disabled={locked || !!editing || !snapshot || snapshot.profiles.length >= 32}
        onImport={edit}
      />

      <VaultProfileHistory
        environmentId={environmentId}
        projectId={projectId}
        canWrite={canWrite}
      />
    </div>
  );
}
