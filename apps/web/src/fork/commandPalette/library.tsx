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
  PROJECT_LIBRARY_FEATURE,
  type LibraryProject,
  type LibraryThreadIndex,
} from "@t3tools/contracts/fork";
import { useNavigate, useParams } from "@tanstack/react-router";
import { FileTextIcon, FolderGit2Icon, SquarePenIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "~/components/CommandPalette.logic";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { openLibraryAction, requestLibraryBriefEdit } from "../project-library/actions";
import { projectLibrary, useLibraryPermission, useLibraryProjects } from "../project-library/state";
import type { ForkCommandPaletteSource } from "./registry";

// The Projects page asks for the same page of the index, so both read one cached result.
const THREAD_INDEX_LIMIT = 100;

/** What the Library source needs; null when no Library is configured. */
export interface LibraryPaletteContext {
  /** Live projects; archived ones stay off the palette. */
  readonly projects: ReadonlyArray<LibraryProject>;
  readonly threadIndex: LibraryThreadIndex | null;
  readonly canStart: boolean;
  readonly canEditBrief: boolean;
  /** The active thread's project, from its live binding or the Library's saved record. */
  readonly threadProjectId: string | null;
  readonly openProject: (projectId: string) => Promise<void>;
}

const icon = (Icon: typeof FolderGit2Icon, className = ITEM_ICON_CLASS): ReactNode => (
  <Icon className={className} />
);

/** Live projects, most recent activity first. */
export function libraryPaletteProjects(library: LibraryPaletteContext) {
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
      ...(library.canStart
        ? submenu(
            "new-conversation",
            "New conversation in...",
            SquarePenIcon,
            async (projectId) => {
              openLibraryAction("new-conversation", projectId);
            },
            {
              searchTerms: ["library", "project", "new thread", "chat", "start"],
              shortcutCommand: "loom.library.newConversationIn",
            },
          )
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
    library
      ? projectItems(library, "project", FolderGit2Icon, library.openProject).map((item) => ({
          ...item,
          description: "Library project",
        }))
      : [],
};

/** Resolves the active thread's project the way New conversation does, live or from the Library. */
export function useLibraryPaletteContext(
  activeThreadRef: ScopedThreadRef | null,
): LibraryPaletteContext | null {
  const catalog = useLibraryProjects();
  const { authorityId, connected, environments } = catalog;
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
          input: { limit: THREAD_INDEX_LIMIT },
        })
      : null,
  );
  const canRegister = useLibraryPermission(projectLibrary.registerThread, authorityId);
  const canUpdate = useLibraryPermission(projectLibrary.updateProject, authorityId);
  if (!authorityId) return null;
  return {
    projects: catalog.query.data ?? [],
    threadIndex: threadIndex.data,
    canStart: canRegister && connected,
    canEditBrief: canUpdate && connected,
    threadProjectId: record.data?.projectId ?? null,
    openProject: async (projectId) => {
      await navigate({ to: "/library/$projectId", params: { projectId } });
    },
  };
}
