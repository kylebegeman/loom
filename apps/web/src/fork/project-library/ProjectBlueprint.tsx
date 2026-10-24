import { useRef, useState } from "react";
import * as Schema from "effect/Schema";
import { LibraryBlueprint, type LibraryProject } from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  DownloadIcon,
  FileJsonIcon,
  FileUpIcon,
  FolderGit2Icon,
  KeyRoundIcon,
  TerminalIcon,
  UploadIcon,
  WrenchIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { randomUUID } from "~/lib/utils";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { projectLibrary, useLibraryPermission } from "./state";
import { LibraryErrorNotice, LibrarySection } from "./LibraryControls";

const codec = Schema.fromJsonString(LibraryBlueprint);
const decodeBlueprint = Schema.decodeOption(codec);
/** The Library refuses larger blueprints, so the file chooser says so before reading one. */
const BLUEPRINT_LIMIT = 131072;

export function ProjectBlueprint({
  project,
  authorityId,
  onChanged,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly onChanged: () => void;
}) {
  const query = useEnvironmentQuery(
    projectLibrary.blueprint({ environmentId: authorityId, input: { projectId: project.id } }),
  );
  const apply = useAtomCommand(projectLibrary.applyBlueprint, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.applyBlueprint, authorityId);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingImport = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = text === null ? null : decodeBlueprint(text);
  const preview = parsed?._tag === "Some" ? parsed.value : null;
  const download = () => {
    if (!query.data) return;
    const blob = new Blob([Schema.encodeSync(codec)(query.data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "project.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const submit = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    const input = { projectId: project.id, expectedRevision: project.revision, blueprint: preview };
    const fingerprint = JSON.stringify(input);
    if (pendingImport.current?.fingerprint !== fingerprint)
      pendingImport.current = { fingerprint, requestId: randomUUID() };
    const result = await apply({
      environmentId: authorityId,
      input: { ...input, requestId: pendingImport.current.requestId },
    });
    if (result._tag === "Success") {
      setText(null);
      query.refresh();
      onChanged();
    } else {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not apply this blueprint.");
    }
    setBusy(false);
  };
  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > BLUEPRINT_LIMIT) {
      setError("Choose a blueprint smaller than 128 KB.");
      return;
    }
    setError(null);
    void file
      .text()
      .then(setText)
      .catch(() => setError("Could not read that file."));
  };
  return (
    <LibrarySection
      title="Project blueprint"
      icon={FileJsonIcon}
      action={
        <div className="flex gap-1.5">
          <Button
            shape="pill"
            size="sm"
            variant="ghost"
            disabled={!query.data || query.isPending}
            onClick={download}
          >
            <DownloadIcon />
            Export blueprint
          </Button>
          <Button
            shape="pill"
            size="sm"
            variant="outline"
            disabled={!allowed || busy || text !== null}
            onClick={() => setText(query.data ? Schema.encodeSync(codec)(query.data) : "")}
          >
            <UploadIcon />
            Import or edit blueprint
          </Button>
        </div>
      }
    >
      <p className="-mt-1 max-w-2xl text-sm text-muted-foreground">
        Carry repository layout, tools, scripts and connection names to another computer. Save the
        export as{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          .loom/project.json
        </code>{" "}
        in your repository. Computer paths and provider choices stay local; credentials stay in
        Vault.
      </p>
      <LibraryErrorNotice error={error ?? query.error} onRetry={query.refresh} />
      {text === null ? (
        query.data ? (
          <BlueprintSummary blueprint={query.data} />
        ) : query.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading blueprint...
          </p>
        ) : null
      ) : (
        <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Review before applying</p>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept=".json,application/json"
              aria-label="Choose a blueprint file"
              disabled={busy}
              onChange={(event) => {
                readFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <FileUpIcon />
              Choose file
            </Button>
          </div>
          <Textarea
            aria-label="Blueprint JSON"
            size="sm"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={12}
            maxLength={BLUEPRINT_LIMIT}
            disabled={busy}
          />
          {preview ? (
            <div className="flex flex-col gap-3">
              <BlueprintSummary blueprint={preview} />
              <p className="text-xs text-muted-foreground">
                Applying replaces {project.title}&apos;s shared details and setup. Existing copies
                and conversation pins stay intact.
              </p>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {text.trim()
                ? "This is not a valid version 1 Loom project blueprint yet. Computer IDs, unsafe layouts and secret values are refused."
                : "Paste a blueprint or choose a file."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              shape="pill"
              size="sm"
              disabled={!preview || !allowed || busy}
              onClick={() => void submit()}
            >
              {busy ? "Applying..." : "Apply reviewed blueprint"}
            </Button>
            <Button
              shape="pill"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setText(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </LibrarySection>
  );
}

/** What a blueprint carries, with its scripts spelled out since a person runs them later. */
function BlueprintSummary({ blueprint }: { readonly blueprint: LibraryBlueprint }) {
  const scripts = blueprint.setup?.scripts ?? [];
  const tools = blueprint.setup?.requiredTools ?? [];
  const stats = [
    { label: "Repositories and links", value: blueprint.resources.length, icon: FolderGit2Icon },
    { label: "Required tools", value: tools.length, icon: WrenchIcon },
    { label: "Scripts", value: scripts.length, icon: TerminalIcon },
    { label: "Named connections", value: blueprint.connections.length, icon: KeyRoundIcon },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-xl bg-muted/50 p-3 dark:bg-accent/40"
          >
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon aria-hidden className="size-3.5" />
              {label}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {tools.length ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Needs
          {tools.map((tool) => (
            <span
              key={tool.id}
              className="inline-flex h-5 items-center rounded-full bg-muted px-2 font-mono text-2xs text-foreground dark:bg-accent"
            >
              {tool.id}
              {tool.minimumVersion ? ` ${tool.minimumVersion}+` : ""}
            </span>
          ))}
        </p>
      ) : null}
      {scripts.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Importing never runs these. Read them before anyone does.
          </p>
          <ul className="flex flex-col gap-1.5">
            {scripts.map((script) => (
              <li key={script.id} className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-medium">{script.name}</span>
                <code className="block overflow-x-auto whitespace-pre rounded-lg bg-muted px-3 py-2 font-mono text-xs dark:bg-accent/60">
                  {script.command}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
