import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import { FolderIcon, FileIcon, CornerLeftUpIcon, CheckIcon, HouseIcon } from "lucide-react";
import { LIBRARY_FOLDER_CHOICE_TITLES, libraryNewFolderPath } from "@t3tools/client-runtime/fork";
import { filesystemEnvironment, useFilesystemReadAccess } from "~/state/filesystem";
import { useEnvironmentQuery } from "~/state/query";
import { LibraryPaletteView, type LibraryPaletteItem } from "./LibraryPalette";

/** The folder being browsed, once its listing has loaded. */
export interface LibraryBrowsedFolder {
  readonly path: string;
  /** The folder is a Git repository root. */
  readonly repository: boolean;
  /** Names inside the folder, hidden ones included. Given to `actions` only. */
  readonly entries?: readonly string[];
}

/**
 * The choices for a browsed folder: use its files, download into it when empty, or download into
 * a new folder inside it. The caller checks what the folder holds before it uses it.
 */
export function libraryFolderActions(
  folder: LibraryBrowsedFolder,
  title: string,
  select: (path: string, empty?: boolean) => void,
): LibraryPaletteItem[] {
  const empty = folder.entries?.length === 0;
  const fresh = libraryNewFolderPath(folder.path, title, folder.entries);
  return [
    {
      id: empty ? "download-folder" : "use-folder",
      title: LIBRARY_FOLDER_CHOICE_TITLES[empty ? "clone" : "reuse"],
      description: folder.path,
      icon: <CheckIcon className="size-4" />,
      select: () => select(folder.path, folder.entries ? empty : undefined),
    },
    ...(folder.repository || empty
      ? []
      : [
          {
            id: "new-folder",
            title: "Download into a new folder here",
            description: fresh,
            icon: <FolderIcon className="size-4" />,
            select: () => select(fresh),
          },
        ]),
  ];
}

export function LibraryFolderPalette({
  environmentId,
  computerName,
  initialPath,
  onSelect,
  actions,
  onFolderChange,
  onBack,
  onClose,
  busy = false,
  error,
  children,
  files = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly computerName: string;
  readonly initialPath: string;
  /** Receives the chosen folder, or the chosen file when `files` is set. */
  readonly onSelect?: ((path: string) => void) | undefined;
  /** Lists files too. Folders still open; choosing a file selects it. */
  readonly files?: boolean | undefined;
  /** Rows that act on the browsed folder, in place of "Use this folder". */
  readonly actions?:
    | ((folder: LibraryBrowsedFolder | null) => readonly LibraryPaletteItem[])
    | undefined;
  readonly onFolderChange?: ((folder: LibraryBrowsedFolder | null) => void) | undefined;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly busy?: boolean | undefined;
  readonly error?: string | null | undefined;
  readonly children?: ReactNode;
}) {
  const [path, setPath] = useState(ensureBrowseDirectoryPath(initialPath.trim() || "~/"));
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const access = useFilesystemReadAccess(environmentId);
  const typedPath = /^(?:~?[\\/]|[A-Za-z]:[\\/])/.test(query);
  const separator = Math.max(query.lastIndexOf("/"), query.lastIndexOf("\\"));
  const browsePath = typedPath ? ensureBrowseDirectoryPath(query.slice(0, separator + 1)) : path;
  const filter = typedPath ? query.slice(separator + 1) : query;
  // The home folder the browser opens on is where browsing starts, not a choice. Its actions
  // follow its folders so Enter on opening never adds the whole home folder.
  const chosen = typedPath || history.length > 0 || path !== "~/";
  const listing = useEnvironmentQuery(
    access.canReadFiles
      ? filesystemEnvironment.browse({
          environmentId,
          input: files
            ? { partialPath: browsePath, includeFiles: true }
            : { partialPath: browsePath },
        })
      : null,
  );
  const ready = access.canReadFiles && listing.isSuccess && !listing.isPending;
  const currentPath = listing.data?.parentPath;
  const parentPath = currentPath
    ? getBrowseParentPath(ensureBrowseDirectoryPath(currentPath))
    : null;
  const open = (next: string) => {
    setHistory((previous) => [...previous, browsePath]);
    setPath(ensureBrowseDirectoryPath(next));
    setQuery("");
  };
  const listed = ready ? (listing.data?.entries ?? []) : [];
  const folderPath = ready && currentPath ? currentPath : null;
  const repository = folderPath !== null && listed.some((entry) => entry.name === ".git");
  const folder =
    folderPath === null
      ? null
      : { path: folderPath, repository, entries: listed.map((entry) => entry.name) };
  const reportFolder = useEffectEvent((path: string | null, repository: boolean) =>
    onFolderChange?.(path === null ? null : { path, repository }),
  );
  useEffect(() => {
    reportFolder(folderPath, repository);
  }, [folderPath, repository]);
  const entries = listed.filter(
    (entry) =>
      (!entry.name.startsWith(".") || filter.startsWith(".")) &&
      entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const folderActions: readonly LibraryPaletteItem[] = filter
    ? []
    : actions
      ? actions(folder)
      : [
          {
            id: "select-folder",
            title: "Use this folder",
            description: currentPath,
            icon: <CheckIcon className="size-4" />,
            disabled: !ready || !currentPath,
            select: () => {
              if (ready && currentPath) onSelect?.(currentPath);
            },
          },
        ];
  return (
    <LibraryPaletteView
      title={`${files ? "Files" : "Folders"} on ${computerName}`}
      placeholder={`Search ${files ? "files" : "folders"} or enter a path...`}
      query={query}
      onQueryChange={setQuery}
      onBack={() => {
        if (query) setQuery("");
        else if (history.length) {
          setPath(history[history.length - 1]!);
          setHistory((previous) => previous.slice(0, -1));
        } else onBack();
      }}
      onClose={onClose}
      busy={busy}
      filter={false}
      message={
        listing.isPending || access.isPending
          ? `Loading ${files ? "files" : "folders"}...`
          : `${computerName}: ${currentPath ?? browsePath}`
      }
      error={
        error ??
        access.error ??
        (!access.isPending && !access.canReadFiles
          ? "Allow file access to browse this computer."
          : listing.error)
      }
      items={[
        ...(chosen && !files ? folderActions : []),
        ...entries.map((entry) =>
          entry.kind === "file"
            ? {
                id: entry.fullPath,
                title: entry.name,
                description: entry.fullPath,
                icon: <FileIcon className="size-4" />,
                select: () => onSelect?.(entry.fullPath),
              }
            : {
                id: entry.fullPath,
                title: entry.name,
                description: entry.fullPath,
                icon: <FolderIcon className="size-4" />,
                next: true,
                select: () => open(entry.fullPath),
              },
        ),
        ...(chosen || files ? [] : folderActions),
        ...(!filter && parentPath
          ? [
              {
                id: "parent",
                title: "Parent folder",
                description: parentPath,
                icon: <CornerLeftUpIcon className="size-4" />,
                select: () => {
                  if (parentPath) open(parentPath);
                },
              },
            ]
          : []),
        ...(!filter
          ? [
              {
                id: "home",
                title: "Home folder",
                icon: <HouseIcon className="size-4" />,
                select: () => open("~/"),
              },
            ]
          : []),
        ...(listing.error ? [{ id: "retry", title: "Try again", select: listing.refresh }] : []),
      ]}
    >
      {children}
    </LibraryPaletteView>
  );
}
