import { useState, type ReactNode } from "react";
import { CheckIcon, FolderIcon, MonitorIcon, SettingsIcon, PlayIcon, BotIcon } from "lucide-react";
import { isRepositoryResource } from "@t3tools/client-runtime/fork";
import {
  getProviderOptionDescriptors,
  getProviderOptionCurrentLabel,
  buildProviderOptionSelectionsFromDescriptors,
} from "@t3tools/shared/model";
import { getProviderModelCapabilities } from "~/providerModels";
import { runtimeModeConfig, runtimeModeOptions } from "~/components/chat/runtimeModeConfig";
import { LibraryModelPalette } from "./LibraryModelPalette";
import { LibraryTextPalette } from "./LibraryTextPalette";
import { LibraryPaletteView, type LibraryPaletteItem } from "./LibraryPalette";
import { ProfileReadiness } from "./ProfileReadiness";
import { LibraryFolderPalette } from "./LibraryFolderPalette";
import type { useLibraryConversationSetup } from "./NewConversationDialog";

type Setup = ReturnType<typeof useLibraryConversationSetup>;
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
  | "title"
  | "context";

export function ConversationPalette({ setup: s }: { readonly setup: Setup }) {
  const [page, setPage] = useState<Page>("start");
  const [search, setSearch] = useState("");
  const [optionId, setOptionId] = useState<string | null>(null);
  const go = (next: Page) => {
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
    icon: icon ?? <SettingsIcon className="size-4" />,
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
        initialPath={s.rootPath || "~/"}
        onBack={back}
        onClose={close}
        onSelect={(path) => {
          s.selectFolder(path);
          go("start");
        }}
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
        icon: <MonitorIcon className="size-4" />,
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
        icon: <FolderIcon className="size-4" />,
        select: () => {
          s.selectCopy(copy.id);
          go("start");
        },
      })),
      edit(
        "browse",
        "Browse computer folders",
        "Choose an existing folder on the selected computer",
        <FolderIcon className="size-4" />,
      ),
      edit("path", "Set files location", s.rootPath || "Choose where to prepare new files"),
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
        title: s.busy ? "Starting..." : s.locked ? "Retry conversation" : "Start conversation",
        description: `${s.project.title} on ${s.hostLabel ?? "a computer"}`,
        icon: <PlayIcon className="size-4" />,
        disabled: !s.canCreate,
        select: () => void s.submit(),
      },
      ...(s.existingFolder
        ? [
            {
              id: "existing-files",
              title: "Use files in this folder",
              description: s.existingFolder,
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
      ...(s.chooseFilesAgain
        ? [{ id: "choose-again", title: "Choose files again", select: s.chooseFilesAgain }]
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
        <MonitorIcon className="size-4" />,
      ),
      edit(
        "files",
        "Files",
        s.rootPath || "Choose project files",
        <FolderIcon className="size-4" />,
      ),
      edit(
        "models",
        "Model",
        [provider?.displayName, modelName].filter(Boolean).join(": "),
        <BotIcon className="size-4" />,
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
      onQueryChange={page === "title" ? s.setTitle : page === "path" ? s.setRootPath : setSearch}
      onBack={page !== "start" || s.onChooseProject ? back : undefined}
      onClose={close}
      busy={s.busy}
      filter={!["title", "context", "path"].includes(page)}
      items={items}
      error={s.error}
      message={
        page === "start"
          ? (s.blocker ?? s.warning?.message)
          : page === "models"
            ? "Set up a provider on this computer in Settings to choose a model."
            : undefined
      }
    >
      {page === "files" && s.hostId ? (
        <div className="px-4 py-2">
          <ProfileReadiness environmentId={s.hostId} project={s.project} />
        </div>
      ) : null}
    </LibraryPaletteView>
  );
}
