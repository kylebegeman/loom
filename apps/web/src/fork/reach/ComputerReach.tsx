import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  reachView,
  supportsLoomFeature,
  type ReachLine,
  type ReachTone,
} from "@t3tools/client-runtime/fork";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { AuthRelayReadScope, sessionGrantsScope, type EnvironmentId } from "@t3tools/contracts";
import { REACH_FEATURE } from "@t3tools/contracts/fork";
import { CheckIcon, CopyIcon } from "lucide-react";
import * as Option from "effect/Option";
import { type ReactNode, useState } from "react";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { requestConfirmDialog } from "~/confirmDialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import type { EnvironmentPresentation } from "~/state/environments";
import { useEnvironmentSessionState, usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { connectedThroughAddress, reachChangeFailureText } from "./reachChange";
import { reach } from "./state";

const TITLE = "Reach from anywhere";

export const REACH_TONE_CLASS: Readonly<Record<ReachTone, string>> = {
  neutral: "text-muted-foreground",
  active: "text-muted-foreground",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  danger: "text-destructive-foreground",
};

export function ReachLineText({ line, live = false }: { line: ReachLine; live?: boolean }) {
  return (
    <p
      role={live ? "status" : undefined}
      className={cn("text-xs leading-relaxed", REACH_TONE_CLASS[line.tone])}
    >
      {line.text}
    </p>
  );
}

function CopyAction({ value, label }: { value: string; label: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: label.toLowerCase() });
  return (
    <Button size="xs" variant="outline" onClick={() => copyToClipboard(value)}>
      {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {isCopied ? "Copied" : label}
    </Button>
  );
}

/**
 * A saved computer's reach, inside its connection details. Those mount children only while open,
 * so the status stream runs only while someone is looking.
 */
export function ComputerReachDetails({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  return (
    <section className="space-y-2" aria-label={TITLE}>
      <ComputerReachBody
        environment={environment}
        isThisComputer={false}
        heading={<h3 className="text-xs font-medium">{TITLE}</h3>}
      />
    </section>
  );
}

/** The current computer's reach, among its own connection settings. */
export function ComputerReachSection({
  environment,
  isThisComputer,
}: {
  readonly environment: EnvironmentPresentation;
  readonly isThisComputer: boolean;
}) {
  return (
    <SettingsSection title={TITLE}>
      <div className="space-y-2 px-3 py-3 sm:px-4">
        <ComputerReachBody
          environment={environment}
          isThisComputer={isThisComputer}
          heading={null}
        />
      </div>
    </SettingsSection>
  );
}

function ComputerReachBody({
  environment,
  isThisComputer,
  heading,
}: {
  readonly environment: EnvironmentPresentation;
  readonly isThisComputer: boolean;
  readonly heading: ReactNode;
}) {
  const environmentId: EnvironmentId = environment.environmentId;
  const connected = environment.connection.phase === "connected";
  const serverConfig = environment.serverConfig ?? null;
  const supported =
    serverConfig === null
      ? null
      : supportsLoomFeature(serverConfig.environment.capabilities, REACH_FEATURE);
  const session = useEnvironmentSessionState(environmentId).data;
  const canRead = session === null ? null : sessionGrantsScope(session, AuthRelayReadScope);
  const statusAtom = reach.status(
    connected && supported === true && canRead === true ? environmentId : null,
  );
  const result = useAtomValue(statusAtom);
  const refresh = useAtomRefresh(statusAtom);
  const canChange = useAtomValue(reach.set.permissionAtom(environmentId));
  const activeRouteUrl = Option.match(usePreparedConnection(environmentId), {
    onNone: () => null,
    onSome: (prepared) => prepared.httpBaseUrl,
  });
  const set = useAtomCommand(reach.set, { reportFailure: false });
  const remove = useAtomCommand(reach.remove, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const view = reachView({
    result,
    connected,
    supported,
    canRead,
    canChange,
    isThisComputer,
    activeRouteUrl,
  });
  const dropsRoute = connectedThroughAddress(activeRouteUrl, view.address?.url ?? null);

  const run = async (
    change: () => Promise<AtomCommandResult<unknown, unknown>>,
    lostRouteExpected: boolean,
  ) => {
    setBusy(true);
    setFailure(null);
    const outcome = await change();
    setBusy(false);
    if (outcome._tag === "Failure")
      setFailure(reachChangeFailureText(outcome.cause, lostRouteExpected));
  };

  const toggle = async (enabled: boolean) => {
    const confirm = enabled ? null : view.confirmOff;
    if (
      confirm !== null &&
      (await requestConfirmDialog(confirm, { variant: "destructive" })) !== true
    )
      return;
    await run(() => set({ environmentId, input: { enabled } }), confirm !== null);
  };

  const removeAddress = async () => {
    if (view.confirmRemove === null) return;
    if ((await requestConfirmDialog(view.confirmRemove, { variant: "destructive" })) !== true)
      return;
    await run(() => remove({ environmentId, input: {} }), dropsRoute);
  };

  const disabledNote =
    view.switch.disabledReason !== null && view.switch.disabledReason !== view.status.text
      ? view.switch.disabledReason
      : null;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {heading}
          <ReachLineText line={view.status} live />
          {view.detail ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{view.detail}</p>
          ) : null}
        </div>
        <Switch
          size="sm"
          checked={view.switch.checked}
          disabled={view.switch.disabled || busy}
          aria-label={`${TITLE} for ${environment.label}`}
          onCheckedChange={(checked) => void toggle(checked)}
        />
      </div>
      {view.address ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {view.address.host}
          </code>
          {view.actions.copyAddress ? (
            <CopyAction value={view.address.url} label="Copy address" />
          ) : null}
          {view.actions.remove ? (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy}
              onClick={() => void removeAddress()}
            >
              Remove address
            </Button>
          ) : null}
        </div>
      ) : null}
      {view.notes.map((note) => (
        <p key={note} className="text-xs leading-relaxed text-warning-foreground">
          {note}
        </p>
      ))}
      {disabledNote ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{disabledNote}</p>
      ) : null}
      {view.signIn ? (
        <div className="space-y-1.5">
          <p className="text-xs leading-relaxed text-muted-foreground">{view.signIn.text}</p>
          {view.signIn.copyText ? (
            <>
              <pre className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                {view.signIn.copyText}
              </pre>
              <CopyAction value={view.signIn.copyText} label="Copy values" />
            </>
          ) : null}
        </div>
      ) : null}
      {failure ? (
        <p role="alert" className="text-xs leading-relaxed text-destructive-foreground">
          {failure}
        </p>
      ) : null}
      {view.actions.retry ? (
        <Button size="xs" variant="outline" onClick={() => refresh()}>
          Try again
        </Button>
      ) : null}
    </>
  );
}
