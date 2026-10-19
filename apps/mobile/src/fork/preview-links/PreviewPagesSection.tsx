import { useAtomValue } from "@effect/atom-react";
import type { MenuAction } from "@react-native-menu/menu";
import {
  PREVIEW_PAGES_EMPTY_TEXT,
  PREVIEW_PAGES_UNAVAILABLE_TEXT,
  PREVIEW_PAGE_CONTROL_LABELS,
  previewPageControls,
  previewPageSummary,
  visiblePreviewPages,
  type PreviewPageControl,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { PreviewPage, PreviewPageAction } from "@t3tools/contracts/fork";
import { useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Menu } from "../../components/ui/Menu";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import type { PreviewComputer } from "./previewLinksLogic";
import { previewLinks } from "./state";

const CONTROL_IMAGES: Record<PreviewPageControl, string> = {
  open: "safari",
  keep: "pin",
  release: "pin.slash",
  end: "xmark",
  restore: "arrow.uturn.backward",
};

const UPDATE_FALLBACKS: Record<PreviewPageAction, string> = {
  keep: "Could not keep this page.",
  release: "Could not stop keeping this page.",
  end: "Could not end this page.",
  restore: "Could not restore this page.",
};

type PageFailure = { readonly pageId: string; readonly message: string };

/** Pages this computer published to its Library, listed through the computer. */
export function ComputerPreviewPages(props: {
  readonly computer: PreviewComputer;
  readonly now: number;
}) {
  const { environmentId, label } = props.computer;
  const query = useEnvironmentQuery(previewLinks.pages({ environmentId, input: {} }));
  const canUpdate = useAtomValue(previewLinks.updatePage.permissionAtom(environmentId));
  const updatePage = useAtomCommand(previewLinks.updatePage, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [failure, setFailure] = useState<PageFailure | null>(null);
  const list = query.data;
  const pages = list?.available ? visiblePreviewPages(list.pages, props.now) : [];

  async function run(pageId: string, fallback: string, task: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(pageId);
    setFailure(null);
    // The React Compiler cannot lower `finally`, so the reset follows the settled promise.
    await task().catch((cause: unknown) => {
      setFailure({
        pageId,
        message: cause instanceof Error && cause.message.trim() ? cause.message : fallback,
      });
    });
    pendingRef.current = false;
    setPending(null);
  }

  function update(page: PreviewPage, action: PreviewPageAction) {
    void run(page.id, UPDATE_FALLBACKS[action], async () => {
      const result = await updatePage({ environmentId, input: { pageId: page.id, action } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
  }

  function perform(page: PreviewPage, control: PreviewPageControl) {
    switch (control) {
      case "open":
        void run(page.id, "Could not open this page.", async () => {
          await Linking.openURL(page.url).catch(() => {
            throw new Error("Could not open your browser. Try again.");
          });
        });
        return;
      case "end":
        Dialog.confirm({
          title: "End this page?",
          message: `${page.title} stops opening right away. You can restore it later.`,
          confirmText: "End page",
          destructive: true,
          onConfirm: () => update(page, "end"),
        });
        return;
      default:
        update(page, control);
    }
  }

  return (
    <SettingsSection
      title={`Pages on ${label}`}
      footer="Pages that agents on this computer published to your Library. Each opens only in a browser signed in to your Library."
    >
      {query.error ? (
        <View className="items-start gap-1 px-4 py-3">
          <Text selectable accessibilityRole="alert" className="text-sm text-danger-foreground">
            {query.error}
          </Text>
          <Button
            label={query.isPending ? "Checking…" : "Try again"}
            tone="text"
            disabled={query.isPending}
            onPress={query.refresh}
          />
        </View>
      ) : null}
      {list === null ? (
        query.error ? null : (
          <Text className="px-4 py-3 text-sm text-foreground-muted">Loading pages…</Text>
        )
      ) : !list.available ? (
        <Text className="px-4 py-3 text-sm text-foreground-muted">
          {PREVIEW_PAGES_UNAVAILABLE_TEXT}
        </Text>
      ) : pages.length === 0 ? (
        <Text className="px-4 py-3 text-sm text-foreground-muted">{PREVIEW_PAGES_EMPTY_TEXT}</Text>
      ) : (
        pages.map((page) => (
          <PreviewPageRow
            key={page.id}
            page={page}
            now={props.now}
            canUpdate={canUpdate}
            pending={pending === page.id}
            error={failure?.pageId === page.id ? failure.message : null}
            onControl={(control) => perform(page, control)}
          />
        ))
      )}
    </SettingsSection>
  );
}

function PreviewPageRow(props: {
  readonly page: PreviewPage;
  readonly now: number;
  readonly canUpdate: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onControl: (control: PreviewPageControl) => void;
}) {
  const { page } = props;
  const summary = previewPageSummary(page, props.now);
  const available = previewPageControls(page, props.canUpdate, props.now);
  const menuActions = available.map(({ control, enabled }): MenuAction => ({
    id: control,
    title: PREVIEW_PAGE_CONTROL_LABELS[control],
    image: CONTROL_IMAGES[control],
    attributes: { disabled: !enabled, destructive: control === "end" },
  }));
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${page.title}, ${summary}`}
      accessibilityHint="Shows actions for this page"
      accessibilityState={{ disabled: props.pending, busy: props.pending }}
      disabled={props.pending}
      className="bg-grouped-card active:opacity-70"
    >
      <ListRowLayout
        icon="doc.text"
        label={page.title}
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
          title={page.title}
          actions={menuActions}
          onPressAction={({ nativeEvent }) => {
            const choice = available.find((entry) => entry.control === nativeEvent.event);
            if (choice?.enabled) props.onControl(choice.control);
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
