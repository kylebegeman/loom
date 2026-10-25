import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { libraryStartFolderProjects, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryFolderInspection } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLibraryAuthority } from "./libraryState";
import { libraryFolderResources, libraryProjectsForFolder } from "./libraryFolder";

export type ExistingLibraryFolder = ReturnType<typeof libraryFolderResources> & {
  environmentId: EnvironmentId;
  registration: LibraryFolderInspection["registration"];
};

export function LibraryExistingFolder(props: {
  initialRootPath?: string | undefined;
  disabled: boolean;
  folder: ExistingLibraryFolder | null;
  /** A project the form offers to add the folder to, so it is not suggested twice. */
  offeredProjectId: string | null;
  onClear: () => void;
  onPending: (pending: boolean) => void;
  onChoose: (folder: ExistingLibraryFolder) => void;
}) {
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const [expanded, setExpanded] = useState(!!props.initialRootPath),
    [search, setSearch] = useState(props.initialRootPath ?? "");
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
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
  const exact =
    inspection && inspectionEnvironmentId
      ? libraryStartFolderProjects(
          catalog.data ?? [],
          copies.data ?? [],
          inspectionEnvironmentId,
          inspection.rootPath,
        )
      : [];
  // The catalog includes archived projects, which cannot take a folder, so they are not suggested.
  const suggestions = (
    exact.length
      ? exact
      : inspection
        ? libraryProjectsForFolder(inspection, catalog.data ?? [])
        : []
  ).filter((project) => !project.archived && project.id !== props.offeredProjectId);
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
        .includes(search.trim().toLocaleLowerCase()),
  );
  async function choose(environmentId: EnvironmentId, rootPath: string) {
    if (busy.current || props.disabled) return;
    busy.current = true;
    setPending(`${environmentId}:${rootPath}`);
    props.onPending(true);
    setError(null);
    await inspect({ environmentId, input: { rootPath } })
      .then((result) => {
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        const inferred = libraryFolderResources(result.value);
        setInspection(result.value);
        setInspectionEnvironmentId(environmentId);
        setSelectedSource(`${environmentId}:${rootPath}`);
        props.onChoose({
          ...inferred,
          environmentId,
          registration: result.value.registration,
        });
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
  return (
    <SettingsSection title="Files you already have">
      <View className="gap-2 p-4">
        <Button
          label={expanded ? "Hide folders" : "Add existing folder"}
          tone="text"
          disabled={props.disabled || pending !== null}
          onPress={() => setExpanded((value) => !value)}
        />
        {expanded ? (
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
              editable={!props.disabled && pending === null}
              autoCapitalize="none"
              autoCorrect={false}
              className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
            {search.trim().startsWith("/") ||
            search.trim().startsWith("~") ||
            /^[a-z]:[\\/]/i.test(search.trim())
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
                  .map((host) => (
                    <KnownFolderRow
                      key={host.environmentId}
                      environmentId={host.environmentId}
                      title={`Use this folder on ${host.label}`}
                      description={search.trim()}
                      selected={selectedSource === `${host.environmentId}:${search.trim()}`}
                      disabled={props.disabled || pending !== null}
                      onPress={() => void choose(host.environmentId, search.trim())}
                    />
                  ))
              : null}
            {inspection && props.folder ? (
              <>
                <Text selectable className="text-xs text-foreground-muted">
                  Using {inspection.rootPath}. {inspection.repositories.length}{" "}
                  {inspection.repositories.length === 1 ? "repository found" : "repositories found"}
                  .
                </Text>
                <Button
                  label="Prepare new files instead"
                  tone="text"
                  disabled={props.disabled || pending !== null}
                  onPress={() => {
                    setInspection(null);
                    setSelectedSource(null);
                    props.onClear();
                  }}
                />
              </>
            ) : null}
            {suggestions.map((project) => (
              <View key={project.id} className="gap-2">
                <Text className="text-sm text-foreground-muted">
                  {project.title} already has files or matching repositories from this folder.
                </Text>
                <Button
                  label={`Open ${project.title}`}
                  disabled={props.disabled || pending !== null}
                  onPress={() => navigation.navigate("LibraryProject", { projectId: project.id })}
                />
              </View>
            ))}
            {catalog.error || copies.error ? (
              <Text className="text-xs text-danger-foreground">
                Could not check existing projects. Reopen this section to retry.
              </Text>
            ) : null}
            {error ? (
              <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
                {error}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
      {expanded
        ? known.slice(0, 12).map((project) => {
            const host = environments.find(
              (entry) => entry.environmentId === project.environmentId,
            );
            const connected = host?.entry.enabled === true && host.connection.phase === "connected";
            const supported = supportsLoomFeature(
              host?.serverConfig?.environment.capabilities,
              "project-library",
            );
            return (
              <KnownFolderRow
                key={`${project.environmentId}:${project.workspaceRoot}`}
                environmentId={project.environmentId}
                title={project.title}
                description={`${host?.label ?? "Saved computer"} · ${project.workspaceRoot}${!connected ? " · Offline" : !supported ? " · Update Loom to inspect this folder" : ""}`}
                selected={
                  props.folder !== null &&
                  selectedSource === `${project.environmentId}:${project.workspaceRoot}`
                }
                disabled={props.disabled || pending !== null || !connected || !supported}
                onPress={() => void choose(project.environmentId, project.workspaceRoot)}
              />
            );
          })
        : null}
      {expanded && known.length === 0 ? (
        <Text className="px-4 pb-4 text-sm text-foreground-muted">
          {search.trim()
            ? "No matching folders."
            : "No known folders yet. Add repositories above, or connect a computer with existing projects."}
        </Text>
      ) : null}
      {expanded && known.length > 12 ? (
        <Text className="px-4 pb-4 text-xs text-foreground-muted">
          Search to find more folders.
        </Text>
      ) : null}
    </SettingsSection>
  );
}

function KnownFolderRow(props: {
  environmentId: EnvironmentId;
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const permitted = useAtomValue(library.inspectFolder.permissionAtom(props.environmentId));
  return (
    <ListChoiceRow
      label={props.title}
      description={permitted ? props.description : `${props.description} · File access required`}
      selected={props.selected}
      disabled={props.disabled || !permitted}
      onPress={props.onPress}
    />
  );
}
