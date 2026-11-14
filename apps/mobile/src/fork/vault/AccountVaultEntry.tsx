import { useNavigation } from "@react-navigation/native";
import { accountVaultDetail } from "@t3tools/client-runtime/fork";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useAccountVault } from "./useAccountVault";

export function AccountVaultEntry() {
  const { authority, state } = useAccountVault();
  const navigation = useNavigation();
  if (state.kind === "none") return null;
  return (
    <SettingsSection title="Account Vault">
      <View className="gap-3 p-4">
        <Text>Saved connections and secrets for your approved computers.</Text>
        {state.kind === "open" ? null : (
          <Text className="text-sm text-foreground-muted">
            {accountVaultDetail(state, authority.label)}
          </Text>
        )}
        {state.kind === "no-access" ? null : (
          <Button
            label="Manage account Vault"
            // The screen offers sign-in when the account needs reconnecting.
            disabled={state.kind === "checking"}
            onPress={() => navigation.navigate("AccountVault")}
          />
        )}
      </View>
    </SettingsSection>
  );
}
