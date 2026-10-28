import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { noProjectWorkspaceRoot } from "@t3tools/client-runtime/fork";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useSelectWorkspaceDetail } from "../../features/workspace/useSelectWorkspaceDetail";
import { uuidv4 } from "../../lib/uuid";
import { useProjects, useNavigationThreadShells } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
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
  const selectDetail = useSelectWorkspaceDetail();
  const startDraft = (projectId: string, title: string) =>
    selectDetail({
      name: "Thread",
      params: { draft: { requestId: uuidv4(), environmentId, projectId, title } },
    });
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
    noProjectWorkspaceRoot(connected ? "connected" : "offline", config) !== null;
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
    startDraft(project.id, project.title);
  }

  function startScratch() {
    if (!canStart || !canStartScratch) return;
    void run("scratch", async () => {
      const result = await openScratch({ environmentId, input: {} });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      startDraft(result.value.id, result.value.title);
    });
  }

  return (
    <SettingsSection title="Work on this computer">
      <View className="gap-1 px-4 pt-4 pb-2">
        <Text className="text-sm text-foreground-muted">
          {connected
            ? ready === 0
              ? "Install and sign in to an agent in Loom on this computer to start work."
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
        loading={pending === "scratch"}
        onPress={() => {
          if (!canStart) return;
          if (machineProjects.length === 0) {
            if (canStartScratch) startScratch();
            else {
              navigation.navigate("AddProject", { environmentId });
            }
          } else if (machineProjects.length === 1 && !canStartScratch) {
            startProject(machineProjects[0]!);
          } else setChoosing((value) => !value);
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
        onPress={() => navigation.navigate("AddProject", { environmentId })}
      />
      {recent ? (
        <SettingsActionRow
          icon="text.bubble"
          label={`Continue: ${recent.title || "Untitled conversation"}`}
          onPress={() =>
            selectDetail({ name: "Thread", params: { environmentId, threadId: recent.id } })
          }
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
