import { useEffect, useState } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  WorkspaceHandoffAttemptRecord,
  type WorkspaceHandoffAttemptRecord as Attempt,
} from "@t3tools/contracts/fork";
import {
  createWorkspaceHandoffAtoms,
  runWorkspaceHandoff,
  supportsLoomFeature,
  type WorkspaceHandoffPhase,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AppText } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { useProjects, useServerConfigs, useThreadShell } from "../../state/entities";
import { uuidv4 } from "../../lib/uuid";
import { runtime } from "../../lib/runtime";
import * as MobileDatabase from "../../persistence/mobile-database";

const handoff = createWorkspaceHandoffAtoms(connectionAtomRuntime);
const JsonRecord = Schema.fromJsonString(WorkspaceHandoffAttemptRecord);
const decodeRecord = Schema.decodeUnknownOption(JsonRecord);
const encodeRecord = Schema.encodeSync(JsonRecord);
const labels = {
  checking: "Checking source work…",
  preparing: "Preparing destination…",
  settling: "Finishing source handoff…",
  continuing: "Starting continuation…",
  done: "Continuation ready",
  idle: "Prepare and continue",
};

export function WorkspaceHandoffScreen({
  route,
}: StaticScreenProps<{ environmentId: string; threadId: string }>) {
  const sourceEnvironmentId = EnvironmentId.make(route.params.environmentId);
  const sourceThreadId = ThreadId.make(route.params.threadId);
  const sourceShell = useThreadShell({
    environmentId: sourceEnvironmentId,
    threadId: sourceThreadId,
  });
  const projects = useProjects();
  const configs = useServerConfigs();
  const navigation = useNavigation();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [phase, setPhase] = useState<WorkspaceHandoffPhase | "idle">("idle");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destinations = projects.filter(
    (project) =>
      project.environmentId !== sourceEnvironmentId &&
      supportsLoomFeature(
        configs.get(project.environmentId)?.environment.capabilities,
        "workspace-handoff",
      ),
  );
  const selected = destinations.find(
    (project) => `${project.environmentId}/${project.id}` === attempt?.destinationKey,
  );
  const destination = attempt?.receipt
    ? { environmentId: attempt.receipt.destinationEnvironmentId, id: attempt.receipt.projectId }
    : selected;
  const sourceAllowed = useAtomValue(handoff.offer.permissionAtom(sourceEnvironmentId));
  const destinationAllowed = useAtomValue(
    handoff.prepare.permissionAtom(destination?.environmentId ?? sourceEnvironmentId),
  );
  const allowed = (attempt?.sourceResult != null || sourceAllowed) && destinationAllowed;
  const canStartNew =
    sourceAllowed && sourceShell !== null && sourceShell.settledOverride !== "settled";
  useEffect(() => {
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
        if (alive) setError("Could not load the saved handoff. Reopen this screen to retry.");
      });
    return () => {
      alive = false;
    };
  }, [sourceEnvironmentId, sourceThreadId]);
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
    setAttempt(record);
  };
  const go = async () => {
    if (!attempt || !destination || running || !allowed) return;
    setRunning(true);
    setError(null);
    const run = async <W, A, E>(
      command: import("@t3tools/client-runtime/state/runtime").AtomCommand<W, A, E>,
      input: W,
    ): Promise<A> => {
      const result = await command.run(appAtomRegistry, input);
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      return result.value;
    };
    try {
      await runWorkspaceHandoff({
        attempt,
        offer: () =>
          run(handoff.offer, {
            environmentId: sourceEnvironmentId,
            input: { threadId: sourceThreadId, requestId: attempt.requestId },
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
          await save({ ...attempt, ...partial, completed: step === "done" });
          setPhase(step);
        },
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Handoff could not finish. The original conversation is preserved.",
      );
      setPhase("idle");
    } finally {
      setRunning(false);
    }
  };
  const openDestination = () => {
    if (attempt?.receipt)
      navigation.navigate("Thread", {
        environmentId: attempt.receipt.destinationEnvironmentId,
        threadId: attempt.receipt.threadId,
      });
  };
  return (
    <ScrollView className="flex-1 bg-screen" contentContainerStyle={{ padding: 20, gap: 16 }}>
      <AppText className="text-xl font-t3-medium">Continue on another machine</AppText>
      <AppText className="text-foreground-muted">
        Prepare published code and workspace setup first. The original conversation keeps its full
        history and attachments.
      </AppText>
      {!attempt && !error && (
        <AppText accessibilityLiveRegion="polite">Loading saved handoff…</AppText>
      )}
      <View className="gap-2">
        <AppText className="font-t3-medium">Destination project</AppText>
        {destinations.map((project) => {
          const key = `${project.environmentId}/${project.id}`;
          return (
            <Pressable
              key={key}
              disabled={running || attempt?.offer != null}
              accessibilityRole="radio"
              accessibilityState={{
                checked: attempt?.destinationKey === key,
                disabled: running || attempt?.offer != null,
              }}
              onPress={() => {
                if (attempt)
                  void save({ ...attempt, destinationKey: key }).catch(() =>
                    setError("Could not save the destination selection."),
                  );
              }}
              className="rounded-xl bg-subtle p-3"
            >
              <AppText>
                {configs.get(project.environmentId)?.environment.label} · {project.title}
                {attempt?.destinationKey === key ? " · Selected" : ""}
              </AppText>
            </Pressable>
          );
        })}
        {destinations.length === 0 && (
          <AppText className="text-foreground-muted">
            {attempt?.receipt
              ? "Reconnect the destination host to finish this saved handoff."
              : "Connect another Loom host and add this repository there. It will appear once that host supports handoff."}
          </AppText>
        )}
      </View>
      {(running || phase === "done") && (
        <AppText accessibilityLiveRegion="polite">{labels[phase]}</AppText>
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
          Retry to deliver to the prepared conversation. The original is already settled, and its
          history is preserved.
        </AppText>
      )}
      {phase !== "done" && !allowed && (
        <AppText className="text-foreground-muted">
          {attempt?.sourceResult == null && !sourceAllowed
            ? "Workspace operation permission is required on the original host."
            : "Workspace operation permission is required on the destination host."}
        </AppText>
      )}
      {phase !== "done" && (
        <MaterialButton
          label={
            running
              ? labels[phase]
              : attempt?.sourceResult
                ? "Retry continuation"
                : error
                  ? "Retry handoff"
                  : "Prepare and continue"
          }
          tone="primary"
          disabled={!attempt || !destination || !allowed}
          loading={running}
          onPress={() => void go()}
        />
      )}
      {attempt?.receipt && (
        <MaterialButton
          label={phase === "done" ? "Continue on destination" : "Open destination"}
          tone={phase === "done" ? "primary" : "secondary"}
          disabled={running}
          onPress={openDestination}
        />
      )}
      {attempt &&
        ((error && !attempt.sourceResult?.sourceSettled) || (phase === "done" && canStartNew)) && (
          <MaterialButton
            label={phase === "done" ? "New handoff" : "Start over"}
            disabled={running}
            onPress={() => {
              void save({
                requestId: uuidv4(),
                destinationKey: attempt.destinationKey,
                offer: null,
                receipt: null,
                sourceResult: null,
              })
                .then(() => {
                  setError(null);
                  setPhase("idle");
                })
                .catch(() => setError("Could not save the new handoff."));
            }}
          />
        )}
    </ScrollView>
  );
}
