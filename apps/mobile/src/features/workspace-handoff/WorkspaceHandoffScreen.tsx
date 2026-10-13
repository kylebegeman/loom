import { useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  WorkspaceHandoffAttemptRecord,
  type WorkspaceHandoffAttemptRecord as Attempt,
} from "@t3tools/contracts/fork";
import {
  buildWorkspaceHandoffDestinations,
  createWorkspaceHandoffAtoms,
  runWorkspaceHandoff,
  selectWorkspaceHandoffDestination,
  supportsLoomFeature,
  WORKSPACE_HANDOFF_LABELS,
  type WorkspaceHandoffDestinationGroup,
  type WorkspaceHandoffPhase,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { AppText } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { connectionAtomRuntime } from "../../connection/runtime";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { appAtomRegistry } from "../../state/atom-registry";
import { useProjects, useServerConfigs, useThreadShell } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { runtime } from "../../lib/runtime";
import * as MobileDatabase from "../../persistence/mobile-database";

const handoff = createWorkspaceHandoffAtoms(connectionAtomRuntime);
const JsonRecord = Schema.fromJsonString(WorkspaceHandoffAttemptRecord);
const decodeRecord = Schema.decodeUnknownOption(JsonRecord);
const encodeRecord = Schema.encodeSync(JsonRecord);
// A move keeps running after navigation. Reopened screens wait for its durable result.
const pendingOperation = Atom.family((_threadKey: string) =>
  Atom.make<"saving" | "moving" | null>(null).pipe(Atom.keepAlive),
);

export function WorkspaceHandoffScreen({
  route,
}: StaticScreenProps<{ environmentId: string; threadId: string }>) {
  return (
    <WorkspaceHandoffContent
      key={`${route.params.environmentId}/${route.params.threadId}`}
      sourceEnvironmentId={EnvironmentId.make(route.params.environmentId)}
      sourceThreadId={ThreadId.make(route.params.threadId)}
    />
  );
}

function WorkspaceHandoffContent({
  sourceEnvironmentId,
  sourceThreadId,
}: {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly sourceThreadId: ThreadId;
}) {
  const sourceShell = useThreadShell({
    environmentId: sourceEnvironmentId,
    threadId: sourceThreadId,
  });
  const projects = useProjects();
  const configs = useServerConfigs();
  const { environments, isReady } = useEnvironments();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [phase, setPhase] = useState<WorkspaceHandoffPhase | "idle">("idle");
  const operationAtom = pendingOperation(`${sourceEnvironmentId}/${sourceThreadId}`);
  const operation = useAtomValue(operationAtom);
  const running = operation === "moving";
  const savingSelection = operation === "saving";
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const sourceComputer = environments.find(
    (environment) => environment.environmentId === sourceEnvironmentId,
  );
  const sourceProject = projects.find(
    (project) =>
      project.environmentId === sourceEnvironmentId && project.id === sourceShell?.projectId,
  );
  const sourceLabel =
    sourceComputer?.label ??
    configs.get(sourceEnvironmentId)?.environment.label ??
    "Original computer";
  const sourceConnected =
    sourceComputer?.entry.enabled === true && sourceComputer.connection.phase === "connected";
  const sourceSupported = supportsLoomFeature(
    sourceComputer?.serverConfig?.environment.capabilities ??
      configs.get(sourceEnvironmentId)?.environment.capabilities,
    "workspace-handoff",
  );
  const destinations = useMemo(
    () =>
      buildWorkspaceHandoffDestinations({
        sourceEnvironmentId,
        sourceRepository: sourceProject?.repositoryIdentity,
        offeredRepositoryKey: attempt?.offer?.repositoryKey,
        projects,
        computers: environments.map((environment) => ({
          environmentId: environment.environmentId,
          label: environment.label,
          connected: environment.entry.enabled && environment.connection.phase === "connected",
          supportsHandoff: supportsLoomFeature(
            environment.serverConfig?.environment.capabilities ??
              configs.get(environment.environmentId)?.environment.capabilities,
            "workspace-handoff",
          ),
        })),
      }),
    [
      sourceEnvironmentId,
      sourceProject?.repositoryIdentity,
      attempt?.offer?.repositoryKey,
      projects,
      environments,
      configs,
    ],
  );
  const selected = attempt
    ? selectWorkspaceHandoffDestination(
        destinations,
        !attempt.destinationKey && !attempt.offer ? undefined : attempt.destinationKey,
      )
    : null;
  const destination = attempt?.receipt
    ? { environmentId: attempt.receipt.destinationEnvironmentId, id: attempt.receipt.projectId }
    : selected?.project;
  const savedProject = projects.find(
    (project) => `${project.environmentId}/${project.id}` === attempt?.destinationKey,
  );
  const destinationGroup = destinations.find((group) =>
    destination
      ? group.environmentId === destination.environmentId
      : attempt?.destinationKey.startsWith(`${group.environmentId}/`),
  );
  const destinationLabel = destinationGroup?.label ?? "Saved computer";
  const destinationProjectTitle =
    selected?.project.title ?? savedProject?.title ?? "Prepared project";
  const sourceAllowed = useAtomValue(handoff.offer.permissionAtom(sourceEnvironmentId));
  const destinationAllowed = useAtomValue(
    handoff.prepare.permissionAtom(destination?.environmentId ?? sourceEnvironmentId),
  );
  const sourceBusy =
    sourceShell?.runtime?.activeRunId != null ||
    threadRuntimeIsActive(sourceShell?.runtime) ||
    (sourceShell?.pendingBackgroundTasks.length ?? 0) > 0 ||
    sourceShell?.source.pendingRuntimeRequest != null;
  const sourceRemoved = sourceShell?.archivedAt != null || sourceShell?.deletedAt != null;
  const sourceReady =
    sourceConnected && sourceSupported && sourceShell !== null && !sourceBusy && !sourceRemoved;
  const allowed =
    (attempt?.sourceResult != null || (sourceAllowed && sourceReady)) &&
    destination !== undefined &&
    destinationGroup?.connected === true &&
    destinationGroup.supportsHandoff &&
    destinationAllowed;
  const canStartNew = sourceAllowed && sourceReady && sourceShell?.settledOverride !== "settled";
  const blockedReason =
    phase === "done" || !attempt || running
      ? null
      : attempt.sourceResult == null && sourceBusy
        ? "Finish or stop the current turn and background work before moving."
        : attempt.sourceResult == null && sourceRemoved
          ? "Restore the original conversation before moving work."
          : attempt.sourceResult == null && !sourceConnected
            ? `Reconnect ${sourceLabel} to move work.`
            : attempt.sourceResult == null && !sourceSupported
              ? `Update Loom on ${sourceLabel} to move work.`
              : attempt.sourceResult == null && sourceShell === null
                ? "The original conversation is unavailable. Reconnect its computer."
                : attempt.sourceResult == null && !sourceAllowed
                  ? "Workspace operation permission is required on the original computer."
                  : destination && destinationGroup?.connected !== true
                    ? `Reconnect ${destinationLabel} to finish the move.`
                    : destination && !destinationGroup?.supportsHandoff
                      ? `Update Loom on ${destinationLabel} to finish the move.`
                      : !attempt.receipt && destinationGroup?.blockedReason
                        ? destinationGroup.blockedReason
                        : !destination
                          ? attempt.destinationKey
                            ? "The saved project is unavailable. Choose another project or reconnect its computer."
                            : "Choose a computer and project to move work."
                          : !destinationAllowed
                            ? "Workspace operation permission is required on the destination computer."
                            : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (operation !== null) return;
    let alive = true;
    void runtime
      .runPromise(
        Effect.flatMap(MobileDatabase.MobileDatabase, (database) =>
          database.loadCache(sourceEnvironmentId, "workspace-handoff", sourceThreadId),
        ),
      )
      .then((stored) => {
        if (!alive) return;
        const decoded = Option.isSome(stored) ? decodeRecord(stored.value) : Option.none();
        if (Option.isSome(stored) && Option.isNone(decoded)) {
          setError("The saved move could not be read. Reopen this screen to retry.");
          return;
        }
        setPhase(Option.isSome(decoded) && decoded.value.completed ? "done" : "idle");
        setAttempt(
          Option.getOrElse(decoded, () => ({
            requestId: uuidv4(),
            destinationKey: "",
            offer: null,
            receipt: null,
            sourceResult: null,
          })),
        );
      })
      .catch(() => {
        if (alive) setError("Could not load the saved move. Reopen this screen to retry.");
      });
    return () => {
      alive = false;
    };
  }, [sourceEnvironmentId, sourceThreadId, operation]);

  const save = async (record: Attempt) => {
    await runtime.runPromise(
      Effect.flatMap(MobileDatabase.MobileDatabase, (database) =>
        database.saveCache(
          sourceEnvironmentId,
          "workspace-handoff",
          sourceThreadId,
          1,
          encodeRecord(record),
        ),
      ),
    );
    if (mounted.current) setAttempt(record);
  };
  const chooseDestination = async (key: string) => {
    if (!attempt || appAtomRegistry.get(operationAtom) !== null || attempt.offer) return;
    appAtomRegistry.set(operationAtom, "saving");
    try {
      await save({ ...attempt, destinationKey: key });
      if (mounted.current) setError(null);
    } catch {
      if (mounted.current) setError("Could not save the destination selection.");
    } finally {
      appAtomRegistry.set(operationAtom, null);
    }
  };
  const go = async () => {
    if (!attempt || !destination || appAtomRegistry.get(operationAtom) !== null || !allowed) return;
    appAtomRegistry.set(operationAtom, "moving");
    setError(null);
    const run = async <W, A, E>(
      command: import("@t3tools/client-runtime/state/runtime").AtomCommand<W, A, E>,
      input: W,
    ): Promise<A> => {
      const result = await command.run(appAtomRegistry, input);
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      return result.value;
    };
    const activeAttempt = {
      ...attempt,
      destinationKey: `${destination.environmentId}/${destination.id}`,
    };
    try {
      // Persist automatic selection before the first step so retries stay on this computer.
      await save(activeAttempt);
      await runWorkspaceHandoff({
        attempt: activeAttempt,
        offer: () =>
          run(handoff.offer, {
            environmentId: sourceEnvironmentId,
            input: { threadId: sourceThreadId, requestId: activeAttempt.requestId },
          }),
        prepare: (offer) =>
          run(handoff.prepare, {
            environmentId: destination.environmentId,
            input: { offer, projectId: destination.id },
          }),
        finish: (offer, receipt) =>
          run(handoff.finish, { environmentId: sourceEnvironmentId, input: { offer, receipt } }),
        resume: (offer, receipt) =>
          run(handoff.resume, {
            environmentId: destination.environmentId,
            input: { offer, receipt },
          }),
        progress: async (step, partial) => {
          await save({ ...activeAttempt, ...partial, completed: step === "done" });
          if (mounted.current) setPhase(step);
        },
      });
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The move could not finish. The original conversation is preserved.",
        );
        setPhase("idle");
      }
    } finally {
      appAtomRegistry.set(operationAtom, null);
    }
  };
  const openDestination = () => {
    if (attempt?.receipt)
      navigation.navigate("Thread", {
        environmentId: attempt.receipt.destinationEnvironmentId,
        threadId: attempt.receipt.threadId,
      });
  };
  const startOver = async () => {
    if (!attempt || appAtomRegistry.get(operationAtom) !== null || !canStartNew) return;
    appAtomRegistry.set(operationAtom, "saving");
    try {
      await save({
        requestId: uuidv4(),
        destinationKey: "",
        offer: null,
        receipt: null,
        sourceResult: null,
      });
      if (mounted.current) {
        setError(null);
        setPhase("idle");
      }
    } catch {
      if (mounted.current) setError("Could not save the new move.");
    } finally {
      appAtomRegistry.set(operationAtom, null);
    }
  };

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions options={{ title: "Move work" }} />
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        <AppText className="text-foreground-muted">
          Start a new conversation with recent context on another computer. The original history
          stays here.
        </AppText>
        <View className="gap-1">
          <AppText className="text-sm text-foreground-muted">From {sourceLabel}</AppText>
          <AppText className="font-t3-medium">
            {sourceShell?.title ?? attempt?.offer?.title ?? "Original conversation"}
          </AppText>
        </View>
        {!attempt && !error && (
          <AppText accessibilityLiveRegion="polite">
            {running
              ? "The move is in progress."
              : savingSelection
                ? "Saving selection…"
                : "Loading saved move…"}
          </AppText>
        )}
        {(selected || attempt?.destinationKey || attempt?.receipt) && (
          <View className="gap-1 rounded-xl bg-subtle p-4">
            <AppText className="text-sm text-foreground-muted">
              {phase === "done" ? "Moved to" : "Move to"}
            </AppText>
            <AppText className="font-t3-medium">{destinationLabel}</AppText>
            <AppText>{destinationProjectTitle}</AppText>
            {selected && !selected.repositoryVerified && (
              <AppText className="text-sm text-foreground-muted">
                The repository will be checked before moving.
              </AppText>
            )}
            {phase === "done" && destinationGroup?.connected !== true && (
              <AppText className="text-sm text-foreground-muted">
                Reconnect this computer to continue the conversation.
              </AppText>
            )}
          </View>
        )}
        {!attempt?.offer && phase !== "done" && (
          <View className="gap-3">
            <AppText className="font-t3-medium">Choose a computer</AppText>
            {!isReady ? (
              <AppText className="text-foreground-muted">Loading computers…</AppText>
            ) : destinations.length === 0 ? (
              <AppText className="text-foreground-muted">
                Connect another computer to move work there.
              </AppText>
            ) : (
              destinations.map((group) => (
                <DestinationComputer
                  key={group.environmentId}
                  group={group}
                  selectedKey={selected?.key ?? attempt?.destinationKey ?? ""}
                  disabled={running || savingSelection || !attempt}
                  onSelect={(key) => void chooseDestination(key)}
                />
              ))
            )}
          </View>
        )}
        <MaterialButton
          label="Manage computers"
          tone="text"
          disabled={running || savingSelection}
          onPress={() => navigation.navigate("Connections")}
        />
        {attempt?.receipt && phase !== "done" && !running && (
          <AppText className="text-foreground-muted">
            The destination is prepared. Finish the move to start the conversation there.
          </AppText>
        )}
        {error && (
          <AppText accessibilityRole="alert" className="text-danger">
            {error}
          </AppText>
        )}
        {attempt?.sourceResult && (
          <AppText className="text-foreground-muted">{attempt.sourceResult.reason}</AppText>
        )}
        {error && attempt?.sourceResult?.sourceSettled && (
          <AppText className="text-foreground-muted">
            Finish the move to deliver to the prepared conversation. The original is already settled
            and its history is preserved.
          </AppText>
        )}
        {!attempt?.offer && phase !== "done" && (
          <AppText className="text-sm text-foreground-muted">
            Publish your latest commits first. Loom prepares the destination before settling this
            conversation.
          </AppText>
        )}
      </ScreenScrollView>
      <View
        className="border-t border-border"
        style={{
          paddingBottom: Math.max(insets.bottom, 16),
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
      >
        <View className="w-full gap-3" style={{ maxWidth: 720, alignSelf: "center" }}>
          {(running || phase === "done") && (
            <AppText accessibilityLiveRegion="polite">
              {phase === "idle" ? "Moving work…" : WORKSPACE_HANDOFF_LABELS[phase]}
            </AppText>
          )}
          {blockedReason && (
            <AppText accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
              {blockedReason}
            </AppText>
          )}
          {phase !== "done" && (
            <MaterialButton
              label={
                running
                  ? "Moving work…"
                  : attempt?.sourceResult
                    ? "Finish move"
                    : error
                      ? "Retry move"
                      : "Move work"
              }
              tone="primary"
              fullWidth
              disabled={!attempt || !destination || !allowed || savingSelection}
              loading={running}
              onPress={() => void go()}
            />
          )}
          {attempt?.receipt && (
            <MaterialButton
              label="Open conversation"
              tone={phase === "done" ? "primary" : "secondary"}
              fullWidth
              disabled={running || savingSelection}
              onPress={openDestination}
            />
          )}
          {attempt &&
            canStartNew &&
            !attempt.sourceResult?.sourceSettled &&
            (error || attempt.offer || phase === "done") && (
              <MaterialButton
                label={phase === "done" ? "Move again" : "Start over"}
                tone="text"
                fullWidth
                disabled={running || savingSelection}
                onPress={() => void startOver()}
              />
            )}
        </View>
      </View>
    </View>
  );
}

function DestinationComputer({
  group,
  selectedKey,
  disabled,
  onSelect,
}: {
  readonly group: WorkspaceHandoffDestinationGroup;
  readonly selectedKey: string;
  readonly disabled: boolean;
  readonly onSelect: (key: string) => void;
}) {
  const permitted = useAtomValue(handoff.prepare.permissionAtom(group.environmentId));
  const reason =
    group.blockedReason ??
    (!permitted ? "Workspace operation permission is required on this computer." : null);
  return (
    <View className="gap-2 rounded-xl bg-subtle p-3">
      <AppText className="font-t3-medium">{group.label}</AppText>
      {reason && <AppText className="text-sm text-foreground-muted">{reason}</AppText>}
      {group.projects.map((candidate) => {
        const unavailable = disabled || reason !== null;
        const checked = selectedKey === candidate.key;
        return (
          <Pressable
            key={candidate.key}
            disabled={unavailable}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled: unavailable }}
            onPress={() => onSelect(candidate.key)}
            className={cn("min-h-12 gap-1 rounded-lg px-3 py-3", checked && "bg-subtle-strong")}
          >
            <AppText>
              {candidate.project.title}
              {checked ? " · Selected" : ""}
            </AppText>
            {group.projects.length > 1 && (
              <AppText className="text-sm text-foreground-muted">
                {candidate.project.workspaceRoot}
              </AppText>
            )}
            {!candidate.repositoryVerified && (
              <AppText className="text-sm text-foreground-muted">
                Repository not yet verified
              </AppText>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
