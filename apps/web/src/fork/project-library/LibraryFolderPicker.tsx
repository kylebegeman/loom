import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import { ArrowUpIcon, FolderIcon, HouseIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { filesystemEnvironment, useFilesystemReadAccess } from "~/state/filesystem";
import { useEnvironmentQuery } from "~/state/query";
import { LibraryErrorNotice } from "./LibraryControls";

export function LibraryFolderPicker({
  environmentId,
  computerName,
  initialPath,
  onSelect,
  onCancel,
}: {
  readonly environmentId: EnvironmentId;
  readonly computerName: string;
  readonly initialPath: string;
  readonly onSelect: (path: string) => void;
  readonly onCancel: () => void;
}) {
  const [path, setPath] = useState(ensureBrowseDirectoryPath(initialPath.trim() || "~/"));
  const [search, setSearch] = useState("");
  const access = useFilesystemReadAccess(environmentId);
  const query = useEnvironmentQuery(
    access.canReadFiles
      ? filesystemEnvironment.browse({ environmentId, input: { partialPath: path } })
      : null,
  );
  const ready = access.canReadFiles && query.isSuccess && !query.isPending;
  const currentPath = query.data?.parentPath;
  const parentPath = currentPath
    ? getBrowseParentPath(ensureBrowseDirectoryPath(currentPath))
    : null;
  const error =
    access.error ??
    (access.isPending
      ? null
      : !access.canReadFiles
        ? "This connection cannot browse folders. Allow file access to this computer."
        : query.error);
  const entries =
    query.data?.entries.filter((entry) =>
      entry.name.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const open = (next: string) => {
    setPath(ensureBrowseDirectoryPath(next));
    setSearch("");
  };
  return (
    <section
      aria-label={`Folders on ${computerName}`}
      className="space-y-3 rounded-lg bg-muted/40 p-3"
    >
      <p className="text-sm font-medium">Folders on {computerName}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => open("~/")}>
          <HouseIcon /> Home
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || !parentPath}
          onClick={() => {
            if (parentPath) open(parentPath);
          }}
        >
          <ArrowUpIcon /> Up
        </Button>
      </div>
      <p className="break-all text-xs text-muted-foreground">{ready ? currentPath : path}</p>
      <Input
        aria-label="Filter folders"
        placeholder="Filter folders"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <LibraryErrorNotice error={error} onRetry={query.refresh} />
      {access.isPending || query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading folders...
        </p>
      ) : null}
      {ready ? (
        entries.length ? (
          <ul aria-label="Folders" className="max-h-64 space-y-1 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.fullPath}>
                <Button size="sm" variant="ghost" onClick={() => open(entry.fullPath)}>
                  <FolderIcon />
                  <span className="truncate">{entry.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {search ? "No matching folders." : "No subfolders. You can select this folder."}
          </p>
        )
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!ready || !currentPath}
          onClick={() => {
            if (currentPath) onSelect(currentPath);
          }}
        >
          Select this folder
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel selection
        </Button>
      </div>
    </section>
  );
}
