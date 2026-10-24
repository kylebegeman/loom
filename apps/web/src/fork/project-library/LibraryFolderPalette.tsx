import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import { FolderIcon, CornerLeftUpIcon, CheckIcon, HouseIcon } from "lucide-react";
import { filesystemEnvironment, useFilesystemReadAccess } from "~/state/filesystem";
import { useEnvironmentQuery } from "~/state/query";
import { LibraryPaletteView } from "./LibraryPalette";

export function LibraryFolderPalette({
  environmentId,
  computerName,
  initialPath,
  onSelect,
  onBack,
  onClose,
  busy = false,
  error,
}: {
  readonly environmentId: EnvironmentId;
  readonly computerName: string;
  readonly initialPath: string;
  readonly onSelect: (path: string) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly busy?: boolean | undefined;
  readonly error?: string | null | undefined;
}) {
  const [path, setPath] = useState(ensureBrowseDirectoryPath(initialPath.trim() || "~/"));
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const access = useFilesystemReadAccess(environmentId);
  const typedPath = /^(?:~?[\\/]|[A-Za-z]:[\\/])/.test(query);
  const separator = Math.max(query.lastIndexOf("/"), query.lastIndexOf("\\"));
  const browsePath = typedPath ? ensureBrowseDirectoryPath(query.slice(0, separator + 1)) : path;
  const filter = typedPath ? query.slice(separator + 1) : query;
  const listing = useEnvironmentQuery(
    access.canReadFiles
      ? filesystemEnvironment.browse({ environmentId, input: { partialPath: browsePath } })
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
  const entries = (ready ? (listing.data?.entries ?? []) : []).filter(
    (entry) =>
      (!entry.name.startsWith(".") || filter.startsWith(".")) &&
      entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  return (
    <LibraryPaletteView
      title={`Folders on ${computerName}`}
      placeholder="Search folders or enter a path..."
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
          ? "Loading folders..."
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
        ...(filter
          ? []
          : [
              {
                id: "select-folder",
                title: "Use this folder",
                description: currentPath,
                icon: <CheckIcon className="size-4" />,
                disabled: !ready || !currentPath,
                select: () => {
                  if (ready && currentPath) onSelect(currentPath);
                },
              },
            ]),
        ...entries.map((entry) => ({
          id: entry.fullPath,
          title: entry.name,
          description: entry.fullPath,
          icon: <FolderIcon className="size-4" />,
          next: true,
          select: () => open(entry.fullPath),
        })),
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
    />
  );
}
