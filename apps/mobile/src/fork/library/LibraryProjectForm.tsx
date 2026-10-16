import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  LIBRARY_PROJECT_COLORS,
  LibraryError,
  type LibraryProject,
  type LibraryProjectColor,
  type LibraryResource,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import { library, refreshLibraryProject, useLibraryAuthority } from "./libraryState";
import { libraryResourceDraft } from "./libraryLogic";
import { useLibraryProjectColorValue } from "./libraryProjectColors";
import { libraryResourceFromInput, PROJECT_COLOR_NAMES } from "@t3tools/client-runtime/fork";

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
      })) ?? [],
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [awaitingResult, setAwaitingResult] = useState(false);
  const request = useRef(uuidv4()),
    submittedAuthority = useRef<string | null>(null),
    busy = useRef(false);
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
    setResources((current) => [
      ...current,
      {
        id: uuidv4(),
        kind: parsed.kind === "link" ? "link" : "repository",
        title: parsed.title,
        url,
        relativePath: parsed.relativePath,
        defaultBranch: "",
      },
    ]);
    setPasted("");
  };
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
              // Only send a color the person changed; null returns the project to automatic.
              ...((initial.color ?? null) !== color ? { color } : {}),
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
            },
          });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      refreshLibraryProject(authority.environmentId, result.value.id);
      setAwaitingResult(false);
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
  return (
    <LibraryPage title={initial ? "Edit project" : "New project"} back>
      {awaitingResult && !pending ? (
        <LibraryNotice detail="The save result is not yet confirmed. Retry the same save before making further edits." />
      ) : null}
      <Text className="text-sm text-foreground-muted">
        {initial
          ? "Update shared context and resources. Existing conversations keep their reviewed execution bindings."
          : "Start with a name. Add a brief and the repositories or links it's made of now or later."}
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
      <SettingsSection title="Color">
        <LibraryColorPicker
          value={color}
          onChange={setColor}
          disabled={pending || awaitingResult}
        />
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
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!pending && !awaitingResult}
              className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
            {pasteProblem ? (
              <Text className="text-sm text-danger-foreground">{pasteProblem}</Text>
            ) : null}
            <MaterialButton
              label="Add"
              disabled={pending || awaitingResult || !pasted.trim()}
              onPress={addPasted}
            />
          </View>
        </SettingsSection>
      ) : null}
      {!authority.environmentId ? (
        <MaterialButton
          label="Connect your Library"
          onPress={() => navigation.navigate("LibrarySettings")}
        />
      ) : !authority.ready ? (
        <LibraryNotice detail="Reconnect your Library to save this project." />
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
