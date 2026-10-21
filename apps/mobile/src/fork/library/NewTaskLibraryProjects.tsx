import { StackActions, useNavigation } from "@react-navigation/native";
import { libraryHoldsLocalRefs, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { CommandId, ThreadId } from "@t3tools/contracts";
import type { LibraryProject } from "@t3tools/contracts/fork";
import { useRef } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { NavigationRow } from "../../components/ui/NavigationRow";
import { useEnvironmentQuery } from "../../state/query";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { threadEnvironment } from "../../state/threads";
import { uuidv4 } from "../../lib/uuid";
import * as Dialog from "../../components/ui/Dialog";
import { checkoutNewTaskBranch } from "../../features/threads/checkout-new-task-branch";
import { resolveNewTaskBranchWorktreePath } from "../../features/threads/new-task-context-presentation";
import {
  librarySourceLaunchParams,
  librarySourceProjectContext,
  sourceConversationSettings,
  type LibrarySourceContext,
} from "./librarySourceLaunch";
import { library, useLibraryAuthority } from "./libraryState";

/** Library projects use their normal computer and files form without inheriting a thread. */
export function useNewTaskLibraryProjects(input: {
  readonly hasRouteParams: boolean;
  readonly searchText: string;
}) {
  const authority = useLibraryAuthority();
  const sharedProjects = useEnvironmentQuery(
    authority.environmentId
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: false },
        })
      : null,
  );
  const sharedCopies = useEnvironmentQuery(
    authority.environmentId
      ? library.copies({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const query = input.searchText.trim().toLocaleLowerCase();
  const choices = (sharedProjects.data ?? []).filter((project) =>
    project.title.toLocaleLowerCase().includes(query),
  );
  const holdsLocalRefs = (refs: readonly { environmentId: string; projectId: string }[]) =>
    libraryHoldsLocalRefs([], refs, sharedCopies.data ?? []);

  return { choices, error: sharedProjects.error, holdsLocalRefs };
}

/** Library projects offered above the local project list; each opens the Library start flow. */
export function NewTaskLibraryProjectChoices(props: {
  readonly choices: readonly LibraryProject[];
  readonly error: string | null;
}) {
  const navigation = useNavigation();
  return (
    <>
      {props.choices.length > 0 ? (
        <View className="overflow-hidden rounded-2xl bg-grouped-card">
          {props.choices.map((project) => (
            <NavigationRow
              key={project.id}
              title={project.title}
              subtitle={
                project.brief.trim().split("\n")[0] ||
                `${project.resources.filter((resource) => resource.kind !== "link").length} repository components`
              }
              onPress={() =>
                navigation
                  .getParent()
                  ?.dispatch(StackActions.replace("LibraryStart", { projectId: project.id }))
              }
            />
          ))}
        </View>
      ) : null}
      {props.error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
          {props.error}
        </Text>
      ) : null}
    </>
  );
}

/** Source actions carry settings, while ordinary New task actions keep project defaults. */
export function useNewTaskFromSource() {
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const binding = useAtomQueryRunner(library.threadBinding, {
    refresh: true,
    reportFailure: false,
  });
  const lookup = useAtomQueryRunner(library.lookupThread, { refresh: true, reportFailure: false });
  const copies = useAtomQueryRunner(library.copies, { refresh: true, reportFailure: false });
  const project = useAtomQueryRunner(library.project, { refresh: true, reportFailure: false });
  const readRefs = useAtomCommand(vcsEnvironment.readRefs, { reportFailure: false });
  const switchRef = useAtomCommand(vcsEnvironment.switchRef, { reportFailure: false });
  const create = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const opening = useRef(false);
  return async (source: EnvironmentThreadShell) => {
    if (opening.current) return;
    opening.current = true;
    const open = async () => {
      const host = environments.find((entry) => entry.environmentId === source.environmentId);
      if (authority.environmentId && !source.branch && !source.worktreePath) {
        const live =
          host?.connection.phase === "connected" &&
          supportsLoomFeature(host.serverConfig?.environment.capabilities, "project-library")
            ? await binding({ environmentId: source.environmentId, input: { threadId: source.id } })
            : null;
        let context: LibrarySourceContext | null = live?._tag === "Success" ? live.value : null;
        if (!context) {
          const saved = await lookup({
            environmentId: authority.environmentId,
            input: { sourceEnvironmentId: source.environmentId, threadId: source.id },
          });
          if (saved._tag === "Success" && saved.value) context = saved.value;
        }
        if (!context) {
          const registered = await copies({ environmentId: authority.environmentId, input: {} });
          if (registered._tag === "Success")
            context = librarySourceProjectContext(source, registered.value);
        }
        if (context) {
          const shared = await project({
            environmentId: authority.environmentId,
            input: { projectId: context.projectId },
          });
          const params =
            shared._tag === "Success"
              ? librarySourceLaunchParams(source, context, shared.value)
              : null;
          if (params) {
            navigation.navigate("LibraryStart", params);
            return;
          }
        }
      }
      let checkout = source;
      if (source.branch && !source.worktreePath && host?.connection.phase === "connected") {
        const local = projects.find(
          (entry) => entry.environmentId === source.environmentId && entry.id === source.projectId,
        );
        if (!local)
          throw new Error(
            "Reconnect the source computer to load its project before starting a conversation.",
          );
        const prepared = await checkoutNewTaskBranch({
          branch: { name: source.branch, current: false, isDefault: false, worktreePath: null },
          project: local,
          workspaceMode: "local",
          readRefs,
          switchRef,
        });
        if (prepared._tag === "Failure") throw squashAtomCommandFailure(prepared);
        checkout = {
          ...source,
          branch: prepared.value.name,
          worktreePath: resolveNewTaskBranchWorktreePath({
            workspaceMode: "local",
            projectCwd: local.workspaceRoot,
            branchWorktreePath: prepared.value.worktreePath,
          }),
        };
      }
      const threadId = ThreadId.make(uuidv4());
      const created = await create({
        environmentId: source.environmentId,
        input: {
          commandId: CommandId.make(uuidv4()),
          threadId,
          projectId: source.projectId,
          title: "New conversation",
          ...sourceConversationSettings(checkout),
        },
      });
      if (created._tag === "Failure") throw squashAtomCommandFailure(created);
      navigation.navigate("Thread", { environmentId: source.environmentId, threadId });
    };
    try {
      await open();
    } catch (cause) {
      opening.current = false;
      Dialog.alert(
        "Could not start a conversation",
        cause instanceof Error
          ? cause.message
          : "The source settings could not be loaded. Try again.",
      );
      return;
    }
    opening.current = false;
  };
}
