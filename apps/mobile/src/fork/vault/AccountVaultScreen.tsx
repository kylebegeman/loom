import { useNavigation } from "@react-navigation/native";
import { ACCOUNT_VAULT_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentServerConfig } from "../../state/entities";
import { LibraryPage } from "../library/LibraryPage";
import { useLibraryAuthority } from "../library/libraryState";
import { VaultSettingsSection } from "./VaultSettingsSection";

export function AccountVaultScreen() {
  const authority = useLibraryAuthority();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const navigation = useNavigation();
  const supported = supportsLoomFeature(config?.environment.capabilities, ACCOUNT_VAULT_FEATURE);
  return (
    <LibraryPage title="Vault">
      <Text className="text-sm text-foreground-muted">
        Saved connections for your approved computers, managed by your Loom account.
      </Text>
      {!authority.environmentId ? (
        <Button
          label="Set up your account"
          onPress={() => navigation.navigate("LibrarySettings")}
        />
      ) : !authority.connected ? (
        <Button
          label="Sign in to your account"
          onPress={() => navigation.navigate("LibrarySignIn", {})}
        />
      ) : !supported ? (
        <Text>Update your Library to manage account Vault connections.</Text>
      ) : (
        <VaultSettingsSection
          key={authority.environmentId}
          environmentId={authority.environmentId}
          connected={authority.ready}
        />
      )}
    </LibraryPage>
  );
}
