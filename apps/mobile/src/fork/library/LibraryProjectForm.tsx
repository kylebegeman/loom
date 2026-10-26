import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  LIBRARY_PROJECT_COLORS,
  LibraryBlueprint,
  PROJECT_WORKFLOWS_FEATURE,
  LibraryError,
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
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryProfileSection } from "./LibraryProfileSection";
import { LibraryBriefSuggestionsSetting } from "./LibraryBriefSuggestions";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
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
import { useLibraryProjectColorValue } from "./libraryProjectColors";
import { LibraryNewProjectChoices, type LibraryCreateStart } from "./LibraryNewProjectChoices";
import {
  libraryActiveCopies,
  libraryAddResource,
  libraryStartIntent,
  libraryProfileChange,
  libraryProfileProblem,
  libraryResourceFromInput,
  PROJECT_COLOR_NAMES,
  validateResources,
  type LibraryProfileDraft,
} from "@t3tools/client-runtime/fork";

const blueprintCodec = Schema.fromJsonString(LibraryBlueprint);

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
function LibraryProjectForm({
  initial: seed,
  initialInput,
  start,
}: {
  initial?: LibraryProject;
  initialInput?: string | undefined;
  start?: LibraryCreateStart | undefined;
}) {
  const intent = libraryStartIntent(initialInput ?? "");
  const lead = start === "folder" || start === "repository" ? start : null;
  const [initial] = useState(seed);
  const authority = useLibraryAuthority(),
    navigation = useNavigation(),
    { environments } = useEnvironments();
  const create = useAtomCommand(library.createProject, { reportFailure: false }),
    update = useAtomCommand(library.updateProject, { reportFailure: false });
  const canSave = useAtomValue(
    (initial ? library.updateProject : library.createProject).permissionAtom(
      authority.environmentId,
    ),
  );
  const [title, setTitle] = useState(
      initial?.title ?? (intent.kind !== "search" ? intent.title : ""),
    ),
    [brief, setBrief] = useState(initial?.brief ?? "");
  // Null means automatic: the project keeps a stable color derived from its id.
  const [color, setColor] = useState<LibraryProjectColor | null>(initial?.color ?? null);
  const [resources, setResources] = useState<readonly ResourceDraft[]>(
    () =>
      initial?.resources.map((resource) => ({
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
  const [profile, setProfile] = useState<LibraryProfileDraft>(() => ({ ...initial?.profile }));
  const supportsBlueprint = useLoomFeature(authority.environmentId, PROJECT_WORKFLOWS_FEATURE);
  const [blueprintText, setBlueprintText] = useState<string | null>(null);
  const [importedBlueprint, setImportedBlueprint] = useState(false);
  const decodedBlueprint =
    blueprintText === null ? null : Schema.decodeUnknownOption(blueprintCodec)(blueprintText);
  const blueprint = decodedBlueprint?._tag === "Some" ? decodedBlueprint.value : null;
  const copies = useEnvironmentQuery(
    editsProfile && initial && authority.environmentId
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
  const [awaitingResult, setAwaitingResult] = useState(false);
  const request = useRef(uuidv4()),
    submittedAuthority = useRef<string | null>(null),
    busy = useRef(false);
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
    [pasteProblem, setPasteProblem] = useState<string | null>(null);
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
      (folderTarget !== null && !folderTarget.canCreate)
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
    if (submittedAuthority.current && submittedAuthority.current !== authority.environmentId) {
      setError("Reconnect the library used for this save before retrying it.");
      return;
    }
    submittedAuthority.current = authority.environmentId;
    busy.current = true;
    setPending(true);
    setAwaitingResult(true);
    setError(null);
    try {
      const result = initial
        ? await update({
            environmentId: authority.environmentId,
            input: {
              requestId: request.current,
              projectId: initial.id,
              expectedRevision: initial.revision,
              title: title.trim(),
              brief,
              resources: parsed,
              // Only send a color the person changed; null returns the project to automatic.
              ...((initial.color ?? null) !== color ? { color } : {}),
              ...(profileChange === undefined ? {} : { profile: profileChange }),
            },
          })
        : await create({
            environmentId: authority.environmentId,
            input: {
              requestId: request.current,
              title: title.trim(),
              brief,
              resources: parsed,
              ...(color ? { color } : {}),
              ...(importedBlueprint ? { profile } : {}),
            },
          });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      if (existingFolder && !initial)
        rememberLibraryFolderProject(authority.environmentId, existingFolder, result.value);
      refreshLibraryProject(authority.environmentId, result.value.id);
      setAwaitingResult(false);
      if (existingFolder && !initial) addFolderTo(result.value, null);
      else
        navigation.dispatch(StackActions.replace("LibraryProject", { projectId: result.value.id }));
    } catch (cause) {
      if (cause instanceof LibraryError && cause.reason !== "io") {
        setAwaitingResult(false);
        request.current = uuidv4();
        submittedAuthority.current = null;
      }
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
  useEffect(() => {
    if (!folderOutcome || folderOutcome.kind === "wait") return;
    if (decidedFolderRequest.current === folderRequest) return;
    decidedFolderRequest.current = folderRequest;
    finishFolderAction(folderOutcome);
  }, [folderOutcome, folderRequest]);
  const repositorySections = (
    <>
      {resources.map((resource) => (
        <SettingsSection
          key={resource.id}
          title={resource.kind === "repository" ? "Repository" : "Reference link"}
        >
          <View className="gap-3 p-4">
            <TextInput
              accessibilityLabel="Resource name"
              placeholder={resource.kind === "repository" ? "iOS" : "Onboarding design"}
              value={resource.title}
              onChangeText={(value) => patch(resource.id, { title: value })}
              maxLength={160}
              editable={!pending && !awaitingResult}
              className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
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
              className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
            {resource.kind === "repository" ? (
              <>
                <TextInput
                  accessibilityLabel="Component folder inside project"
                  placeholder="ios"
                  value={resource.relativePath}
                  onChangeText={(value) => patch(resource.id, { relativePath: value })}
                  maxLength={512}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!pending && !awaitingResult}
                  className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
                />
                <TextInput
                  accessibilityLabel="Default branch, optional"
                  placeholder="Default branch (optional)"
                  value={resource.defaultBranch}
                  onChangeText={(value) => patch(resource.id, { defaultBranch: value })}
                  autoCapitalize="none"
                  editable={!pending && !awaitingResult}
                  className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
                />
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
          <View className="gap-2 p-4">
            <TextInput
              accessibilityLabel="Repository or link URL"
              placeholder="Paste a GitHub URL or any link"
              value={pasted}
              onChangeText={(value) => {
                setPasted(value);
                setPasteProblem(null);
              }}
              onSubmitEditing={addPasted}
              returnKeyType="done"
              autoFocus={lead === "repository"}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!pending && !awaitingResult}
              className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
            {pasteProblem ? (
              <Text className="text-sm text-danger-foreground">{pasteProblem}</Text>
            ) : null}
            <Button
              label="Add"
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
      {savingFromFolder && error ? <LibraryNotice error={error} /> : null}
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
          disabled={pending || awaitingResult || inspectingFolder}
          onPress={() => addFolderTo(offeredProject, folderTarget?.copyId ?? null)}
        />
      ) : null}
    </LibraryExistingFolder>
  ) : null;
  return (
    <LibraryPage title={initial ? "Edit project" : "New project"} back>
      {awaitingResult && !pending ? (
        <LibraryNotice detail="The save result is not yet confirmed. Retry the same save before making further edits." />
      ) : null}
      {/* The folder list explains itself, so a folder start leads with it alone. */}
      {lead !== "folder" ? (
        <Text className="text-sm text-foreground-muted">
          {initial
            ? "Update the brief, repositories and links together. Your conversations stay saved."
            : lead === "repository"
              ? "Paste a Git URL. Loom clones it onto a computer when you start work."
              : "Start with a name. Add a brief, repositories or links now or later. Files are prepared when you start work."}
        </Text>
      ) : null}
      {lead === "repository" ? repositorySections : null}
      {lead === "folder" ? folderSection : null}
      {!initial && !lead && supportsBlueprint ? (
        <SettingsSection title="Start from a blueprint">
          <View className="gap-3 p-4">
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
                  className="min-h-28 rounded-xl border border-input-border bg-input p-3 text-sm text-foreground"
                />
                <Text className="text-sm text-foreground-muted">
                  {blueprint
                    ? `${blueprint.title}: ${blueprint.resources.length} repositories and links, ${blueprint.connections.length} named connections.`
                    : "Paste a version 1 Loom blueprint. Computer preferences and credentials are refused."}
                </Text>
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
      <SettingsSection title="Project">
        <View className="gap-3 p-4">
          <TextInput
            accessibilityLabel="Project name"
            placeholder="AspectAvy"
            value={title}
            onChangeText={setTitle}
            maxLength={160}
            editable={!pending && !awaitingResult}
            className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-base text-foreground"
          />
          <TextInput
            accessibilityLabel="Shared project brief"
            placeholder="What are we building?"
            value={brief}
            onChangeText={setBrief}
            multiline
            textAlignVertical="top"
            maxLength={65536}
            editable={!pending && !awaitingResult}
            className="min-h-28 rounded-xl border border-input-border bg-input p-3 text-sm text-foreground"
          />
        </View>
      </SettingsSection>
      <SettingsSection title="Color">
        <LibraryColorPicker
          value={color}
          onChange={setColor}
          disabled={pending || awaitingResult}
        />
      </SettingsSection>
      {lead !== "repository" ? repositorySections : null}
      {lead !== "folder" ? folderSection : null}
      {editsProfile ? (
        <View className="gap-2">
          <Button
            label={showSetup ? "Hide optional setup" : "Optional setup"}
            tone="text"
            disabled={pending || awaitingResult}
            onPress={() => setShowSetup((value) => !value)}
          />
          <Text className="text-xs text-foreground-muted">
            Save defaults, tools and scripts when they are useful. They are not required to start
            work.
          </Text>
        </View>
      ) : null}
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
      {error && !savingFromFolder ? <LibraryNotice error={error} /> : null}
      <Button
        label={pending ? "Saving…" : initial ? "Save project" : "Create project"}
        tone="primary"
        disabled={
          pending ||
          inspectingFolder ||
          !authority.ready ||
          !canSave ||
          !title.trim() ||
          (folderTarget !== null && !folderTarget.canCreate)
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
    <View accessibilityRole="radiogroup" className="flex-row flex-wrap items-center gap-2 p-4">
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel="Automatic color"
        accessibilityState={{ checked: props.value === null, disabled: props.disabled }}
        disabled={props.disabled}
        onPress={() => props.onChange(null)}
        className={cn(
          "h-9 justify-center rounded-full border-2 px-3 active:opacity-70",
          props.value === null ? "border-foreground" : "border-border",
        )}
      >
        <Text className="text-sm text-foreground">Automatic</Text>
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
            className="size-9 items-center justify-center rounded-full border-2 active:opacity-70"
            style={{ borderColor: selected ? value : "transparent" }}
          >
            <View className="size-6 rounded-full" style={{ backgroundColor: value }} />
          </Pressable>
        );
      })}
    </View>
  );
}
