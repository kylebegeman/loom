import type { ReactNode } from "react";
import { View } from "react-native";
import {
  BOT_RUN_STATES,
  BOT_VERDICT_STATES,
  botColor,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import type { BotRunStatus, BotVerdictValue } from "@t3tools/contracts/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import { useLibraryProjectColorValue } from "../library/libraryProjectColors";
import { LibraryStateBadge } from "../library/LibraryStateBadge";

/** The same bolt Settings uses for Bots, without the circle, since the tile already frames it. */
const BOT_GLYPH: AppSymbolName = { ios: "bolt.fill", android: "bolt" };

/** Hex alpha for the tile fill, matching project and site tiles. */
const TILE_ALPHA = "24";

const TILE_SIZES = {
  sm: { box: "size-8 rounded-lg", icon: 15 },
  md: { box: "size-10 rounded-xl", icon: 18 },
  xl: { box: "size-14 rounded-2xl", icon: 26 },
} as const;

const DOT_FILL: Record<LibraryWorkflowTone, string> = {
  neutral: "bg-foreground-muted",
  active: "bg-adaptive-sky-600-400",
  success: "bg-adaptive-emerald-600-400",
  warning: "bg-warning-foreground",
  danger: "bg-danger-foreground",
};

/** A bot's mark: the bot glyph in its stable color, so the same bot reads alike everywhere. */
export function BotTile({
  botId,
  size = "md",
  status,
}: {
  readonly botId: string;
  readonly size?: keyof typeof TILE_SIZES;
  /** Rides on the corner, so a run in a mixed list shows both whose it is and how it went. */
  readonly status?: ReactNode;
}) {
  const color = useLibraryProjectColorValue()(botColor({ id: botId }));
  const tile = TILE_SIZES[size];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn("items-center justify-center", tile.box)}
      style={{ backgroundColor: `${color}${TILE_ALPHA}` }}
    >
      <SymbolView name={BOT_GLYPH} size={tile.icon} tintColor={color} />
      {status ? (
        <View className="absolute -end-0.5 -bottom-0.5 rounded-full bg-screen p-0.5">{status}</View>
      ) : null}
    </View>
  );
}

export function BotStateDot({ tone }: { readonly tone: LibraryWorkflowTone }) {
  return <View className={cn("size-2 shrink-0 rounded-full", DOT_FILL[tone])} />;
}

export function BotRunStateBadge({ status }: { readonly status: BotRunStatus }) {
  const state = BOT_RUN_STATES[status];
  return <LibraryStateBadge tone={state.tone} label={state.label} />;
}

export function BotVerdictBadge({ verdict }: { readonly verdict: BotVerdictValue }) {
  const state = BOT_VERDICT_STATES[verdict];
  return <LibraryStateBadge tone={state.tone} label={state.label} />;
}

/** A section heading in the grouped-list voice Sites and the Library use. */
export function BotsSection({
  title,
  detail,
  trailing,
  children,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-2.5">
      <View className="min-h-8 flex-row items-center justify-between gap-3 px-1">
        <Text accessibilityRole="header" className="text-sm font-t3-medium text-foreground-muted">
          {title}
        </Text>
        <View className="flex-row items-center gap-2">
          {detail ? (
            <Text className="text-xs tabular-nums text-foreground-muted">{detail}</Text>
          ) : null}
          {trailing}
        </View>
      </View>
      {children}
    </View>
  );
}

/** One outline group without a fill; rows inside divide themselves with hairlines. */
export function BotsOutline({ children }: { readonly children: ReactNode }) {
  return <View className="overflow-hidden rounded-2xl border border-border">{children}</View>;
}

/** A list with nothing in it yet: a dashed outline the rows will fill, and the way to start. */
export function BotsEmptyList({
  message,
  action,
}: {
  readonly message: string;
  readonly action?: ReactNode;
}) {
  return (
    <View className="gap-2 rounded-2xl border border-dashed border-border px-4 py-4">
      <Text className="text-sm text-foreground-muted">{message}</Text>
      {action}
    </View>
  );
}

/** Placeholder rows in the shape of the list they stand in for, so nothing jumps on arrival. */
export function BotRowsSkeleton({
  label,
  rows = 3,
}: {
  readonly label: string;
  readonly rows?: number;
}) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      className="overflow-hidden rounded-2xl border border-border"
    >
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          className={cn(
            "flex-row items-center gap-3 px-4 py-3.5",
            index > 0 && "border-t border-border-subtle",
          )}
        >
          <View className="size-10 rounded-xl bg-row-hover" />
          <View className="flex-1 gap-2">
            <View className="h-3.5 w-2/5 rounded-md bg-row-hover" />
            <View className="h-3 w-3/5 rounded-md bg-row-hover" />
          </View>
          <View className="h-5 w-16 rounded-full bg-row-hover" />
        </View>
      ))}
    </View>
  );
}

/** Settings read across like a spec sheet, two to a row, rather than boxed one by one. */
export function BotSpecGrid({
  rows,
}: {
  readonly rows: ReadonlyArray<readonly [label: string, value: string]>;
}) {
  return (
    <View className="flex-row flex-wrap gap-y-4">
      {rows.map(([label, value]) => (
        <View key={label} className="w-1/2 min-w-0 gap-0.5 pe-3">
          <Text className="text-xs text-foreground-muted">{label}</Text>
          <Text selectable className="text-sm font-t3-medium text-foreground">
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}
