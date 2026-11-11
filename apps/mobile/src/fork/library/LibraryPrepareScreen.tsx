import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { getNewProjectPathPreview } from "@t3tools/client-runtime/operations/projects";
import {
  libraryAccessRepairFromFailure,
  libraryPlacementReuses,
  libraryPlacementStrategy,
  serverChoosesFolders,
  supportsLoomFeature,
  libraryGitHubRepository,
  cancelEmptyLibraryPreparation,
  squashLibraryCommandFailure,
} from "@t3tools/client-runtime/fork";
import { type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { AuthSourceControlWriteScope, EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_REPOSITORY_ACCESS_FEATURE,
  type LibraryResourceRepositoryAccess,
  LibraryError,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import {
  readEnvironmentSessionState,
  useEnvironmentsWithScope,
  useEnvironmentSessionState,
} from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { VaultGitHubConnectionPicker } from "../vault/GitHubConnectionPicker";
import { LibraryFolderPicker } from "./LibraryFolderPicker";
import { LibraryNotice, LibraryPage } from "./LibraryPage";
import {
  assertLibraryProjectInitiator,
  registerSubmittedLibraryProjectCopy,
  runSubmittedLibraryProjectRequest,
  type SubmittedLibraryProjectRequest,
} from "./libraryProjectRequest";
import { libraryGitHub, library, refreshLibraryWork, useLibraryAuthority } from "./libraryState";
import { useLibraryProjectRequest } from "./useLibraryProjectRequest";

const isCopy = Schema.is(LibraryWorkingCopy);
const isLibraryError = Schema.is(LibraryError);
function unwrap<A, E>(result: AtomCommandResult<A, E>) {
  if (AsyncResult.isFailure(result)) throw squashLibraryCommandFailure(result);
  return result.value;
}

export function LibraryPrepareRouteScreen({
  route,
}: StaticScreenProps<{
  readonly projectId: string;
  readonly authorityEnvironmentId: EnvironmentId;
}>) {
  return (
    <LibraryPrepareContent
      key={`${route.params.authorityEnvironmentId}:${route.params.projectId}`}
      {...route.params}
    />
  );
}

function LibraryPrepareContent({
  projectId,
  authorityEnvironmentId,
}: {
  projectId: string;
  authorityEnvironmentId: EnvironmentId;
}) {
  const authority = useLibraryAuthority();
  const navigation = useNavigation();
  const { environments } = useEnvironments();
  const requests = useLibraryProjectRequest(
    JSON.stringify(["project-prepare", authorityEnvironmentId, projectId]),
  );
  const attempt = requests.attempt || null;
  const project = useEnvironmentQuery(
    library.project({ environmentId: authorityEnvironmentId, input: { projectId } }),
  );
  const [selected, select] = useState<EnvironmentId | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [browse, setBrowse] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repair, setRepair] = useState<LibraryError["repair"]>(undefined);
  const [accessRepair, setAccessRepair] = useState<LibraryError["accessRepair"]>(undefined);
  const busy = useRef(false);
  const execution = attempt?.environmentId ?? selected;
  const computer = environments.find((entry) => entry.environmentId === execution);
  const config = computer?.serverConfig;
  const identity = useEnvironmentSessionState(execution)?.identity;
  const [accessSelection, setAccessSelection] = useState<{
    environmentId: EnvironmentId | null;
    entries: LibraryResourceRepositoryAccess;
  }>({ environmentId: execution, entries: [] });
  const [choosingAccess, setChoosingAccess] = useState<string | null>(null);
  const repositoryAccess =
    attempt?.request.kind === "prepare"
      ? (attempt.request.input.repositoryAccess ?? [])
      : accessSelection.environmentId === execution
        ? accessSelection.entries
        : [];
  const usesVault = repositoryAccess.some((entry) => entry.access.kind === "vault-github");
  const vaultSupported = supportsLoomFeature(
    config?.environment.capabilities,
    LIBRARY_REPOSITORY_ACCESS_FEATURE,
  );
  const canUseVault = useAtomValue(libraryGitHub.readiness.permissionAtom(execution));
  const writable = useEnvironmentsWithScope(environments, AuthSourceControlWriteScope);
  const canPrepare = useAtomValue(library.prepareCopy.permissionAtom(execution));
  const canRegister = useAtomValue(library.registerCopy.permissionAtom(authorityEnvironmentId));
  const prepare = useAtomCommand(library.prepareCopy, { reportFailure: false });
  const lookup = useAtomCommand(library.operationOutcome, { reportFailure: false });
  const cancel = useAtomCommand(library.cancelOperation, { reportFailure: false });
  const readPreparation = useAtomQueryRunner(library.preparation, {
    refresh: true,
    reportFailure: false,
  });
  const register = useAtomCommand(library.registerCopy, { reportFailure: false });
  const readCopies = useAtomQueryRunner(library.copies, { refresh: true, reportFailure: false });
  const places = serverChoosesFolders(config);
  const placement = useEnvironmentQuery(
    execution && places && !attempt && destination === null
      ? library.placement.resultAtom({ environmentId: execution, input: { projectId } })
      : null,
  );
  const rootPath =
    attempt?.request.kind === "prepare"
      ? (attempt.request.input.rootPath ?? "")
      : (destination ??
        placement.data?.rootPath ??
        (config?.newProjectsRoot && project.data
          ? getNewProjectPathPreview(config.newProjectsRoot, project.data.title)
          : ""));
  const chosenProject =
    attempt?.request.kind === "prepare" ? attempt.request.input.project : project.data;
  const copy = attempt?.state === "succeeded" && isCopy(attempt.result) ? attempt.result : null;
  const projectReady =
    attempt !== null || (project.isSuccess && !project.isPending && project.error === null);
  const computerLabel = computer?.label ?? execution ?? "Selected computer";
  const connected = computer?.entry.enabled === true && computer.connection.phase === "connected";
  const correctAuthority = authority.environmentId === authorityEnvironmentId;
  const accountMatches =
    !attempt?.initiator ||
    (attempt.initiator.issuer === identity?.issuer &&
      attempt.initiator.subject === identity?.subject);
  const ready = authority.ready && correctAuthority && accountMatches;
  const finished = copy !== null && attempt?.registration === "succeeded";
  const destinationReady =
    attempt !== null ||
    destination !== null ||
    !places ||
    (placement.isSuccess && !placement.isPending && placement.error === null);
  const supported =
    supportsLoomFeature(config?.environment.capabilities, "project-library") &&
    config?.environment.capabilities.supportsExecution !== false;

  async function changePreparation() {
    if (!attempt || !execution || !ready || pending) return;
    setPending(true);
    setError(null);
    const change = async () => {
      await cancelEmptyLibraryPreparation(attempt.request.input.requestId, {
        outcome: async (requestId) =>
          unwrap(
            await lookup({
              environmentId: attempt.environmentId,
              input: { requestId, kind: "prepare" },
            }),
          ),
        preparation: async (requestId) =>
          unwrap(
            await readPreparation({ environmentId: attempt.environmentId, input: { requestId } }),
          ),
        cancel: async (operationId) =>
          unwrap(await cancel({ environmentId: attempt.environmentId, input: { operationId } })),
      });
      await requests.persist(null);
    };
    await change().catch((cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not change this preparation. Check its result first.",
      ),
    );
    setPending(false);
  }
  async function act() {
    if (
      busy.current ||
      !ready ||
      !requests.loaded ||
      requests.attempt === false ||
      !chosenProject ||
      !projectReady ||
      chosenProject.archived ||
      !execution
    )
      return;
    if (!copy && (!connected || !supported || !canPrepare || !writable.has(execution))) return;
    if (!copy && !attempt && (!rootPath.trim() || !destinationReady)) return;
    if (!canRegister || (usesVault && (!vaultSupported || !canUseVault))) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setAccessRepair(undefined);
    setRepair(undefined);
    let requestEnvironmentId = execution;
    const prepareFiles = async () => {
      const submitted: SubmittedLibraryProjectRequest = attempt ?? {
        authorityId: authorityEnvironmentId,
        environmentId: execution,
        ...(identity ? { initiator: identity } : {}),
        state: "ready",
        result: null,
        prepareFiles: true,
        request: {
          kind: "prepare",
          input: {
            requestId: uuidv4(),
            project: chosenProject,
            rootPath: rootPath.trim(),
            ...(repositoryAccess.length ? { repositoryAccess } : {}),
            strategy:
              destination === null && placement.data
                ? libraryPlacementStrategy(placement.data)
                : "clone",
          },
        },
      };
      const checking = submitted.state === "unknown" || submitted.registration === "unknown";
      const complete = await runSubmittedLibraryProjectRequest(submitted, authorityEnvironmentId, {
        persist: requests.persist,
        identity,
        lookup: async ({ environmentId, requestId, kind }) =>
          unwrap(await lookup({ environmentId, input: { requestId, kind } })),
        execute: async (saved) => {
          if (saved.request.kind !== "prepare") throw new Error("Review the saved file request.");
          return unwrap(
            await prepare({ environmentId: saved.environmentId, input: saved.request.input }),
          );
        },
      });
      const currentIdentity = readEnvironmentSessionState(execution)?.identity;
      assertLibraryProjectInitiator(complete, currentIdentity);
      if (complete.state === "succeeded" && !checking) {
        await registerSubmittedLibraryProjectCopy(complete, authorityEnvironmentId, {
          persist: requests.persist,
          copies: async () => {
            requestEnvironmentId = authorityEnvironmentId;
            return unwrap(
              await readCopies({ environmentId: authorityEnvironmentId, input: { projectId } }),
            );
          },
          register: async (input) => {
            requestEnvironmentId = authorityEnvironmentId;
            unwrap(await register({ environmentId: authorityEnvironmentId, input }));
          },
        });
      } else if (complete.registration === "unknown") {
        await registerSubmittedLibraryProjectCopy(complete, authorityEnvironmentId, {
          persist: requests.persist,
          copies: async () => {
            requestEnvironmentId = authorityEnvironmentId;
            return unwrap(
              await readCopies({ environmentId: authorityEnvironmentId, input: { projectId } }),
            );
          },
          register: async () => {
            throw new Error("Check the saved file location before retrying.");
          },
        });
      }
      refreshLibraryWork(authorityEnvironmentId, projectId);
    };
    await prepareFiles().catch((cause: unknown) => {
      setAccessRepair(libraryAccessRepairFromFailure(cause, requestEnvironmentId));
      setRepair(isLibraryError(cause) ? cause.repair : undefined);
      setError(cause instanceof Error ? cause.message : "The files could not be prepared.");
    });
    busy.current = false;
    setPending(false);
  }
  return (
    <LibraryPage title={finished ? "Project ready" : "Prepare project files"} back>
      <LibraryNotice
        detail={
          finished
            ? `${chosenProject?.title ?? "Project"} and its files are ready.`
            : `${chosenProject?.title ?? "Project"} is saved in your Library. Choose where its files belong. Start a conversation separately.`
        }
      />
      {!accountMatches ? (
        <LibraryNotice
          error="Sign in with the account that started this request before continuing."
          accessRepair={{ kind: "ownership" }}
          accessContext={{
            environmentId: execution,
            authorityEnvironmentId,
            originalAccount: attempt?.initiator,
          }}
        />
      ) : null}
      {!correctAuthority ? (
        <LibraryNotice
          error="Reconnect the Library used to create this project before continuing."
          accessRepair={{ kind: "connection", environmentId: authorityEnvironmentId }}
        />
      ) : null}
      {!requests.loaded ? <LibraryNotice detail="Loading the saved file request…" /> : null}
      {requests.attempt === false ? (
        <LibraryNotice error="The saved file request could not be read. Keep it for recovery before preparing another copy." />
      ) : null}
      {copy ? (
        <SettingsSection title="Files ready">
          <View className="gap-2 p-4">
            <Text>{computerLabel}</Text>
            <Text selectable>{copy.rootPath}</Text>
            <Text>
              {finished
                ? "Project and file location saved. No conversation has been started."
                : "The files are ready. Save their location to your Library to finish."}
            </Text>
          </View>
        </SettingsSection>
      ) : (
        <>
          <SettingsSection title="Computer">
            {environments.length === 0 ? (
              <LibraryNotice detail="Connect a computer to prepare this project's files." />
            ) : null}
            {environments.map((entry, index) => (
              <ListChoiceRow
                key={entry.environmentId}
                label={entry.label}
                selected={execution === entry.environmentId}
                separated={index > 0}
                disabled={
                  pending ||
                  attempt !== null ||
                  !entry.entry.enabled ||
                  entry.connection.phase !== "connected" ||
                  entry.serverConfig?.environment.capabilities.supportsExecution === false ||
                  !supportsLoomFeature(
                    entry.serverConfig?.environment.capabilities,
                    "project-library",
                  )
                }
                onPress={() => {
                  select(entry.environmentId);
                  setDestination(null);
                  setBrowse(false);
                  setError(null);
                }}
              />
            ))}
          </SettingsSection>
          {execution ? (
            <>
              {chosenProject?.resources.some((resource) => resource.kind !== "link") ? (
                <SettingsSection title="Repository access">
                  <View className="gap-3 p-4">
                    {chosenProject.resources
                      .filter((resource) => resource.kind !== "link")
                      .map((resource) => {
                        const selected = repositoryAccess.find(
                          (entry) => entry.resourceId === resource.id,
                        )?.access;
                        const repository = libraryGitHubRepository(resource.remoteUrl);
                        return (
                          <View key={resource.id} className="gap-2">
                            <Text>{resource.title}</Text>
                            <Text>
                              {selected?.kind === "vault-github"
                                ? `Vault GitHub for ${selected.repository}, version ${selected.expectedVersion}`
                                : `Git credentials configured on ${computerLabel}`}
                            </Text>
                            {vaultSupported && repository ? (
                              <Button
                                label="Choose Vault GitHub connection"
                                disabled={pending || attempt !== null || !canUseVault}
                                onPress={() =>
                                  setChoosingAccess(
                                    choosingAccess === resource.id ? null : resource.id,
                                  )
                                }
                              />
                            ) : null}
                            {selected?.kind === "vault-github" ? (
                              <Button
                                label="Use computer credentials"
                                disabled={pending || attempt !== null}
                                onPress={() =>
                                  setAccessSelection({
                                    environmentId: execution,
                                    entries: repositoryAccess.filter(
                                      (entry) => entry.resourceId !== resource.id,
                                    ),
                                  })
                                }
                              />
                            ) : null}
                            {choosingAccess === resource.id ? (
                              <VaultGitHubConnectionPicker
                                environmentId={execution}
                                connected={connected && !pending && attempt === null}
                                onSelect={(id, selectedRepository, info) => {
                                  if (selectedRepository.toLowerCase() !== repository) {
                                    setError(`Choose the connection's access to ${repository}.`);
                                    return;
                                  }
                                  setAccessSelection({
                                    environmentId: execution,
                                    entries: [
                                      ...repositoryAccess.filter(
                                        (entry) => entry.resourceId !== resource.id,
                                      ),
                                      {
                                        resourceId: resource.id,
                                        access: {
                                          kind: "vault-github",
                                          id,
                                          expectedVersion: info.item.version,
                                          repository: selectedRepository.toLowerCase(),
                                        },
                                      },
                                    ],
                                  });
                                  setChoosingAccess(null);
                                  setError(null);
                                }}
                              />
                            ) : null}
                          </View>
                        );
                      })}
                    {usesVault && !vaultSupported ? (
                      <LibraryNotice error="Update this computer to use the selected Vault connection." />
                    ) : null}
                    {usesVault && !canUseVault ? (
                      <LibraryNotice error="Vault credential-use access is required on this computer." />
                    ) : null}
                  </View>
                </SettingsSection>
              ) : null}
              <SettingsSection title="Destination">
                <View className="gap-3 p-4">
                  <TextInput
                    accessibilityLabel="Project files destination"
                    value={rootPath}
                    editable={!pending && !attempt}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setDestination}
                  />
                  <Text className="text-sm text-foreground-muted">
                    Repository access is checked before creating folders.
                  </Text>
                  <Button
                    label={browse ? "Hide folders" : "Choose destination folder"}
                    disabled={pending || attempt !== null}
                    onPress={() => setBrowse(!browse)}
                  />
                  {browse && !attempt ? (
                    <LibraryFolderPicker
                      environmentId={execution}
                      projectTitle={chosenProject?.title}
                      disabled={pending}
                      onChoose={(path) => {
                        setDestination(path);
                        setBrowse(false);
                      }}
                    />
                  ) : null}
                  {placement.data &&
                  !attempt &&
                  destination === null &&
                  libraryPlacementReuses(placement.data) ? (
                    <Text>The computer can use its existing checkout at this destination.</Text>
                  ) : null}
                </View>
              </SettingsSection>
            </>
          ) : null}
        </>
      )}
      {attempt && !copy ? (
        <Button
          label="Change setup"
          tone="text"
          disabled={pending || !ready || !connected}
          onPress={() => void changePreparation()}
        />
      ) : null}
      {attempt?.state === "unknown" || attempt?.registration === "unknown" ? (
        <LibraryNotice detail="The submitted request and destination are saved. Check the existing result before retrying. Signing in does not run this request." />
      ) : null}
      {chosenProject?.archived ? (
        <LibraryNotice detail="Reopen this project before preparing its files." />
      ) : null}
      {!canRegister ? (
        <LibraryNotice
          detail="Library access to save file locations is required to finish preparation."
          accessRepair={{ kind: "permission", environmentId: authorityEnvironmentId }}
        />
      ) : null}
      {!authority.ready ? (
        <LibraryNotice
          detail="Reconnect your Library, then explicitly continue this preparation."
          accessRepair={{ kind: "connection", environmentId: authorityEnvironmentId }}
        />
      ) : null}
      {!copy &&
      execution &&
      (!connected || !supported || !canPrepare || !writable.has(execution)) ? (
        <LibraryNotice
          detail="Connect the selected computer with permission to prepare project files and use Git."
          accessRepair={{ kind: connected ? "permission" : "connection", environmentId: execution }}
          accessContext={{ environmentId: execution, computerLabel: computer?.label }}
        />
      ) : null}
      {placement.error ? (
        <LibraryNotice error={placement.error} onRetry={placement.refresh} />
      ) : null}
      {project.error ? <LibraryNotice error={project.error} onRetry={project.refresh} /> : null}
      {error ? (
        <LibraryNotice
          accessRepair={accessRepair}
          accessContext={{
            environmentId: execution,
            authorityEnvironmentId,
            computerLabel: computer?.label,
            originalAccount:
              accessRepair?.environmentId === authorityEnvironmentId
                ? undefined
                : attempt?.initiator,
          }}
          repair={repair}
          error={error}
        />
      ) : null}
      {finished ? (
        <>
          <Button
            label="View project"
            tone="primary"
            disabled={pending}
            onPress={() => {
              void requests
                .persist(null)
                .then(() =>
                  navigation.dispatch(StackActions.replace("LibraryProject", { projectId })),
                )
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error ? cause.message : "The result could not be saved.",
                  ),
                );
            }}
          />
          <Button
            label="New conversation"
            disabled={!ready}
            onPress={() => {
              void requests
                .persist(null)
                .then(() =>
                  navigation.navigate("LibraryStart", {
                    projectId,
                    reuseEnvironmentId: copy.environmentId,
                    initialCopyId: copy.id,
                    startNow: true,
                  }),
                )
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error ? cause.message : "The result could not be saved.",
                  ),
                );
            }}
          />
        </>
      ) : (
        <Button
          label={
            pending
              ? "Preparing…"
              : attempt?.state === "unknown" || attempt?.registration === "unknown"
                ? "Check preparation result"
                : copy
                  ? "Save file location"
                  : attempt
                    ? "Retry preparation"
                    : "Prepare files"
          }
          tone="primary"
          disabled={
            pending ||
            !ready ||
            !requests.loaded ||
            requests.attempt === false ||
            !chosenProject ||
            !projectReady ||
            chosenProject.archived ||
            !execution ||
            !canRegister ||
            (usesVault && (!vaultSupported || !canUseVault)) ||
            (!copy &&
              (!connected ||
                !supported ||
                !canPrepare ||
                !writable.has(execution) ||
                !rootPath.trim() ||
                !destinationReady))
          }
          onPress={() => {
            void act();
          }}
        />
      )}
    </LibraryPage>
  );
}
