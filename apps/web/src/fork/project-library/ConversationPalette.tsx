import { LibraryCloneRepair } from "../vault/LibraryCloneRepair";
import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckIcon,
  FolderIcon,
  GitBranchIcon,
  MonitorIcon,
  SettingsIcon,
  PlayIcon,
  BotIcon,
  RotateCcwIcon,
} from "lucide-react";
import { isRepositoryResource, LIBRARY_FOLDER_CHOICE_TITLES } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, ModelSelection, RuntimeMode } from "@t3tools/contracts";
import {
  getProviderOptionDescriptors,
  getProviderOptionCurrentLabel,
  buildProviderOptionSelectionsFromDescriptors,
  modelSelectionsEqual,
} from "@t3tools/shared/model";
import { getProviderModelCapabilities } from "~/providerModels";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { runtimeModeConfig, runtimeModeOptions } from "~/components/chat/runtimeModeConfig";
import { LibraryModelPalette } from "./LibraryModelPalette";
import { LibraryTextPalette } from "./LibraryTextPalette";
import { LibraryPaletteView, type LibraryPaletteItem } from "./LibraryPalette";
import { ProfileReadiness } from "./ProfileReadiness";
import { LibraryFolderPalette, libraryFolderActions } from "./LibraryFolderPalette";
import type { useLibraryConversationSetup } from "./NewConversationDialog";

type Setup = ReturnType<typeof useLibraryConversationSetup>;

/** The computer, files, model and permissions a project row promised to start with. */
export interface ConversationQuickStart {
  readonly environmentId: EnvironmentId;
  readonly workingCopyId: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
}

/** A start the project list asked for, run once the settings it promised are settled. */
export interface ConversationAutoStart {
  readonly launch: ConversationQuickStart;
  /** Called once the conversation starts, or its settings are shown instead. */
  readonly settle: () => void;
}

export const ConversationAutoStartContext = createContext<ConversationAutoStart | null>(null);

/**
 * Whether a start the project list promised can run now. It runs only when the settings match
 * the promise and nothing would be worth reading first. "settings" means the screen already shows
 * why it cannot start, and "changed" means the settings no longer match what the row showed.
 */
export function conversationAutoStart(
  setup: Pick<
    Setup,
    | "busy"
    | "checking"
    | "locked"
    | "error"
    | "existingFolder"
    | "hostId"
    | "canCreate"
    | "blocker"
    | "warning"
    | "copy"
    | "scope"
    | "needsReopen"
    | "needsPortable"
    | "interactionMode"
    | "runtimeMode"
    | "modelSelection"
  >,
  launch: ConversationQuickStart,
): "wait" | "start" | "settings" | "changed" {
  if (setup.busy) return "wait";
  // A failure or held attempt is final, so it never waits on files and never retries by itself.
  if (setup.locked || setup.error || setup.existingFolder) return "settings";
  if (setup.checking) return "wait";
  if (!setup.canCreate || setup.blocker || setup.warning) return "settings";
  return setup.hostId === launch.environmentId &&
    setup.copy?.id === launch.workingCopyId &&
    setup.copy.state === "ready" &&
    !setup.needsReopen &&
    !setup.needsPortable &&
    setup.scope.length === 0 &&
    setup.interactionMode === "default" &&
    setup.runtimeMode === launch.runtimeMode &&
    setup.modelSelection !== null &&
    modelSelectionsEqual(setup.modelSelection, launch.modelSelection)
    ? "start"
    : "changed";
}
type Page =
  | "start"
  | "computers"
  | "files"
  | "browse"
  | "path"
  | "models"
  | "options"
  | "permissions"
  | "mode"
  | "scope"
  | "workspace"
  | "title"
  | "context";

export function ConversationPalette({ setup: s }: { readonly setup: Setup }) {
  const [page, setPage] = useState<Page>("start");
  const [search, setSearch] = useState("");
  const [optionId, setOptionId] = useState<string | null>(null);
  const auto = use(ConversationAutoStartContext);
  const settled = useRef(false);
  // Outlives the decision, so settings that no longer match the row say so until the user edits.
  const [promise, setPromise] = useState(auto?.launch ?? null);
  const autoStart = auto ? conversationAutoStart(s, auto.launch) : null;
  // A decided start reads as starting until the submit marks the setup busy.
  const waiting = autoStart === "wait" || autoStart === "start";
  // The ref keeps a start that was already decided from running twice before the host clears it.
  const finish = (start: boolean) => {
    if (!auto || settled.current) return;
    settled.current = true;
    auto.settle();
    if (start) void s.submit();
  };
  const decide = useEffectEvent((start: boolean) => finish(start));
  useEffect(() => {
    if (autoStart !== null && autoStart !== "wait") decide(autoStart === "start");
  }, [autoStart]);
  // Any other choice means the user is changing settings, so the promised start is off.
  const leave = () => {
    finish(false);
    setPromise(null);
  };
  const go = (next: Page) => {
    leave();
    setSearch("");
    setOptionId(null);
    setPage(next);
  };
  const back = () => {
    if (page === "start") s.onChooseProject?.();
    else if (page === "browse" || page === "path") go("files");
    else if (page === "options" && optionId) {
      setOptionId(null);
      setSearch("");
    } else go("start");
  };
  const close = () => {
    if (!s.busy) s.onClose();
  };
  const provider = s.providerEntry;
  const descriptors =
    provider && s.modelSelection
      ? getProviderOptionDescriptors({
          caps: getProviderModelCapabilities(
            provider.models,
            s.modelSelection.model,
            provider.driverKind,
            s.interactionMode === "plan",
          ),
          selections: s.modelSelection.options,
        })
      : [];
  const modelName =
    provider?.models.find((model) => model.slug === s.modelSelection?.model)?.name ??
    s.modelSelection?.model;
  const selectOption = (id: string, value: string | boolean) => {
    if (!s.modelSelection) return;
    const next = descriptors.map((descriptor) =>
      descriptor.id !== id
        ? descriptor
        : descriptor.type === "boolean" && typeof value === "boolean"
          ? { ...descriptor, currentValue: value }
          : descriptor.type === "select" && typeof value === "string"
            ? { ...descriptor, currentValue: value }
            : descriptor,
    );
    s.setModelChoice({
      ...s.modelSelection,
      options: [
        ...(s.modelSelection.options ?? []).filter(
          (option) => !descriptors.some((descriptor) => descriptor.id === option.id),
        ),
        ...(buildProviderOptionSelectionsFromDescriptors(next) ?? []),
      ],
    });
    setOptionId(null);
    setSearch("");
  };
  const edit = (
    next: Page,
    title: string,
    description?: string,
    icon?: ReactNode,
  ): LibraryPaletteItem => ({
    id: next,
    title,
    description,
    icon: icon ?? <SettingsIcon className="size-4 text-(--project-gold)" />,
    next: true,
    disabled: s.locked,
    select: () => go(next),
  });
  const activeInstanceId = s.modelSelection?.instanceId ?? s.entries[0]?.instanceId;
  if (page === "models" && activeInstanceId)
    return (
      <LibraryModelPalette
        environmentId={s.hostId}
        activeInstanceId={activeInstanceId}
        instanceEntries={s.entries}
        modelOptionsByInstance={s.modelOptionsByInstance}
        selection={s.modelSelection}
        onSelect={(selection) => {
          s.setModelChoice(selection);
          go("start");
        }}
        onBack={back}
        onClose={close}
      />
    );
  if (page === "context")
    return (
      <LibraryTextPalette
        title="Context to carry forward"
        value={s.context}
        onChange={s.setContext}
        onBack={back}
        onClose={close}
      />
    );
  if (page === "browse" && s.hostId)
    return (
      <LibraryFolderPalette
        environmentId={s.hostId}
        computerName={s.hostLabel ?? "Computer"}
        initialPath={s.browseStart}
        onBack={back}
        onClose={close}
        actions={(folder) =>
          folder
            ? libraryFolderActions(folder, s.project.title, (path) => {
                s.selectFolder(path);
                go("start");
              })
            : []
        }
      />
    );
  let items: LibraryPaletteItem[];
  if (page === "models") items = [];
  else if (page === "computers")
    items = [
      ...s.executionHosts.map((host) => ({
        id: host.environmentId,
        title: host.label,
        selected: host.environmentId === s.hostId,
        description:
          host.connection.phase === "connected"
            ? "Run this conversation here"
            : "Reconnect this computer first",
        icon: <MonitorIcon className="size-4 text-(--project-blue)" />,
        disabled: !host.entry.enabled || host.connection.phase !== "connected",
        select: () => {
          s.selectHost(host.environmentId);
          go("start");
        },
      })),
      ...s.computers
        .filter(
          (computer) =>
            computer.supportsExecution &&
            !s.executionHosts.some((host) => host.environmentId === computer.environmentId),
        )
        .map((computer) => ({
          id: computer.environmentId,
          title: computer.label,
          description: "Connect this computer first",
          disabled: true,
          select: () => {},
        })),
    ];
  else if (page === "files")
    items = [
      ...(s.sourcePlan.kind === "choose" ? s.sourcePlan.candidates : s.candidates).map((copy) => ({
        id: copy.id,
        selected: copy.id === s.copy?.id,
        title: copy.rootPath,
        description:
          copy.state === "ready" ? "Existing project files" : "Restore saved project files",
        icon: <FolderIcon className="size-4 text-(--project-teal)" />,
        select: () => {
          s.selectCopy(copy.id);
          go("start");
        },
      })),
      edit(
        "browse",
        s.serverPlaces ? "Choose another folder" : "Browse computer folders",
        s.filesLine ?? "Choose an existing folder on the selected computer",
        <FolderIcon className="size-4 text-(--project-teal)" />,
      ),
      // A computer that chooses folders needs no typed path; the browser still accepts one.
      ...(s.serverPlaces
        ? []
        : [edit("path", "Set files location", s.rootPath || "Choose where to prepare new files")]),
      ...(s.canKeep
        ? [
            {
              id: "keep",
              title: s.keepOnComputer
                ? "Allow cleanup when settled"
                : "Keep files on this computer",
              description: s.keepOnComputer
                ? "Files currently stay on this computer"
                : "Finished work can be cleaned up to free space",
              select: () => s.setKeepChoice(!s.keepOnComputer),
            },
          ]
        : []),
    ];
  else if (page === "path")
    items = [
      {
        id: "path",
        title: "Use this files location",
        description: s.rootPath,
        disabled: !s.rootPath.trim(),
        select: () => go("start"),
      },
    ];
  else if (page === "options") {
    const descriptor = descriptors.find((entry) => entry.id === optionId);
    items = descriptor
      ? descriptor.type === "boolean"
        ? [true, false].map((value) => ({
            id: String(value),
            title: value ? "On" : "Off",
            selected: value === descriptor.currentValue,
            select: () => selectOption(descriptor.id, value),
          }))
        : descriptor.options.map((option) => ({
            id: option.id,
            title: option.label,
            selected:
              option.id === descriptor.currentValue ||
              (descriptor.currentValue === undefined && option.isDefault === true),
            select: () => selectOption(descriptor.id, option.id),
          }))
      : descriptors.map((descriptor) => ({
          id: descriptor.id,
          title: descriptor.label,
          description: getProviderOptionCurrentLabel(descriptor) ?? "Default",
          next: true,
          select: () => {
            setSearch("");
            setOptionId(descriptor.id);
          },
        }));
  } else if (page === "permissions")
    items = runtimeModeOptions.map((mode) => ({
      id: mode,
      selected: mode === s.runtimeMode,
      title: runtimeModeConfig[mode].label,
      description: runtimeModeConfig[mode].description,
      select: () => {
        s.setRuntimeChoice(mode);
        go("start");
      },
    }));
  else if (page === "mode")
    items = [
      {
        id: "default",
        selected: s.interactionMode === "default",
        title: "Do the work",
        description: "The agent can act within the task and selected permissions",
        select: () => {
          s.setInteractionChoice("default");
          go("start");
        },
      },
      {
        id: "plan",
        selected: s.interactionMode === "plan",
        title: "Plan only",
        description: "Discuss and inspect before making changes",
        select: () => {
          s.setInteractionChoice("plan");
          go("start");
        },
      },
    ];
  else if (page === "scope")
    items = [
      {
        id: "whole",
        selected: s.scope.length === 0,
        title: "Whole project",
        select: () => {
          s.selectScope(null);
          go("start");
        },
      },
      ...s.project.resources.filter(isRepositoryResource).map((resource) => ({
        id: resource.id,
        selected: s.scope.includes(resource.id),
        title: resource.title,
        description: resource.remoteUrl ?? resource.relativePath,
        select: () => {
          s.selectScope(resource.id);
          go("start");
        },
      })),
    ];
  else if (page === "workspace")
    items = [
      {
        id: "folder",
        selected: s.workspace === "folder",
        title: "Project folder",
        description: "Work in the project's files, alongside other conversations there",
        icon: <FolderIcon className="size-4 text-(--project-teal)" />,
        select: () => {
          s.setWorkspaceChoice("folder");
          go("start");
        },
      },
      {
        id: "worktree",
        selected: s.workspace === "worktree",
        title: "New worktree",
        description: "Work on a branch of its own, so other conversations' changes stay apart",
        icon: <GitBranchIcon className="size-4 text-(--project-teal)" />,
        select: () => {
          s.setWorkspaceChoice("worktree");
          go("start");
        },
      },
    ];
  else if (page === "title")
    items = [
      {
        id: "keep-text",
        title: "Keep this title",
        icon: <CheckIcon className="size-4" />,
        select: () => go("start"),
      },
    ];
  else
    items = [
      {
        id: "start",
        title:
          s.busy || waiting
            ? (s.operationPhase ?? "Starting...")
            : s.held
              ? s.held.title
                ? `Retry “${s.held.title}”`
                : "Retry untitled conversation"
              : "Start conversation",
        // The first try is the one running now, so only a held retry says when it began.
        description: `${s.held?.savedAt && !(s.busy || waiting) ? `First tried ${formatRelativeTimeLabel(s.held.savedAt)}. ` : ""}${s.project.title} on ${s.hostLabel ?? "a computer"}. ${s.copy ? "Use existing files" : s.placementReuses ? "Use files in this folder" : s.filesPlan.kind === "clone" ? "Clone repository files" : "Use the selected folder"}${s.workspace === "worktree" ? " in a new worktree" : ""}. ${modelName ?? "Choose a model"}. ${s.interactionMode === "plan" ? "Plan first" : "Ready to work"}.`,
        icon: <PlayIcon className="size-4 text-(--project-green)" />,
        disabled: !s.canCreate || waiting,
        select: () => void s.submit(),
      },
      ...(s.startOver
        ? [
            {
              id: "start-over",
              title: "Start over",
              description:
                "Forget this attempt and choose settings again. A conversation it already created stays in your list.",
              icon: <RotateCcwIcon className="size-4 text-muted-foreground" />,
              select: s.startOver,
            },
          ]
        : []),
      ...(s.existingFolder
        ? [
            {
              id: "existing-files",
              title: LIBRARY_FOLDER_CHOICE_TITLES.reuse,
              description: s.existingFolderSkipsRestore
                ? `${s.existingFolder}. Changes saved on the other computer are not applied.`
                : s.existingFolder,
              select: () => s.selectFolder(s.existingFolder!),
            },
            {
              id: "another-folder",
              title: "Choose another folder",
              select: () => {
                s.chooseAnotherFolder();
                go("files");
              },
            },
          ]
        : []),
      ...(s.reviewLatest
        ? [{ id: "review-latest", title: "Review latest source files", select: s.reviewLatest }]
        : []),
      ...(s.reviewFiles
        ? [
            {
              id: "review-files",
              title: "Review failed files",
              select: () => void s.reviewFiles?.(),
            },
          ]
        : []),
      ...(s.warning?.pullPaths && s.canPull
        ? [
            {
              id: "pull",
              title: "Pull latest files and start",
              description: s.warning.message,
              disabled: !s.canCreate,
              select: () => void s.pullThenSubmit(s.warning!.pullPaths ?? []),
            },
          ]
        : []),
      edit(
        "computers",
        "Computer",
        s.hostLabel ?? "Choose a computer",
        <MonitorIcon className="size-4 text-(--project-blue)" />,
      ),
      edit(
        "files",
        "Files",
        s.filesLine ?? (s.rootPath || "Choose project files"),
        <FolderIcon className="size-4 text-(--project-teal)" />,
      ),
      ...(s.workspace
        ? [
            edit(
              "workspace",
              "Workspace",
              s.workspace === "worktree" ? "New worktree" : "Project folder",
              <GitBranchIcon className="size-4 text-(--project-teal)" />,
            ),
          ]
        : []),
      edit(
        "models",
        "Model",
        [provider?.displayName, modelName].filter(Boolean).join(": "),
        <BotIcon className="size-4 text-(--project-plum)" />,
      ),
      ...(descriptors.length
        ? [
            edit(
              "options",
              "Model options",
              descriptors
                .map((descriptor) => getProviderOptionCurrentLabel(descriptor))
                .filter(Boolean)
                .join(", "),
            ),
          ]
        : []),
      edit("permissions", "Permissions", runtimeModeConfig[s.runtimeMode].label),
      edit("mode", "Mode", s.interactionMode === "plan" ? "Plan only" : "Do the work"),
      ...(s.project.resources.filter(isRepositoryResource).length
        ? [
            edit(
              "scope",
              "Repositories",
              s.scope.length ? `${s.scope.length} selected` : "Whole project",
            ),
          ]
        : []),
      edit("title", "Conversation title", s.title || "Optional"),
      ...(s.continuation
        ? [
            edit(
              "context",
              "Context to carry forward",
              s.context || "Choose the context for this new conversation",
            ),
          ]
        : []),
      ...(!s.canCreate
        ? [{ id: "refresh", title: "Check connection and files again", select: s.refreshFiles }]
        : []),
    ];
  return (
    <LibraryPaletteView
      key={`${page}:${optionId ?? ""}`}
      title={
        page === "start"
          ? `New conversation in ${s.project.title}`
          : optionId
            ? (descriptors.find((descriptor) => descriptor.id === optionId)?.label ??
              "Model option")
            : {
                computers: "Choose a computer",
                files: "Choose project files",
                path: "Files location",
                models: "Choose a model",
                options: "Model options",
                permissions: "Permissions",
                mode: "Mode",
                scope: "Repositories",
                workspace: "Workspace",
                title: "Conversation title",
                context: "Context to carry forward",
                browse: "Folders",
              }[page]
      }
      placeholder={
        page === "title"
          ? "Name this conversation..."
          : page === "path"
            ? "Enter a files location..."
            : page === "start"
              ? "Search actions or change settings..."
              : "Search choices..."
      }
      query={page === "title" ? s.title : page === "path" ? s.rootPath : search}
      onQueryChange={
        page === "title"
          ? s.setTitle
          : page === "path"
            ? s.setRootPath
            : (value) => {
                leave();
                setSearch(value);
              }
      }
      onBack={page !== "start" || s.onChooseProject ? back : undefined}
      onClose={close}
      busy={s.busy}
      filter={!["title", "context", "path"].includes(page)}
      items={items}
      error={s.error}
      message={
        page === "start"
          ? (s.blocker ??
            s.warning?.message ??
            s.offlineNotice ??
            (promise && conversationAutoStart(s, promise) === "changed"
              ? "These settings differ from what the project list showed. Review them, then start."
              : undefined))
          : page === "models"
            ? "Set up a provider on this computer in Settings to choose a model."
            : undefined
      }
    >
      {s.cloneRepair ? (
        <LibraryCloneRepair key={s.cloneRepair.environmentId} repair={s.cloneRepair} />
      ) : null}
      {page === "files" && s.hostId ? (
        <div className="px-4 py-2">
          <ProfileReadiness environmentId={s.hostId} project={s.project} />
        </div>
      ) : null}
    </LibraryPaletteView>
  );
}
