import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { CHATGPT_USAGE_URL, collectExternalUsageLinks } from "@t3tools/shared/usageLimits";
import { Linking, Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentPresentations } from "../../state/presentation";

// fork: mobile-design
export function ChatGptUsageSummary({
  selectedEnvironmentIds,
}: {
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const selected =
    selectedEnvironmentIds === null
      ? presentations
      : new Map([...presentations].filter(([id]) => selectedEnvironmentIds.has(id)));
  const usage = collectExternalUsageLinks(selected).find((link) => link.url === CHATGPT_USAGE_URL);
  if (!usage) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Manage ChatGPT shared usage"
      accessibilityHint={`Open ChatGPT with ${usage.accounts.join(", ")}`}
      className="flex-row items-center gap-3 rounded-[24px] bg-grouped-card p-4 active:opacity-70"
      onPress={() => void Linking.openURL(usage.url).catch(() => undefined)}
    >
      <View className="size-11 items-center justify-center rounded-full bg-subtle">
        <ProviderIcon provider="codex" size={24} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text textRole="headline" className="font-t3-medium text-foreground">
          ChatGPT shared usage
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          {usage.accounts.join(", ")}. Open ChatGPT with the account you connected.
        </Text>
        <View className="flex-row items-center gap-1.5 pt-1">
          <Text textRole="footnote" className="font-t3-medium text-primary">
            Manage usage
          </Text>
          <SymbolView name="arrow.up.right" size={13} tintColorClassName="accent-primary" />
        </View>
      </View>
    </Pressable>
  );
}
