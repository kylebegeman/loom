import { OperationStatus } from "./OperationStatus";
import styles from "./workspace.module.css";
import { useState } from "react";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { BoxIcon, FileCode2Icon, FileBoxIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { forkPanelSurface } from "../panels/registry";
import { models } from "./state";
import { ModelTool } from "./WorkspaceTools";
export function ModelPicker({ threadRef }: { threadRef: ScopedThreadRef }) {
  const atom = models.models({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });
  const result = useAtomValue(atom);
  const listing = Option.getOrNull(AsyncResult.value(result));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "mesh" | "scad">("all");
  const files = listing?.models.filter(
    (model) =>
      model.path.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "scad"
          ? model.format === "scad"
          : model.format !== "scad" && model.format !== "step")),
  );
  return (
    <div className={styles["model-library"]}>
      <div className={styles["model-library-header"]}>
        <div className={styles["model-library-heading"]}>
          <h1>Model files</h1>
          <ModelTool label="Refresh model files" onClick={() => appAtomRegistry.refresh(atom)}>
            <RefreshCwIcon />
          </ModelTool>
        </div>
        <p>Open a part from this workspace. Each file gets its own preview.</p>
      </div>
      <div className={styles["model-library-search"]}>
        <Input
          type="search"
          aria-label="Search model files"
          placeholder="Search files or folders..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className={styles["model-library-filters"]} role="group" aria-label="File type">
        {(["all", "mesh", "scad"] as const).map((value) => (
          <button
            key={value}
            className={styles["model-tool"]}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {{ all: "All files", mesh: "Meshes", scad: "OpenSCAD" }[value]}
          </button>
        ))}
      </div>
      <div className={styles["model-file-list"]}>
        {result.waiting && listing && <OperationStatus label="Refreshing model files" />}

        {result._tag === "Failure" ? (
          <div className={styles["model-notice"]} role="alert">
            <p>{String(Cause.squash(result.cause))}</p>
            <Button size="sm" variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
              Try again
            </Button>
          </div>
        ) : !listing ? (
          <div className={styles["model-empty"]}>
            <OperationStatus
              label="Finding model files"
              detail="Searching this workspace on the selected environment."
            />
          </div>
        ) : !listing.models.length ? (
          <div className={styles["model-empty"]}>
            <BoxIcon />
            <strong>Your parts will appear here</strong>
            <p>Add an STL, 3MF, OBJ, glTF, GLB or SCAD file to this workspace.</p>
          </div>
        ) : !files?.length ? (
          <div className={styles["model-empty"]}>
            <SearchIcon />
            <strong>No matching files</strong>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className={styles["model-file-grid"]}>
            {files.map((model) => {
              const name = model.path.split("/").at(-1) ?? model.path;
              const folder = model.path.includes("/")
                ? model.path.slice(0, -(name.length + 1))
                : "Workspace";
              const Icon =
                model.format === "scad"
                  ? FileCode2Icon
                  : model.format === "step"
                    ? FileBoxIcon
                    : BoxIcon;
              return (
                <button
                  key={model.path}
                  className={styles["model-file-row"]}
                  onClick={() =>
                    useRightPanelStore.getState().openSurface(threadRef, {
                      ...forkPanelSurface("model-preview-3d", model.path),
                      title: name,
                    })
                  }
                >
                  <span className={styles["model-file-symbol"]} data-scad={model.format === "scad"}>
                    <Icon />
                  </span>
                  <span className={styles["model-file-name"]}>
                    <strong>{name}</strong>
                    <small>
                      {folder} ·{" "}
                      {model.format === "step"
                        ? "Open in Fabrication"
                        : formatAttachmentSize(model.sizeBytes)}
                    </small>
                  </span>
                  <span className={styles["model-file-format"]}>{model.format.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {listing && (
        <div className={styles["model-status-bar"]}>
          <span>
            {files?.length ?? 0} of {listing.models.length} files
            {listing.truncated ? " · First 2,000 indexed" : ""}
          </span>
          <span>Environment workspace</span>
        </div>
      )}
    </div>
  );
}
