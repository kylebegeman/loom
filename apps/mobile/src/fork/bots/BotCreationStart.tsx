import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { View } from "react-native";
import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";
import { ProjectId, type EnvironmentId, type ModelSelection } from "@t3tools/contracts";
import {
  isBotRunThreadId,
  type BotImportedDraft,
  type BotStarterId,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { RowPressable } from "../../components/ui/RowPressable";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { scheduledTaskDefaultModel } from "../../features/settings/scheduledTaskDraft";
import { useEnvironmentServerConfig, useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotInput, BotNotice, BotPage, BotSection } from "./BotControls";
import { BotModelField } from "./BotModelField";
import { BotsOutline, BotsSection } from "./BotIdentity";
import { bots, useBotsCapabilities } from "./state";

export function BotCreationStart({
  environmentId,
  onDraft,
  onBlank,
}: {
  readonly environmentId: EnvironmentId;
  readonly onDraft: (draft: BotImportedDraft) => void;
  readonly onBlank: () => void;
}) {
  const navigation = useNavigation();
  const host = useBotsCapabilities(environmentId);
  const config = useEnvironmentServerConfig(environmentId);
  const canSave = useAtomValue(bots.save.permissionAtom(environmentId));
  const projects = useProjects().filter(
    (entry) => entry.environmentId === environmentId && !entry.isScratch,
  );
  const threads = useThreadShells().filter(
    (entry) => entry.environmentId === environmentId && !isBotRunThreadId(entry.id),
  );
  const starters = useEnvironmentQuery(bots.listStarters({ environmentId, input: {} }));
  const [point, setPoint] = useState<"prompt" | "thread" | "starter">("prompt");
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const modelSelection = model ?? scheduledTaskDefaultModel(config, null);
  const [text, setText] = useState("");
  const [project, setProject] = useState("");
  const [starterId, setStarter] = useState<BotStarterId | "">("");
  const [threadId, setThread] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ReadonlyArray<BotImportedDraft>>([]);
  const [notes, setNotes] = useState<ReadonlyArray<string>>([]);
  const importText = useAtomCommand(bots.draftFromText, { reportFailure: false });
  const importStarter = useAtomCommand(bots.draftFromStarter, { reportFailure: false });
  const disabled = busy || !host.connected || !canSave;
  const read = async () => {
    if (disabled || !modelSelection) return;
    setBusy(true);
    setError(null);
    const context = { modelSelection, ...(project ? { projectId: ProjectId.make(project) } : {}) };
    await (async () => {
      if (point === "starter") {
        if (!starterId) return;
        const result = await importStarter({ environmentId, input: { ...context, starterId } });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        onDraft(result.value);
      } else {
        const result = await importText({ environmentId, input: { ...context, text } });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        if (result.value.drafts.length === 1) onDraft(result.value.drafts[0]!);
        else {
          setDrafts(result.value.drafts);
          setNotes(result.value.notes);
        }
      }
    })()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not prepare the bot draft."),
      )
      .finally(() => setBusy(false));
  };
  const pickFile = async () => {
    setBusy(true);
    await (async () => {
      const result = await getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const file = new File(asset.uri);
      if (file.size > 400_000) throw new Error("Choose a file smaller than 400 KB.");
      const value = await file.text();
      if (value.length > 100_000) throw new Error("Import at most 100,000 characters at a time.");
      setText(value);
      setDrafts([]);
      setError(null);
    })()
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Could not read the file. Try pasting its text.",
        ),
      )
      .finally(() => setBusy(false));
  };
  return (
    <BotPage title="New bot" back>
      <View className="gap-2">
        <Text accessibilityRole="header" className="text-2xl font-t3-semibold">
          Give a repeatable job its own bot
        </Text>
        <Text className="text-sm text-foreground-muted">
          Start with instructions you already use. Review inputs and permissions before saving.
        </Text>
      </View>
      <View className="gap-3">
        <View accessibilityState={{ disabled }} pointerEvents={disabled ? "none" : "auto"}>
          <SegmentedControl
            selected={point}
            options={[
              { value: "prompt", label: "Prompt", accessibilityLabel: "From prompt or snippet" },
              { value: "thread", label: "Thread", accessibilityLabel: "From thread" },
              { value: "starter", label: "Starter" },
            ]}
            onSelect={(value) => {
              if (disabled) return;
              setPoint(value);
              setError(null);
              setDrafts([]);
            }}
          />
        </View>
        <Button label="Start blank" tone="text" onPress={onBlank} disabled={disabled} />
      </View>
      <BotNotice error={error} />
      {point === "thread" ? (
        <BotSection title="Conversation">
          {threads.length ? (
            <BotChoice
              label="Conversation"
              value={threadId}
              options={threads.map((thread) => ({ value: thread.id, label: thread.title }))}
              onChange={setThread}
              disabled={disabled}
            />
          ) : (
            <Text className="text-sm text-foreground-muted">
              Open a conversation on this computer first. Its opening request becomes the draft.
            </Text>
          )}
          <Button
            label="Draft from thread"
            tone="primary"
            disabled={disabled || !threadId}
            onPress={() =>
              navigation.navigate("BotsCreate", { environmentId, sourceThreadId: threadId })
            }
          />
        </BotSection>
      ) : (
        <>
          <BotSection title={point === "prompt" ? "Instructions" : "Starter"}>
            {point === "prompt" ? (
              <>
                <BotInput
                  label="Instructions or snippet export"
                  value={text}
                  onChangeText={(value) => {
                    setText(value);
                    setDrafts([]);
                  }}
                  disabled={disabled}
                  multiline
                  placeholder="Describe the job. Use {{target}} for anything that changes between runs."
                />
                <Button
                  label="Choose a text file"
                  onPress={() => void pickFile()}
                  disabled={disabled}
                />
                <Text className="text-sm text-foreground-muted">
                  Plain text, Markdown, loom-snippet or snippets.json. Existing placeholders become
                  inputs.
                </Text>
              </>
            ) : (
              <>
                <BotChoice
                  label="Starter"
                  value={starterId}
                  options={(starters.data?.starters ?? []).map((starter) => ({
                    value: starter.starterId,
                    label: starter.name,
                    description: starter.description,
                  }))}
                  onChange={setStarter}
                  disabled={disabled}
                />
                <BotNotice
                  error={starters.error}
                  detail="Creates a separate draft with the starter's typed inputs. Your saved bots stay as they are."
                />
              </>
            )}
          </BotSection>
          <BotsOutline>
            <RowPressable
              accessibilityRole="button"
              accessibilityLabel="Draft model and workspace"
              accessibilityState={{ expanded: defaultsOpen }}
              onPress={() => setDefaultsOpen(!defaultsOpen)}
              className="min-h-16 flex-row items-center gap-3 p-4"
            >
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-sm font-t3-medium">Model and workspace</Text>
                <Text numberOfLines={2} className="text-xs text-foreground-muted">
                  {modelSelection?.model ?? "Choose a model"} in{" "}
                  {projects.find((entry) => entry.id === project)?.title ?? "a scratch folder"}
                </Text>
              </View>
              <SymbolView
                name={defaultsOpen ? "chevron.up" : "chevron.down"}
                size={12}
                tintColorClassName="accent-icon-muted"
              />
            </RowPressable>
            {defaultsOpen ? (
              <View className="gap-4 border-t border-border-subtle p-4">
                <BotModelField
                  environmentId={environmentId}
                  value={modelSelection}
                  onChange={setModel}
                  disabled={disabled}
                />
                <BotChoice
                  label="Project"
                  value={project}
                  options={[
                    { value: "", label: "Scratch folder" },
                    ...projects.map((entry) => ({ value: entry.id, label: entry.title })),
                  ]}
                  onChange={setProject}
                  disabled={disabled}
                />
              </View>
            ) : null}
          </BotsOutline>
          <View className="gap-3">
            <Text className="text-xs text-foreground-muted">
              Drafts ask before actions. Creating a bot does not run it or enable a schedule. Review
              editing permissions in the next step.
            </Text>
            <Button
              label={busy ? "Preparing draft…" : "Review draft"}
              tone="primary"
              loading={busy}
              disabled={
                disabled || !modelSelection || (point === "prompt" ? !text.trim() : !starterId)
              }
              onPress={() => void read()}
            />
          </View>
        </>
      )}
      {host.pipelinesSupported ? (
        <BotsSection title="Need a sequence of jobs?">
          <Text className="text-sm text-foreground-muted">
            Use a pipeline to combine saved bots with inputs and stop conditions.
          </Text>
          <Button
            label="Build an automation"
            tone="text"
            disabled={disabled}
            onPress={() => navigation.navigate("BotsPipelines", { environmentId })}
          />
        </BotsSection>
      ) : null}
      {notes.map((note) => (
        <Text key={note} className="text-sm text-foreground-muted">
          {note}
        </Text>
      ))}
      {drafts.length ? (
        <BotsSection title="Choose a snippet to review" detail={`${drafts.length} found`}>
          <BotsOutline>
            {drafts.map((entry, index) => (
              <RowPressable
                key={entry.draft.id}
                accessibilityRole="button"
                accessibilityLabel={`Review ${entry.draft.name}`}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => onDraft(entry)}
                className={
                  index > 0
                    ? "flex-row items-center gap-3 border-t border-border-subtle p-4"
                    : "flex-row items-center gap-3 p-4"
                }
              >
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="font-t3-medium">{entry.draft.name}</Text>
                  <Text numberOfLines={3} className="text-sm text-foreground-muted">
                    {entry.draft.description || entry.draft.instructions.slice(0, 160)}
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    {entry.intent === "edits"
                      ? "Requests changes"
                      : entry.intent === "planning"
                        ? "Ideas and planning"
                        : "Review permissions"}
                  </Text>
                </View>
                <SymbolView name="chevron.right" size={13} tintColorClassName="accent-icon-muted" />
              </RowPressable>
            ))}
          </BotsOutline>
        </BotsSection>
      ) : null}
    </BotPage>
  );
}
