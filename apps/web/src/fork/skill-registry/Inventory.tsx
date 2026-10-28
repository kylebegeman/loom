import { filterSkills } from "./filter";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { SkillRegistryEntry, SkillRegistryInventory } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useFileContextMenu } from "~/fileContextMenu";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { Choice, Issues } from "./parts";
import { skills, runSkillCommand, type SkillOperation } from "./state";
import { RemoveSkill } from "./RemoveSkill";

export function Inventory({
  inventory,
  environmentId,
  projectId,
  operation,
  refresh,
  edit,
}: {
  inventory: SkillRegistryInventory;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  operation: SkillOperation;
  refresh: () => void;
  edit: (entry: SkillRegistryEntry) => void;
}) {
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("all");
  const [scope, setScope] = useState("all");
  const [state, setState] = useState("all");
  const entries = filterSkills(inventory.entries, search, account, scope, state);
  return (
    <div className="space-y-4">
      <Input
        aria-label="Search skills"
        placeholder="Search skills"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid grid-cols-1 gap-2 @sm:grid-cols-3">
        <Choice
          label="Provider account"
          value={account}
          onChange={setAccount}
          options={[
            { value: "all", label: "All accounts" },
            ...inventory.accounts.map((entry) => ({
              value: entry.instanceId,
              label: `${entry.label} (${entry.driver})`,
            })),
          ]}
        />
        <Choice
          label="Scope"
          value={scope}
          onChange={setScope}
          options={["all", "user", "project", "plugin", "system", "admin"].map((value) => ({
            value,
            label: value === "all" ? "All scopes" : value,
          }))}
        />
        <Choice
          label="State"
          value={state}
          onChange={setState}
          options={[
            { value: "all", label: "All states" },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
            { value: "problem", label: "Problems" },
          ]}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {entries.length} skills. Availability comes from each provider's current catalog.
      </p>
      {entries.length === 0 ? (
        <p className="py-5 text-sm text-muted-foreground">
          {inventory.entries.length === 0
            ? "No skills found on this environment. Install some from git, or create one in the Lab."
            : "No skills match these filters."}
        </p>
      ) : null}
      {entries.slice(0, limit).map((entry) => (
        <SkillRow
          key={entry.key}
          entry={entry}
          inventory={inventory}
          environmentId={environmentId}
          projectId={projectId}
          operation={operation}
          refresh={refresh}
          edit={edit}
        />
      ))}
      {entries.length > limit ? (
        <Button size="sm" variant="outline" onClick={() => setLimit(limit + 50)}>
          Show more skills ({entries.length - limit} remaining)
        </Button>
      ) : null}
    </div>
  );
}
function SkillRow({
  entry,
  inventory,
  environmentId,
  projectId,
  operation,
  refresh,
  edit,
}: Parameters<typeof Inventory>[0] & { entry: SkillRegistryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const allowed = useAtomValue(skills.setEnabled.permissionAtom(environmentId));
  const fileMenu = useFileContextMenu(environmentId);
  const primaryId = usePrimaryEnvironmentId();
  const localDesktop =
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined &&
    primaryId === environmentId;
  return (
    <details
      className="rounded-lg border border-border p-3"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer space-y-1 text-sm">
        <span className="font-medium">{entry.name}</span>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {entry.description ?? "No description"}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            ...new Set(
              entry.visibility.map(
                (visible) =>
                  `${inventory.accounts.find((item) => item.instanceId === visible.instanceId)?.label ?? visible.driver}: ${visible.enabled ? "on" : "off"}`,
              ),
            ),
            ...(entry.locations.some((location) => location.viaSymlink) ? ["Shared"] : []),
            ...(entry.install ? ["Loom"] : []),
            ...(entry.containsScripts ? ["Scripts"] : []),
            ...(entry.modified ? ["Locally modified"] : []),
            ...(entry.problems.length ? ["Problem"] : []),
          ].join(" · ") || "Not reported by a provider"}
        </p>
      </summary>
      {expanded ? (
        <div className="mt-4 space-y-3">
          {entry.locations.map((location) => (
            <div key={location.path} className="break-all text-xs text-muted-foreground">
              <p>{location.path}</p>
              {location.viaSymlink ? <p>Shared folder: {location.realDir}</p> : null}
            </div>
          ))}
          {entry.install ? (
            <p className="break-all text-xs text-muted-foreground">
              Installed from {entry.install.sourceUrl}{" "}
              {entry.install.commit ? `at ${entry.install.commit}` : "in the Lab"}
            </p>
          ) : null}
          <Issues issues={entry.problems} />
          {entry.containsScripts ? (
            <p className="text-xs text-muted-foreground">
              This skill includes scripts the agent may run. Loom copies them but never runs them
              itself. Review them before using the skill.
            </p>
          ) : null}
          {entry.visibility.map((visible) => (
            <div key={visible.instanceId} className="space-y-2 rounded-md bg-muted/40 p-2">
              <p className="text-xs">
                {inventory.accounts.find((item) => item.instanceId === visible.instanceId)?.label ??
                  visible.driver}{" "}
                · {visible.scope} ·{" "}
                {visible.userInvocationOnly ? "Explicit invocation" : "Agent can select"}
                {visible.userInvocable ? "" : " · Hidden from menu"}
              </p>
              {visible.toggle === "none" ? (
                <p className="text-xs text-muted-foreground">
                  Managed by {visible.driver}. Change availability in the provider's own settings.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(visible.toggle === "claude"
                    ? ([
                        "account",
                        ...(projectId ? ["project" as const] : []),
                        "allAccounts",
                      ] as const)
                    : (["account"] as const)
                  ).map((toggleScope) => (
                    <Button
                      key={toggleScope}
                      size="xs"
                      variant="outline"
                      disabled={!allowed || operation.pending !== null}
                      onClick={() =>
                        void operation.run("Changing availability", async () => {
                          await runSkillCommand(skills.setEnabled, {
                            environmentId,
                            input: {
                              projectId,
                              key: entry.key,
                              instanceId: visible.instanceId,
                              enabled: !visible.enabled,
                              scope: toggleScope,
                            },
                          });
                          refresh();
                        })
                      }
                    >
                      {visible.enabled ? "Disable" : "Enable"}{" "}
                      {toggleScope === "project"
                        ? "for project"
                        : toggleScope === "allAccounts"
                          ? "for all Claude accounts"
                          : "for account"}
                    </Button>
                  ))}
                  {visible.toggle === "codex" ? (
                    <p className="text-xs text-muted-foreground">
                      Applies to every project using this Codex home.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {entry.editable ? (
              <Button size="xs" variant="outline" onClick={() => edit(entry)}>
                Open in Lab
              </Button>
            ) : null}
            {localDesktop && fileMenu.capabilities.revealLabel && entry.locations[0] ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void fileMenu.activate("reveal-in-folder", {
                    environmentId,
                    filePath: entry.locations[0]!.path,
                    workspaceRoot: undefined,
                  })
                }
              >
                Reveal folder
              </Button>
            ) : null}
            <RemoveSkill
              entry={entry}
              environmentId={environmentId}
              projectId={projectId}
              operation={operation}
              onRemoved={refresh}
            />
          </div>
        </div>
      ) : null}
    </details>
  );
}
