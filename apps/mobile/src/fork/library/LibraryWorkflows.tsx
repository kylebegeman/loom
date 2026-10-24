import { useNavigation } from "@react-navigation/native";
import { useRef, useState } from "react";
import { Linking, Share, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  PROJECT_WORKFLOWS_FEATURE,
  LibraryBlueprint,
  type LibraryProject,
  type LibraryWorkstream,
  type LibraryWorkstreamReference,
  type LibraryThreadSummary,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  LIBRARY_OPERATION_LABELS,
  LIBRARY_OPERATION_STATES,
  LIBRARY_RESTORE_PATHS,
  LIBRARY_WORKSTREAM_REFERENCE_KINDS,
  LIBRARY_WORKSTREAM_REFERENCE_STATES,
  LIBRARY_WORKSTREAM_STATES,
  LIBRARY_WORKSTREAM_TYPED_KINDS,
  isWorkstreamReferenceDone,
  libraryOperationNeedsAction,
  libraryProjectAttention,
  sortLibraryOperations,
  sortWorkstreams,
  workstreamLinkOptions,
  workstreamProgress,
  workstreamReferenceDoneState,
  workstreamReferenceKey,
  workstreamReferenceThread,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { relativeTime } from "../../lib/time";
import { cn } from "../../lib/cn";
import {
  library,
  refreshLibraryProject,
  useLibraryAuthority,
  useLoomFeature,
} from "./libraryState";
import { LibraryCopySection } from "./LibraryCopySection";

const inputStyle = "min-h-12 rounded-xl bg-field px-4 text-base text-foreground";
const blueprintCodec = Schema.fromJsonString(LibraryBlueprint);
const decodeBlueprint = Schema.decodeOption(blueprintCodec);

const BADGE_FILL: Record<LibraryWorkflowTone, string> = {
  neutral: "bg-subtle",
  active: "bg-adaptive-blue-50-blue-400-a14",
  success: "bg-adaptive-emerald-500-a12-a16",
  warning: "bg-adaptive-amber-500-a12-a16",
  danger: "bg-adaptive-red-50-950-a80",
};

const BADGE_INK: Record<LibraryWorkflowTone, string> = {
  neutral: "text-foreground-muted",
  active: "text-adaptive-blue-600-400",
  success: "text-adaptive-emerald-700-300",
  warning: "text-adaptive-amber-700-300",
  danger: "text-adaptive-red-700-300",
};

/** The same state pill the web Library uses, so Active, Done and Failed read alike on both. */
function StateBadge({
  tone,
  label,
}: {
  readonly tone: LibraryWorkflowTone;
  readonly label: string;
}) {
  return (
    <View className={cn("self-start rounded-full px-2.5 py-0.5", BADGE_FILL[tone])}>
      <Text className={cn("font-t3-medium text-xs", BADGE_INK[tone])}>{label}</Text>
    </View>
  );
}

const ago = (iso: string) => `${relativeTime(iso)} ago`;
export function LibraryWorkflows({
  environmentId,
  project,
  copies,
  threads,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly threads: readonly LibraryThreadSummary[];
}) {
  const navigation = useNavigation();
  const streams = useEnvironmentQuery(
    library.workstreams({ environmentId, input: { projectId: project.id } }),
  );
  const blueprint = useEnvironmentQuery(
    library.blueprint({ environmentId, input: { projectId: project.id } }),
  );
  const canSave = useAtomValue(library.saveWorkstream.permissionAtom(environmentId));
  const canApply = useAtomValue(library.applyBlueprint.permissionAtom(environmentId));
  const save = useAtomCommand(library.saveWorkstream, { reportFailure: false });
  const apply = useAtomCommand(library.applyBlueprint, { reportFailure: false });
  const [editor, setEditor] = useState<LibraryWorkstream | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [references, setReferences] = useState<readonly LibraryWorkstreamReference[]>([]);
  const [reference, setReference] = useState("");
  const pendingImport = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [blueprintText, setBlueprintText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = blueprintText === null ? null : decodeBlueprint(blueprintText);
  const preview = parsed?._tag === "Some" ? parsed.value : null;
  // The latest conversation already leads the project screen, so a resume suggestion would repeat it.
  const attention = libraryProjectAttention(threads, copies).filter(
    (item) => item.kind !== "resume",
  );
  const draftId = useRef("");
  const pendingSave = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const edit = (value: LibraryWorkstream | "new") => {
    setEditor(value);
    setTitle(value === "new" ? "" : value.title);
    setGoal(value === "new" ? "" : value.goal);
    setReferences(value === "new" ? [] : value.references);
    setError(null);
    draftId.current = value === "new" ? uuidv4() : value.id;
    pendingSave.current = null;
  };
  const persist = async (state: LibraryWorkstream["state"]) => {
    if (!editor || busy) return;
    setBusy(true);
    setError(null);
    const input = {
      id: draftId.current,
      projectId: project.id,
      expectedRevision: editor === "new" ? 0 : editor.revision,
      title: title.trim(),
      goal,
      references,
      state,
    };
    const fingerprint = JSON.stringify(input);
    if (pendingSave.current?.fingerprint !== fingerprint)
      pendingSave.current = { fingerprint, requestId: uuidv4() };
    const result = await save({
      environmentId: environmentId,
      input: { ...input, requestId: pendingSave.current.requestId },
    });
    if (result._tag === "Success") {
      streams.refresh();
      setEditor(null);
    } else {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not save this workstream.");
    }
    setBusy(false);
  };
  const options = workstreamLinkOptions(project, threads, copies);
  return (
    <View className="gap-5">
      {attention.length ? (
        <SettingsSection title="Needs attention">
          {attention.slice(0, 8).map((item) => (
            <View key={`${item.kind}:${item.id}`} className="gap-1 px-4 py-3">
              <Text className="font-t3-medium text-foreground" numberOfLines={1}>
                {item.title.trim() || "Untitled conversation"}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {item.detail} · seen {ago(item.checkedAt)}
              </Text>
              {item.kind === "conversation" ? (
                <Button
                  label="Open conversation"
                  tone="text"
                  onPress={() =>
                    navigation.navigate("LibraryHistory", {
                      projectId: project.id,
                      archiveId: item.id,
                    })
                  }
                />
              ) : (
                <Text className="text-sm text-foreground-muted">Review these files below.</Text>
              )}
            </View>
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection title="Workstreams">
        <View className="gap-3 p-4">
          <Text className="text-sm text-foreground-muted">
            Optional groups for conversations, branches, copies and checks around a goal.
          </Text>
          {streams.error ? <Text accessibilityRole="alert">{streams.error}</Text> : null}
          {streams.isPending ? (
            <Text className="text-sm text-foreground-muted">Loading workstreams...</Text>
          ) : !streams.error && !streams.data?.length ? (
            <Text className="text-sm text-foreground-muted">
              No workstreams yet. Start a conversation as usual, or group a larger goal here.
            </Text>
          ) : null}
          {sortWorkstreams(streams.data ?? []).map((stream) => {
            const state = LIBRARY_WORKSTREAM_STATES[stream.state];
            const progress = workstreamProgress(stream);
            return (
              <View key={stream.id} className="gap-2 rounded-xl bg-subtle p-3">
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1 font-t3-medium text-foreground" numberOfLines={2}>
                    {stream.title}
                  </Text>
                  <StateBadge tone={state.tone} label={state.label} />
                </View>
                {stream.goal ? (
                  <Text className="text-sm text-foreground-muted" numberOfLines={4}>
                    {stream.goal}
                  </Text>
                ) : null}
                <Text className="text-xs text-foreground-muted">
                  {progress.total
                    ? `${progress.done} of ${progress.total} done${progress.blocked ? ` · ${progress.blocked} blocked` : ""} · `
                    : ""}
                  Updated {ago(stream.updatedAt)}
                </Text>
                {stream.references.map((ref) => {
                  const thread = workstreamReferenceThread(ref, threads);
                  const refState = LIBRARY_WORKSTREAM_REFERENCE_STATES[ref.state];
                  return (
                    <View key={workstreamReferenceKey(ref)} className="gap-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                          {LIBRARY_WORKSTREAM_REFERENCE_KINDS[ref.kind]} · {ref.label}
                        </Text>
                        <StateBadge tone={refState.tone} label={refState.label} />
                      </View>
                      {thread ? (
                        <Button
                          label="Open conversation"
                          tone="text"
                          onPress={() =>
                            navigation.navigate("LibraryHistory", {
                              projectId: project.id,
                              archiveId: thread.id,
                            })
                          }
                        />
                      ) : ref.url ? (
                        <Button
                          label="Open link"
                          tone="text"
                          onPress={() =>
                            void Linking.openURL(ref.url!).catch(() =>
                              setError("Could not open this reference link."),
                            )
                          }
                        />
                      ) : null}
                    </View>
                  );
                })}
                <Button
                  label="Review workstream"
                  tone="text"
                  disabled={!canSave || busy || editor !== null}
                  onPress={() => edit(stream)}
                />
              </View>
            );
          })}
          <Button
            label="New workstream"
            disabled={!canSave || busy || editor !== null}
            onPress={() => edit("new")}
          />
          {editor ? (
            <View className="gap-3">
              <TextInput
                accessibilityLabel="Workstream title"
                placeholder="Goal name"
                value={title}
                onChangeText={setTitle}
                maxLength={160}
                className={inputStyle}
              />
              <TextInput
                accessibilityLabel="Workstream goal"
                placeholder="Outcome and completion criteria"
                value={goal}
                onChangeText={setGoal}
                multiline
                maxLength={8192}
                className={inputStyle}
              />
              {options
                .filter(
                  (option) =>
                    !references.some(
                      (ref) => workstreamReferenceKey(ref) === workstreamReferenceKey(option),
                    ),
                )
                .map((option) => (
                  <Button
                    key={workstreamReferenceKey(option)}
                    label={`Link ${LIBRARY_WORKSTREAM_REFERENCE_KINDS[option.kind].toLowerCase()}: ${option.label.trim() || "Untitled"}`}
                    tone="text"
                    disabled={busy}
                    onPress={() => setReferences((previous) => [...previous, option])}
                  />
                ))}
              <TextInput
                accessibilityLabel="Check branch or PR"
                placeholder="Check name, branch or HTTPS PR URL"
                value={reference}
                onChangeText={setReference}
                maxLength={160}
                className={inputStyle}
              />
              <View className="flex-row flex-wrap gap-2">
                {LIBRARY_WORKSTREAM_TYPED_KINDS.map((kind) => (
                  <Button
                    key={kind}
                    label={`Add ${LIBRARY_WORKSTREAM_REFERENCE_KINDS[kind].toLowerCase()}`}
                    disabled={!reference.trim() || busy}
                    onPress={() => {
                      const label = reference.trim();
                      setReferences((previous) => [
                        ...previous,
                        {
                          kind,
                          id: uuidv4(),
                          label,
                          state: "open",
                          ...(kind === "pull-request" ? { url: label } : {}),
                        },
                      ]);
                      setReference("");
                    }}
                  />
                ))}
              </View>
              {references.map((ref, index) => (
                <View key={workstreamReferenceKey(ref)} className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                      {LIBRARY_WORKSTREAM_REFERENCE_KINDS[ref.kind]} · {ref.label}
                    </Text>
                    <StateBadge
                      tone={LIBRARY_WORKSTREAM_REFERENCE_STATES[ref.state].tone}
                      label={LIBRARY_WORKSTREAM_REFERENCE_STATES[ref.state].label}
                    />
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label={
                        isWorkstreamReferenceDone(ref)
                          ? "Reopen link"
                          : ref.kind === "verification"
                            ? "Record pass"
                            : "Mark complete"
                      }
                      tone="text"
                      disabled={busy}
                      onPress={() =>
                        setReferences((previous) =>
                          previous.map((item, position) =>
                            position === index
                              ? {
                                  ...item,
                                  state: isWorkstreamReferenceDone(item)
                                    ? "open"
                                    : workstreamReferenceDoneState(item),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    <Button
                      label="Unlink"
                      tone="text"
                      disabled={busy}
                      onPress={() =>
                        setReferences((previous) =>
                          previous.filter((_, position) => position !== index),
                        )
                      }
                    />
                  </View>
                </View>
              ))}
              <Text className="text-sm text-foreground-muted">
                Check and PR results are recorded observations. Completion rechecks linked local
                work.
              </Text>
              <Button
                label={
                  editor !== "new" && editor.state !== "active"
                    ? "Reopen workstream"
                    : "Save active"
                }
                disabled={!canSave || busy || !title.trim()}
                onPress={() => void persist("active")}
              />
              <Button
                label="Complete workstream"
                disabled={!canSave || busy || !title.trim()}
                onPress={() => void persist("completed")}
              />
              {editor !== "new" ? (
                <Button
                  label="Archive workstream"
                  disabled={!canSave || busy}
                  onPress={() => void persist("archived")}
                />
              ) : null}
              <Button label="Cancel" tone="text" disabled={busy} onPress={() => setEditor(null)} />
            </View>
          ) : null}
        </View>
      </SettingsSection>
      <SettingsSection title="Portable blueprint">
        <View className="gap-3 p-4">
          <Text className="text-sm text-foreground-muted">
            Repository layout, tools, scripts and connection names travel together. Save as
            .loom/project.json. Computer paths, provider choices and credentials stay local.
          </Text>
          {blueprint.error ? <Text accessibilityRole="alert">{blueprint.error}</Text> : null}
          <Button
            label="Share blueprint"
            disabled={!blueprint.data}
            onPress={() => {
              if (blueprint.data)
                void Share.share({
                  message: Schema.encodeSync(blueprintCodec)(blueprint.data),
                }).catch(() => setError("Could not share this blueprint."));
            }}
          />
          <Button
            label="Import or edit blueprint"
            disabled={!canApply || busy}
            onPress={() =>
              setBlueprintText(
                blueprint.data ? Schema.encodeSync(blueprintCodec)(blueprint.data) : "",
              )
            }
          />
          {blueprintText !== null ? (
            <>
              <TextInput
                accessibilityLabel="Blueprint JSON"
                value={blueprintText}
                onChangeText={setBlueprintText}
                multiline
                maxLength={131072}
                className={inputStyle}
              />
              <Text className="text-sm text-foreground-muted">
                {preview
                  ? `${preview.resources.length} repositories and links; ${preview.connections.length} connections. Replaces shared setup. Scripts are not executed by import.`
                  : "Paste a version 1 Loom blueprint."}
              </Text>
              {preview?.setup?.scripts?.map((script) => (
                <Text key={script.id} className="text-sm text-foreground">
                  {script.name}: {script.command}
                </Text>
              ))}
              <Button
                label="Apply reviewed blueprint"
                disabled={!preview || busy || !canApply}
                onPress={() => {
                  if (!preview) return;
                  setBusy(true);
                  const input = {
                    projectId: project.id,
                    expectedRevision: project.revision,
                    blueprint: preview,
                  };
                  const fingerprint = JSON.stringify(input);
                  if (pendingImport.current?.fingerprint !== fingerprint)
                    pendingImport.current = { fingerprint, requestId: uuidv4() };
                  void apply({
                    environmentId,
                    input: { ...input, requestId: pendingImport.current.requestId },
                  }).then((result) => {
                    if (result._tag === "Success") {
                      setBlueprintText(null);
                      blueprint.refresh();
                      refreshLibraryProject(environmentId, project.id);
                    } else {
                      const cause = squashAtomCommandFailure(result);
                      setError(
                        cause instanceof Error ? cause.message : "Could not apply blueprint.",
                      );
                    }
                    setBusy(false);
                  });
                }}
              />
              <Button
                label="Cancel import"
                tone="text"
                disabled={busy}
                onPress={() => setBlueprintText(null)}
              />
            </>
          ) : null}
        </View>
      </SettingsSection>
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function LibraryPreservationCenter({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const authority = useLibraryAuthority();
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  const query = useEnvironmentQuery(
    open ? library.preservation({ environmentId, input: {} }) : null,
  );
  return (
    <View className="gap-3">
      <Button
        label={open ? "Close preservation review" : "Preservation and cleanup"}
        onPress={() => setOpen((previous) => !previous)}
      />
      {open ? (
        <>
          <Text className="text-sm text-foreground-muted">
            Review every computer before removal. Remote branches alone do not preserve ignored
            files, stashes and local history.
          </Text>
          {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
          <Button label="Refresh observations" tone="text" onPress={query.refresh} />
          {query.data?.map((entry) => (
            <View key={entry.copy.id} className="gap-3">
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 font-t3-medium text-foreground" numberOfLines={1}>
                  {entry.project.title}
                </Text>
                <StateBadge
                  tone={LIBRARY_RESTORE_PATHS[entry.restore].tone}
                  label={LIBRARY_RESTORE_PATHS[entry.restore].label}
                />
              </View>
              <Text className="text-sm text-foreground-muted">
                {LIBRARY_RESTORE_PATHS[entry.restore].detail}{" "}
                {entry.checkedAt ? `Checked ${ago(entry.checkedAt)}.` : "Not checked yet."}
              </Text>
              {entry.blockers.length ? (
                <View className="gap-1 rounded-xl bg-adaptive-amber-500-a12-a16 p-3">
                  {entry.blockers.map((blocker) => (
                    <Text key={blocker} className="text-sm text-adaptive-amber-700-300">
                      {blocker}
                    </Text>
                  ))}
                </View>
              ) : null}
              <LibraryCopySection
                project={entry.project}
                copy={entry.copy}
                lastSeenAt={undefined}
                authorityEnvironmentId={environmentId}
                authorityReady={authority.ready}
                computerLabel={
                  authority.info.data?.computers?.find(
                    (computer) => computer.environmentId === entry.copy.environmentId,
                  )?.label ?? "Computer"
                }
                onChanged={query.refresh}
                onReuseFolder={() =>
                  navigation.navigate("LibraryStart", {
                    projectId: entry.project.id,
                    reuseEnvironmentId: entry.copy.environmentId,
                    reuseRootPath: entry.copy.rootPath,
                  })
                }
              />
              <LibraryOperationHistory environmentId={entry.copy.environmentId} />
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

export function LibraryOperationHistory({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  const supported = useLoomFeature(environmentId, PROJECT_WORKFLOWS_FEATURE);
  const query = useEnvironmentQuery(
    open && supported ? library.operations({ environmentId, input: {} }) : null,
  );
  const resume = useAtomCommand(library.resumeOperation, { reportFailure: false });
  const cancel = useAtomCommand(library.cancelOperation, { reportFailure: false });
  const allowed = useAtomValue(library.resumeOperation.permissionAtom(environmentId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (id: string, action: "resume" | "cancel") => {
    setBusy(true);
    setError(null);
    const result = await (action === "resume" ? resume : cancel)({
      environmentId,
      input: { operationId: id },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not change operation.");
    }
    query.refresh();
    setBusy(false);
  };
  if (!supported)
    return (
      <Text className="text-sm text-foreground-muted">
        Update Loom on this computer to see its file activity.
      </Text>
    );
  return (
    <View className="gap-2">
      <Button
        label={open ? "Hide activity" : "File activity on this computer"}
        tone="text"
        onPress={() => setOpen((previous) => !previous)}
      />
      {open ? (
        <>
          <Button label="Refresh activity" tone="text" onPress={query.refresh} />
          {error || query.error ? (
            <Text accessibilityRole="alert">{error ?? query.error}</Text>
          ) : null}
          {!query.isPending && !query.data?.length ? (
            <Text className="text-sm text-foreground-muted">No file activity yet.</Text>
          ) : null}
          {sortLibraryOperations(query.data ?? []).map((operation) => (
            <View key={operation.id} className="gap-2">
              <View className="flex-row items-center gap-2">
                <View className="flex-1 gap-0.5">
                  <Text className="text-sm text-foreground">
                    {LIBRARY_OPERATION_LABELS[operation.kind]}
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    {[
                      operation.state === "succeeded" || operation.state === "cancelled"
                        ? null
                        : operation.phase,
                      ago(operation.updatedAt),
                      operation.attempt > 1 ? `attempt ${operation.attempt}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <StateBadge
                  tone={LIBRARY_OPERATION_STATES[operation.state].tone}
                  label={LIBRARY_OPERATION_STATES[operation.state].label}
                />
              </View>
              {operation.error ? (
                <Text className="text-sm text-danger">{operation.error}</Text>
              ) : null}
              {libraryOperationNeedsAction(operation) ? (
                <>
                  <Button
                    label={operation.kind === "restore" ? "Open Start to restore" : "Resume"}
                    disabled={!allowed || busy}
                    onPress={() =>
                      operation.kind === "restore" && operation.projectId
                        ? navigation.navigate("LibraryStart", {
                            projectId: operation.projectId,
                            reuseEnvironmentId: environmentId,
                          })
                        : void act(operation.id, "resume")
                    }
                  />
                  <Button
                    label="Cancel remaining steps"
                    disabled={!allowed || busy}
                    tone="text"
                    onPress={() => void act(operation.id, "cancel")}
                  />
                </>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}
