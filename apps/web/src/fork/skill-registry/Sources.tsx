import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  SkillRegistryInventory,
  SkillRegistrySource,
  SkillUpdatePreview,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useEnvironmentQuery } from "~/state/query";
import { Choice, TargetChoice, Issues, Section } from "./parts";
import { skills, runSkillCommand, type SkillOperation } from "./state";

export function Sources({
  inventory,
  environmentId,
  projectId,
  operation,
  refresh,
}: {
  inventory: SkillRegistryInventory;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  operation: SkillOperation;
  refresh: () => void;
}) {
  const query = useEnvironmentQuery(skills.sources({ environmentId, input: {} }));
  const allowed = useAtomValue(skills.fetchSource.permissionAtom(environmentId));
  const canInstall = useAtomValue(skills.install.permissionAtom(environmentId));
  const canUpdate = useAtomValue(skills.update.permissionAtom(environmentId));
  const canCancel = useAtomValue(skills.cancelFetch.permissionAtom(environmentId));
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const job = useEnvironmentQuery(
    requestId ? skills.fetchJob({ environmentId, input: { requestId } }) : null,
  );
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<SkillUpdatePreview | null>(null);
  const [force, setForce] = useState(false);
  const fetched = job.data?.source;
  const sources = [
    ...(query.data?.sources ?? []).filter((source) => source.id !== fetched?.id),
    ...(fetched ? [fetched] : []),
  ];
  const source =
    sources.find((candidate) => candidate.id === sourceId) ?? fetched ?? sources[0] ?? null;
  const target =
    targetId ||
    inventory.targets.find((candidate) => candidate.isDefault)?.id ||
    inventory.targets[0]?.id ||
    "";
  const fetching = job.data?.phase === "cloning" || job.data?.phase === "scanning";
  async function fetchSource(sourceUrl = url, sourceRef = ref) {
    const nextId = randomUUID();
    await operation.run("Starting fetch", async () => {
      const started = await runSkillCommand(skills.fetchSource, {
        environmentId,
        input: {
          requestId: nextId,
          url: sourceUrl,
          ...(sourceRef.trim() ? { ref: sourceRef.trim() } : {}),
        },
      });
      setRequestId(started.id);
      setSourceId(null);
      setSelected([]);
      setPreview(null);
    });
  }
  function chooseSource(next: SkillRegistrySource) {
    setSourceId(next.id);
    setSelected([]);
  }
  return (
    <div className="space-y-6">
      <Section title="Fetch skills from git">
        <label className="block space-y-1 text-xs">
          Repository URL
          <Input
            autoFocus
            aria-label="Repository URL"
            placeholder="https://github.com/owner/repository"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className="block space-y-1 text-xs">
          Branch, tag or commit (optional)
          <Input
            aria-label="Source revision"
            value={ref}
            onChange={(event) => setRef(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!allowed || !url.trim() || fetching || operation.pending !== null}
            onClick={() => void fetchSource()}
          >
            Fetch
          </Button>
          {fetching && requestId ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!canCancel}
              onClick={() =>
                void operation.run("Cancelling fetch", () =>
                  runSkillCommand(skills.cancelFetch, { environmentId, input: { requestId } }),
                )
              }
            >
              Cancel fetch
            </Button>
          ) : null}
        </div>
        {job.data ? (
          <p role="status" className="text-xs text-muted-foreground">
            {job.data.phase === "cloning"
              ? "Cloning repository…"
              : job.data.phase === "scanning"
                ? "Scanning skill folders…"
                : job.data.phase === "ready"
                  ? `Fetched ${job.data.source?.skills.length ?? 0} skills at ${job.data.source?.commit.slice(0, 12)}`
                  : job.data.phase === "cancelled"
                    ? "Fetch cancelled. You can fetch again."
                    : job.data.error}
          </p>
        ) : null}
        {job.error || query.error ? (
          <p role="alert" className="text-xs text-destructive">
            {job.error ?? query.error}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                query.refresh();
                job.refresh();
              }}
            >
              Retry
            </Button>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Loom copies complete skill folders and license notices. It never runs a repository's
          installer, scripts or hooks.
        </p>
      </Section>
      <Section title="Suggested sources">
        {query.data?.suggested.map((suggestion) => (
          <div
            key={suggestion.url}
            className="flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <span>
              {suggestion.name} · {suggestion.license}
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={!allowed || fetching || operation.pending !== null}
              onClick={() => {
                setUrl(suggestion.url);
                setRef("");
                void fetchSource(suggestion.url, "");
              }}
            >
              Fetch {suggestion.name}
            </Button>
          </div>
        ))}
      </Section>
      {source ? (
        <Section title="Choose skills to install">
          <Choice
            label="Fetched source"
            value={source.id}
            onChange={(id) => {
              const next = sources.find((candidate) => candidate.id === id);
              if (next) chooseSource(next);
            }}
            options={sources.map((entry) => ({ value: entry.id, label: entry.url }))}
          />
          <p className="break-all text-xs text-muted-foreground">Revision {source.commit}</p>
          {source.license ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">View source license</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{source.license}</pre>
            </details>
          ) : (
            <p className="text-xs text-warning">
              No root license found. Review the source before installing.
            </p>
          )}
          {source.skills.length === 0 ? (
            <p className="text-xs text-muted-foreground">No skills found in this repository.</p>
          ) : null}
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {source.skills.map((skill) => (
              <label
                key={`${source.commit}:${skill.subpath}`}
                className="flex items-start gap-2 rounded-md border border-border p-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(skill.subpath)}
                  disabled={skill.issues.some((issue) => issue.severity === "error")}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, skill.subpath]
                        : selected.filter((item) => item !== skill.subpath),
                    )
                  }
                />
                <span className="min-w-0 space-y-1">
                  <span className="block font-medium">
                    {skill.name}
                    {skill.containsScripts ? " · Contains scripts" : ""}
                  </span>
                  <span className="block text-muted-foreground">{skill.description}</span>
                  <span className="block break-all text-muted-foreground">
                    {skill.subpath} · {skill.files} files
                  </span>
                  {skill.issues.length ? <Issues issues={skill.issues} /> : null}
                </span>
              </label>
            ))}
          </div>
          {source.skills.some(
            (skill) => skill.containsScripts && selected.includes(skill.subpath),
          ) ? (
            <p className="text-xs text-warning">
              Selected skills include scripts the agent may run. Review their source before using
              them.
            </p>
          ) : null}
          <TargetChoice targets={inventory.targets} value={target} onChange={setTargetId} />
          <Button
            size="sm"
            disabled={!canInstall || !target || selected.length === 0 || operation.pending !== null}
            onClick={() =>
              void operation.run("Installing complete skill folders", async () => {
                const installed = await runSkillCommand(skills.install, {
                  environmentId,
                  input: {
                    projectId,
                    sourceId: source.id,
                    commit: source.commit,
                    subpaths: selected,
                    targetId: target,
                  },
                });
                setSelected([]);
                operation.setNotice(`Installed ${installed.length} skills.`);
                query.refresh();
                refresh();
              })
            }
          >
            Install {selected.length ? selected.length : "selected"} skills
          </Button>
        </Section>
      ) : null}
      <Section title="Installed from sources">
        {(query.data?.installs ?? [])
          .filter((install) => install.sourceId !== null)
          .map((install) => (
            <article key={install.id} className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{install.name}</p>
              <p className="break-all text-xs text-muted-foreground">
                {install.sourceUrl}
                <br />
                {install.commit}
                <br />
                {install.installedAt}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!allowed || fetching || operation.pending !== null}
                  onClick={() => {
                    const saved = sources.find((entry) => entry.id === install.sourceId);
                    void fetchSource(install.sourceUrl, saved?.ref ?? "");
                  }}
                >
                  Check source for updates
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canUpdate || operation.pending !== null}
                  onClick={() =>
                    void operation.run("Comparing revisions", async () => {
                      setPreview(
                        await runSkillCommand(skills.previewUpdate, {
                          environmentId,
                          input: { projectId, installId: install.id },
                        }),
                      );
                      setForce(false);
                    })
                  }
                >
                  Review update
                </Button>
              </div>
            </article>
          ))}
        {!query.isPending && !query.data?.installs.some((install) => install.sourceId !== null) ? (
          <p className="text-xs text-muted-foreground">
            Skills installed from git will appear here. Fetch a source again to compare its latest
            revision.
          </p>
        ) : null}
      </Section>
      {preview ? (
        <Section title="Review changes">
          <p className="break-all text-xs text-muted-foreground">
            {preview.fromCommit} to {preview.toCommit}
          </p>
          <ul className="space-y-1 text-xs">
            {preview.files.map((file) => (
              <li key={file.path}>
                {file.change}: {file.path}
              </li>
            ))}
          </ul>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">
            {preview.diff || "No text changes."}
          </pre>
          {preview.truncated ? (
            <p className="text-xs text-warning">
              This preview is truncated. Review the full source before updating.
            </p>
          ) : null}
          {preview.modified ? (
            <label className="flex items-start gap-2 text-xs text-warning">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
              />
              Replace my local modifications with this source revision. The previous folder will be
              kept in trash.
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!canUpdate || operation.pending !== null || (preview.modified && !force)}
              onClick={() =>
                void operation.run("Updating skill", async () => {
                  await runSkillCommand(skills.update, {
                    environmentId,
                    input: {
                      projectId,
                      installId: preview.installId,
                      reviewToken: preview.reviewToken,
                      force,
                    },
                  });
                  setPreview(null);
                  query.refresh();
                  refresh();
                  operation.setNotice("Skill updated. Start a new thread to use the revision.");
                })
              }
            >
              Apply reviewed update
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
