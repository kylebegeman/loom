import { StackActions, useNavigation } from "@react-navigation/native";
import {
  libraryHoldsLocalRefs,
  supportsLoomFeature,
  libraryStartIntent,
  libraryStartRepositoryProjects,
  rankLibraryStartProjects,
} from "@t3tools/client-runtime/fork";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  CommandId,
  ThreadId,
} from "@t3tools/contracts";
import { LIBRARY_DEFAULT_CONVERSATION_TITLE, type LibraryProject } from "@t3tools/contracts/fork";
import { useMemo, useRef } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { NavigationRow } from "../../components/ui/NavigationRow";
import { useEnvironmentQuery } from "../../state/query";
import { useProjects, useServerConfigs, useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentsWithScope } from "../../state/session";
import { useStickyComposerModelSelection } from "../../state/use-composer-drafts";
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
import { libraryStartDefaults, type LibraryStartDefaults } from "./libraryStartDefaults";

/** Library projects use their normal computer and files form without inheriting a thread. */
export function useNewTaskLibraryProjects(input: {
  readonly searchText: string;
  /** The Library project in view where New task was opened. */
  readonly suggestedProjectId?: string | undefined;
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
  const recent = useEnvironmentQuery(
    authority.environmentId
      ? library.threadIndex({ environmentId: authority.environmentId, input: { limit: 200 } })
      : null,
  );
  const intent = libraryStartIntent(input.searchText);
  const associated =
    intent.kind === "repository"
      ? libraryStartRepositoryProjects(sharedProjects.data ?? [], intent.url)
      : [];
  const query = input.searchText.trim().toLocaleLowerCase();
  const choices = rankLibraryStartProjects(
    sharedProjects.data ?? [],
    recent.data?.threads ?? [],
  ).filter(
    (project) =>
      associated.some((entry) => entry.id === project.id) ||
      `${project.title} ${project.brief} ${project.resources.map((resource) => resource.remoteUrl ?? resource.title).join(" ")}`
        .toLocaleLowerCase()
        .includes(query),
  );
  const holdsLocalRefs = (refs: readonly { environmentId: string; projectId: string }[]) =>
    libraryHoldsLocalRefs([], refs, sharedCopies.data ?? []);
  const { environments } = useEnvironments();
  const operable = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  const terminal = useEnvironmentsWithScope(environments, AuthTerminalOperateScope);
  const libraryRef = useMemo(
    () => (authority.environmentId ? [{ environmentId: authority.environmentId }] : []),
    [authority.environmentId],
  );
  const libraryOperable =
    useEnvironmentsWithScope(libraryRef, AuthOrchestrationOperateScope).size > 0;
  const configs = useServerConfigs();
  const localProjects = useProjects();
  const lastUsedSelection = useStickyComposerModelSelection();
  const shells = useThreadShells();
  // Keyed by project and independent of the search text, so typing only filters. The computers
  // are listed as web lists them, so both promise the same computer for a project.
  const starts = useMemo(() => {
    const hosts = environments.map((entry) => {
      const capabilities = entry.serverConfig?.environment.capabilities;
      return {
        environmentId: entry.environmentId,
        label: entry.label,
        online: entry.entry.enabled && entry.connection.phase === "connected",
        supportsExecution:
          capabilities?.supportsExecution !== false &&
          supportsLoomFeature(capabilities, "project-library"),
        capabilities,
      };
    });
    return new Map(
      (sharedProjects.data ?? []).map((project) => [
        project.id,
        libraryStartDefaults({
          project,
          copies: sharedCopies.data ?? [],
          threads: recent.data?.threads ?? [],
          hosts,
          remembered: authority.computers,
          operable,
          terminal,
          libraryOperable,
          configs,
          localProject: (environmentId, projectId) =>
            localProjects.find(
              (entry) => entry.environmentId === environmentId && entry.id === projectId,
            ) ?? null,
          lastUsedSelection,
          shells,
        }),
      ]),
    );
  }, [
    sharedProjects.data,
    sharedCopies.data,
    recent.data,
    environments,
    operable,
    terminal,
    libraryOperable,
    configs,
    localProjects,
    authority.computers,
    lastUsedSelection,
    shells,
  ]);

  const rows = choices.map((project) => ({ project, start: starts.get(project.id) ?? null }));
  return {
    // The project in view only leads, as on web: every other project and No project stay a tap
    // away, and a suggestion the catalog no longer lists is left out rather than reported.
    suggested: rows.filter((row) => row.project.id === input.suggestedProjectId),
    choices: rows.filter((row) => row.project.id !== input.suggestedProjectId),
    error: sharedProjects.error,
    holdsLocalRefs,
  };
}

/**
 * Library projects offered above the local project list. A tap starts with the defaults its row
 * shows; the options button, or a tap on a project that needs a decision, opens the start screen.
 */
export function NewTaskLibraryProjectChoices(props: {
  readonly choices: readonly {
    readonly project: LibraryProject;
    readonly start: LibraryStartDefaults | null;
  }[];
  readonly error: string | null;
}) {
  const navigation = useNavigation();
  // Options open on the computer and files the row named, so both show the same defaults.
  const open = (project: LibraryProject, start: LibraryStartDefaults | null, startNow: boolean) =>
    navigation.getParent()?.dispatch(
      StackActions.replace(
        "LibraryStart",
        start
          ? {
              projectId: project.id,
              reuseEnvironmentId: start.environmentId,
              initialCopyId: start.copyId,
              startNow,
            }
          : { projectId: project.id },
      ),
    );
  return (
    <>
      {props.choices.length > 0 ? (
        <View className="overflow-hidden rounded-2xl bg-grouped-card">
          {props.choices.map(({ project, start }) => (
            <NavigationRow
              key={project.id}
              title={project.title}
              subtitle={
                start?.summary ??
                (project.brief.trim().split("\n")[0] ||
                  `${project.resources.filter((resource) => resource.kind !== "link").length} repository components`)
              }
              onPress={() => open(project, start, true)}
              trailing={
                start ? (
                  <IconButton
                    accessibilityLabel={`Conversation options for ${project.title}`}
                    icon="slider.horizontal.3"
                    onPress={() => open(project, start, false)}
                  />
                ) : undefined
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
      if (authority.environmentId) {
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
          title: LIBRARY_DEFAULT_CONVERSATION_TITLE,
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
