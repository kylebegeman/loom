import { useAtomValue } from "@effect/atom-react";
import {
  libraryFolderRegistrations,
  libraryStartFolderProjects,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryFolderInspection,
  LibraryFolderRegistration,
  LibraryProject,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLibraryAuthority } from "./libraryState";
import { libraryFolderResources, libraryProjectsForFolder } from "./libraryFolder";
import {
  libraryFolderRowAction,
  rememberedLibraryFolderProject,
  type LibraryFolderAction,
} from "./libraryExistingFolderTarget";

export type ExistingLibraryFolder = ReturnType<typeof libraryFolderResources> & {
  environmentId: EnvironmentId;
  registrations: readonly LibraryFolderRegistration[];
};

/** What the tapped row said it would do, and the projects already using the folder's files. */
export type ExistingLibraryFolderRequest = {
  readonly action: LibraryFolderAction | null;
  readonly matches: readonly LibraryProject[];
};

const actionLabel = (action: LibraryFolderAction) =>
  action.kind === "add" ? `Add to ${action.project.title}` : `Create project ${action.title}`;

export function LibraryExistingFolder(props: {
  initialRootPath?: string | undefined;
  initiallyExpanded?: boolean;
  disabled: boolean;
  folder: ExistingLibraryFolder | null;
  /** A project the form offers to add the folder to, so it is not suggested twice. */
  offeredProjectId: string | null;
  /** A name typed before choosing a folder, which a new project keeps. */
  projectTitle: string | null;
  /** The chosen folder's status and actions, shown with it. */
  children?: ReactNode;
  onClear: () => void;
  onPending: (pending: boolean) => void;
  onChoose: (folder: ExistingLibraryFolder, request: ExistingLibraryFolderRequest) => void;
}) {
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const [expanded, setExpanded] = useState(!!props.initialRootPath || !!props.initiallyExpanded),
    [search, setSearch] = useState(props.initialRootPath ?? "");
  // The folder "Add to another project" picks a project for, shown in place of the folder list.
  const [choosing, setChoosing] = useState<{
    environmentId: EnvironmentId;
    rootPath: string;
    label: string;
    excludedId: string | null;
  } | null>(null);
  const [inspection, setInspection] = useState<LibraryFolderInspection | null>(null),
    [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const inspect = useAtomCommand(library.inspectFolder, { reportFailure: false });
  const catalog = useEnvironmentQuery(
    expanded && authority.environmentId
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: true },
        })
      : null,
  );
  const copies = useEnvironmentQuery(
    expanded && authority.environmentId
      ? library.copies({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const [inspectionEnvironmentId, setInspectionEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  // The catalog includes archived projects, which cannot take a folder.
  const active = (catalog.data ?? []).filter((project) => !project.archived);
  const folderMatches = (found: LibraryFolderInspection, environmentId: EnvironmentId) => {
    const exact = libraryStartFolderProjects(
      catalog.data ?? [],
      copies.data ?? [],
      environmentId,
      found.rootPath,
    );
    return (exact.length ? exact : libraryProjectsForFolder(found, catalog.data ?? [])).filter(
      (project) => !project.archived,
    );
  };
  const suggestions =
    inspection && inspectionEnvironmentId
      ? folderMatches(inspection, inspectionEnvironmentId).filter(
          (project) => project.id !== props.offeredProjectId,
        )
      : [];
  // A row names its action only from an answer the Library gave; until then it just picks a folder.
  const rowAction = (environmentId: EnvironmentId, rootPath: string) =>
    libraryFolderRowAction({
      registered:
        catalog.data && copies.data && catalog.error === null && copies.error === null
          ? libraryStartFolderProjects(catalog.data, copies.data, environmentId, rootPath)
          : null,
      created: rememberedLibraryFolderProject(authority.environmentId, { environmentId, rootPath }),
      rootPath,
      title: props.projectTitle,
    });
  const path = search.trim();
  const known = projects.filter(
    (project, index) =>
      !project.isScratch &&
      projects.findIndex(
        (entry) =>
          entry.environmentId === project.environmentId &&
          entry.workspaceRoot === project.workspaceRoot,
      ) === index &&
      `${project.title} ${project.workspaceRoot}`
        .toLocaleLowerCase()
        .includes(path.toLocaleLowerCase()),
  );
  async function choose(
    environmentId: EnvironmentId,
    rootPath: string,
    action: LibraryFolderAction | null,
  ) {
    if (busy.current || props.disabled) return;
    busy.current = true;
    setPending(`${environmentId}:${rootPath}`);
    props.onPending(true);
    setError(null);
    await inspect({ environmentId, input: { rootPath } })
      .then((result) => {
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        const inferred = libraryFolderResources(result.value);
        // Projects already listed beside this folder have been seen, so tapping it again goes ahead.
        const shown =
          props.folder !== null &&
          inspectionEnvironmentId === environmentId &&
          inspection?.rootPath === result.value.rootPath;
        setInspection(result.value);
        setInspectionEnvironmentId(environmentId);
        setChoosing(null);
        props.onChoose(
          {
            ...inferred,
            environmentId,
            registrations: libraryFolderRegistrations(result.value),
          },
          { action, matches: shown ? [] : folderMatches(result.value, environmentId) },
        );
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The folder could not be inspected.");
      })
      .finally(() => {
        busy.current = false;
        setPending(null);
        props.onPending(false);
      });
  }
  const rowsDisabled = props.disabled || pending !== null;
  return (
    <SettingsSection title="Files you already have">
      <View className="gap-2 p-4">
        <Button
          label={expanded ? "Hide folders" : "Add existing folder"}
          tone="text"
          disabled={rowsDisabled}
          onPress={() => {
            setExpanded((value) => !value);
            setChoosing(null);
          }}
        />
        {expanded && choosing ? (
          <>
            <Text selectable className="text-sm text-foreground-muted">
              Choose the project for {choosing.rootPath}. Files stay on {choosing.label}.
            </Text>
            <Button
              label="Back to folders"
              tone="text"
              disabled={pending !== null}
              onPress={() => setChoosing(null)}
            />
          </>
        ) : expanded ? (
          <>
            <Text className="text-sm text-foreground-muted">
              Choose a folder on a connected computer. Loom fills in its repositories and keeps the
              files there.
            </Text>
            <TextInput
              accessibilityLabel="Find an existing folder"
              placeholder="Find a folder"
              value={search}
              onChangeText={setSearch}
              editable={!rowsDisabled}
              autoCapitalize="none"
              autoCorrect={false}
              className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
            {path.startsWith("/") || path.startsWith("~") || /^[a-z]:[\\/]/i.test(path)
              ? environments
                  .filter(
                    (host) =>
                      host.entry.enabled &&
                      host.connection.phase === "connected" &&
                      supportsLoomFeature(
                        host.serverConfig?.environment.capabilities,
                        "project-library",
                      ),
                  )
                  .map((host) => {
                    const action = rowAction(host.environmentId, path);
                    const excludedId = action?.kind === "add" ? action.project.id : null;
                    return (
                      <FolderRow
                        key={host.environmentId}
                        environmentId={host.environmentId}
                        label={action ? actionLabel(action) : `Use this folder on ${host.label}`}
                        description={
                          action?.kind === "add"
                            ? `Uses your Library project ${action.project.title}. Files stay on ${host.label}.`
                            : action
                              ? `Files stay on ${host.label}.`
                              : path
                        }
                        pending={pending === `${host.environmentId}:${path}`}
                        disabled={rowsDisabled}
                        onPress={() => void choose(host.environmentId, path, action)}
                        onChooseProject={
                          active.some((project) => project.id !== excludedId)
                            ? () =>
                                setChoosing({
                                  environmentId: host.environmentId,
                                  rootPath: path,
                                  label: host.label,
                                  excludedId,
                                })
                            : undefined
                        }
                      />
                    );
                  })
              : null}
          </>
        ) : null}
        {/* Shown while the list is hidden too, so a failed add stays in view. */}
        {!choosing && inspection && props.folder ? (
          <>
            <Text selectable className="text-xs text-foreground-muted">
              Using {inspection.rootPath}. {inspection.repositories.length}{" "}
              {inspection.repositories.length === 1 ? "repository found" : "repositories found"}.
            </Text>
            {props.children}
            <Button
              label="Prepare new files instead"
              tone="text"
              disabled={rowsDisabled}
              onPress={() => {
                setInspection(null);
                props.onClear();
              }}
            />
          </>
        ) : null}
        {expanded && !choosing
          ? suggestions.map((project) => (
              <View key={project.id} className="gap-2">
                <Text className="text-sm text-foreground-muted">
                  {project.title} already has files or matching repositories from this folder.
                </Text>
                <Button
                  label={`Add to ${project.title}`}
                  disabled={rowsDisabled}
                  onPress={() => {
                    if (inspection && inspectionEnvironmentId)
                      void choose(inspectionEnvironmentId, inspection.rootPath, {
                        kind: "add",
                        project,
                      });
                  }}
                />
              </View>
            ))
          : null}
        {expanded && (catalog.error || copies.error) ? (
          <Text className="text-xs text-danger-foreground">
            Could not check existing projects. Reopen this section to retry.
          </Text>
        ) : null}
        {expanded && error ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>
      {expanded && choosing
        ? active
            .filter((project) => project.id !== choosing.excludedId)
            .map((project) => (
              <ListRow
                key={project.id}
                label={project.title}
                description={project.brief.trim().split("\n")[0] || undefined}
                disabled={rowsDisabled}
                onPress={() =>
                  void choose(choosing.environmentId, choosing.rootPath, {
                    kind: "add",
                    project,
                  })
                }
              />
            ))
        : null}
      {expanded && !choosing
        ? known.slice(0, 12).map((project) => {
            const host = environments.find(
              (entry) => entry.environmentId === project.environmentId,
            );
            const connected = host?.entry.enabled === true && host.connection.phase === "connected";
            const supported = supportsLoomFeature(
              host?.serverConfig?.environment.capabilities,
              "project-library",
            );
            const action =
              connected && supported
                ? rowAction(project.environmentId, project.workspaceRoot)
                : null;
            return (
              <FolderRow
                key={`${project.environmentId}:${project.workspaceRoot}`}
                environmentId={project.environmentId}
                label={action ? actionLabel(action) : project.title}
                description={`${host?.label ?? "Saved computer"} · ${project.workspaceRoot}${!connected ? " · Offline" : !supported ? " · Update Loom to inspect this folder" : ""}`}
                pending={pending === `${project.environmentId}:${project.workspaceRoot}`}
                disabled={rowsDisabled || !connected || !supported}
                onPress={() => void choose(project.environmentId, project.workspaceRoot, action)}
              />
            );
          })
        : null}
      {expanded && !choosing && known.length === 0 ? (
        <Text className="px-4 pb-4 text-sm text-foreground-muted">
          {path
            ? "No matching folders."
            : "No known folders yet. Add repositories above, or connect a computer with existing projects."}
        </Text>
      ) : null}
      {expanded && !choosing && known.length > 12 ? (
        <Text className="px-4 pb-4 text-xs text-foreground-muted">
          Search to find more folders.
        </Text>
      ) : null}
    </SettingsSection>
  );
}

/** A folder row that does what it names; the optional second row offers a different project. */
function FolderRow(props: {
  environmentId: EnvironmentId;
  label: string;
  description: string;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
  onChooseProject?: (() => void) | undefined;
}) {
  const permitted = useAtomValue(library.inspectFolder.permissionAtom(props.environmentId));
  return (
    <>
      <ListRow
        label={props.label}
        description={
          props.pending
            ? "Checking this folder…"
            : permitted
              ? props.description
              : `${props.description} · File access required`
        }
        disabled={props.disabled || !permitted}
        onPress={props.onPress}
      />
      {props.onChooseProject ? (
        <View className="border-t border-border-subtle">
          <ListRow
            label="Add to another project…"
            disabled={props.disabled || !permitted}
            onPress={props.onChooseProject}
          />
        </View>
      ) : null}
    </>
  );
}
