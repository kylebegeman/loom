import { View } from "react-native";
import type { LibraryWorkflowTone } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

const BADGE_FILL: Record<LibraryWorkflowTone, string> = {
  neutral: "bg-subtle",
  active: "bg-adaptive-blue-50-blue-400-a14",
  success: "bg-adaptive-emerald-500-a12-a16",
  warning: "bg-adaptive-amber-500-a12-a16",
  danger: "bg-adaptive-red-50-950-a80",
};

const BADGE_INK: Record<LibraryWorkflowTone, string> = {
  neutral: "text-foreground-muted",
  active: "text-adaptive-blue-600-400",
  success: "text-adaptive-emerald-700-300",
  warning: "text-adaptive-amber-700-300",
  danger: "text-adaptive-red-700-300",
};

/** The same state pill the web Library uses, so Active, Done and Failed read alike on both. */
export function LibraryStateBadge({
  tone,
  label,
}: {
  readonly tone: LibraryWorkflowTone;
  readonly label: string;
}) {
  return (
    <View className={cn("self-start rounded-full px-2.5 py-0.5", BADGE_FILL[tone])}>
      <Text className={cn("font-t3-medium text-xs", BADGE_INK[tone])}>{label}</Text>
    </View>
  );
}
