import { useAtomValue } from "@effect/atom-react";
import type { MenuAction } from "@react-native-menu/menu";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  PREVIEW_LINK_LIFETIMES,
  type PreviewLink,
  type PreviewLinkLifetime,
  type PreviewLinksSettings,
} from "@t3tools/contracts/fork";
import { BRAND_NAME } from "@t3tools/shared/brand";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  PREVIEW_LIFETIME_LABELS,
  previewComputers,
  previewLinkActions,
  previewLinkSummary,
  previewSetupStatus,
  visiblePreviewLinks,
  type PreviewComputer,
  type PreviewLinkAction,
  type PreviewLinkPermissions,
} from "./previewLinksLogic";
import { previewLinks } from "./state";

/** Times are shown in whole minutes, so a coarse tick keeps them honest without busy renders. */
const CLOCK_INTERVAL_MS = 30_000;

function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, CLOCK_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return now;
}

export function PreviewLinksRouteScreen() {
  const insets = useSafeAreaInsets();
  const { environments, isReady } = useEnvironments();
  const computers = useMemo(() => previewComputers(environments), [environments]);
  const now = useClock();
  return (
    <SettingsScreen title="Previews">
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Text className="px-2 text-sm text-foreground-muted">
          Private HTTPS links to dev servers on your computers. Opening a link here lets this
          device's browser in.
        </Text>
        {computers.length === 0 ? (
          <Text className="px-2 text-sm text-foreground-muted">
            {isReady
              ? `No connected computer can share previews. Update ${BRAND_NAME} on a computer to use them.`
              : "Loading computers…"}
          </Text>
        ) : (
          computers.map((computer) => (
            <ComputerPreviewLinks key={computer.environmentId} computer={computer} now={now} />
          ))
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

type LinkFailure = { readonly linkId: string; readonly message: string };

function settled<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

function ComputerPreviewLinks(props: { readonly computer: PreviewComputer; readonly now: number }) {
  const { environmentId, label } = props.computer;
  const query = useEnvironmentQuery(previewLinks.snapshot({ environmentId, input: {} }));
  const permissions: PreviewLinkPermissions = {
    open: useAtomValue(previewLinks.open.permissionAtom(environmentId)),
    extend: useAtomValue(previewLinks.extend.permissionAtom(environmentId)),
    end: useAtomValue(previewLinks.revoke.permissionAtom(environmentId)),
    restore: useAtomValue(previewLinks.restore.permissionAtom(environmentId)),
  };
  const openLink = useAtomCommand(previewLinks.open, { reportFailure: false });
  const extendLink = useAtomCommand(previewLinks.extend, { reportFailure: false });
  const revokeLink = useAtomCommand(previewLinks.revoke, { reportFailure: false });
  const restoreLink = useAtomCommand(previewLinks.restore, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [failure, setFailure] = useState<LinkFailure | null>(null);
  const snapshot = query.data;
  const status = snapshot ? previewSetupStatus(snapshot.setup) : null;
  const links = snapshot
    ? visiblePreviewLinks(snapshot.links, snapshot.setup.settings, props.now)
    : [];

  async function run(linkId: string, fallback: string, action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(linkId);
    setFailure(null);
    // The React Compiler cannot lower `finally`, so the reset follows the settled promise.
    await action().catch((cause: unknown) => {
      setFailure({
        linkId,
        message: cause instanceof Error && cause.message.trim() ? cause.message : fallback,
      });
    });
    pendingRef.current = false;
    setPending(null);
  }

  function perform(link: PreviewLink, action: PreviewLinkAction, lifetime?: PreviewLinkLifetime) {
    const linkId = link.id;
    switch (action) {
      case "open":
        void run(linkId, "Could not open this link.", async () => {
          // The entry link sets the preview cookie in the system browser, then lands on the page.
          const entry = settled(await openLink({ environmentId, input: { link: linkId } }));
          await Linking.openURL(entry.url).catch(() => {
            throw new Error("Could not open your browser. Try again.");
          });
        });
        return;
      case "copy":
        setFailure(null);
        void tryCopyTextWithHaptic(link.url, { target: "preview link" }).then((copied) => {
          if (!copied) setFailure({ linkId, message: "Could not copy the link." });
        });
        return;
      case "extend":
        void run(linkId, "Could not extend this link.", async () => {
          settled(
            await extendLink({
              environmentId,
              input: lifetime === undefined ? { linkId } : { linkId, lifetime },
            }),
          );
        });
        return;
      case "end":
        Dialog.confirm({
          title: "End this link?",
          message: `${link.host} stops working right away. You can restore it later.`,
          confirmText: "End link",
          destructive: true,
          onConfirm: () =>
            void run(linkId, "Could not end this link.", async () => {
              settled(await revokeLink({ environmentId, input: { linkId } }));
            }),
        });
        return;
      case "restore":
        void run(linkId, "Could not restore this link.", async () => {
          settled(await restoreLink({ environmentId, input: { linkId } }));
        });
        return;
    }
  }

  return (
    <SettingsSection
      title={label}
      footer={`Set up previews for this computer in ${BRAND_NAME} on desktop or web.`}
    >
      <ListRowLayout
        icon="globe"
        label={status?.label ?? (query.error ? "Could not load previews" : "Loading previews…")}
        description={status?.detail ?? undefined}
      />
      {query.error ? (
        <Text
          selectable
          accessibilityRole="alert"
          className="px-4 pb-3 text-sm text-danger-foreground"
        >
          {query.error}
        </Text>
      ) : null}
      {snapshot
        ? links.map((link) => (
            <PreviewLinkRow
              key={link.id}
              link={link}
              settings={snapshot.setup.settings}
              now={props.now}
              permissions={permissions}
              pending={pending === link.id}
              error={failure?.linkId === link.id ? failure.message : null}
              onAction={(action, lifetime) => perform(link, action, lifetime)}
            />
          ))
        : null}
      {snapshot && links.length === 0 ? (
        <Text className="px-4 pb-4 text-sm text-foreground-muted">
          No preview links on this computer.
        </Text>
      ) : null}
    </SettingsSection>
  );
}

const ACTION_LABELS: Record<PreviewLinkAction, string> = {
  open: "Open",
  copy: "Copy link",
  extend: "Extend",
  end: "End link",
  restore: "Restore",
};

const ACTION_IMAGES: Record<PreviewLinkAction, string> = {
  open: "safari",
  copy: "doc.on.doc",
  extend: "clock",
  end: "xmark",
  restore: "arrow.uturn.backward",
};

const EXTEND_PREFIX = "extend:";

function PreviewLinkRow(props: {
  readonly link: PreviewLink;
  readonly settings: PreviewLinksSettings;
  readonly now: number;
  readonly permissions: PreviewLinkPermissions;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onAction: (action: PreviewLinkAction, lifetime?: PreviewLinkLifetime) => void;
}) {
  const { link } = props;
  const summary = previewLinkSummary(link, props.now);
  const available = previewLinkActions(link, props.permissions, props.settings, props.now);
  const menuActions = available.map(({ action, enabled }): MenuAction => ({
    id: action,
    title: ACTION_LABELS[action],
    image: ACTION_IMAGES[action],
    attributes: { disabled: !enabled, destructive: action === "end" },
    ...(action === "extend"
      ? {
          subactions: PREVIEW_LINK_LIFETIMES.map((lifetime) => ({
            id: `${EXTEND_PREFIX}${lifetime}`,
            title: `${PREVIEW_LIFETIME_LABELS[lifetime]} from now`,
            attributes: { disabled: !enabled },
          })),
        }
      : {}),
  }));
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${link.host}, ${summary}`}
      accessibilityHint="Shows actions for this link"
      accessibilityState={{ disabled: props.pending, busy: props.pending }}
      disabled={props.pending}
      className="bg-grouped-card active:opacity-70"
    >
      <ListRowLayout
        icon="link"
        label={link.host}
        description={summary}
        accessory={
          props.pending ? (
            <AppActivityIndicator colorClassName="accent-icon" />
          ) : (
            <SymbolView name="ellipsis" size={16} tintColorClassName="accent-chevron" />
          )
        }
      />
    </Pressable>
  );
  return (
    <View>
      {props.pending ? (
        row
      ) : (
        <Menu
          title={link.host}
          actions={menuActions}
          onPressAction={({ nativeEvent }) => {
            const id = nativeEvent.event;
            if (id.startsWith(EXTEND_PREFIX)) {
              const lifetime = PREVIEW_LINK_LIFETIMES.find(
                (value) => `${EXTEND_PREFIX}${value}` === id,
              );
              if (lifetime) props.onAction("extend", lifetime);
              return;
            }
            const choice = available.find((entry) => entry.action === id);
            if (choice?.enabled && choice.action !== "extend") props.onAction(choice.action);
          }}
        >
          {row}
        </Menu>
      )}
      {props.error ? (
        <Text
          selectable
          accessibilityRole="alert"
          className="px-4 pb-3 text-sm text-danger-foreground"
        >
          {props.error}
        </Text>
      ) : null}
    </View>
  );
}
