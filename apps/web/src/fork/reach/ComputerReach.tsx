import { DirectoryReporting } from "../directory-computers/DirectoryReporting";
import { Input } from "~/components/ui/input";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  reachChangeErrorText,
  reachView,
  supportsLoomFeature,
  type ReachConfirm,
  type ReachLine,
  type ReachTone,
} from "@t3tools/client-runtime/fork";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { AuthRelayReadScope, sessionGrantsScope, type EnvironmentId } from "@t3tools/contracts";
import {
  REACH_FEATURE,
  REACH_FORGET_FEATURE,
  REACH_IDENTITY_APPLY_FEATURE,
  REACH_IDENTITY_DEFAULT_MAX_SESSION_AGE_SECONDS,
  REACH_IDENTITY_PREPARE_FEATURE,
} from "@t3tools/contracts/fork";
import { CheckIcon, CopyIcon } from "lucide-react";
import * as Option from "effect/Option";
import { type ReactNode, useState } from "react";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { requestConfirmDialog } from "~/confirmDialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import type { EnvironmentPresentation } from "~/state/environments";
import { useEnvironmentSessionState, usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { reach } from "./state";

const TITLE = "Reach from anywhere";

type PendingChange = "on" | "off" | "remove" | "forget" | "identity" | "prepare";

const DAY_SECONDS = 24 * 60 * 60;
const DEFAULT_SESSION_DAYS = REACH_IDENTITY_DEFAULT_MAX_SESSION_AGE_SECONDS / DAY_SECONDS;
const MAX_SESSION_DAYS = 30;

/** Empty keeps what the computer saved; otherwise whole days from one to `MAX_SESSION_DAYS`. */
function sessionAgeInput(days: string): { readonly maxSessionAgeSeconds?: number } | null {
  const trimmed = days.trim();
  if (trimmed === "") return {};
  const value = Number(trimmed);
  return /^\d+$/.test(trimmed) && value >= 1 && value <= MAX_SESSION_DAYS
    ? { maxSessionAgeSeconds: value * DAY_SECONDS }
    : null;
}

const REACH_TONE_CLASS: Readonly<Record<ReachTone, string>> = {
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

/** The shared confirm dialog titles the line that ends in a question mark. */
const askFirst = (confirm: ReachConfirm) =>
  requestConfirmDialog(`${confirm.title}\n${confirm.message}`, {
    variant: "destructive",
    confirmLabel: confirm.action,
  });

function CopyAction({
  value,
  label,
  target,
}: {
  readonly value: string;
  readonly label: string;
  readonly target: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target,
    onError: () => toastManager.add({ type: "error", title: `Could not copy the ${target}` }),
  });
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

/**
 * The primary computer's reach, among its own connection settings: the computer that serves this
 * desktop or web app, so it is where its prepared sign-in values get set.
 */
export function ComputerReachSection({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  return (
    <>
      <DirectoryReporting environment={environment} />
      <SettingsSection title={TITLE}>
        <div className="space-y-2 px-3 py-3 sm:px-4">
          <ComputerReachBody environment={environment} isThisComputer heading={null} />
        </div>
      </SettingsSection>
    </>
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
  const forgetSupported =
    serverConfig !== null &&
    supportsLoomFeature(serverConfig.environment.capabilities, REACH_FORGET_FEATURE);
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
  const canApplyIdentity = useAtomValue(reach.applyIdentity.permissionAtom(environmentId));
  const applyIdentity = useAtomCommand(reach.applyIdentity, { reportFailure: false });
  const [allowedSubjects, setAllowedSubjects] = useState("");
  const [requirePasskey, setRequirePasskey] = useState(true);
  const [sessionDays, setSessionDays] = useState("");
  const sessionAge = sessionAgeInput(sessionDays);
  const identityApplySupported =
    serverConfig !== null &&
    supportsLoomFeature(serverConfig.environment.capabilities, REACH_IDENTITY_APPLY_FEATURE);
  const canPrepareIdentity = useAtomValue(reach.prepareIdentity.permissionAtom(environmentId));
  const prepareIdentity = useAtomCommand(reach.prepareIdentity, { reportFailure: false });
  const identityPrepareSupported =
    serverConfig !== null &&
    supportsLoomFeature(serverConfig.environment.capabilities, REACH_IDENTITY_PREPARE_FEATURE);
  const set = useAtomCommand(reach.set, { reportFailure: false });
  const remove = useAtomCommand(reach.remove, { reportFailure: false });
  const forget = useAtomCommand(reach.forget, { reportFailure: false });
  // The switch moves at once; the status stream confirms the change.
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const view = reachView({
    result,
    connected,
    supported,
    canRead,
    canChange,
    forgetSupported,
    isThisComputer,
    canPrepareSignIn: identityPrepareSupported && canPrepareIdentity,
    activeRouteUrl,
  });

  const run = async (
    kind: PendingChange,
    change: () => Promise<AtomCommandResult<unknown, unknown>>,
  ) => {
    setPending(kind);
    setFailure(null);
    const outcome = await change();
    setPending(null);
    if (outcome._tag === "Failure")
      setFailure(
        reachChangeErrorText(
          outcome.cause,
          kind !== "on" && kind !== "prepare" && view.throughAddress,
        ),
      );
  };

  const toggle = async (enabled: boolean) => {
    const confirm = enabled ? null : view.confirmOff;
    if (confirm !== null && (await askFirst(confirm)) !== true) return;
    await run(enabled ? "on" : "off", () => set({ environmentId, input: { enabled } }));
  };

  const removeAddress = async () => {
    if (view.confirmRemove === null) return;
    if ((await askFirst(view.confirmRemove)) !== true) return;
    await run("remove", () => remove({ environmentId, input: {} }));
  };

  const forgetReach = async () => {
    if (view.confirmForget === null) return;
    if ((await askFirst(view.confirmForget)) !== true) return;
    await run("forget", () => forget({ environmentId, input: {} }));
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
          checked={pending === "on" ? true : pending === "off" ? false : view.switch.checked}
          disabled={view.switch.disabled || pending !== null}
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
            <CopyAction value={view.address.url} label="Copy address" target="reach address" />
          ) : null}
          {view.actions.remove ? (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={pending !== null}
              aria-label={`Remove address ${view.address.host}`}
              onClick={() => void removeAddress()}
            >
              Remove address
            </Button>
          ) : null}
        </div>
      ) : null}
      {view.actions.forget ? (
        <Button
          size="xs"
          variant="destructive-outline"
          disabled={pending !== null}
          onClick={() => void forgetReach()}
        >
          Forget reach on this computer
        </Button>
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
          {view.signIn.prepare ? (
            <Button
              size="xs"
              variant="outline"
              disabled={pending !== null}
              onClick={() =>
                void run("prepare", () => prepareIdentity({ environmentId, input: {} }))
              }
            >
              {pending === "prepare" ? "Preparing..." : view.signIn.prepare}
            </Button>
          ) : null}
          {view.signIn.copyText ? (
            <>
              <pre className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                {view.signIn.copyText}
              </pre>
              {isThisComputer && canApplyIdentity && identityApplySupported ? (
                <div className="space-y-2">
                  <label className="block space-y-1 text-xs">
                    Allowed Loom account IDs, if not already configured
                    <Input
                      value={allowedSubjects}
                      onChange={(event) => setAllowedSubjects(event.target.value)}
                      placeholder="Account IDs, separated by commas"
                    />
                  </label>
                  <label className="block space-y-1 text-xs">
                    Days devices stay signed in, if not already set ({DEFAULT_SESSION_DAYS} by
                    default, up to {MAX_SESSION_DAYS})
                    <span className="block w-24">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_SESSION_DAYS}
                        step={1}
                        value={sessionDays}
                        onChange={(event) => setSessionDays(event.target.value)}
                        placeholder={String(DEFAULT_SESSION_DAYS)}
                        aria-invalid={sessionAge === null}
                      />
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={requirePasskey} onCheckedChange={setRequirePasskey} />
                    Require passkey
                  </label>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    While on, only a passkey sign-in works. Turn it off if you sign in to Loom with
                    an email code.
                  </p>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={pending !== null || sessionAge === null}
                    onClick={async () => {
                      if (
                        (await requestConfirmDialog(
                          "Save these sign-in values on this computer and restart its backend? Devices will reconnect. Running agent turns may stop.",
                          { confirmLabel: "Use these values" },
                        )) !== true
                      )
                        return;
                      await run("identity", () =>
                        applyIdentity({
                          environmentId,
                          input: {
                            requirePasskey,
                            ...sessionAge,
                            ...(allowedSubjects.trim()
                              ? { allowedSubjects: allowedSubjects.trim() }
                              : {}),
                          },
                        }),
                      );
                    }}
                  >
                    Use these values
                  </Button>
                </div>
              ) : null}
              <CopyAction
                value={view.signIn.copyText}
                label="Copy values"
                target="sign-in values"
              />
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
