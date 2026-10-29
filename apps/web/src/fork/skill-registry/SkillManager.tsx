import { useState } from "react";
import { ProjectId, type EnvironmentId } from "@t3tools/contracts";
import type { SkillFile } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Choice } from "./parts";
import { Inventory } from "./Inventory";
import { Sources } from "./Sources";
import { Lab } from "./Lab";
import { skills, runSkillCommand, useSkillOperation, type SkillTab } from "./state";

export default function SkillManager({
  environmentId,
  initialProjectId = null,
  initialTab = "skills",
}: {
  environmentId: EnvironmentId;
  initialProjectId?: ProjectId | null;
  initialTab?: SkillTab;
}) {
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [projectId, setProjectId] = useState<ProjectId | null>(initialProjectId);
  const [tab, setTab] = useState<SkillTab>(initialTab);
  const [visited, setVisited] = useState<readonly SkillTab[]>([initialTab]);
  const [labDirty, setLabDirty] = useState(false);
  const [editing, setEditing] = useState<SkillFile | null>(null);
  const operation = useSkillOperation();
  const query = useEnvironmentQuery(
    skills.inventory({ environmentId, input: { projectId, refresh: true } }),
  );
  const refresh = () => {
    query.refresh();
    appAtomRegistry.refresh(skills.inventory({ environmentId, input: { projectId } }));
    appAtomRegistry.refresh(skills.sources({ environmentId, input: {} }));
  };
  const selectTab = (next: SkillTab) => {
    setTab(next);
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
    if (next === "sources") appAtomRegistry.refresh(skills.sources({ environmentId, input: {} }));
  };
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Skills</h2>
          <Button
            size="xs"
            variant="outline"
            disabled={query.isPending || operation.pending !== null}
            onClick={refresh}
          >
            Refresh
          </Button>
        </div>
        <Choice
          label="Project context"
          value={projectId ?? ""}
          options={[
            { value: "", label: "User skills only" },
            ...projects.map((project) => ({ value: project.id, label: project.title })),
          ]}
          disabled={operation.pending !== null || labDirty}
          onChange={(next) => {
            setProjectId(next ? ProjectId.make(next) : null);
            setEditing(null);
          }}
        />
        <nav aria-label="Skills manager" className="flex flex-wrap gap-1">
          {(["skills", "sources", "lab"] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={tab === item ? "secondary" : "ghost"}
              aria-current={tab === item ? "page" : undefined}
              onClick={() => selectTab(item)}
            >
              {item === "skills" ? "Skills" : item === "sources" ? "Sources" : "Lab"}
            </Button>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {labDirty ? (
          <p className="text-xs text-muted-foreground">
            Save or reload Lab edits before creating another skill or changing project context.
          </p>
        ) : null}
        {operation.pending ? (
          <p role="status" className="text-xs text-muted-foreground">
            {operation.pending}…
          </p>
        ) : null}
        {operation.error ? (
          <p role="alert" className="break-words text-xs text-destructive">
            {operation.error}
          </p>
        ) : null}
        {operation.notice ? (
          <p role="status" className="break-all text-xs text-muted-foreground">
            {operation.notice}
          </p>
        ) : null}
        {query.error ? (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>{query.error}</p>
            <Button size="xs" variant="outline" onClick={refresh}>
              Retry inventory
            </Button>
          </div>
        ) : null}
        {query.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            Checking provider catalogs and skill folders…
          </p>
        ) : null}
        {query.data ? (
          <>
            {query.data.unavailable.map((account) => (
              <p key={account.instanceId} className="break-words text-xs text-warning">
                Could not read skills from{" "}
                {query.data?.accounts.find((item) => item.instanceId === account.instanceId)
                  ?.label ?? account.instanceId}
                : {account.reason}. Refresh to retry.
              </p>
            ))}
            {query.data.scanTruncated ? (
              <p className="text-xs text-warning">
                Some folders exceed the scan limits or could not be inspected. The inventory is
                incomplete.
              </p>
            ) : null}
            {visited.includes("skills") ? (
              <div hidden={tab !== "skills"}>
                <Inventory
                  inventory={query.data}
                  environmentId={environmentId}
                  projectId={projectId}
                  operation={operation}
                  refresh={refresh}
                  edit={(entry) => {
                    if (labDirty) {
                      operation.setNotice(
                        "Save or reload your Lab edits before opening another skill.",
                      );
                      selectTab("lab");
                      return;
                    }
                    void operation.run("Reading skill", async () => {
                      setEditing(
                        await runSkillCommand(skills.readSkill, {
                          environmentId,
                          input: { projectId, key: entry.key },
                        }),
                      );
                      selectTab("lab");
                    });
                  }}
                />
              </div>
            ) : null}
            {visited.includes("sources") ? (
              <div hidden={tab !== "sources"}>
                <Sources
                  key={projectId ?? "user"}
                  inventory={query.data}
                  environmentId={environmentId}
                  projectId={projectId}
                  operation={operation}
                  refresh={refresh}
                />
              </div>
            ) : null}
            {visited.includes("lab") ? (
              <div hidden={tab !== "lab"}>
                <Lab
                  key={`${projectId ?? "user"}:${editing?.key ?? "new"}`}
                  inventory={query.data}
                  environmentId={environmentId}
                  projectId={projectId}
                  operation={operation}
                  refresh={refresh}
                  initialFile={editing}
                  onDirtyChange={setLabDirty}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
