import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createReachAtoms,
  reachChangeErrorText,
  reachView,
  supportsLoomFeature,
  type ReachTone,
} from "@t3tools/client-runtime/fork";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { AuthRelayReadScope, sessionGrantsScope, type EnvironmentId } from "@t3tools/contracts";
import { REACH_FEATURE, type ReachStatus } from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { cn } from "../../lib/cn";
import { serverEnvironment } from "../../state/server";
import { environmentSession, usePreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";

const reach = createReachAtoms(connectionAtomRuntime);

const FOOTER =
  "Your Library gives this computer its own address, so your devices can connect when they are away from your network and tailnet.";

const INK: Readonly<Record<ReachTone, string>> = {
  neutral: "text-foreground-muted",
  active: "text-foreground-muted",
  success: "text-foreground-muted",
  warning: "text-warning-foreground",
  danger: "text-danger-foreground",
};

type Pending = "on" | "off" | "remove";

/**
 * One saved computer's reach. The status streams only while this screen is open and the computer
 * is connected. The phone is never a reach host, so it is never offered the prepared sign-in values.
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
    // A promise chain, not try/finally, which the React Compiler cannot compile.
    void command().then((outcome) => {
      pendingRef.current = false;
      setPending(null);
      if (AsyncResult.isFailure(outcome)) setError(reachChangeErrorText(outcome.cause));
    });
  }

  function change(enabled: boolean) {
    const send = () =>
      run(enabled ? "on" : "off", () => setReach({ environmentId, input: { enabled } }));
    if (enabled || view.confirmOff === null) return send();
    Dialog.confirm({
      title: "Turn reach off?",
      message: view.confirmOff,
      confirmText: "Turn off",
      destructive: true,
      onConfirm: send,
    });
  }

  function confirmRemove() {
    if (view.confirmRemove === null) return;
    Dialog.confirm({
      title: "Remove address?",
      message: view.confirmRemove,
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => run("remove", () => removeReach({ environmentId, input: {} })),
    });
  }

  function copyAddress(url: string) {
    void Clipboard.setStringAsync(url).then(
      () => setNotice("Address copied."),
      () => setError("Loom could not copy the address."),
    );
  }

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
              className={cn("text-sm", INK[line.tone])}
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
    </SettingsSection>
  );
}
