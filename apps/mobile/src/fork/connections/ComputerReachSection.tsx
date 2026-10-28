import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  reachChangeErrorText,
  backgroundCheckFailureText,
  directoryReportingText,
  reachView,
  supportsLoomFeature,
  type ReachConfirm,
  type ReachTone,
} from "@t3tools/client-runtime/fork";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { AuthRelayReadScope, sessionGrantsScope, type EnvironmentId } from "@t3tools/contracts";
import {
  DIRECTORY_REPORTING_FEATURE,
  REACH_FEATURE,
  REACH_FORGET_FEATURE,
  type ReachStatus,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { cn } from "../../lib/cn";
import { serverEnvironment } from "../../state/server";
import { environmentSession, usePreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { REACH_INK, reach, directoryReporting } from "./reach";

const FOOTER =
  "Your Library gives this computer its own address, so your devices can connect when they are away from your network and tailnet.";

type Pending = "on" | "off" | "remove" | "forget";

function askFirst(confirm: ReachConfirm, onConfirm: () => void) {
  Dialog.confirm({
    title: confirm.title,
    message: confirm.message,
    confirmText: confirm.action,
    destructive: true,
    onConfirm,
  });
}

/**
 * One saved computer's reach. The status streams only while this screen is open and the computer
 * is connected. The phone is never a reach host, so the prepared sign-in values stay on the
 * computer's own settings and this screen only points there.
 */
export function ComputerReachSection({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const supported = config
    ? supportsLoomFeature(config.environment.capabilities, REACH_FEATURE)
    : null;
  const forgetSupported = config
    ? supportsLoomFeature(config.environment.capabilities, REACH_FORGET_FEATURE)
    : false;
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const canRead = session === null ? null : sessionGrantsScope(session, AuthRelayReadScope);
  const canChange = useAtomValue(reach.set.permissionAtom(environmentId));
  const statusAtom = reach.status(
    connected && supported === true && canRead === true ? environmentId : null,
  );
  const result = useAtomValue(statusAtom);
  const refreshStatus = useAtomRefresh(statusAtom);
  const prepared = usePreparedConnection(environmentId);
  const setReach = useAtomCommand(reach.set, { reportFailure: false });
  const removeReach = useAtomCommand(reach.remove, { reportFailure: false });
  const forgetReach = useAtomCommand(reach.forget, { reportFailure: false });
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const view = reachView({
    result,
    connected,
    supported,
    canRead,
    canChange,
    forgetSupported,
    isThisComputer: false,
    activeRouteUrl: connected && Option.isSome(prepared) ? prepared.value.httpBaseUrl : null,
  });
  const address = view.address;

  function run(kind: Pending, command: () => Promise<AtomCommandResult<ReachStatus, unknown>>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(kind);
    setError(null);
    setNotice(null);
    // Read now: once the change lands, a device on the reach address loses its route.
    const dropsRoute = kind !== "on" && view.throughAddress;
    // A promise chain, not try/finally, which the React Compiler cannot compile.
    void command().then((outcome) => {
      pendingRef.current = false;
      setPending(null);
      if (outcome._tag === "Failure") setError(reachChangeErrorText(outcome.cause, dropsRoute));
    });
  }

  function change(enabled: boolean) {
    const send = () =>
      run(enabled ? "on" : "off", () => setReach({ environmentId, input: { enabled } }));
    if (enabled || view.confirmOff === null) return send();
    askFirst(view.confirmOff, send);
  }

  function confirmRemove() {
    if (view.confirmRemove === null) return;
    askFirst(view.confirmRemove, () =>
      run("remove", () => removeReach({ environmentId, input: {} })),
    );
  }

  function confirmForget() {
    if (view.confirmForget === null) return;
    askFirst(view.confirmForget, () =>
      run("forget", () => forgetReach({ environmentId, input: {} })),
    );
  }

  function copyAddress(url: string) {
    void Clipboard.setStringAsync(url).then(
      () => setNotice("Address copied."),
      () => setError("Loom could not copy the address."),
    );
  }

  const reportingSupported =
    config !== null &&
    supportsLoomFeature(config.environment.capabilities, DIRECTORY_REPORTING_FEATURE);
  const reportingAtom = directoryReporting(connected && reportingSupported ? environmentId : null);
  const reportingResult = useAtomValue(reportingAtom);
  const reportingRefresh = useAtomRefresh(reportingAtom);
  const report = Option.getOrNull(AsyncResult.value(reportingResult));
  const lines: { readonly tone: ReachTone; readonly text: string }[] = [];
  if (view.detail !== null)
    lines.push({ tone: view.status.tone === "danger" ? "danger" : "neutral", text: view.detail });
  for (const note of view.notes) lines.push({ tone: "warning", text: note });
  if (view.switch.disabledReason !== null && view.switch.disabledReason !== view.status.text)
    lines.push({ tone: "neutral", text: view.switch.disabledReason });
  if (view.signIn !== null) lines.push({ tone: "neutral", text: view.signIn.text });
  if (error !== null) lines.push({ tone: "danger", text: error });
  if (notice !== null) lines.push({ tone: "neutral", text: notice });

  return (
    <>
      {reportingSupported ? (
        <SettingsSection title="Library sign-in and directory">
          <View className="gap-2 px-4 py-3">
            {(report
              ? directoryReportingText(report)
              : [
                  !connected
                    ? "Reconnect to check this computer's Library sign-in."
                    : AsyncResult.isFailure(reportingResult)
                      ? "Could not read this computer's Library sign-in. Try again."
                      : "Checking Library sign-in...",
                ]
            ).map((text) => (
              <Text key={text} className="text-sm text-foreground-muted">
                {text}
              </Text>
            ))}
            {(report ? backgroundCheckFailureText(report) : []).map((text) => (
              <Text key={text} selectable className={cn("text-sm", REACH_INK.danger)}>
                {text}
              </Text>
            ))}
          </View>
          <SettingsActionRow
            icon="arrow.clockwise"
            label="Refresh Library status"
            disabled={!connected || reportingResult.waiting}
            onPress={reportingRefresh}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title="Reach" footer={FOOTER}>
        <SettingsSwitchRow
          icon="globe"
          label="Reach from anywhere"
          subtitle={view.status.text}
          value={pending === "on" ? true : pending === "off" ? false : view.switch.checked}
          disabled={view.switch.disabled || pending !== null}
          onValueChange={change}
        />
        {lines.length > 0 ? (
          <View className="gap-2 px-4 pb-4">
            {lines.map((line) => (
              <Text
                key={`${line.tone}:${line.text}`}
                selectable
                className={cn("text-sm", REACH_INK[line.tone])}
              >
                {line.text}
              </Text>
            ))}
          </View>
        ) : null}
        {view.actions.retry ? (
          <SettingsActionRow icon="arrow.clockwise" label="Try again" onPress={refreshStatus} />
        ) : null}
        {address !== null && view.actions.copyAddress ? (
          <SettingsActionRow
            icon="doc.on.doc"
            label="Copy address"
            description={address.host}
            onPress={() => copyAddress(address.url)}
          />
        ) : null}
        {view.actions.remove ? (
          <SettingsActionRow
            icon="trash"
            label="Remove address"
            tone="danger"
            loading={pending === "remove"}
            disabled={pending !== null}
            onPress={confirmRemove}
          />
        ) : null}
        {view.actions.forget ? (
          <SettingsActionRow
            icon="xmark.circle.fill"
            label="Forget reach on this computer"
            tone="danger"
            loading={pending === "forget"}
            disabled={pending !== null}
            onPress={confirmForget}
          />
        ) : null}
      </SettingsSection>
    </>
  );
}
