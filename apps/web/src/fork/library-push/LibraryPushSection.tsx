import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_PUSH_ACTIVITY_FEATURE,
  LIBRARY_PUSH_FEATURE,
  type LibraryPushDeviceRowId,
} from "@t3tools/contracts/fork";
import { useState } from "react";
import { ChevronRightIcon, RefreshCwIcon, SmartphoneIcon } from "lucide-react";
import { SettingsSearchTarget } from "~/components/settings/settingsLayout";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { LibrarySection } from "../project-library/LibraryControls";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { requestConfirmDialog } from "~/confirmDialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
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
    <p role={role} className={cn("text-xs leading-relaxed wrap-anywhere", TONE_CLASS[line.tone])}>
      {line.text}
    </p>
  );
}

/** `loom_push_test` takes a row id that agents cannot list, so a person copies it from here. */
function CopyDeviceId({ id, label }: { id: LibraryPushDeviceRowId; label: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "device ID" });
  return (
    <Button
      size="xs"
      variant="ghost-muted"
      // Starts with the visible text, so voice control can still name the button.
      aria-label={isCopied ? `Copied the ID of ${label}` : `Copy ID of ${label}`}
      onClick={() => copyToClipboard(id)}
    >
      {isCopied ? "Copied" : "Copy ID"}
    </Button>
  );
}

/**
 * The chosen Library's push notifications: whether it can send, which Apple key it signs with,
 * which app builds it sends to, whether it sends agent alerts, and the iPhones registered with
 * it. Push is switched on in the Library's server environment, so there is no on/off control
 * here. The status reads when the section mounts and on Refresh.
 */
export function LibraryPushSection() {
  const authority = useLibraryAuthority();
  if (authority.authorityId === null)
    return (
      <SettingsSearchTarget id="library-push">
        <LibrarySection title="Phone notifications">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Connect your Library above to manage notifications for your phone.
          </p>
        </LibrarySection>
      </SettingsSearchTarget>
    );
  const capabilities = authority.environment?.serverConfig?.environment.capabilities ?? null;
  return (
    <LibraryPushBody
      libraryId={authority.authorityId}
      connected={authority.connected}
      supported={
        capabilities === null ? null : supportsLoomFeature(capabilities, LIBRARY_PUSH_FEATURE)
      }
      alerts={
        capabilities !== null && supportsLoomFeature(capabilities, LIBRARY_PUSH_ACTIVITY_FEATURE)
      }
    />
  );
}

function LibraryPushBody({
  libraryId,
  connected,
  supported,
  alerts,
}: {
  readonly libraryId: EnvironmentId;
  readonly connected: boolean;
  readonly supported: boolean | null;
  readonly alerts: boolean;
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
    alerts,
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
    <SettingsSearchTarget id="library-push" className="min-w-0">
      <LibrarySection
        title="Phone notifications"
        count={view.devices.length}
        action={
          view.refreshable ? (
            <Button
              shape="pill"
              size="xs"
              variant="ghost-muted"
              disabled={view.refreshing}
              onClick={() => refresh()}
            >
              <RefreshCwIcon aria-hidden />
              {view.refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <LineText line={view.headline} role={view.status === "failed" ? "alert" : "status"} />
            {view.hint ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{view.hint}</p>
            ) : null}
            {view.alerts ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{view.alerts}</p>
            ) : null}
            {view.error ? (
              <p role="alert" className="text-xs leading-relaxed text-destructive-foreground">
                {view.error}
              </p>
            ) : null}
          </div>
          {view.retry ? (
            <Button
              size="xs"
              variant="outline"
              disabled={view.refreshing}
              onClick={() => refresh()}
            >
              Try again
            </Button>
          ) : null}
        </div>
        {view.empty ? (
          <div className="flex items-start gap-3 rounded-xl border border-border/60 p-4">
            <SmartphoneIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <LineText line={view.empty} />
          </div>
        ) : null}
        <div className="divide-y divide-border/60">
          {view.devices.map((device) => {
            const busy = pending?.id === device.id ? pending.action : null;
            const outcome = outcomes.get(device.id);
            return (
              <div
                key={device.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0 flex-1 basis-48 space-y-1">
                  <p className="text-sm font-medium wrap-anywhere">{device.label}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{device.detail}</p>
                  {device.lastDelivery ? <LineText line={device.lastDelivery} /> : null}
                  {outcome ? (
                    <LineText
                      line={outcome}
                      role={outcome.tone === "danger" ? "alert" : "status"}
                    />
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyDeviceId id={device.id} label={device.label} />
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
              </div>
            );
          })}
        </div>
        {view.key || view.builds ? (
          <Collapsible>
            <CollapsibleTrigger render={<Button shape="pill" size="xs" variant="ghost-muted" />}>
              <ChevronRightIcon aria-hidden className="[[data-panel-open]_&]:rotate-90" />
              Delivery settings
            </CollapsibleTrigger>
            <CollapsiblePanel keepMounted>
              <div className="space-y-2 pt-3">
                {view.key ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{view.key}</p>
                ) : null}
                {view.builds ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{view.builds}</p>
                ) : null}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ) : null}
      </LibrarySection>
    </SettingsSearchTarget>
  );
}
