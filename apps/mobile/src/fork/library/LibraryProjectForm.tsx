import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import {
  LIBRARY_PROJECT_COLORS,
  LibraryBlueprint,
  LibraryError,
  PROJECT_WORKFLOWS_FEATURE,
  PROJECT_ECOSYSTEM_FEATURE,
  type LibraryProject,
  type LibraryProjectColor,
  type LibraryResource,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironments } from "../../state/environments";
import { readEnvironmentSessionState, useEnvironmentSessionState } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryPreparationPlans } from "./LibraryPreparationPlan";
import { LibraryProfileSection } from "./LibraryProfileSection";
import { LibraryBriefSuggestionsSetting } from "./LibraryBriefSuggestions";
import { LibraryNotice, LibraryPage } from "./LibraryPage";
import {
  library,
  refreshLibraryProject,
  useLibraryAuthority,
  useLoomFeature,
} from "./libraryState";
import { libraryResourceDraft } from "./libraryLogic";
import {
  LibraryExistingFolder,
  type ExistingLibraryFolder,
  type ExistingLibraryFolderRequest,
} from "./LibraryExistingFolder";
import {
  libraryExistingFolderTarget,
  libraryFolderActionOutcome,
  rememberLibraryFolderProject,
  rememberedLibraryFolderProject,
} from "./libraryExistingFolderTarget";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { useLibraryProjectRequest } from "./useLibraryProjectRequest";
import {
  runSubmittedLibraryProjectRequest,
  type SubmittedLibraryProjectRequest,
} from "./libraryProjectRequest";
import { EnvironmentId } from "@t3tools/contracts";
import { useLibraryProjectColorValue } from "./libraryProjectColors";
import { LibraryNewProjectChoices, type LibraryCreateStart } from "./LibraryNewProjectChoices";
import {
  libraryActiveCopies,
  libraryAddResource,
  libraryRootMoveWarning,
  libraryStartIntent,
  libraryProfileChange,
  libraryProfileProblem,
  libraryResourceFromInput,
  PROJECT_COLOR_NAMES,
  validateResources,
  type LibraryProfileDraft,
} from "@t3tools/client-runtime/fork";

const blueprintCodec = Schema.fromJsonString(LibraryBlueprint);
const isLibraryError = Schema.is(LibraryError);

type ResourceDraft = {
  id: string;
  kind: "repository" | "link";
  title: string;
  url: string;
  relativePath: string;
  defaultBranch: string;
};
export function LibraryCreateRouteScreen({
  route,
}: StaticScreenProps<
  { readonly initialInput?: string; readonly start?: LibraryCreateStart } | undefined
>) {
  const params = route.params;
  return params?.start || params?.initialInput ? (
    <LibraryProjectForm initialInput={params.initialInput} start={params.start} />
  ) : (
    <LibraryNewProjectChoices />
  );
}
export function LibraryEditRouteScreen({
  route,
}: StaticScreenProps<{ readonly projectId: string }>) {
  const authority = useLibraryAuthority();
  const query = useEnvironmentQuery(
    authority.environmentId
      ? library.project({
          environmentId: authority.environmentId,
          input: { projectId: route.params.projectId },
        })
      : null,
  );
  return query.data ? (
    <LibraryProjectForm key={query.data.id} initial={query.data} />
  ) : (
    <LibraryPage title="Edit project" back>
      <LibraryNotice
        error={query.error}
        detail={query.error ? null : "Loading the saved project…"}
        onRetry={query.refresh}
      />
    </LibraryPage>
  );
}
type ProjectFormProps = {
  initial?: LibraryProject;
  initialInput?: string | undefined;
  start?: LibraryCreateStart | undefined;
};
function LibraryProjectForm(props: ProjectFormProps) {
  const authority = useLibraryAuthority();
  const [pinned, setPinned] = useState(authority.environmentId);
  if (!pinned && authority.environmentId) setPinned(authority.environmentId);
  const requestState = useLibraryProjectRequest(
    JSON.stringify(["project-save", pinned, props.initial?.id ?? "new"]),
  );
  if (!requestState.loaded || requestState.attempt === false)
    return (
      <LibraryPage title="New project" back>
        <LibraryNotice
          detail={
            requestState.attempt === false
              ? "The saved project request could not be read. Keep it for recovery before creating another project."
              : "Loading the saved project request…"
          }
        />
      </LibraryPage>
    );
  return (
    <LibraryProjectFormContent
      {...props}
      key={`${pinned}:${props.initial?.id ?? "new"}`}
      saved={requestState.attempt}
      persist={requestState.persist}
    />
  );
}
function LibraryProjectFormContent({
  initial: seed,
  initialInput,
  start,
  saved,
  persist,
}: ProjectFormProps & {
  saved: SubmittedLibraryProjectRequest | null;
  persist: (attempt: SubmittedLibraryProjectRequest | null) => Promise<void>;
}) {
  const savedInput = saved?.request.kind !== "prepare" ? saved?.request.input : undefined;
  const intent = libraryStartIntent(initialInput ?? "");
  const lead = start === "folder" || start === "repository" ? start : null;
  const [initial] = useState(seed);
  const authority = useLibraryAuthority(),
    navigation = useNavigation(),
    { environments } = useEnvironments();
  const identity = useEnvironmentSessionState(authority.environmentId)?.identity;
  const lookup = useAtomCommand(library.operationOutcome, { reportFailure: false });
  const create = useAtomCommand(library.createProject, { reportFailure: false }),
    update = useAtomCommand(library.updateProject, { reportFailure: false });
  const canSave = useAtomValue(
    (initial ? library.updateProject : library.createProject).permissionAtom(
      authority.environmentId,
    ),
  );
  const [title, setTitle] = useState(
      savedInput?.title ?? initial?.title ?? (intent.kind !== "search" ? intent.title : ""),
    ),
    [brief, setBrief] = useState(savedInput?.brief ?? initial?.brief ?? "");
  // Null means automatic: the project keeps a stable color derived from its id.
  const [color, setColor] = useState<LibraryProjectColor | null>(
    savedInput?.color ?? initial?.color ?? null,
  );
  const [resources, setResources] = useState<readonly ResourceDraft[]>(
    () =>
      (savedInput?.resources ?? initial?.resources)?.map((resource) => ({
        id: resource.id,
        kind: resource.kind ?? "repository",
        title: resource.title,
        url: resource.kind === "link" ? (resource.url ?? "") : (resource.remoteUrl ?? ""),
        relativePath: resource.relativePath,
        defaultBranch: resource.defaultBranch ?? "",
      })) ??
      (() => {
        const resource = intent.kind === "repository" ? libraryResourceFromInput(intent.url) : null;
        return resource
          ? [
              {
                id: uuidv4(),
                kind: "repository" as const,
                title: resource.title,
                url: resource.remoteUrl ?? "",
                relativePath: resource.relativePath,
                defaultBranch: "",
              },
            ]
          : [];
      })(),
  );
  // The setup is edited with a saved project, and only once the Library says it keeps one.
  const editsProfile = Boolean(initial && authority.keepsProfile);
  const [profile, setProfile] = useState<LibraryProfileDraft>(() => ({
    ...(savedInput?.profile ?? initial?.profile),
  }));
  const editsDependencies = useLoomFeature(authority.environmentId, PROJECT_ECOSYSTEM_FEATURE);
  const [dependencies, setDependencies] = useState<readonly string[]>(
    savedInput?.dependencies ?? initial?.dependencies ?? [],
  );
  const dependencyCatalog = useEnvironmentQuery(
    editsDependencies && authority.environmentId && initial
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: true },
        })
      : null,
  );
  const supportsBlueprint = useLoomFeature(authority.environmentId, PROJECT_WORKFLOWS_FEATURE);
  const [blueprintText, setBlueprintText] = useState<string | null>(null);
  const [importedBlueprint, setImportedBlueprint] = useState(false);
  const decodedBlueprint =
    blueprintText === null ? null : Schema.decodeOption(blueprintCodec)(blueprintText);
  const blueprint = decodedBlueprint?._tag === "Some" ? decodedBlueprint.value : null;
  const copies = useEnvironmentQuery(
    initial && authority.environmentId
      ? library.copies({
          environmentId: authority.environmentId,
          input: { projectId: initial.id, includeReleased: true },
        })
      : null,
  );
  const hostLabel = (id: string) =>
    environments.find((env) => env.environmentId === id)?.label ??
    authority.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [accessRepair, setAccessRepair] = useState<LibraryError["accessRepair"]>(undefined);
  const [submitted, setSubmitted] = useState(saved);
  const awaitingResult = submitted !== null;
  const accountMatches =
    !submitted?.initiator ||
    (submitted.initiator.issuer === identity?.issuer &&
      submitted.initiator.subject === identity?.subject);
  const busy = useRef(false);
  const saveAttempt = async (next: SubmittedLibraryProjectRequest | null) => {
    await persist(next);
    setSubmitted(next);
  };
  const [showSetup, setShowSetup] = useState(false);
  const [existingFolder, setExistingFolder] = useState<ExistingLibraryFolder | null>(null),
    [inspectingFolder, setInspectingFolder] = useState(false),
    [folderProject, setFolderProject] = useState<LibraryProject | null>(null);
  // What the last folder row tapped said it would do. It runs once the folder's owner is known.
  const [folderRequest, setFolderRequest] = useState<ExistingLibraryFolderRequest | null>(null),
    decidedFolderRequest = useRef<ExistingLibraryFolderRequest | null>(null);
  // A save a folder row asked for reports beside that folder rather than at the end of the form.
  const savingFromFolder = folderRequest?.action?.kind === "create";
  // Archived projects tell a folder's archived owner apart from one the Library no longer has.
  const catalog = useEnvironmentQuery(
    existingFolder && authority.environmentId
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: true },
        })
      : null,
  );
  // Latched on the first answer from the connected Library. A persisted catalog can still show an
  // owner as current or archived after that changed elsewhere, and a wrong call here either
  // creates a project the computer then refuses or offers a project that cannot take the folder.
  const [catalogSettled, setCatalogSettled] = useState(false);
  if (!catalogSettled && authority.connected && catalog.isSuccess && !catalog.isPending)
    setCatalogSettled(true);
  const folderTarget = existingFolder
    ? libraryExistingFolderTarget({
        registrations: existingFolder.registrations,
        projects: catalogSettled && catalog.error === null ? catalog.data : null,
        loading: catalog.isPending,
        created: folderProject,
      })
    : null;
  const offeredProject = folderTarget?.project ?? null;
  // A name typed before choosing a folder, rather than one the folder filled in.
  const typedTitle = title.trim() && title !== existingFolder?.title ? title.trim() : null;
  const folderDraftIds = useRef<ReadonlySet<string>>(new Set());
  const [pasted, setPasted] = useState(""),
    [pasteProblem, setPasteProblem] = useState<string | null>(null),
    [moveWarning, setMoveWarning] = useState<string | null>(null);
  // Pasting a URL is the whole add flow; the drafts below stay editable for names and folders.
  const addPasted = () => {
    const existing: LibraryResource[] = resources.map((draft) => ({
      id: draft.id,
      kind: draft.kind,
      title: draft.title,
      url: draft.kind === "link" ? draft.url : null,
      remoteUrl: draft.kind === "link" ? null : draft.url,
      relativePath: draft.relativePath,
      defaultBranch: null,
    }));
    const parsed = libraryResourceFromInput(pasted, existing);
    if (!parsed) {
      setPasteProblem("Paste a full web address, like github.com/owner/repo.");
      return;
    }
    const url = (parsed.kind === "link" ? parsed.url : parsed.remoteUrl) ?? "";
    if (resources.some((draft) => draft.url === url)) {
      setPasteProblem("That's already in this project.");
      return;
    }
    // The warning is shown once before adding, so moving a held repository is a deliberate choice.
    const warning = libraryRootMoveWarning(existing, parsed, copies.data ?? [], hostLabel);
    if (warning && warning !== moveWarning) {
      setMoveWarning(warning);
      return;
    }
    setMoveWarning(null);
    const id = uuidv4();
    // A repository at the project root moves into its own folder once a second one joins it.
    const folders = new Map(
      libraryAddResource(existing, { ...parsed, id }).map((entry) => [
        entry.id,
        entry.relativePath,
      ]),
    );
    setResources((current) => [
      ...current.map((draft) => ({
        ...draft,
        relativePath: folders.get(draft.id) ?? draft.relativePath,
      })),
      {
        id,
        kind: parsed.kind === "link" ? "link" : "repository",
        title: parsed.title,
        url,
        relativePath: folders.get(id) ?? parsed.relativePath,
        defaultBranch: "",
      },
    ]);
    // A name is required to create, so an unnamed project takes its first repository's.
    if (!title.trim() && parsed.kind !== "link") setTitle(parsed.title);
    setPasted("");
  };
  const patch = (id: string, value: Partial<ResourceDraft>) =>
    setResources((current) =>
      current.map((resource) => (resource.id === id ? { ...resource, ...value } : resource)),
    );
  async function save() {
    if (
      busy.current ||
      inspectingFolder ||
      !authority.environmentId ||
      !authority.ready ||
      !canSave ||
      !title.trim() ||
      (submitted === null && folderTarget !== null && !folderTarget.canCreate)
    )
      return;
    let parsed: LibraryResource[];
    try {
      parsed = resources.map((resource) =>
        resource.kind === "repository"
          ? libraryResourceDraft({
              id: resource.id,
              title: resource.title,
              remoteUrl: resource.url,
              relativePath: resource.relativePath,
              defaultBranch: resource.defaultBranch,
            })
          : {
              id: resource.id,
              title: resource.title.trim(),
              kind: "link",
              url: resource.url.trim(),
              remoteUrl: null,
              relativePath: "",
              defaultBranch: null,
            },
      );
      const invalid = validateResources(parsed);
      if (invalid) throw new Error(invalid);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review the project resources.");
      return;
    }
    // Undefined keeps the saved setup, so a hidden or untouched section never changes it.
    const profileChange = editsProfile
      ? libraryProfileChange(profile, initial?.profile)
      : undefined;
    const profileProblem = profileChange
      ? libraryProfileProblem(profileChange, initial?.profile)
      : null;
    if (profileProblem) {
      setError(profileProblem);
      return;
    }
    const target = EnvironmentId.make(authority.environmentId);
    const attempt: SubmittedLibraryProjectRequest = submitted ?? {
      authorityId: target,
      environmentId: target,
      ...(identity ? { initiator: identity } : {}),
      request: initial
        ? {
            kind: "update",
            input: {
              requestId: uuidv4(),
              projectId: initial.id,
              expectedRevision: initial.revision,
              title: title.trim(),
              brief,
              resources: parsed,
              ...((initial.color ?? null) !== color ? { color } : {}),
              ...(profileChange === undefined ? {} : { profile: profileChange }),
              ...(editsDependencies &&
              JSON.stringify(dependencies) !== JSON.stringify(initial.dependencies ?? [])
                ? { dependencies }
                : {}),
            },
          }
        : {
            kind: "create",
            input: {
              requestId: uuidv4(),
              title: title.trim(),
              brief,
              resources: parsed,
              ...(color ? { color } : {}),
              ...(importedBlueprint ? { profile } : {}),
            },
          },
      state: "ready",
      result: null,
      prepareFiles:
        !initial && !existingFolder && parsed.some((resource) => resource.kind !== "link"),
      ...(existingFolder
        ? {
            folder: {
              environmentId: existingFolder.environmentId,
              rootPath: existingFolder.rootPath,
            },
          }
        : {}),
    };
    busy.current = true;
    setPending(true);
    setError(null);
    setAccessRepair(undefined);
    try {
      const complete = await runSubmittedLibraryProjectRequest(attempt, target, {
        persist: saveAttempt,
        identity,
        lookup: async ({ environmentId, requestId, kind }) => {
          const result = await lookup({ environmentId, input: { requestId, kind } });
          if (AsyncResult.isFailure(result)) throw squashLibraryCommandFailure(result);
          return result.value;
        },
        execute: async (submitted) => {
          if (submitted.request.kind === "prepare")
            throw new Error("Review the saved project request.");
          const result =
            submitted.request.kind === "update"
              ? await update({
                  environmentId: submitted.environmentId,
                  input: submitted.request.input,
                })
              : await create({
                  environmentId: submitted.environmentId,
                  input: submitted.request.input,
                });
          if (AsyncResult.isFailure(result)) throw squashLibraryCommandFailure(result);
          return result.value;
        },
      });
      if (complete.state !== "succeeded" || !complete.result || !("title" in complete.result))
        return;
      const project = complete.result;
      if (existingFolder && !initial) rememberLibraryFolderProject(target, existingFolder, project);
      refreshLibraryProject(target, project.id);
      const currentIdentity = readEnvironmentSessionState(target)?.identity;
      if (
        !navigation.isFocused() ||
        (complete.initiator &&
          (complete.initiator.issuer !== currentIdentity?.issuer ||
            complete.initiator.subject !== currentIdentity?.subject))
      )
        return;
      await saveAttempt(null);
      if (complete.folder && !initial) {
        navigation.dispatch(
          StackActions.replace("LibraryStart", {
            projectId: project.id,
            reuseEnvironmentId: complete.folder.environmentId,
            reuseRootPath: complete.folder.rootPath,
            startNow: attempt.state !== "unknown",
          }),
        );
      } else if (complete.prepareFiles) {
        navigation.dispatch(
          StackActions.replace("LibraryPrepare", {
            projectId: project.id,
            authorityEnvironmentId: target,
          }),
        );
      } else {
        navigation.dispatch(StackActions.replace("LibraryProject", { projectId: project.id }));
      }
    } catch (cause) {
      setAccessRepair(isLibraryError(cause) ? cause.accessRepair : undefined);
      setError(cause instanceof Error ? cause.message : "The project could not be saved.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  // A folder joins its project when its first conversation starts there, so adding it starts that
  // conversation unless the start screen finds something to decide first.
  const addFolderTo = (project: LibraryProject, copyId: string | null) => {
    if (!existingFolder) return;
    navigation.dispatch(
      StackActions.replace("LibraryStart", {
        projectId: project.id,
        reuseEnvironmentId: existingFolder.environmentId,
        ...(copyId ? { initialCopyId: copyId } : { reuseRootPath: existingFolder.rootPath }),
        startNow: true,
      }),
    );
  };
  const folderOutcome =
    existingFolder && folderRequest && !inspectingFolder
      ? libraryFolderActionOutcome({
          ...folderRequest,
          registrations: existingFolder.registrations,
          projects: catalogSettled && catalog.error === null ? catalog.data : null,
          loading: catalog.isPending,
          created: folderProject,
        })
      : null;
  const finishFolderAction = useEffectEvent((outcome: NonNullable<typeof folderOutcome>) => {
    if (outcome.kind === "add") addFolderTo(outcome.project, outcome.copyId);
    else if (outcome.kind === "create") void save();
  });
  // Runs after the chosen folder's state has rendered, so Create saves the resources it filled in.
  // Each tap is decided once, so a later catalog refresh never acts on it again.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- acts on the chosen folder's outcome once its catalog state has rendered, once per request
  useEffect(() => {
    if (!authority.ready) {
      decidedFolderRequest.current = folderRequest;
      return;
    }
    if (!folderOutcome || folderOutcome.kind === "wait") return;
    if (decidedFolderRequest.current === folderRequest) return;
    decidedFolderRequest.current = folderRequest;
    finishFolderAction(folderOutcome);
  }, [folderOutcome, folderRequest, authority.ready]);
  const repositorySections = (
    <>
      {resources.map((resource) => (
        <SettingsSection
          key={resource.id}
          title={resource.kind === "repository" ? "Repository" : "Reference link"}
        >
          <View className="gap-4 p-5">
            <Text textRole="body" className="font-t3-medium">
              Name
            </Text>
            <TextInput
              accessibilityLabel="Resource name"
              placeholder={resource.kind === "repository" ? "iOS" : "Onboarding design"}
              value={resource.title}
              onChangeText={(value) => patch(resource.id, { title: value })}
              maxLength={160}
              editable={!pending && !awaitingResult}
            />
            <Text textRole="body" className="font-t3-medium">
              {resource.kind === "repository" ? "Repository URL" : "Reference URL"}
            </Text>
            <TextInput
              accessibilityLabel={
                resource.kind === "repository" ? "Repository URL" : "Reference URL"
              }
              placeholder={
                resource.kind === "repository" ? "https://github.com/team/ios" : "https://…"
              }
              value={resource.url}
              onChangeText={(value) => patch(resource.id, { url: value })}
              maxLength={2048}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending && !awaitingResult}
            />
            {resource.kind === "repository" ? (
              <>
                <Text textRole="body" className="font-t3-medium">
                  Folder inside project
                </Text>
                <TextInput
                  accessibilityLabel="Component folder inside project"
                  placeholder="ios"
                  value={resource.relativePath}
                  onChangeText={(value) => patch(resource.id, { relativePath: value })}
                  maxLength={512}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!pending && !awaitingResult}
                />
                <Text textRole="body" className="font-t3-medium text-foreground">
                  Branch override (optional)
                </Text>
                <TextInput
                  accessibilityLabel="Branch override, optional"
                  placeholder="Follow repository default"
                  value={resource.defaultBranch}
                  onChangeText={(value) => patch(resource.id, { defaultBranch: value })}
                  autoCapitalize="none"
                  editable={!pending && !awaitingResult}
                />
                <Text textRole="footnote" className="text-foreground-muted">
                  Leave empty to follow the repository default. Existing working copies keep their
                  branches.
                </Text>
              </>
            ) : null}
            <Button
              label={
                resource.kind === "repository"
                  ? "Remove repository from project"
                  : "Remove link from project"
              }
              tone="text"
              disabled={pending || awaitingResult}
              onPress={() =>
                setResources((current) => current.filter((entry) => entry.id !== resource.id))
              }
            />
          </View>
        </SettingsSection>
      ))}
      {resources.length < 64 ? (
        <SettingsSection title="Add a repository or link">
          <View className="gap-4 p-5">
            <TextInput
              accessibilityLabel="Repository or link URL"
              placeholder="Paste a GitHub URL or any link"
              value={pasted}
              onChangeText={(value) => {
                setPasted(value);
                setPasteProblem(null);
                setMoveWarning(null);
              }}
              onSubmitEditing={addPasted}
              returnKeyType="done"
              autoFocus={lead === "repository"}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!pending && !awaitingResult}
            />
            {pasteProblem ? (
              <Text className="text-sm text-danger-foreground">{pasteProblem}</Text>
            ) : moveWarning ? (
              <Text className="text-sm text-warning-foreground">{moveWarning}</Text>
            ) : null}
            <Button
              label={moveWarning ? "Add anyway" : "Add"}
              disabled={pending || awaitingResult || !pasted.trim()}
              onPress={addPasted}
            />
          </View>
        </SettingsSection>
      ) : null}
    </>
  );
  const folderSection = !initial ? (
    <LibraryExistingFolder
      initialRootPath={intent.kind === "folder" ? intent.path : undefined}
      initiallyExpanded={lead === "folder"}
      disabled={pending || awaitingResult || !authority.ready || !canSave}
      folder={existingFolder}
      offeredProjectId={offeredProject?.id ?? null}
      projectTitle={typedTitle}
      onPending={setInspectingFolder}
      onClear={() => {
        setExistingFolder(null);
        setFolderProject(null);
        setFolderRequest(null);
      }}
      onChoose={(folder, request) => {
        const previousIds = folderDraftIds.current;
        const drafts: ResourceDraft[] = folder.resources.map((entry) => ({
          id: uuidv4(),
          title: entry.title,
          kind: "repository",
          url: entry.remoteUrl ?? "",
          relativePath: entry.relativePath,
          defaultBranch: "",
        }));
        folderDraftIds.current = new Set(drafts.map((draft) => draft.id));
        setTitle((current) =>
          !current.trim() || current === existingFolder?.title ? folder.title : current,
        );
        setExistingFolder(folder);
        setFolderProject(rememberedLibraryFolderProject(authority.environmentId, folder));
        setFolderRequest(request.action ? request : null);
        setResources((current) => {
          const retained = current
            .filter((entry) => !previousIds.has(entry.id))
            .map((entry) => {
              const detected = drafts.find(
                (draft) =>
                  entry.kind === "repository" &&
                  entry.url &&
                  normalizeGitRemoteUrl(entry.url) === normalizeGitRemoteUrl(draft.url),
              );
              return detected ? { ...entry, relativePath: detected.relativePath } : entry;
            });
          const known = new Set(
            retained
              .filter((entry) => entry.kind === "repository")
              .map((entry) =>
                entry.url ? normalizeGitRemoteUrl(entry.url) : `local:${entry.relativePath}`,
              ),
          );
          return [
            ...retained,
            ...drafts.filter(
              (draft) =>
                !known.has(
                  draft.url ? normalizeGitRemoteUrl(draft.url) : `local:${draft.relativePath}`,
                ),
            ),
          ];
        });
      }}
    >
      {savingFromFolder && pending ? <LibraryNotice detail="Creating project…" /> : null}
      {savingFromFolder && error ? (
        <LibraryNotice accessRepair={accessRepair} error={error} />
      ) : null}
      {folderTarget && (folderTarget.error || folderTarget.detail) ? (
        <LibraryNotice
          error={folderTarget.error}
          detail={folderTarget.detail}
          onRetry={catalog.error ? catalog.refresh : undefined}
        />
      ) : null}
      {existingFolder && offeredProject ? (
        <Button
          label={`Add folder to ${offeredProject.title}`}
          tone="primary"
          disabled={pending || awaitingResult || inspectingFolder || !authority.ready || !canSave}
          onPress={() => addFolderTo(offeredProject, folderTarget?.copyId ?? null)}
        />
      ) : null}
    </LibraryExistingFolder>
  ) : null;
  return (
    <LibraryPage title={initial ? "Edit project" : "New project"} back>
      {awaitingResult && !pending ? (
        <LibraryNotice detail="The submitted request is saved with its Library and inputs. Check an uncertain result before retrying. Signing in does not submit it." />
      ) : null}
      {/* The folder list explains itself, so a folder start leads with it alone. */}
      {lead !== "folder" ? (
        <Text className="text-sm text-foreground-muted">
          {initial
            ? "Update the brief, repositories and links together. Your conversations stay saved."
            : lead === "repository"
              ? "Create the Library project, then choose a computer and destination to prepare its files. Start a conversation separately."
              : "Start with a name. Add a brief, repositories or links now or later. Files are prepared when you start work."}
        </Text>
      ) : null}
      {lead === "repository" ? repositorySections : null}
      {lead === "folder" ? folderSection : null}
      {!initial && !lead && supportsBlueprint ? (
        <SettingsSection title="Start from a blueprint">
          <View className="gap-4 p-5">
            <Button
              label="Import blueprint"
              tone="text"
              disabled={pending || awaitingResult}
              onPress={() => setBlueprintText("")}
            />
            {blueprintText !== null ? (
              <>
                <TextInput
                  accessibilityLabel="Blueprint JSON"
                  value={blueprintText}
                  onChangeText={setBlueprintText}
                  multiline
                  maxLength={131072}
                  editable={!pending && !awaitingResult}
                  className="min-h-32"
                />
                <Text className="text-sm text-foreground-muted">
                  {blueprint
                    ? `${blueprint.title}: ${blueprint.resources.length} repositories and links, ${blueprint.connections.length} named connections.`
                    : "Paste a version 1 Loom blueprint. Computer preferences and credentials are refused."}
                </Text>
                {blueprint ? (
                  <View className="gap-2">
                    {blueprint.resources.map((resource) => (
                      <Text key={resource.id} className="text-xs text-foreground-muted">
                        {resource.title}:{" "}
                        {resource.kind === "link"
                          ? resource.url
                          : `${resource.relativePath} · ${resource.remoteUrl ?? "Local files"} · ${resource.defaultBranch ?? "Remote default branch"}`}
                      </Text>
                    ))}
                    <Text className="text-xs text-foreground-muted">
                      Required tools:{" "}
                      {blueprint.setup?.requiredTools
                        ?.map(
                          (tool) =>
                            `${tool.id}${tool.minimumVersion ? ` ${tool.minimumVersion}+` : ""}`,
                        )
                        .join(", ") || "none"}
                    </Text>
                    <Text className="text-xs text-foreground-muted">
                      Named connections: {blueprint.connections.join(", ") || "none"}. Secret names:{" "}
                      {blueprint.setup?.secretNames?.join(", ") || "none"}. Importing does not
                      verify availability.
                    </Text>
                  </View>
                ) : null}
                {blueprint?.setup?.scripts?.map((script) => (
                  <Text key={script.id} className="text-sm text-foreground-muted">
                    {script.name}: {script.command}
                  </Text>
                ))}
                <Text className="text-sm text-foreground-muted">
                  Review scripts before importing. Importing does not run them or prepare files.
                </Text>
                <Button
                  label="Use reviewed blueprint"
                  disabled={!blueprint || pending || awaitingResult}
                  onPress={() => {
                    if (!blueprint) return;
                    setTitle(blueprint.title);
                    setBrief(blueprint.brief);
                    setColor(blueprint.color ?? null);
                    setResources(
                      blueprint.resources.map((resource) => ({
                        id: resource.id,
                        kind: resource.kind === "link" ? "link" : "repository",
                        title: resource.title,
                        url: (resource.kind === "link" ? resource.url : resource.remoteUrl) ?? "",
                        relativePath: resource.relativePath,
                        defaultBranch: resource.defaultBranch ?? "",
                      })),
                    );
                    setProfile({ ...blueprint.setup, connectionNames: blueprint.connections });
                    setImportedBlueprint(true);
                    setBlueprintText(null);
                  }}
                />
                <Button
                  label="Cancel import"
                  tone="text"
                  disabled={pending || awaitingResult}
                  onPress={() => setBlueprintText(null)}
                />
              </>
            ) : null}
          </View>
        </SettingsSection>
      ) : null}
      <SettingsSection title="Project details">
        <View className="gap-4 p-5">
          <Text textRole="body" className="font-t3-medium">
            Name
          </Text>
          <TextInput
            accessibilityLabel="Project name"
            placeholder="Project name"
            value={title}
            onChangeText={setTitle}
            maxLength={160}
            editable={!pending && !awaitingResult}
          />
          <Text textRole="body" className="font-t3-medium">
            Shared brief
          </Text>
          <TextInput
            accessibilityLabel="Shared project brief"
            placeholder="What are we building?"
            value={brief}
            onChangeText={setBrief}
            multiline
            textAlignVertical="top"
            maxLength={65536}
            editable={!pending && !awaitingResult}
            className="min-h-32"
          />
        </View>
      </SettingsSection>
      <SettingsSection title="Project color">
        <LibraryColorPicker
          value={color}
          onChange={setColor}
          disabled={pending || awaitingResult}
        />
      </SettingsSection>
      {lead !== "repository" ? repositorySections : null}
      {lead !== "folder" ? folderSection : null}
      {initial && editsDependencies ? (
        <SettingsSection
          title="Depends on"
          footer="Declare other Library projects this one uses. Each project keeps its repositories and releases."
        >
          {(dependencyCatalog.data ?? [])
            .filter((entry) => entry.id !== initial.id)
            .map((entry) => (
              <SettingsSwitchRow
                key={entry.id}
                label={entry.title}
                subtitle={entry.archived ? "Archived project" : undefined}
                value={dependencies.includes(entry.id)}
                disabled={
                  pending || awaitingResult || (entry.archived && !dependencies.includes(entry.id))
                }
                onValueChange={(selected) =>
                  setDependencies((ids) =>
                    selected ? [...ids, entry.id] : ids.filter((id) => id !== entry.id),
                  )
                }
              />
            ))}
          {!dependencyCatalog.data ? (
            <LibraryNotice
              detail={dependencyCatalog.error ?? "Loading projects..."}
              onRetry={dependencyCatalog.refresh}
            />
          ) : null}
        </SettingsSection>
      ) : null}
      {editsProfile ? (
        <View className="gap-2">
          <Button
            label={showSetup ? "Hide optional setup" : "Optional setup"}
            tone="text"
            disabled={pending || awaitingResult}
            onPress={() => setShowSetup((value) => !value)}
          />
          <Text textRole="footnote" className="text-foreground-muted">
            Save defaults, tools and scripts when they are useful. They are not required to start
            work.
          </Text>
        </View>
      ) : null}
      {initial && showSetup ? <LibraryPreparationPlans project={initial} /> : null}
      {editsProfile && showSetup ? (
        <LibraryProfileSection
          draft={profile}
          onChange={(change) => {
            setError(null);
            setProfile((current) => ({ ...current, ...change }));
          }}
          copies={libraryActiveCopies(copies.data ?? [])}
          computers={authority.computers}
          hostLabel={hostLabel}
          disabled={pending || awaitingResult}
        />
      ) : null}
      {editsProfile && showSetup ? (
        <LibraryBriefSuggestionsSetting
          authorityId={authority.environmentId}
          mode={profile.briefSuggestions}
          onChange={(briefSuggestions) => {
            setError(null);
            setProfile((current) => ({ ...current, briefSuggestions }));
          }}
          disabled={pending || awaitingResult}
        />
      ) : null}
      {submitted && submitted.authorityId !== authority.environmentId ? (
        <LibraryNotice error="Reconnect the Library used for this saved request before continuing." />
      ) : null}
      {!authority.environmentId ? (
        <Button
          label="Connect your Library"
          onPress={() => navigation.navigate("LibrarySettings")}
        />
      ) : !authority.ready ? (
        <LibraryNotice detail="Reconnect your Library to save this project." />
      ) : !canSave ? (
        <LibraryNotice detail="Project settings access is required to save this project." />
      ) : null}
      {!accountMatches ? (
        <LibraryNotice error="Sign in with the account that started this request before continuing." />
      ) : null}
      {error && !savingFromFolder ? (
        <LibraryNotice accessRepair={accessRepair} error={error} />
      ) : null}
      {submitted?.state === "ready" ? (
        <Button
          label="Edit saved request"
          tone="text"
          disabled={pending}
          onPress={() => {
            void saveAttempt(null).catch((cause: unknown) =>
              setError(
                cause instanceof Error ? cause.message : "The request could not be cleared.",
              ),
            );
          }}
        />
      ) : null}
      <Button
        label={
          pending
            ? "Saving…"
            : submitted?.state === "unknown"
              ? "Check save result"
              : submitted
                ? "Retry save"
                : initial
                  ? "Save project"
                  : "Create project"
        }
        tone="primary"
        disabled={
          pending ||
          inspectingFolder ||
          !accountMatches ||
          !authority.ready ||
          (submitted !== null && submitted.authorityId !== authority.environmentId) ||
          !canSave ||
          !title.trim() ||
          (submitted === null && folderTarget !== null && !folderTarget.canCreate)
        }
        onPress={() => {
          setFolderRequest(null);
          void save();
        }}
      />
    </LibraryPage>
  );
}

function LibraryColorPicker(props: {
  value: LibraryProjectColor | null;
  onChange: (color: LibraryProjectColor | null) => void;
  disabled: boolean;
}) {
  const colorValue = useLibraryProjectColorValue();
  return (
    <View accessibilityRole="radiogroup" className="flex-row flex-wrap items-center gap-2 p-5">
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel="Automatic color"
        accessibilityState={{ checked: props.value === null, disabled: props.disabled }}
        disabled={props.disabled}
        onPress={() => props.onChange(null)}
        className={cn(
          "min-h-11 justify-center rounded-full border-2 px-4 active:opacity-70",
          props.value === null ? "border-foreground" : "border-border",
        )}
      >
        <Text textRole="body" className="text-foreground">
          Automatic
        </Text>
      </Pressable>
      {LIBRARY_PROJECT_COLORS.map((option) => {
        const value = colorValue(option);
        const selected = props.value === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={PROJECT_COLOR_NAMES[option]}
            accessibilityState={{ checked: selected, disabled: props.disabled }}
            disabled={props.disabled}
            onPress={() => props.onChange(option)}
            className="size-11 items-center justify-center rounded-full border-2 active:opacity-70"
            style={{ borderColor: selected ? value : "transparent" }}
          >
            <View className="size-6 rounded-full" style={{ backgroundColor: value }} />
          </Pressable>
        );
      })}
    </View>
  );
}
