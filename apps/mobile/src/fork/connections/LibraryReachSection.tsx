import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  reachLibraryErrorText,
  reachLibraryView,
  supportsLoomFeature,
  type ReachLibraryComputerView,
} from "@t3tools/client-runtime/fork";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { REACH_LIBRARY_FEATURE } from "@t3tools/contracts/fork";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
import { REACH_INK, reach } from "./reach";

const FOOTER =
  "Addresses and Loom sign-in your Library set up for your computers. Retire a computer you lost or no longer use. Turn reach on or off in each computer's details.";

/**
 * The Library's reach records for the Connections screen. It reads when the screen opens (if the
 * last read is a few seconds old), after a retire and on `refresh`, never on a timer. Shown only
 * when the chosen Library advertises `reach-library`. No Library secret is read or set here.
 */
export function useLibraryReach(libraryId: EnvironmentId | null) {
  const config = useEnvironmentServerConfig(libraryId);
  const supported = config
    ? supportsLoomFeature(config.environment.capabilities, REACH_LIBRARY_FEATURE)
    : null;
  const listAtom = reach.libraryList(supported === true ? libraryId : null);
  const result = useAtomValue(listAtom);
  const refresh = useAtomRefresh(listAtom);
  const canRetire = useAtomValue(reach.libraryRetire.permissionAtom(libraryId));
  const view = reachLibraryView({ result, libraryId, supported, canRetire });
  return {
    libraryId,
    view,
    visible: libraryId !== null && supported === true,
    refresh,
  } as const;
}

export type LibraryReach = ReturnType<typeof useLibraryReach>;

function ComputerRow({ computer }: { readonly computer: ReachLibraryComputerView }) {
  return (
    <View className="gap-1.5 px-4 py-3">
      <Text className="text-base text-foreground">{computer.title}</Text>
      {computer.hostname !== null && computer.hostname !== computer.title ? (
        <Text selectable className="text-sm text-foreground-muted">
          {computer.hostname}
        </Text>
      ) : null}
      <LibraryStateBadge tone={computer.state.tone} label={computer.state.text} />
      {computer.notes.map((note) => (
        <Text key={note} selectable className="text-sm text-warning-foreground">
          {note}
        </Text>
      ))}
    </View>
  );
}

export function LibraryReachSection({ libraryReach }: { readonly libraryReach: LibraryReach }) {
  const { libraryId, view, visible, refresh } = libraryReach;
  const retireReach = useAtomCommand(reach.libraryRetire, { reportFailure: false });
  const [pending, setPending] = useState<EnvironmentId | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  if (!visible || libraryId === null) return null;

  function retire(computer: ReachLibraryComputerView, endIdentity: boolean) {
    if (pendingRef.current || libraryId === null) return;
    pendingRef.current = true;
    setPending(computer.environmentId);
    setError(null);
    void retireReach({
      environmentId: libraryId,
      input: { environmentId: computer.environmentId, endIdentity },
    }).then((outcome) => {
      pendingRef.current = false;
      setPending(null);
      if (outcome._tag === "Failure" && !isAtomCommandInterrupted(outcome))
        setError(`${computer.title}: ${reachLibraryErrorText(outcome.cause, "retire")}`);
    });
  }

  // A native alert has no checkbox, so ending Loom sign-in is its own button, or the reason it
  // is not offered.
  function confirmRetire(computer: ReachLibraryComputerView) {
    const choice = computer.retire;
    if (choice === null) return;
    const offered = choice.endIdentityDisabledReason === null;
    const endIdentityLine = offered
      ? `${choice.endIdentityLabel}? ${choice.endIdentityHint}`
      : choice.endIdentityDisabledReason;
    Dialog.alert(choice.confirm.title, `${choice.confirm.message}\n\n${endIdentityLine}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: choice.confirm.action,
        style: "destructive",
        onPress: () => retire(computer, false),
      },
      ...(offered
        ? [
            {
              text: "Retire and end sign-in",
              style: "destructive" as const,
              onPress: () => retire(computer, true),
            },
          ]
        : []),
    ]);
  }

  // Only the setup lines that need attention; the rest is managed from Loom on the Library.
  const setup = view.setup.filter((line) => line.tone === "warning" || line.tone === "danger");
  const retireNote = view.computers.length > 0 ? view.retireDisabledReason : null;
  return (
    <SettingsSection title="Reach addresses" footer={FOOTER}>
      {view.error !== null ? (
        <Text selectable className="p-4 text-sm text-danger-foreground">
          {view.error}
        </Text>
      ) : null}
      {view.notice !== null ? (
        <Text selectable className="p-4 text-sm text-foreground-muted">
          {view.notice}
        </Text>
      ) : null}
      {setup.length > 0 || retireNote !== null || error !== null ? (
        <View className="gap-2 p-4">
          {setup.map((line) => (
            <Text key={line.text} selectable className={cn("text-sm", REACH_INK[line.tone])}>
              {line.text}
            </Text>
          ))}
          {retireNote !== null ? (
            <Text className="text-sm text-foreground-muted">{retireNote}</Text>
          ) : null}
          {error !== null ? (
            <Text selectable className="text-sm text-danger-foreground">
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
      {view.computers.map((computer) => (
        <View key={computer.environmentId}>
          <ComputerRow computer={computer} />
          {computer.retire !== null ? (
            <SettingsActionRow
              icon="trash"
              label={`Retire ${computer.hostname ?? computer.title}`}
              tone="danger"
              loading={pending === computer.environmentId}
              disabled={pending !== null}
              onPress={() => confirmRetire(computer)}
            />
          ) : null}
        </View>
      ))}
      {view.retry ? (
        <SettingsActionRow
          icon="arrow.clockwise"
          label="Try again"
          disabled={view.refreshing}
          onPress={refresh}
        />
      ) : null}
    </SettingsSection>
  );
}
