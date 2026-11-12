import { useNavigation } from "@react-navigation/native";
import { ACCOUNT_VAULT_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useLibraryAuthority } from "../library/libraryState";
import { useEnvironmentServerConfig } from "../../state/entities";

export function AccountVaultEntry() {
  const authority = useLibraryAuthority();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const navigation = useNavigation();
  if (
    !authority.environmentId ||
    !supportsLoomFeature(config?.environment.capabilities, ACCOUNT_VAULT_FEATURE)
  )
    return null;
  return (
    <SettingsSection title="Account Vault">
      <View className="gap-3 p-4">
        <Text>SSH and GitHub connections for your approved computers.</Text>
        <Button label="Manage account Vault" onPress={() => navigation.navigate("AccountVault")} />
      </View>
    </SettingsSection>
  );
}
