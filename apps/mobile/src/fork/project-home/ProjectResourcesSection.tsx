import { useAtomValue } from "@effect/atom-react";
import { createProjectResourcesAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { MaterialButton } from "../../components/MaterialButton";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentServerConfig } from "../../state/entities";
import { environmentPresentations, useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { cn } from "../../lib/cn";

const resources = createProjectResourcesAtoms(connectionAtomRuntime);
type Props = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly computerLabel: string;
};

/** Resource changes stay attached to the selected project on its own computer. */
export function ProjectResourcesSection(props: Props) {
  const config = useEnvironmentServerConfig(props.environmentId);
  const { presentation } = useEnvironmentPresentation(props.environmentId);
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const supported = supportsLoomFeature(config?.environment.capabilities, "project-resources");
  const canRead = useEnvironmentScope(props.environmentId, AuthOrchestrationReadScope);
  const canAdd = useAtomValue(resources.upsert.permissionAtom(props.environmentId));
  const canRemove = useAtomValue(resources.remove.permissionAtom(props.environmentId));
  return (
    <ProjectResourcesContent
      key={`${props.environmentId}:${props.projectId}:${connected}:${supported}:${canRead}:${canAdd}:${canRemove}`}
      {...props}
      connected={connected}
      configReady={config != null}
      supported={supported}
      canRead={canRead}
      canAdd={canAdd}
      canRemove={canRemove}
    />
  );
}

function ProjectResourcesContent(
  props: Props & {
    readonly connected: boolean;
    readonly configReady: boolean;
    readonly supported: boolean;
    readonly canRead: boolean;
    readonly canAdd: boolean;
    readonly canRemove: boolean;
  },
) {
  const ready = props.connected && props.supported && props.canRead;
  const query = useEnvironmentQuery(
    ready
      ? resources.get({ environmentId: props.environmentId, input: { projectId: props.projectId } })
      : null,
  );
  const upsert = useAtomCommand(resources.upsert, { reportFailure: false });
  const remove = useAtomCommand(resources.remove, { reportFailure: false });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"repository" | "link">("repository");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const draftResourceId = useRef(uuidv4());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function canExecute(command: typeof resources.upsert | typeof resources.remove) {
    const current = appAtomRegistry.get(
      environmentPresentations.presentationAtom(props.environmentId),
    );
    return (
      mounted.current &&
      !busy.current &&
      ready &&
      query.isSuccess &&
      !query.isPending &&
      query.data?.projectId === props.projectId &&
      current?.entry.enabled === true &&
      current.connection.phase === "connected" &&
      readEnvironmentScope(props.environmentId, AuthOrchestrationReadScope) &&
      appAtomRegistry.get(command.permissionAtom(props.environmentId))
    );
  }

  async function save() {
    if (!canExecute(resources.upsert) || !query.data || !url.trim()) return;
    busy.current = true;
    setPending("add");
    setError(null);
    try {
      const result = await upsert({
        environmentId: props.environmentId,
        input: {
          projectId: props.projectId,
          expectedRevision: query.data.revision,
          resource: {
            id: draftResourceId.current,
            kind,
            title: title.trim() || url.trim().slice(0, 200),
            url: url.trim(),
          },
        },
      });
      if (!mounted.current) return;
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      draftResourceId.current = uuidv4();
      setAdding(false);
      setUrl("");
      setTitle("");
      query.refresh();
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : "The resource could not be saved. Try again.",
        );
        query.refresh();
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  async function removeResource(resourceId: string) {
    if (!canExecute(resources.remove) || !query.data) return;
    busy.current = true;
    setPending(resourceId);
    setError(null);
    try {
      const result = await remove({
        environmentId: props.environmentId,
        input: { projectId: props.projectId, expectedRevision: query.data.revision, resourceId },
      });
      if (!mounted.current) return;
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      query.refresh();
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : "The resource could not be removed. Try again.",
        );
        query.refresh();
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  const unavailable = !props.connected
    ? `Reconnect ${props.computerLabel} to view this project's resources.`
    : !props.configReady
      ? "Loading this computer's capabilities…"
      : !props.supported
        ? "Update Loom on this computer to manage project resources."
        : !props.canRead
          ? "Project read permission is required to view resources."
          : null;
  const currentResources = query.data?.projectId === props.projectId ? query.data.resources : [];
  return (
    <SettingsSection
      title="Resources"
      footer={`Saved with this project on ${props.computerLabel}. Removing a resource keeps its files and conversations.`}
    >
      <View className="gap-3 p-4">
        {unavailable ? (
          <Text className="text-sm text-foreground-muted">{unavailable}</Text>
        ) : (
          <>
            {!query.data && !query.error ? (
              <Text className="text-sm text-foreground-muted">Loading resources…</Text>
            ) : null}
            {query.isSuccess && currentResources.length === 0 ? (
              <Text className="text-sm text-foreground-muted">
                Add a repository, GitHub issue, design, or reference for this project.
              </Text>
            ) : null}
            {currentResources.map((resource) => (
              <View key={resource.id} className="flex-row items-start gap-3">
                <View className="pt-1">
                  <SymbolView
                    name={
                      resource.kind === "repository"
                        ? "chevron.left.forwardslash.chevron.right"
                        : "link"
                    }
                    size={18}
                    tintColorClassName="accent-icon-muted"
                  />
                </View>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${resource.title}`}
                  disabled={!/^https?:\/\//i.test(resource.url)}
                  onPress={() => {
                    void Linking.openURL(resource.url).catch(() =>
                      setError("This link could not be opened."),
                    );
                  }}
                  className="min-h-11 min-w-0 flex-1 gap-1 active:opacity-70"
                >
                  <Text className="text-sm font-t3-medium text-foreground" numberOfLines={2}>
                    {resource.title}
                  </Text>
                  <Text selectable className="text-xs text-foreground-muted" numberOfLines={2}>
                    {resource.url}
                  </Text>
                </Pressable>
                {props.canRemove ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${resource.title} from project`}
                    disabled={pending !== null || query.isPending}
                    onPress={() =>
                      Alert.alert(
                        "Remove resource?",
                        `Remove ${resource.title} from this project? Its files and conversations stay in place.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove resource",
                            style: "destructive",
                            onPress: () => {
                              void removeResource(resource.id);
                            },
                          },
                        ],
                      )
                    }
                    className="size-11 items-center justify-center rounded-full active:opacity-70"
                  >
                    <SymbolView name="xmark" size={16} tintColorClassName="accent-icon-muted" />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {!props.canAdd ? (
              <Text className="text-xs text-foreground-muted">
                Project access is required to add or remove resources.
              </Text>
            ) : null}
            {adding ? (
              <View className="gap-3">
                <View className="flex-row gap-2">
                  {(["repository", "link"] as const).map((choice) => (
                    <Pressable
                      key={choice}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: kind === choice }}
                      disabled={pending !== null}
                      onPress={() => setKind(choice)}
                      className={cn(
                        "min-h-11 justify-center rounded-xl px-3",
                        kind === choice ? "bg-subtle-strong" : "bg-subtle",
                      )}
                    >
                      <Text className="text-sm text-foreground">
                        {choice === "repository" ? "Repository" : "Reference link"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  accessibilityLabel={kind === "repository" ? "Repository URL" : "Reference URL"}
                  placeholder={kind === "repository" ? "Repository URL" : "https://…"}
                  value={url}
                  onChangeText={setUrl}
                  maxLength={2048}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={pending === null}
                  className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
                />
                <TextInput
                  accessibilityLabel="Resource title, optional"
                  placeholder="Title (optional)"
                  value={title}
                  onChangeText={setTitle}
                  maxLength={200}
                  editable={pending === null}
                  className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
                />
                <View className="flex-row flex-wrap gap-2">
                  <MaterialButton
                    label={pending === "add" ? "Saving…" : "Save resource"}
                    tone="primary"
                    disabled={
                      pending !== null || query.isPending || !query.isSuccess || !url.trim()
                    }
                    onPress={() => {
                      void save();
                    }}
                  />
                  <MaterialButton
                    label="Cancel"
                    tone="text"
                    disabled={pending !== null}
                    onPress={() => setAdding(false)}
                  />
                </View>
              </View>
            ) : props.canAdd ? (
              <MaterialButton
                label="Add resource"
                tone="text"
                disabled={pending !== null || !query.isSuccess || query.isPending}
                onPress={() => setAdding(true)}
              />
            ) : null}
          </>
        )}
        {(error ?? query.error) ? (
          <>
            <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
              {error ?? query.error}
            </Text>
            {ready ? (
              <MaterialButton
                label="Reload resources"
                tone="text"
                disabled={pending !== null || query.isPending}
                onPress={() => {
                  setError(null);
                  query.refresh();
                }}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}
