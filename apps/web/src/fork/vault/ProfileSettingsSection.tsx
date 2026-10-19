import { VaultProfileHistory } from "./ProfileHistory";
import { VaultRequirementImport, VaultRequirementExport } from "./ProfileTransfer";
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
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-profiles",
    )
  )
    return <p className="text-sm">Project profiles need a server with Vault profile support.</p>;
  if (!canRead)
    return <p className="text-sm">Your connection does not include Vault inspection.</p>;
  return (
    <ProfileProjects
      key={`${environment.environmentId}:${target?.projectId}:${canWrite}`}
      environmentId={environment.environmentId}
      initialProject={target?.projectId ?? null}
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Give SSH and Git requirements stable names. Profiles hold references and grant no access. A
        run keeps the revision and key versions it first resolves; later edits and default changes
        apply to later runs.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Project
        <select
          aria-label="Vault profile project"
          value={selected ?? ""}
          onChange={(e) => setSelected(e.target.value ? ProjectId.make(e.target.value) : null)}
        >
          <option value="">Choose a project</option>
          {projects.map((s) => (
            <option key={s.principal.id} value={s.principal.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {result.waiting ? <p role="status">Loading projects…</p> : null}
      {failure(result) ? <p role="alert">{failure(result)}</p> : null}
      {catalog?.truncated ? (
        <p className="text-sm">Only the first 250 projects and threads are available here.</p>
      ) : null}
      <Button size="sm" variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
        Refresh projects
      </Button>
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
        <p className="text-sm">Choose a project to manage its profiles.</p>
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
    } finally {
      setBusy(false);
    }
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
          "Use a label, unique lowercase binding names and valid Git paths. Add at least one requirement.",
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setReview(null);
            appAtomRegistry.refresh(atom);
          }}
        >
          Refresh profiles
        </Button>
        <Button
          size="sm"
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
      </div>
      <VaultRequirementImport
        disabled={locked || !!editing || !snapshot || snapshot.profiles.length >= 32}
        onImport={edit}
      />
      {error || failure(result) ? (
        <p role="alert" className="text-sm">
          {error ?? failure(result)}
        </p>
      ) : null}
      {result.waiting ? <p role="status">Loading profiles…</p> : null}
      {snapshot?.profiles.length === 0 ? (
        <p className="text-sm">
          No profiles yet. Create one for this project's development environment.
        </p>
      ) : null}
      {snapshot?.activeProfileId ? (
        <Button
          size="sm"
          variant="outline"
          disabled={locked || !!editing}
          onClick={() => void apply({ type: "activate", id: null })}
        >
          Clear default for new runs
        </Button>
      ) : null}
      {snapshot?.profiles.map((p) => (
        <div key={p.id} className="flex flex-col gap-2 rounded-md border p-3">
          <p className="break-words font-medium">
            {p.label}
            {snapshot.activeProfileId === p.id ? " · Default for new runs" : ""}
            {p.state === "archived" ? " · Archived" : ""}
          </p>
          <p className="text-sm">
            Version {p.version} · {p.bindings.map((b) => b.name).join(", ")}
          </p>
          <VaultRequirementExport profile={p} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={locked || !!editing || p.state === "archived"}
              aria-label={`Edit ${p.label}`}
              onClick={() => edit(p)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={locked || !!editing || (snapshot?.profiles.length ?? 0) >= 32}
              aria-label={`Clone ${p.label}`}
              onClick={() => edit({ ...p, id: newId(), label: `${p.label} copy` })}
            >
              Clone
            </Button>
            {p.state === "active" && snapshot.activeProfileId !== p.id ? (
              <Button
                size="sm"
                variant="outline"
                disabled={locked || !!editing}
                aria-label={`Use ${p.label} by default`}
                onClick={() => void apply({ type: "activate", id: p.id })}
              >
                Use by default
              </Button>
            ) : null}
            <Button
              size="sm"
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
          </div>
        </div>
      ))}
      <VaultProfileHistory
        environmentId={environmentId}
        projectId={projectId}
        canWrite={canWrite}
      />
      {editing ? (
        <section
          aria-label="Profile editor"
          className="flex flex-col gap-4 rounded-md bg-muted p-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            Profile label
            <Input
              autoFocus
              value={editing.label}
              maxLength={120}
              disabled={locked}
              onChange={(e) => update({ ...editing, label: e.target.value })}
            />
          </label>
          {editing.bindings.map((b, i) => (
            <div key={b.rowId} className="flex flex-col gap-3 rounded-md border p-3">
              <label className="flex flex-col gap-1 text-sm">
                Requirement name
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
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Operation
                <select
                  aria-label={`Requirement ${i + 1} operation`}
                  disabled={locked}
                  value={b.kind}
                  onChange={(e) =>
                    update({
                      ...editing,
                      bindings: editing.bindings.map((old, n) =>
                        n === i
                          ? {
                              ...old,
                              kind: e.target.value === "git" ? "git" : "ssh",
                              repository: null,
                            }
                          : old,
                      ),
                    })
                  }
                >
                  <option value="ssh">SSH command</option>
                  <option value="git">Git repository</option>
                </select>
              </label>
              {b.kind === "git" ? (
                <label className="flex flex-col gap-1 text-sm">
                  Repository path
                  <Input
                    value={b.repository ?? ""}
                    placeholder="team/repo.git"
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
                </label>
              ) : null}
              <p className="text-sm">
                Selected key:{" "}
                {b.itemId ? (
                  <VaultBoundReference environmentId={environmentId} id={b.itemId} />
                ) : (
                  "No key bound"
                )}
              </p>
              <details>
                <summary className="cursor-pointer text-sm">Choose or replace SSH key</summary>
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
              </details>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
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
                  Unbind key
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={locked || editing.bindings.length === 1}
                  onClick={() =>
                    update({ ...editing, bindings: editing.bindings.filter((_, n) => n !== i) })
                  }
                >
                  Remove requirement {i + 1}
                </Button>
              </div>
            </div>
          ))}
          <Button
            size="sm"
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
          <label className="flex flex-col gap-1 text-sm">
            Check access for thread
            <select
              aria-label="Preview thread"
              disabled={locked}
              value={thread ?? ""}
              onChange={(e) => {
                setThread(e.target.value ? ThreadId.make(e.target.value) : null);
                setReview(null);
              }}
            >
              <option value="">Host checks only</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm">
            Archiving blocks further profile use. Restoring does not restore the project default.
            Incomplete profiles can be saved for later repair.
          </p>
          {review ? (
            <div role="region" aria-label="Profile review" className="flex flex-col gap-2">
              <p className="break-words font-medium">Review {editing.label}</p>
              {review.bindings.map((b) => (
                <p key={b.name} className="break-words text-sm">
                  {b.name}: {vaultProfileBindingMessage(b.state)}
                  {b.destination ? ` · ${b.destination}` : ""}
                </p>
              ))}
              <Button
                disabled={locked}
                onClick={() => void apply({ type: "save", profile: editing })}
              >
                Save reviewed profile
              </Button>
            </div>
          ) : (
            <Button disabled={locked} onClick={() => void preview()}>
              Review profile
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setReview(null);
            }}
          >
            Cancel profile editing
          </Button>
        </section>
      ) : null}
    </div>
  );
}
