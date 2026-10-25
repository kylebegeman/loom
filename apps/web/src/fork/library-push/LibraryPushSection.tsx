import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_PUSH_FEATURE, type LibraryPushDeviceRowId } from "@t3tools/contracts/fork";
import { useState } from "react";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { requestConfirmDialog } from "~/confirmDialog";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryAuthority } from "../project-library/state";
import {
  libraryPushErrorText,
  libraryPushRemoveText,
  libraryPushTestText,
  libraryPushView,
  type LibraryPushDeviceView,
  type LibraryPushLine,
  type LibraryPushTone,
} from "./libraryPushView";
import { libraryPush } from "./state";

const TONE_CLASS: Readonly<Record<LibraryPushTone, string>> = {
  neutral: "text-muted-foreground",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  danger: "text-destructive-foreground",
};

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const formatDate = (iso: string) => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE_FORMAT.format(time);
};

type Pending = { readonly id: LibraryPushDeviceRowId; readonly action: "test" | "remove" };

function LineText({ line, role }: { line: LibraryPushLine; role?: "status" | "alert" }) {
  return (
    <p role={role} className={cn("text-xs leading-relaxed", TONE_CLASS[line.tone])}>
      {line.text}
    </p>
  );
}

/**
 * The chosen Library's push notifications: whether it can send, which Apple key it signs with,
 * and the iPhones registered with it. Push is switched on in the Library's server environment, so
 * there is no on/off control here. The status reads when the section mounts and on Refresh.
 */
export function LibraryPushSection() {
  const authority = useLibraryAuthority();
  if (authority.authorityId === null) return null;
  const serverConfig = authority.environment?.serverConfig ?? null;
  return (
    <LibraryPushBody
      libraryId={authority.authorityId}
      connected={authority.connected}
      supported={
        serverConfig === null
          ? null
          : supportsLoomFeature(serverConfig.environment.capabilities, LIBRARY_PUSH_FEATURE)
      }
    />
  );
}

function LibraryPushBody({
  libraryId,
  connected,
  supported,
}: {
  readonly libraryId: EnvironmentId;
  readonly connected: boolean;
  readonly supported: boolean | null;
}) {
  const statusAtom = libraryPush.status(connected && supported === true ? libraryId : null);
  const result = useAtomValue(statusAtom);
  const refresh = useAtomRefresh(statusAtom);
  const canTest = useAtomValue(libraryPush.test.permissionAtom(libraryId));
  const canRemove = useAtomValue(libraryPush.unregister.permissionAtom(libraryId));
  const test = useAtomCommand(libraryPush.test, { reportFailure: false });
  const unregister = useAtomCommand(libraryPush.unregister, { reportFailure: false });
  const [pending, setPending] = useState<Pending | null>(null);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<LibraryPushDeviceRowId, LibraryPushLine>>(
    new Map(),
  );
  const view = libraryPushView({
    libraryId,
    connected,
    supported,
    result,
    canTest,
    canRemove,
    formatDate,
  });

  const showOutcome = (id: LibraryPushDeviceRowId, line: LibraryPushLine | null) =>
    setOutcomes((current) => {
      const next = new Map(current);
      if (line === null) next.delete(id);
      else next.set(id, line);
      return next;
    });

  const sendTest = async (device: LibraryPushDeviceView) => {
    setPending({ id: device.id, action: "test" });
    showOutcome(device.id, null);
    const outcome = await test({ environmentId: libraryId, input: { id: device.id } });
    setPending(null);
    if (outcome._tag === "Success")
      showOutcome(device.id, libraryPushTestText(outcome.value, device.label));
    else if (!isAtomCommandInterrupted(outcome))
      showOutcome(device.id, { tone: "danger", text: libraryPushErrorText(outcome.cause, "test") });
  };

  const remove = async (device: LibraryPushDeviceView) => {
    if (device.remove === null) return;
    if ((await requestConfirmDialog(device.remove.confirm, { variant: "destructive" })) !== true)
      return;
    setPending({ id: device.id, action: "remove" });
    showOutcome(device.id, null);
    const outcome = await unregister({ environmentId: libraryId, input: { id: device.id } });
    setPending(null);
    if (outcome._tag === "Success") {
      // The row leaves the list when the status reads again, so the result goes to a toast.
      const line = libraryPushRemoveText(outcome.value, device.label);
      toastManager.add({ type: line.tone === "success" ? "success" : "info", title: line.text });
    } else if (!isAtomCommandInterrupted(outcome))
      showOutcome(device.id, {
        tone: "danger",
        text: libraryPushErrorText(outcome.cause, "remove"),
      });
  };

  if (view.headline === null) return null;

  return (
    <SettingsSection
      title="Push notifications"
      headerAction={
        view.refreshable ? (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={view.refreshing}
            onClick={() => refresh()}
          >
            {view.refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-3 sm:px-4">
        <div className="min-w-0 space-y-1">
          <LineText line={view.headline} role={view.status === "failed" ? "alert" : "status"} />
          {view.hint ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{view.hint}</p>
          ) : null}
          {view.key ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{view.key}</p>
          ) : null}
          {view.error ? (
            <p role="alert" className="text-xs leading-relaxed text-destructive-foreground">
              {view.error}
            </p>
          ) : null}
        </div>
        {view.retry ? (
          <Button size="xs" variant="outline" disabled={view.refreshing} onClick={() => refresh()}>
            Try again
          </Button>
        ) : null}
      </div>
      {view.empty ? (
        <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
          {view.empty}
        </p>
      ) : null}
      {view.devices.map((device) => {
        const busy = pending?.id === device.id ? pending.action : null;
        const outcome = outcomes.get(device.id);
        return (
          <div
            key={device.id}
            className="flex items-start justify-between gap-3 px-3 py-2.5 sm:px-4"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm">{device.label}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{device.detail}</p>
              {device.lastDelivery ? <LineText line={device.lastDelivery} /> : null}
              {outcome ? (
                <LineText line={outcome} role={outcome.tone === "danger" ? "alert" : "status"} />
              ) : null}
            </div>
            {device.test || device.remove ? (
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {device.test ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => void sendTest(device)}
                  >
                    {busy === "test" ? "Sending..." : "Send test"}
                  </Button>
                ) : null}
                {device.remove ? (
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={pending !== null}
                    onClick={() => void remove(device)}
                  >
                    {busy === "remove" ? "Removing..." : "Remove"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </SettingsSection>
  );
}
