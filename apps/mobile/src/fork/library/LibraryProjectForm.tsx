import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { LibraryError, type LibraryProject, type LibraryResource } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryAuthorityScreen, LibraryNotice, LibraryPage } from "./LibraryScreens";
import { library, refreshLibraryProject, useLibraryAuthority } from "./libraryState";
import { libraryResourceDraft } from "./libraryLogic";

type ResourceDraft = {
  id: string;
  kind: "repository" | "link";
  title: string;
  url: string;
  relativePath: string;
  defaultBranch: string;
};
export function LibraryCreateRouteScreen() {
  return <LibraryProjectForm />;
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
function LibraryProjectForm({ initial: seed }: { initial?: LibraryProject }) {
  const [initial] = useState(seed);
  const authority = useLibraryAuthority(),
    navigation = useNavigation();
  const create = useAtomCommand(library.createProject, { reportFailure: false }),
    update = useAtomCommand(library.updateProject, { reportFailure: false });
  const canSave = useAtomValue(
    (initial ? library.updateProject : library.createProject).permissionAtom(
      authority.environmentId,
    ),
  );
  const [title, setTitle] = useState(initial?.title ?? ""),
    [brief, setBrief] = useState(initial?.brief ?? "");
  const [resources, setResources] = useState<readonly ResourceDraft[]>(
    () =>
      initial?.resources.map((resource) => ({
        id: resource.id,
        kind: resource.kind ?? "repository",
        title: resource.title,
        url: resource.kind === "link" ? (resource.url ?? "") : (resource.remoteUrl ?? ""),
        relativePath: resource.relativePath,
        defaultBranch: resource.defaultBranch ?? "",
      })) ?? [],
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [awaitingResult, setAwaitingResult] = useState(false);
  const request = useRef(uuidv4()),
    submittedAuthority = useRef<string | null>(null),
    busy = useRef(false);
  if (!authority.environmentId) return <LibraryAuthorityScreen />;
  const patch = (id: string, value: Partial<ResourceDraft>) =>
    setResources((current) =>
      current.map((resource) => (resource.id === id ? { ...resource, ...value } : resource)),
    );
  async function save() {
    if (busy.current || !authority.environmentId || !authority.ready || !canSave || !title.trim())
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
      if (
        parsed.some(
          (resource) =>
            !resource.title ||
            (resource.kind === "link" && !/^https?:\/\//i.test(resource.url ?? "")),
        )
      )
        throw new Error("Reference links need a name and HTTP or HTTPS URL.");
      const paths = parsed
        .filter((resource) => resource.kind !== "link")
        .map((resource) => resource.relativePath);
      if (new Set(paths).size !== paths.length)
        throw new Error("Each repository needs its own component folder.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review the project resources.");
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
            },
          })
        : await create({
            environmentId: authority.environmentId,
            input: { requestId: request.current, title: title.trim(), brief, resources: parsed },
          });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      refreshLibraryProject(authority.environmentId, result.value.id);
      setAwaitingResult(false);
      navigation.navigate("LibraryProject", { projectId: result.value.id });
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
  return (
    <LibraryPage title={initial ? "Edit project" : "Create project"} back>
      {awaitingResult && !pending ? (
        <LibraryNotice detail="The save result is not yet confirmed. Retry the same save before making further edits." />
      ) : null}
      <Text className="text-sm text-foreground-muted">
        {initial
          ? "Update shared context and resources. Existing conversations keep their reviewed execution bindings."
          : "Start with a name and brief. Add components and references now or later. No computer or working files are required."}
      </Text>
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
            maxLength={65536}
            editable={!pending && !awaitingResult}
            className="min-h-28 rounded-xl border border-input-border bg-input p-3 text-sm text-foreground"
          />
        </View>
      </SettingsSection>
      {resources.map((resource) => (
        <SettingsSection
          key={resource.id}
          title={resource.kind === "repository" ? "Repository component" : "Reference link"}
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
            <MaterialButton
              label="Remove resource"
              tone="text"
              disabled={pending || awaitingResult}
              onPress={() =>
                setResources((current) => current.filter((entry) => entry.id !== resource.id))
              }
            />
          </View>
        </SettingsSection>
      ))}
      <View className="flex-row flex-wrap gap-2">
        <MaterialButton
          label="Add repository"
          disabled={pending || awaitingResult || resources.length >= 64}
          onPress={() =>
            setResources((current) => [
              ...current,
              {
                id: uuidv4(),
                kind: "repository",
                title: "",
                url: "",
                relativePath: "",
                defaultBranch: "",
              },
            ])
          }
        />
        <MaterialButton
          label="Add reference"
          disabled={pending || awaitingResult || resources.length >= 64}
          onPress={() =>
            setResources((current) => [
              ...current,
              {
                id: uuidv4(),
                kind: "link",
                title: "",
                url: "",
                relativePath: "",
                defaultBranch: "",
              },
            ])
          }
        />
      </View>
      {!authority.ready ? (
        <LibraryNotice detail="Reconnect your library server to save this project." />
      ) : !canSave ? (
        <LibraryNotice detail="Project settings access is required to save this project." />
      ) : null}
      {error ? <LibraryNotice error={error} /> : null}
      <MaterialButton
        label={pending ? "Saving…" : initial ? "Save project" : "Create project"}
        tone="primary"
        disabled={pending || !authority.ready || !canSave || !title.trim()}
        onPress={() => {
          void save();
        }}
      />
    </LibraryPage>
  );
}
