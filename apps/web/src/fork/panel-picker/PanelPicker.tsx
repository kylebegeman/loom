import { Plus } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { PanelPickerList } from "./PanelPickerList";
import { registerPanelPickerTarget } from "./requests";
import type { PanelPickerAction } from "./types";

export { useLoomPanelPicker } from "./preferences";

interface BrowserProfileProps {
  readonly browserProfiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onAddBrowserInProfile: (profileId: string) => void;
}

/** Replaces upstream's "Open a surface" list while the right panel has no tabs. */
export function LoomPanelPickerLauncher(
  props: BrowserProfileProps & { readonly actions: ReadonlyArray<PanelPickerAction> },
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () =>
      registerPanelPickerTarget({
        kind: "launcher",
        element: () => rootRef.current,
        open: () => inputRef.current?.focus(),
      }),
    [],
  );
  return (
    <div
      ref={rootRef}
      // Matches upstream's launcher: the bottom padding centers the list against the
      // full panel, not the space left under its topbar.
      className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-(--workspace-topbar-height)"
    >
      <div className="w-full max-w-xs py-6">
        <PanelPickerList
          mode="launcher"
          actions={props.actions}
          inputRef={inputRef}
          browser={{
            profiles: props.browserProfiles,
            onOpenInProfile: props.onAddBrowserInProfile,
          }}
          heading={
            <h3 className="mb-1 text-center font-medium text-foreground text-sm">Open a panel</h3>
          }
        />
      </div>
    </div>
  );
}

/**
 * Replaces upstream's "+" menu. Driven by upstream's own open state and trigger ref, so
 * `rightPanel.new` and closing the panel keep working unchanged.
 */
export function LoomPanelPickerButton(
  props: BrowserProfileProps & {
    readonly actions: ReadonlyArray<PanelPickerAction>;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly triggerRef: RefObject<HTMLButtonElement | null>;
  },
) {
  const { onOpenChange, triggerRef } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () =>
      registerPanelPickerTarget({
        kind: "button",
        element: () => triggerRef.current,
        open: () => {
          triggerRef.current?.focus();
          onOpenChange(true);
        },
      }),
    [onOpenChange, triggerRef],
  );
  return (
    <Popover open={props.open} onOpenChange={(open) => onOpenChange(open)}>
      <PopoverTrigger
        ref={triggerRef}
        render={
          <Button
            aria-label="Add panel surface"
            className="shrink-0"
            size="icon-xs"
            variant="ghost-muted"
          />
        }
      >
        <Plus className="size-3.5" />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side="bottom"
        sideOffset={6}
        width="md"
        padding="compact"
        initialFocus={inputRef}
      >
        <PanelPickerList
          mode="popover"
          actions={props.actions}
          inputRef={inputRef}
          browser={{
            profiles: props.browserProfiles,
            onOpenInProfile: props.onAddBrowserInProfile,
          }}
          onPicked={() => onOpenChange(false)}
        />
      </PopoverPopup>
    </Popover>
  );
}
