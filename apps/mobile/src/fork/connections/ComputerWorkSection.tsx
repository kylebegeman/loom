import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useProjects, useNavigationThreadShells } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { readyAgentCount, recentConversationForComputer } from "./presentation";

export function ComputerWorkSection({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const navigation = useNavigation();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const projects = useProjects();
  const threads = useNavigationThreadShells();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const canRefresh = useAtomValue(serverEnvironment.refreshProviders.permissionAtom(environmentId));
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const ready = readyAgentCount(config?.providers ?? []);
  const canStart = connected && canOperate && ready > 0 && pending === null;
  const machineProjects = projects.filter(
    (project) =>
      project.environmentId === environmentId &&
      !isScratchProject(project, config?.scratchWorkspaceRoot),
  );
  const canStartScratch =
    availableScratchWorkspaceRoot(connected ? "connected" : "offline", config) !== null;
  const recent = recentConversationForComputer(threads, projects, environmentId);

  async function run(label: string, action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(label);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete this action.");
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  function startProject(project: EnvironmentProject) {
    if (!canStart) return;
    navigation.navigate("NewTaskSheet", {
      screen: "NewTaskDraft",
      params: { environmentId, projectId: project.id, title: project.title },
    });
  }

  function startScratch() {
    if (!canStart || !canStartScratch) return;
    void run("scratch", async () => {
      const result = await openScratch({ environmentId, input: {} });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: { environmentId, projectId: result.value.id, title: result.value.title },
      });
    });
  }

  return (
    <SettingsSection title="Work on this computer">
      <View className="gap-1 px-4 pt-4 pb-2">
        <Text className="text-sm text-foreground-muted">
          {connected
            ? ready === 0
              ? "Agents need setup before starting work."
              : `${ready} ${ready === 1 ? "agent" : "agents"} ready`
            : "Reconnect to start work. Saved conversations remain available."}
        </Text>
        {connected && !canOperate ? (
          <Text className="text-sm text-foreground-muted">
            This connection does not have permission to start work.
          </Text>
        ) : null}
        {error ? (
          <Text selectable className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>
      <SettingsActionRow
        icon="square.and.pencil"
        label="New conversation"
        disabled={!canStart}
        onPress={() => {
          if (machineProjects.length === 0 && canStartScratch) startScratch();
          else setChoosing((value) => !value);
        }}
      />
      {choosing ? (
        <>
          {canStartScratch ? (
            <SettingsActionRow
              icon="text.bubble"
              label="Start without a project"
              disabled={!canStart}
              loading={pending === "scratch"}
              onPress={startScratch}
            />
          ) : null}
          {machineProjects.map((project) => (
            <SettingsActionRow
              key={project.id}
              icon="folder"
              label={project.title}
              disabled={!canStart}
              onPress={() => startProject(project)}
            />
          ))}
          {!canStartScratch && machineProjects.length === 0 ? (
            <Text className="px-4 pb-3 text-sm text-foreground-muted">
              Add a project to start a conversation on this computer.
            </Text>
          ) : null}
        </>
      ) : null}
      <SettingsActionRow
        icon="folder.badge.plus"
        label="Add project"
        disabled={!connected || !canOperate || pending !== null}
        onPress={() =>
          navigation.navigate("NewTaskSheet", { screen: "AddProject", params: { environmentId } })
        }
      />
      {recent ? (
        <SettingsActionRow
          icon="text.bubble"
          label={`Continue: ${recent.title || "Untitled conversation"}`}
          onPress={() => navigation.navigate("Thread", { environmentId, threadId: recent.id })}
        />
      ) : null}
      {connected && ready === 0 ? (
        <SettingsActionRow
          icon="arrow.clockwise"
          label="Check agents"
          disabled={!canRefresh || pending !== null}
          loading={pending === "agents"}
          onPress={() => {
            void run("agents", async () => {
              const result = await refreshProviders({ environmentId, input: {} });
              if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
            });
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
