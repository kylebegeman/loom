import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  DEFAULT_CODE_GRAPH_SETTINGS,
  TESTED_GRAPHIFY_VERSION,
  graphifyInstallCommands,
  graphifyUvxCommand,
  type CodeGraphSettingsPatch,
  type CodeGraphStatus,
} from "@t3tools/contracts/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { SettingsRow } from "~/components/settings/settingsLayout";
import {
  LoomSettingsActions,
  LoomSettingsContent,
  LoomSettingsDetails,
  LoomSettingsNotice,
} from "~/fork/settings/parts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { CommandLine, Muted, failureOf, formatBytes, plural, useAction, valueOf } from "./parts";
import { FEATURE } from "./panel";
import { codeGraph, runCommand } from "./state";

/** Splits on spaces; a path with spaces needs a wrapper script. */
const parseCommand = (text: string) => text.trim().split(/\s+/).filter(Boolean);

function ProjectGraph({
  environmentId,
  status,
  canOperate,
  onChanged,
}: {
  environmentId: EnvironmentId;
  status: CodeGraphStatus;
  canOperate: boolean;
  onChanged: () => void;
}) {
  const action = useAction();
  const { projectId } = status;
  const disabled = !canOperate || action.busy;
  const facts = [
    status.state === "building"
      ? "Building"
      : status.state === "failed"
        ? "Last build failed"
        : null,
    plural(status.nodeCount, "node"),
    formatBytes(status.graphBytes),
    status.stale ? "Older commit" : null,
  ].filter(Boolean);
  return (
    <li className="flex min-w-0 flex-col gap-3 border-t py-3 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-48 flex-col">
          <span className="break-words text-sm">{status.projectName}</span>
          <span className="break-words text-muted-foreground text-xs tabular-nums">
            {facts.join(", ")}
          </span>
        </div>
        <Button
          size="xs"
          variant="ghost-destructive"
          disabled={disabled}
          onClick={() =>
            void action.act(async () => {
              await runCommand(codeGraph.deleteGraph, { environmentId, input: { projectId } });
              onChanged();
            })
          }
        >
          Delete graph
        </Button>
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">Agents can query this graph</span>
        <Switch
          checked={status.agentTool}
          disabled={disabled}
          onCheckedChange={(enabled) =>
            void action.act(async () => {
              await runCommand(codeGraph.setAgentTool, {
                environmentId,
                input: { projectId, enabled },
              });
              onChanged();
            })
          }
        />
      </label>
      {action.error && <LoomSettingsNotice role="alert">{action.error}</LoomSettingsNotice>}
    </li>
  );
}

function EnvironmentCodeGraph({ environmentId }: { environmentId: EnvironmentId }) {
  const settingsAtom = codeGraph.settings({ environmentId, input: {} });
  const listAtom = codeGraph.list({ environmentId, input: {} });
  const result = useAtomValue(settingsAtom);
  const listResult = useAtomValue(listAtom);
  const settings = valueOf(result);
  const graphs = valueOf(listResult);
  const canEdit = useAtomValue(codeGraph.updateSettings.permissionAtom(environmentId));
  const canOperate = useAtomValue(codeGraph.deleteGraph.permissionAtom(environmentId));
  const save = useAction();
  const [commandText, setCommandText] = useState<string | null>(null);
  const failure = failureOf(result);
  if (failure)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice role="alert">{failure}</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  if (!settings)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice role="status">Loading code graph settings...</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  const disabled = !canEdit || save.busy;

  const update = (patch: CodeGraphSettingsPatch) =>
    void save.act(async () => {
      await runCommand(codeGraph.updateSettings, { environmentId, input: patch });
      appAtomRegistry.refresh(settingsAtom);
      appAtomRegistry.refresh(listAtom);
    });
  const shownCommand = commandText ?? settings.command.join(" ");
  const availability = graphs?.[0]?.availability;

  return (
    <div className="flex min-w-0 flex-col">
      <SettingsRow
        title="Graphify command"
        description="How Loom starts Graphify on this environment's host. Loom never installs it."
      >
        <div className="flex min-w-0 flex-col gap-3 pt-3 pb-2">
          <Input
            aria-label="Graphify command"
            font="mono"
            placeholder="graphify"
            disabled={disabled}
            value={shownCommand}
            onChange={(event) => setCommandText(event.target.value)}
            onBlur={() => {
              const next = parseCommand(shownCommand);
              setCommandText(null);
              if (next.length > 0 && next.join(" ") !== settings.command.join(" "))
                update({ command: next });
            }}
          />
          <Muted>
            Loom is tested with Graphify {TESTED_GRAPHIFY_VERSION}.
            {availability?._tag === "available" &&
              ` This host has ${availability.version}${availability.tested ? "." : ", an untested version."}`}
            {availability?._tag === "missing" && " Graphify was not found on this host."} Install it
            with one of these commands, or run it through uvx without installing.
          </Muted>
          <LoomSettingsDetails title="Install Graphify">
            <div className="flex min-w-0 flex-col gap-2">
              {graphifyInstallCommands().map((command) => (
                <CommandLine key={command} command={command} />
              ))}
            </div>
          </LoomSettingsDetails>
          <LoomSettingsActions>
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => update({ command: graphifyUvxCommand() })}
            >
              Use uvx
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => update({ command: DEFAULT_CODE_GRAPH_SETTINGS.command })}
            >
              Reset command
            </Button>
          </LoomSettingsActions>
          {save.error && <LoomSettingsNotice role="alert">{save.error}</LoomSettingsNotice>}
        </div>
      </SettingsRow>
      <SettingsRow
        title="Update graphs automatically"
        description="After a turn changes files in a project's main checkout, and when you open a project whose graph is out of date. Never builds a first graph."
        control={
          <Switch
            aria-label="Update graphs automatically"
            disabled={disabled}
            checked={settings.autoUpdate}
            onCheckedChange={(checked) => update({ autoUpdate: checked })}
          />
        }
      />
      <SettingsRow
        title="Project graphs"
        description={
          graphs?.length === 0
            ? "No project has a graph yet. Build one from the Code map panel."
            : "Graphs this environment keeps, with their size."
        }
      >
        <div className="flex min-w-0 flex-col gap-3 pt-3 pb-2">
          {failureOf(listResult) ? (
            <LoomSettingsNotice role="alert">{failureOf(listResult)}</LoomSettingsNotice>
          ) : !graphs ? (
            <LoomSettingsNotice role="status">Loading project graphs...</LoomSettingsNotice>
          ) : graphs.length === 0 ? null : (
            <ul className="flex flex-col">
              {graphs.map((status) => (
                <ProjectGraph
                  key={status.projectId}
                  environmentId={environmentId}
                  status={status}
                  canOperate={canOperate}
                  onChanged={() => appAtomRegistry.refresh(listAtom)}
                />
              ))}
            </ul>
          )}
        </div>
      </SettingsRow>
    </div>
  );
}

export function CodeGraphSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>
          Select a connected environment to manage code graphs.
        </LoomSettingsNotice>
      </LoomSettingsContent>
    );
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      FEATURE,
    )
  )
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>
          This environment's server does not have the code graph.
        </LoomSettingsNotice>
      </LoomSettingsContent>
    );
  return (
    <EnvironmentCodeGraph
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}
