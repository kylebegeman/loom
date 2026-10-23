import { useRef, useState } from "react";
import * as Schema from "effect/Schema";
import { LibraryBlueprint, type LibraryProject } from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { randomUUID } from "~/lib/utils";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { projectLibrary, useLibraryPermission } from "./state";
import { LibraryErrorNotice } from "./LibraryControls";

const codec = Schema.fromJsonString(LibraryBlueprint);
const decodeBlueprint = Schema.decodeOption(codec);
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
  return (
    <section aria-label="Project blueprint" className="space-y-3">
      <h2 className="text-base font-semibold">Project blueprint</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Carry repository layout, tools, scripts and connection names to another computer. Save the
        exported file as <code>.loom/project.json</code> in your repository. Computer paths and
        provider selections stay local. Credentials stay in Vault.
      </p>
      <LibraryErrorNotice error={error ?? query.error} onRetry={query.refresh} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!query.data || query.isPending}
          onClick={download}
        >
          <DownloadIcon />
          Export blueprint
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || busy}
          onClick={() => setText(query.data ? Schema.encodeSync(codec)(query.data) : "")}
        >
          <UploadIcon />
          Import or edit blueprint
        </Button>
      </div>
      {text !== null ? (
        <div className="space-y-3">
          <label className="grid gap-2 text-sm">
            Choose a blueprint file
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 131072) {
                  setError("Choose a blueprint smaller than 128 KB.");
                  return;
                }
                void file
                  .text()
                  .then(setText)
                  .catch(() => setError("Could not read that file."));
              }}
            />
          </label>
          <Textarea
            aria-label="Blueprint JSON"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={12}
            maxLength={131072}
            disabled={busy}
          />
          {preview ? (
            <div className="space-y-1 text-sm">
              <p>
                Apply to {project.title}: {preview.resources.length} repositories and links,{" "}
                {preview.setup?.requiredTools?.length ?? 0} required tools,{" "}
                {preview.connections.length} named connections.
              </p>
              {preview.setup?.scripts?.length ? (
                <>
                  <p>Review these scripts before applying. Importing does not execute them.</p>
                  <ul className="space-y-1">
                    {preview.setup.scripts.map((script) => (
                      <li key={script.id}>
                        <strong>{script.name}</strong>:{" "}
                        <code className="break-all">{script.command}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="text-muted-foreground">
                This replaces shared project details and setup. Existing copies and conversation
                pins stay intact.
              </p>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Enter a version 1 Loom project blueprint. Computer IDs, unsafe layouts and secret
              values are refused.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={!preview || !allowed || busy} onClick={() => void submit()}>
              {busy ? "Applying..." : "Apply reviewed blueprint"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setText(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
