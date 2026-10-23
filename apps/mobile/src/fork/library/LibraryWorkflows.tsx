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
import { libraryProjectAttention } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
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
  const attention = libraryProjectAttention(threads, copies);
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
  const options: LibraryWorkstreamReference[] = [
    ...threads
      .filter((thread) => !thread.deleted)
      .map((thread) => ({
        kind: "thread" as const,
        id: thread.threadId,
        label: thread.title,
        environmentId: thread.environmentId,
        state: thread.settled ? ("completed" as const) : ("open" as const),
      })),
    ...copies.map((copy) => ({
      kind: "copy" as const,
      id: copy.id,
      label: copy.rootPath.slice(-160),
      environmentId: copy.environmentId,
      state: "open" as const,
    })),
    ...project.resources
      .filter((resource) => resource.kind !== "link")
      .map((resource) => ({
        kind: "repository" as const,
        id: resource.id,
        label: resource.title,
        state: "open" as const,
      })),
  ];
  return (
    <View className="gap-5">
      <SettingsSection title="Needs attention">
        {attention.length ? (
          attention.slice(0, 8).map((item) => (
            <View key={`${item.kind}:${item.id}`} className="gap-1 px-4 py-3">
              <Text className="font-t3-medium text-foreground">{item.title}</Text>
              <Text className="text-sm text-foreground-muted">
                {item.detail}. Observed {new Date(item.checkedAt).toLocaleString()}
              </Text>
              {item.kind === "conversation" ? (
                <Button
                  label="Resume conversation"
                  tone="text"
                  onPress={() =>
                    navigation.navigate("LibraryHistory", {
                      projectId: project.id,
                      archiveId: item.id,
                    })
                  }
                />
              ) : (
                <Text className="text-sm text-foreground-muted">
                  Review this copy in Files on this page.
                </Text>
              )}
            </View>
          ))
        ) : (
          <Text className="px-4 py-3 text-sm text-foreground-muted">
            No problems in saved observations. Check connected computers for current file status.
          </Text>
        )}
      </SettingsSection>
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
          {streams.data?.map((stream) => (
            <View key={stream.id} className="gap-2">
              <Text className="font-t3-medium text-foreground">
                {stream.title}: {stream.state}
              </Text>
              <Text className="text-sm text-foreground-muted">{stream.goal}</Text>
              {stream.references.map((ref) => {
                const thread =
                  ref.kind === "thread"
                    ? threads.find(
                        (thread) =>
                          (thread.threadId === ref.id || thread.id === ref.id) &&
                          (!ref.environmentId || ref.environmentId === thread.environmentId),
                      )
                    : undefined;
                return (
                  <View key={`${ref.kind}:${ref.environmentId ?? ""}:${ref.id}`} className="gap-1">
                    <Text className="text-sm text-foreground-muted">
                      {ref.label}: {ref.state}
                    </Text>
                    {thread ? (
                      <Button
                        label={`Open ${ref.label}`}
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
                        label={`Open ${ref.label}`}
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
          ))}
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
                      (ref) =>
                        ref.kind === option.kind &&
                        ref.id === option.id &&
                        ref.environmentId === option.environmentId,
                    ),
                )
                .map((option) => (
                  <Button
                    key={`${option.kind}:${option.environmentId ?? ""}:${option.id}`}
                    label={`Link ${option.kind}: ${option.label}`}
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
                {["verification", "branch", "pull-request"].map((kind) => (
                  <Button
                    key={kind}
                    label={`Add ${kind === "verification" ? "check" : kind === "branch" ? "branch" : "PR"}`}
                    disabled={!reference.trim() || busy}
                    onPress={() => {
                      const label = reference.trim();
                      setReferences((previous) => [
                        ...previous,
                        {
                          kind:
                            kind === "branch"
                              ? "branch"
                              : kind === "pull-request"
                                ? "pull-request"
                                : "verification",
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
                <View key={`${ref.kind}:${ref.environmentId ?? ""}:${ref.id}`} className="gap-2">
                  <Text className="text-sm text-foreground">
                    {ref.label}: {ref.state}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label={
                        ref.state === "completed" || ref.state === "passed"
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
                                  state:
                                    item.state === "passed" || item.state === "completed"
                                      ? "open"
                                      : item.kind === "verification"
                                        ? "passed"
                                        : "completed",
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
              <Text className="font-t3-medium text-foreground">{entry.project.title}</Text>
              <Text className="text-sm text-foreground-muted">
                Restore:{" "}
                {entry.restore === "verified-archive"
                  ? "Saved recovery archive"
                  : entry.restore === "repository"
                    ? "Repository clone; local-only files are not covered"
                    : "No verified restore path"}
                .{" "}
                {entry.checkedAt
                  ? `Last checked ${new Date(entry.checkedAt).toLocaleString()}`
                  : "Not yet checked"}
              </Text>
              {entry.blockers.map((blocker) => (
                <Text key={blocker} className="text-sm text-foreground-muted">
                  {blocker}
                </Text>
              ))}
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
        Connect an updated computer to view its operations.
      </Text>
    );
  return (
    <View className="gap-2">
      <Button
        label={open ? "Hide operations" : "Operations on this computer"}
        tone="text"
        onPress={() => setOpen((previous) => !previous)}
      />
      {open ? (
        <>
          <Button label="Refresh operations" tone="text" onPress={query.refresh} />
          {error || query.error ? (
            <Text accessibilityRole="alert">{error ?? query.error}</Text>
          ) : null}
          {query.data?.map((operation) => (
            <View key={operation.id} className="gap-2">
              <Text className="text-sm text-foreground">
                {operation.kind}: {operation.phase} ({operation.state})
              </Text>
              {operation.error ? (
                <Text className="text-sm text-danger">{operation.error}</Text>
              ) : null}
              {["queued", "failed", "needs-input"].includes(operation.state) ? (
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
