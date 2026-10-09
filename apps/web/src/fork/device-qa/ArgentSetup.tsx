import { TerminalIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  argentGlobalInstallCommand,
  argentInitCommand,
  type DeviceQaArgentStatus,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { typeInNewTerminal } from "./installArgent";
import { Alert, CopyButton, Muted, Section, useAction } from "./parts";
import { deviceQa, runCommand } from "./state";

export interface Workspace {
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
}

function InstallCommand({
  threadRef,
  workspace,
  command,
}: {
  threadRef: ScopedThreadRef;
  workspace: Workspace | null;
  command: string;
}) {
  const type = useAction();
  return (
    <div className="flex flex-col gap-2">
      <code className="block break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed">
        {command}
      </code>
      <div className="flex flex-wrap items-center gap-1.5">
        <CopyButton value={command} label="Copy" />
        {workspace && (
          <Button
            size="xs"
            variant="outline"
            disabled={type.busy}
            onClick={() => void type.act(() => typeInNewTerminal(threadRef, workspace, command))}
          >
            <TerminalIcon />
            Type in terminal
          </Button>
        )}
      </div>
      {type.error && <Alert>{type.error}</Alert>}
    </div>
  );
}

/** argent install guidance and the telemetry notice; renders nothing once both are settled. */
export function ArgentSetup({
  threadRef,
  workspace,
  argent,
}: {
  threadRef: ScopedThreadRef;
  workspace: Workspace | null;
  argent: DeviceQaArgentStatus;
}) {
  const telemetry = useAction();
  const { environmentId, threadId } = threadRef;
  if (argent.installed && argent.telemetry !== "enabled") return null;
  if (!argent.installed)
    return (
      <Section
        title="Install argent"
        description="Flows run with argent from Software Mansion, which you install yourself."
      >
        <Muted>
          Loom never bundles argent. The full installer also registers its tools with your editors
          and agents, which recording with the agent needs. Review it in the terminal, then press
          Enter.
        </Muted>
        <InstallCommand threadRef={threadRef} workspace={workspace} command={argentInitCommand()} />
        <h3 className="pt-1 font-medium text-xs">Runner only, without editor setup</h3>
        <InstallCommand
          threadRef={threadRef}
          workspace={workspace}
          command={argentGlobalInstallCommand()}
        />
        <Muted>
          argent's source is Apache-2.0; its per-platform binaries are proprietary. Loom starts it
          with telemetry off. Screenshots, recordings and installs work without argent.
        </Muted>
      </Section>
    );
  return (
    <Section title="argent telemetry is on">
      <div className="flex flex-col gap-3 rounded-lg border bg-warning/6 px-3 py-3 dark:bg-warning/10">
        <Muted>
          argent sends telemetry when an agent or the terminal runs it. Flow runs can share the
          argent helper an agent already started, which sends it too. Turning it off covers all of
          them.
        </Muted>
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={telemetry.busy}
            onClick={() =>
              void telemetry.act(async () => {
                await runCommand(deviceQa.disableTelemetry, { environmentId, input: {} });
                appAtomRegistry.refresh(deviceQa.status({ environmentId, input: { threadId } }));
              })
            }
          >
            Turn off telemetry
          </Button>
        </div>
      </div>
      {telemetry.error && <Alert>{telemetry.error}</Alert>}
    </Section>
  );
}
