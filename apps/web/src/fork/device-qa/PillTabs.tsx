import type { ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";

export interface PillTab<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Trailing detail such as a count or a status dot. */
  readonly adornment?: ReactNode;
}

/**
 * Tabs drawn as a pill track; the selected pill slides to the chosen tab. Pair each tab with a
 * `PillTabPanel` of the same value inside `children`.
 */
export function PillTabs<T extends string>({
  label,
  tabs,
  value,
  onValueChange,
  children,
}: {
  label: string;
  tabs: ReadonlyArray<PillTab<T>>;
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
}) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        const tab = tabs.find((entry) => entry.value === next);
        if (tab) onValueChange(tab.value);
      }}
      className="flex min-h-0 flex-col"
    >
      <div className="px-4 pb-3">
        <Tabs.List
          aria-label={label}
          className="relative flex w-full rounded-full bg-input/40 p-1 dark:bg-input/32"
        >
          <Tabs.Indicator className="absolute top-1/2 left-0 h-(--active-tab-height) w-(--active-tab-width) -translate-y-1/2 translate-x-(--active-tab-left) rounded-full bg-background shadow-xs/10 transition-[translate,width] duration-200 ease-out motion-reduce:transition-none dark:bg-input/80" />
          {tabs.map((tab) => (
            <Tabs.Tab
              key={tab.value}
              value={tab.value}
              className="relative z-10 flex h-7 flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-full px-3 font-medium text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-foreground"
            >
              {tab.label}
              {tab.adornment}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </div>
      {children}
    </Tabs.Root>
  );
}

export function PillTabPanel<T extends string>({
  value,
  children,
}: {
  value: T;
  children: ReactNode;
}) {
  return (
    <Tabs.Panel value={value} className="flex flex-col outline-none">
      {children}
    </Tabs.Panel>
  );
}
