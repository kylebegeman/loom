import {
  libraryRouteParams,
  projectEntries,
  sortProjectEntries,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ThreadId,
  type KeybindingCommand,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  LIBRARY_SEARCH_FEATURE,
  PROJECT_LIBRARY_FEATURE,
  type LibraryProject,
  type LibraryThreadIndex,
} from "@t3tools/contracts/fork";
import { useNavigate, useParams } from "@tanstack/react-router";
import { FileTextIcon, FolderGit2Icon, SearchIcon, SquarePenIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { openCommandPalette } from "~/commandPaletteBus";

import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "~/components/CommandPalette.logic";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  openLibraryAction,
  requestLibraryBriefEdit,
  requestLibraryHistorySearch,
} from "../project-library/actions";
import {
  LIBRARY_THREAD_INDEX_LIMIT,
  projectLibrary,
  useLibraryPermission,
  useLibraryProjects,
} from "../project-library/state";
import { onForkCommand } from "../keybindings/forkCommandBus";
import type { ForkCommandPaletteSource } from "./registry";

/** Why the Library cannot be used yet. The palette then shows one quiet hint in its place. */
export type LibraryPaletteBlocker =
  | { readonly kind: "setup" }
  | { readonly kind: "unavailable"; readonly reason: string };

export function libraryPaletteBlocker(library: {
  readonly authorityId: string | null;
  readonly isReady: boolean;
  readonly phase: string | undefined;
  readonly connected: boolean;
  readonly supported: boolean;
  /** Live projects already loaded; an offline Library still lists them. */
  readonly hasProjects: boolean;
}): LibraryPaletteBlocker | null {
  if (!library.authorityId) return { kind: "setup" };
  if (!library.connected) {
    if (library.hasProjects) return null;
    const connecting =
      !library.isReady || library.phase === "connecting" || library.phase === "reconnecting";
    return {
      kind: "unavailable",
      reason: connecting ? "Connecting to the Library" : "Reconnect the Library server to use it",
    };
  }
  if (!library.supported)
    return { kind: "unavailable", reason: "Update Loom on the Library server to use it" };
  return null;
}

/** What the Library source needs; null leaves the palette without Library entries. */
export interface LibraryPaletteContext {
  /** Live projects; archived ones stay off the palette. */
  readonly projects: ReadonlyArray<LibraryProject>;
  readonly threadIndex: LibraryThreadIndex | null;
  readonly canStart: boolean;
  readonly canEditBrief: boolean;
  /** The active thread's project, from its live binding or the Library's saved record. */
  readonly threadProjectId: string | null;
  readonly openProject: (projectId: string) => Promise<void>;
  readonly blocker: LibraryPaletteBlocker | null;
  /** The Library page, which walks through setup when no Library is connected. */
  readonly openLibrary: () => Promise<void>;
  /**
   * Focuses history search: the open project page's, otherwise every project's on the Library
   * page. Null when the Library cannot search.
   */
  readonly searchHistory: (() => Promise<void>) | null;
}

const icon = (Icon: typeof FolderGit2Icon, className = ITEM_ICON_CLASS): ReactNode => (
  <Icon className={className} />
);

/** Live projects, most recent activity first. */
function libraryPaletteProjects(library: LibraryPaletteContext) {
  return sortProjectEntries(
    projectEntries(
      library.projects.filter((project) => !project.archived),
      [],
      library.threadIndex,
    ),
    "activity",
  );
}

function projectItems(
  library: LibraryPaletteContext,
  name: string,
  Icon: typeof FolderGit2Icon,
  run: (projectId: string) => Promise<void>,
): CommandPaletteActionItem[] {
  return libraryPaletteProjects(library).map(({ project, activeAt }) => ({
    kind: "action",
    value: `action:loom:library:${name}:${project.id}`,
    title: project.title,
    searchTerms: [project.title],
    timestamp: formatRelativeTimeLabel(activeAt),
    icon: icon(Icon),
    run: () => run(project.id),
  }));
}

export const libraryPaletteSource: ForkCommandPaletteSource = {
  id: "library",
  items: ({ library }) => {
    if (!library) return [];
    if (library.blocker?.kind === "setup")
      return [
        {
          kind: "action",
          value: "action:loom:library:setup",
          title: "Set up Library...",
          searchTerms: ["library", "projects", "connect", "setup"],
          icon: icon(FolderGit2Icon),
          run: library.openLibrary,
        },
      ];
    if (library.blocker)
      return [
        {
          kind: "action",
          value: "action:loom:library:unavailable",
          title: "Library projects",
          description: library.blocker.reason,
          searchTerms: ["library", "projects", "open", "switch"],
          disabled: true,
          icon: icon(FolderGit2Icon),
          run: async () => {},
        },
      ];
    const threadProjectId = library.threadProjectId;
    const submenu = (
      name: string,
      title: string,
      Icon: typeof FolderGit2Icon,
      run: (projectId: string) => Promise<void>,
      extra: {
        readonly searchTerms: ReadonlyArray<string>;
        readonly shortcutCommand?: KeybindingCommand;
      },
    ) => {
      const items = projectItems(library, name, Icon, run);
      if (items.length === 0) return [];
      return [
        {
          kind: "submenu" as const,
          value: `action:loom:library:${name}`,
          title,
          icon: icon(Icon),
          addonIcon: icon(Icon, ADDON_ICON_CLASS),
          groups: [{ value: `library-${name}`, label: "Projects", items }],
          ...extra,
        },
      ];
    };
    return [
      ...(threadProjectId
        ? [
            {
              kind: "action" as const,
              value: "action:loom:library:thread-project",
              title: "Go to this thread's project",
              searchTerms: ["library", "project", "open", "current"],
              icon: icon(FolderGit2Icon),
              run: () => library.openProject(threadProjectId),
            },
          ]
        : []),
      ...submenu("go-to-project", "Go to project...", FolderGit2Icon, library.openProject, {
        searchTerms: ["library", "projects", "open", "switch"],
        shortcutCommand: "loom.library.goToProject",
      }),
      ...(library.searchHistory
        ? [
            {
              kind: "action" as const,
              value: "action:loom:library:search-history",
              title: "Search project history...",
              searchTerms: ["library", "search", "history", "conversations", "messages", "find"],
              icon: icon(SearchIcon),
              run: library.searchHistory,
            },
          ]
        : []),
      // The New conversation chooser is the one place a project is picked to start in: Enter
      // starts with the defaults its row shows, and No project leads it.
      ...(library.canStart && libraryPaletteProjects(library).length
        ? [
            {
              kind: "action" as const,
              value: "action:loom:library:new-conversation",
              title: "New conversation in...",
              searchTerms: ["library", "project", "new thread", "chat", "start"],
              shortcutCommand: "loom.library.newConversationIn" as const,
              icon: icon(SquarePenIcon),
              run: async () => {
                openLibraryAction("new-conversation");
              },
            },
          ]
        : []),
      ...(library.canEditBrief
        ? submenu(
            "project-brief",
            "Open project brief...",
            FileTextIcon,
            async (projectId) => {
              requestLibraryBriefEdit(projectId);
              await library.openProject(projectId);
            },
            { searchTerms: ["library", "project", "brief", "edit", "context"] },
          )
        : []),
    ];
  },
  // Typing part of a project's name finds it beside computer folders, so Enter opens it.
  searchItems: ({ library }) =>
    library && !library.blocker
      ? projectItems(library, "project", FolderGit2Icon, library.openProject).map((item) => ({
          ...item,
          description: "Library project",
        }))
      : [],
};

/** Projects, blocker and start permission, shared by the palette and the Library shortcuts. */
function useLibraryPaletteState() {
  const catalog = useLibraryProjects();
  const projects = catalog.query.data ?? [];
  const liveProjects = projects.filter((project) => !project.archived).length;
  const { authorityId, isReady, connected, supported } = catalog;
  const phase = catalog.environment?.connection.phase;
  const hasProjects = liveProjects > 0;
  // Stable across renders so the shortcut listeners only resubscribe when it changes.
  const blocker = useMemo(
    () => libraryPaletteBlocker({ authorityId, isReady, phase, connected, supported, hasProjects }),
    [authorityId, isReady, phase, connected, supported, hasProjects],
  );
  const canRegister = useLibraryPermission(projectLibrary.registerThread, catalog.authorityId);
  return {
    catalog,
    projects,
    blocker,
    canStart: catalog.offline ? hasProjects : canRegister && catalog.connected,
    // Unknown until the first page loads; a failed load leaves nothing to pick.
    liveProjects: catalog.query.data || catalog.query.error ? liveProjects : null,
  };
}

/** Resolves the active thread's project the way New conversation does, live or from the Library. */
export function useLibraryPaletteContext(
  activeThreadRef: ScopedThreadRef | null,
  query = "",
): LibraryPaletteContext {
  const { catalog, projects, blocker, canStart } = useLibraryPaletteState();
  const { authorityId, connected, environments } = catalog;
  const canSearch =
    connected &&
    supportsLoomFeature(
      catalog.environment?.serverConfig?.environment.capabilities,
      LIBRARY_SEARCH_FEATURE,
    );
  const navigate = useNavigate();
  // Route params cover a thread whose computer is offline and so absent from the store.
  const params = libraryRouteParams(useParams({ strict: false }));
  const thread =
    params.environmentId && params.threadId
      ? scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId))
      : activeThreadRef;
  const host = thread
    ? environments.find((entry) => entry.environmentId === thread.environmentId)
    : undefined;
  const live =
    host?.connection.phase === "connected" &&
    supportsLoomFeature(host.serverConfig?.environment.capabilities, PROJECT_LIBRARY_FEATURE);
  const binding = useEnvironmentQuery(
    authorityId && thread && live
      ? projectLibrary.threadBinding({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId },
        })
      : null,
  );
  const saved = useEnvironmentQuery(
    authorityId && thread && !live
      ? projectLibrary.lookupThread({
          environmentId: authorityId,
          input: { sourceEnvironmentId: thread.environmentId, threadId: thread.threadId },
        })
      : null,
  );
  // A cached "no project" can predate the thread's binding, so the palette asks again on open.
  const record = live ? binding : saved;
  const [openedAt] = useState(() => Date.now());
  const recheck = record.isSuccess && record.data === null && record.dataUpdatedAt < openedAt;
  const refreshRecord = record.refresh;
  useEffect(() => {
    if (recheck) refreshRecord();
  }, [recheck, refreshRecord]);
  const threadIndex = useEnvironmentQuery(
    authorityId
      ? projectLibrary.threadIndex({
          environmentId: authorityId,
          input: { limit: LIBRARY_THREAD_INDEX_LIMIT },
        })
      : null,
  );
  const canUpdate = useLibraryPermission(projectLibrary.updateProject, authorityId);
  return {
    projects,
    threadIndex: threadIndex.data,
    canStart,
    canEditBrief: canUpdate && connected,
    threadProjectId: record.data?.projectId ?? null,
    openProject: async (projectId) => {
      await navigate({ to: "/library/$projectId", params: { projectId } });
    },
    blocker,
    openLibrary: async () => {
      await navigate({ to: "/library" });
    },
    searchHistory: canSearch
      ? async () => {
          const projectId = record.data?.projectId ?? params.projectId;
          requestLibraryHistorySearch(projectId, query);
          // The project's search field lives on its Conversations view.
          await (projectId
            ? navigate({
                to: "/library/$projectId",
                params: { projectId },
                search: { view: "conversations" },
              })
            : navigate({ to: "/library" }));
        }
      : null,
  };
}

const LIBRARY_SHORTCUTS = ["loom.library.goToProject", "loom.library.newConversationIn"] as const;

export type LibraryShortcutCommand = (typeof LIBRARY_SHORTCUTS)[number];

/**
 * What a Library shortcut does: Go to project opens the palette's project picker, or the Library
 * page when there is nothing to pick, and New conversation in opens the New conversation chooser.
 * Both walk through setup when no Library is connected, and do nothing when the action is not
 * permitted, like upstream's permission-gated preview shortcuts.
 */
export function libraryShortcutAction(
  command: LibraryShortcutCommand,
  library: {
    readonly blocker: LibraryPaletteBlocker | null;
    readonly canStart: boolean;
    /** Null while the first page of projects loads; the palette then waits for its picker. */
    readonly liveProjects: number | null;
  },
): "projects" | "library" | "new-conversation" | null {
  const setup = library.blocker?.kind === "setup";
  if (library.blocker && !setup) return null;
  if (command === "loom.library.newConversationIn")
    return setup || library.canStart ? "new-conversation" : null;
  return setup || library.liveProjects === 0 ? "library" : "projects";
}

/** Handles the Library shortcuts with the same rules the palette uses for its Library entries. */
export function useLibraryShortcuts() {
  const { blocker, canStart, liveProjects } = useLibraryPaletteState();
  const navigate = useNavigate();
  useEffect(() => {
    const unsubscribes = LIBRARY_SHORTCUTS.map((command) =>
      onForkCommand(command, () => {
        const action = libraryShortcutAction(command, { blocker, canStart, liveProjects });
        if (action === "projects")
          openCommandPalette({ submenu: "action:loom:library:go-to-project" });
        // Both walk through setup when no Library is connected yet.
        else if (action === "library") void navigate({ to: "/library" });
        else if (action === "new-conversation") openLibraryAction("new-conversation");
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [blocker, canStart, liveProjects, navigate]);
}
