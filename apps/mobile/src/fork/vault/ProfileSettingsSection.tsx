import { VaultReferenceSearch } from "./ReferenceSearch";
import { VaultReferenceSettings } from "./ReferenceSettingsSection";
import { VaultGitHubConnectionPicker } from "./GitHubConnectionPicker";
import { VaultProfileHistory } from "./ProfileHistory";
import { VaultRequirementImport, VaultRequirementExport } from "./ProfileTransfer";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
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
  createVaultReferenceAtoms,
  createVaultAccessAtoms,
  supportsLoomFeature,
  vaultProfileBindingMessage,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
const profiles = createVaultProfileAtoms(connectionAtomRuntime),
  references = createVaultReferenceAtoms(connectionAtomRuntime),
  access = createVaultAccessAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
type ProfileEditor = Omit<VaultProfileDefinition, "bindings"> & {
  bindings: ReadonlyArray<VaultProfileDefinition["bindings"][number] & { rowId: string }>;
};
const decode = Schema.decodeUnknownOption(VaultProfileDefinition);
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The Vault operation failed. Refresh and try again.";
export function VaultProfileSettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId),
    canRead = useEnvironmentScope(environmentId, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const supportsProfiles = supportsLoomFeature(config?.environment.capabilities, "vault-profiles");
  return (
    <>
      <SettingsSection title="Vault references">
        <VaultReferenceSettings key={environmentId} environmentId={environmentId} />
      </SettingsSection>
      {supportsProfiles ? (
        <SettingsSection title="Vault project profiles">
          {canRead ? (
            <VaultProjectProfiles
              key={`${environmentId}:${connected}:${canWrite}`}
              environmentId={environmentId}
              connected={connected}
              canWrite={canWrite}
            />
          ) : (
            <Text>Your connection does not include Vault inspection.</Text>
          )}
        </SettingsSection>
      ) : null}
    </>
  );
}
export function VaultProjectProfiles({
  environmentId,
  connected,
  canWrite,
  initialProject = null,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  canWrite: boolean;
  initialProject?: ProjectId | null;
}) {
  const catalog = useEnvironmentQuery(
    connected ? access.catalog({ environmentId, input: {} }) : null,
  );
  const [project, setProject] = useState<ProjectId | null>(initialProject),
    [choosing, setChoosing] = useState(false),
    [filter, setFilter] = useState("");
  const projects = catalog.data?.subjects.filter((s) => s.principal.kind === "project") ?? [];
  return (
    <View className="gap-3">
      <Text>
        Profiles hold named SSH, Git and GitHub references. They grant no access. A run keeps the
        revision and key versions it first resolves; later changes apply to later runs.
      </Text>
      <Button
        label={
          project
            ? `Project: ${projects.find((p) => p.principal.id === project)?.label ?? project}`
            : "Choose profile project"
        }
        disabled={!connected || !catalog.data}
        onPress={() => setChoosing(true)}
      />
      {catalog.error ? <Text accessibilityRole="alert">{message(catalog.error)}</Text> : null}
      {catalog.isPending ? <Text>Loading projects…</Text> : null}
      <Button label="Refresh profile projects" disabled={!connected} onPress={catalog.refresh} />
      {catalog.data?.truncated ? (
        <Text>Only the first 250 projects and threads are available here.</Text>
      ) : null}
      {choosing ? (
        <Sheet title="Profile project" onClose={() => setChoosing(false)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-3 p-4"
          >
            <TextInput
              accessibilityLabel="Filter profile projects"
              placeholder="Find a project"
              value={filter}
              onChangeText={setFilter}
            />
            {projects
              .filter((p) => p.label.toLowerCase().includes(filter.toLowerCase()))
              .map((p) => (
                <Button
                  key={p.principal.id}
                  label={p.label}
                  onPress={() => {
                    setProject(ProjectId.make(p.principal.id));
                    setChoosing(false);
                  }}
                />
              ))}
          </ScrollView>
        </Sheet>
      ) : null}
      {project ? (
        <ProfileManager
          key={project}
          environmentId={environmentId}
          projectId={project}
          connected={connected}
          canWrite={canWrite}
          threads={
            catalog.data?.subjects
              .filter((s) => s.principal.kind === "thread" && s.projectId === project)
              .map((s) => ({ id: s.principal.id, label: s.label })) ?? []
          }
        />
      ) : null}
    </View>
  );
}
function ProfileManager({
  environmentId,
  projectId,
  connected,
  canWrite,
  threads,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  connected: boolean;
  canWrite: boolean;
  threads: ReadonlyArray<{ id: string; label: string }>;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const supportsGitHub = supportsLoomFeature(
    config?.environment.capabilities,
    "vault-profile-github",
  );
  const snapshot = useEnvironmentQuery(
    connected ? profiles.list({ environmentId, input: { projectId } }) : null,
  );
  const applyCommand = useAtomCommand(profiles.apply, { reportFailure: false }),
    previewCommand = useAtomCommand(profiles.preview, { reportFailure: false });
  const [editing, setEditing] = useState<ProfileEditor | null>(null),
    [thread, setThread] = useState<ThreadId | null>(null),
    [review, setReview] = useState<VaultProfilePreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [picking, setPicking] = useState<number | null>(null),
    [choosingThread, setChoosingThread] = useState(false);
  const locked = !canWrite || !connected || busy || snapshot.isPending || !!snapshot.error;
  const closeEditorPage = () => {
    if (busy) return;
    if (picking !== null) setPicking(null);
    else if (choosingThread) setChoosingThread(false);
    else {
      setEditing(null);
      setReview(null);
    }
  };
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
      if (!snapshot.data) return;
      const result = await applyCommand({
        environmentId,
        input: {
          projectId,
          operationId: newId(),
          expectedRevision: snapshot.data.revision,
          change,
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setEditing(null);
      setReview(null);
    });
  const edit = (p: VaultProfileDefinition) => {
    setEditing({ ...p, bindings: p.bindings.map((b) => ({ ...b, rowId: newId() })) });
    setReview(null);
    setThread(null);
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
      const result = await previewCommand({
        environmentId,
        input: { projectId, profile: parsed.value, threadId: thread },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setReview(result.value);
    });
  return (
    <View className="gap-3">
      <Button
        label="Refresh profiles"
        disabled={busy || !connected}
        onPress={() => {
          setReview(null);
          snapshot.refresh();
        }}
      />
      <Button
        label="Create profile"
        disabled={locked || !snapshot.data || !!editing || snapshot.data.profiles.length >= 32}
        onPress={() =>
          edit({
            id: newId(),
            label: "",
            bindings: [{ name: "server", kind: "ssh", itemId: null, repository: null }],
          })
        }
      />
      <VaultRequirementImport
        supportsGitHub={supportsGitHub}
        disabled={locked || !!editing || !snapshot.data || snapshot.data.profiles.length >= 32}
        onImport={edit}
      />
      {snapshot.error ? <Text accessibilityRole="alert">{message(snapshot.error)}</Text> : null}
      {error && !editing ? <Text accessibilityRole="alert">{error}</Text> : null}
      {snapshot.isPending ? <Text>Loading profiles…</Text> : null}
      {snapshot.data?.profiles.length === 0 ? (
        <Text>No profiles yet. Create one for this project.</Text>
      ) : null}
      {snapshot.data?.activeProfileId ? (
        <Button
          label="Clear default for new runs"
          disabled={locked || !!editing}
          onPress={() => void apply({ type: "activate", id: null })}
        />
      ) : null}
      {snapshot.data?.profiles.map((p) => (
        <View key={p.id} className="gap-2 rounded-lg bg-subtle p-3">
          <Text className="font-t3-medium">
            {p.label}
            {snapshot.data?.activeProfileId === p.id ? " · Default for new runs" : ""}
            {p.state === "archived" ? " · Archived" : ""}
          </Text>
          <Text>
            Version {p.version} · {p.bindings.map((b) => b.name).join(", ")}
          </Text>
          <VaultRequirementExport profile={p} />
          <Button
            label={`Edit ${p.label}`}
            disabled={locked || !!editing || p.state === "archived"}
            onPress={() => edit(p)}
          />
          <Button
            label={`Clone ${p.label}`}
            disabled={locked || !!editing || (snapshot.data?.profiles.length ?? 0) >= 32}
            onPress={() => edit({ ...p, id: newId(), label: `${p.label} copy` })}
          />
          {p.state === "active" && snapshot.data?.activeProfileId !== p.id ? (
            <Button
              label={`Use ${p.label} by default`}
              disabled={locked || !!editing}
              onPress={() => void apply({ type: "activate", id: p.id })}
            />
          ) : null}
          <Button
            label={`${p.state === "active" ? "Archive" : "Restore"} ${p.label}`}
            disabled={locked || !!editing}
            onPress={() =>
              void apply({
                type: "state",
                id: p.id,
                state: p.state === "active" ? "archived" : "active",
              })
            }
          />
        </View>
      ))}
      <VaultProfileHistory
        environmentId={environmentId}
        projectId={projectId}
        canWrite={canWrite}
        connected={connected}
      />
      {/* Nested native sheets clip long forms and lose React touches inside RN modals. */}
      {editing ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={closeEditorPage}
        >
          <View accessibilityViewIsModal className="flex-1 bg-sheet">
            <SafeAreaProvider>
              <SafeAreaView style={{ flex: 1 }}>
                <KeyboardAvoidingView
                  className="flex-1 bg-sheet"
                  behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                  <View className="flex-row items-center justify-between gap-3 px-4 py-3">
                    <Text className="min-w-0 flex-1 text-xl font-t3-semibold">
                      {picking !== null
                        ? editing.bindings[picking]?.kind === "github"
                          ? "Choose GitHub connection"
                          : "Choose profile key"
                        : choosingThread
                          ? "Preview thread"
                          : "Vault profile"}
                    </Text>
                    <Button
                      label={
                        picking !== null || choosingThread
                          ? "Back to profile"
                          : "Close Vault profile"
                      }
                      disabled={busy}
                      onPress={closeEditorPage}
                    />
                  </View>
                  {picking === null && !choosingThread ? (
                    <>
                      <ScrollView
                        className="flex-1"
                        contentInsetAdjustmentBehavior="automatic"
                        keyboardShouldPersistTaps="handled"
                        contentContainerClassName="gap-4 p-4"
                      >
                        <Text>Profile label</Text>
                        <TextInput
                          accessibilityLabel="Profile label"
                          value={editing.label}
                          maxLength={120}
                          editable={!locked}
                          onChangeText={(label) => update({ ...editing, label })}
                        />
                        {editing.bindings.map((b, i) => (
                          <View key={b.rowId} className="gap-3 rounded-lg bg-subtle p-3">
                            <Text>Requirement {i + 1}</Text>
                            <TextInput
                              accessibilityLabel={`Requirement ${i + 1} name`}
                              value={b.name}
                              maxLength={64}
                              autoCapitalize="none"
                              editable={!locked}
                              onChangeText={(name) =>
                                update({
                                  ...editing,
                                  bindings: editing.bindings.map((old, n) =>
                                    n === i ? { ...old, name } : old,
                                  ),
                                })
                              }
                            />
                            <Button
                              label={`Operation: ${b.kind === "github" ? "GitHub operations" : b.kind === "git" ? "Git repository over SSH" : "SSH command"}`}
                              disabled={locked}
                              onPress={() =>
                                update({
                                  ...editing,
                                  bindings: editing.bindings.map((old, n) =>
                                    n === i
                                      ? {
                                          ...old,
                                          kind:
                                            old.kind === "ssh"
                                              ? "git"
                                              : old.kind === "git" && supportsGitHub
                                                ? "github"
                                                : "ssh",
                                          itemId: null,
                                          repository: null,
                                        }
                                      : old,
                                  ),
                                })
                              }
                            />
                            {b.kind !== "ssh" ? (
                              <TextInput
                                accessibilityLabel={`Requirement ${i + 1} repository`}
                                placeholder={
                                  b.kind === "github" ? "owner/repository" : "team/repo.git"
                                }
                                autoCapitalize="none"
                                value={b.repository ?? ""}
                                editable={!locked}
                                onChangeText={(repository) =>
                                  update({
                                    ...editing,
                                    bindings: editing.bindings.map((old, n) =>
                                      n === i ? { ...old, repository: repository || null } : old,
                                    ),
                                  })
                                }
                              />
                            ) : null}
                            {b.itemId ? (
                              <BoundReference
                                environmentId={environmentId}
                                id={b.itemId}
                                connected={connected}
                              />
                            ) : (
                              <Text>
                                {b.kind === "github" ? "No connection bound" : "No key bound"}
                              </Text>
                            )}
                            <Button
                              label={`Choose ${b.kind === "github" ? "GitHub connection" : "key"} for ${b.name || `requirement ${i + 1}`}`}
                              disabled={locked}
                              onPress={() => setPicking(i)}
                            />
                            <Button
                              label={`Unbind ${b.name || `requirement ${i + 1}`}`}
                              disabled={locked || !b.itemId}
                              onPress={() =>
                                update({
                                  ...editing,
                                  bindings: editing.bindings.map((old, n) =>
                                    n === i ? { ...old, itemId: null } : old,
                                  ),
                                })
                              }
                            />
                            <Button
                              label={`Remove requirement ${i + 1}`}
                              disabled={locked || editing.bindings.length === 1}
                              onPress={() =>
                                update({
                                  ...editing,
                                  bindings: editing.bindings.filter((_, n) => n !== i),
                                })
                              }
                            />
                          </View>
                        ))}
                        <Button
                          label="Add requirement"
                          disabled={locked || editing.bindings.length >= 16}
                          onPress={() =>
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
                        />
                        <Button
                          label={
                            thread
                              ? `Preview: ${threads.find((t) => t.id === thread)?.label ?? thread}`
                              : "Preview thread: host checks only"
                          }
                          disabled={locked}
                          onPress={() => setChoosingThread(true)}
                        />
                        <Text>
                          Review checks saved configuration and use grants. GitHub API health and GH
                          CLI availability must be checked separately. Incomplete profiles can be
                          saved for repair. Archiving blocks further profile use; restoring does not
                          restore the project default.
                        </Text>
                        {review ? (
                          <View className="gap-2">
                            <Text>Review {editing.label}</Text>
                            {review.bindings.map((b) => (
                              <Text key={b.name}>
                                {b.name}: {vaultProfileBindingMessage(b.state)}
                                {b.destination ? ` · ${b.destination}` : ""}
                              </Text>
                            ))}
                          </View>
                        ) : null}
                      </ScrollView>
                      <View className="gap-2 bg-sheet px-4 pt-3 pb-8">
                        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
                        <Button
                          label={review ? "Save reviewed profile" : "Review profile"}
                          disabled={locked}
                          onPress={() =>
                            review ? void apply({ type: "save", profile: editing }) : void preview()
                          }
                        />
                        <Button
                          label="Cancel profile editing"
                          disabled={busy}
                          onPress={closeEditorPage}
                        />
                      </View>
                    </>
                  ) : null}
                  {picking !== null ? (
                    <>
                      <ScrollView
                        className="flex-1"
                        contentInsetAdjustmentBehavior="automatic"
                        keyboardShouldPersistTaps="handled"
                        contentContainerClassName="gap-3 p-4"
                      >
                        {editing.bindings[picking]?.kind === "github" ? (
                          <VaultGitHubConnectionPicker
                            environmentId={environmentId}
                            connected={connected && !locked}
                            onSelect={(itemId, repository) => {
                              update({
                                ...editing,
                                bindings: editing.bindings.map((b, i) =>
                                  i === picking ? { ...b, itemId, repository } : b,
                                ),
                              });
                              setPicking(null);
                            }}
                          />
                        ) : (
                          <VaultReferenceSearch
                            environmentId={environmentId}
                            connected={connected && !locked}
                            kind="ssh-key"
                            onSelect={(r) => {
                              update({
                                ...editing,
                                bindings: editing.bindings.map((b, i) =>
                                  i === picking ? { ...b, itemId: r.item.id } : b,
                                ),
                              });
                              setPicking(null);
                            }}
                          />
                        )}
                      </ScrollView>
                    </>
                  ) : null}
                  {choosingThread ? (
                    <>
                      <ScrollView
                        className="flex-1"
                        contentInsetAdjustmentBehavior="automatic"
                        contentContainerClassName="gap-3 p-4"
                      >
                        <Button
                          label="Host checks only"
                          onPress={() => {
                            setThread(null);
                            setReview(null);
                            setChoosingThread(false);
                          }}
                        />
                        {threads.map((t) => (
                          <Button
                            key={t.id}
                            label={t.label}
                            onPress={() => {
                              setThread(ThreadId.make(t.id));
                              setReview(null);
                              setChoosingThread(false);
                            }}
                          />
                        ))}
                      </ScrollView>
                    </>
                  ) : null}
                </KeyboardAvoidingView>
              </SafeAreaView>
            </SafeAreaProvider>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
function BoundReference({
  environmentId,
  id,
  connected,
}: {
  environmentId: EnvironmentId;
  id: string;
  connected: boolean;
}) {
  const result = useEnvironmentQuery(
    connected ? references.describe({ environmentId, input: { id } }) : null,
  );
  return (
    <Text>
      Selected reference:{" "}
      {result.error
        ? "Reference unavailable; refresh to retry"
        : result.data
          ? `${result.data.item.label}${result.data.item.state === "archived" ? " (archived)" : ""}`
          : result.isPending
            ? "Loading selected reference…"
            : "Unavailable reference"}
    </Text>
  );
}
