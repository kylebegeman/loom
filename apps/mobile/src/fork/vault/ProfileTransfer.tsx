import { useState } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  readVaultProfileRequirements,
  vaultProfileFromRequirements,
  vaultProfileRequirements,
  type VaultProfileDefinition,
} from "@t3tools/contracts/fork";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { uuidv4 } from "../../lib/uuid";
export function VaultRequirementImport({
  disabled,
  supportsGitHub,
  onImport,
}: {
  disabled: boolean;
  supportsGitHub: boolean;
  onImport: (p: VaultProfileDefinition) => void;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [error, setError] = useState(false);
  return (
    <View className="gap-2">
      <Button
        label={open ? "Cancel requirement import" : "Import portable requirements"}
        disabled={disabled}
        onPress={() => {
          setOpen(!open);
          setText("");
          setError(false);
        }}
      />
      {open ? (
        <>
          <Text>
            Paste a Loom requirements declaration. Keys, connections and repositories stay local.
            Imported requirements start unbound.
          </Text>
          <TextInput
            accessibilityLabel="Portable Vault requirements"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            value={text}
            maxLength={16384}
            editable={!disabled}
            onChangeText={(value) => {
              setText(value);
              setError(false);
            }}
          />
          {error ? (
            <Text accessibilityRole="alert">
              Use a Loom declaration with unique SSH, Git or GitHub requirements. GitHub needs
              version 2 and server support. Include no local bindings or extra fields.
            </Text>
          ) : null}
          <Button
            label="Review imported requirements"
            disabled={disabled || !text.trim()}
            onPress={() => {
              const declaration = readVaultProfileRequirements(text);
              if (
                !declaration ||
                (!supportsGitHub && declaration.requirements.some((r) => r.kind === "github"))
              ) {
                setError(true);
                return;
              }
              onImport(vaultProfileFromRequirements(declaration, uuidv4().replaceAll("-", "")));
              setOpen(false);
              setText("");
            }}
          />
        </>
      ) : null}
    </View>
  );
}
export function VaultRequirementExport({ profile }: { profile: VaultProfileDefinition }) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <View className="gap-2">
      <Button
        label={`Copy requirements for ${profile.label}`}
        onPress={() =>
          void Clipboard.setStringAsync(
            JSON.stringify(vaultProfileRequirements(profile), null, 2),
          ).then(
            () =>
              setNotice(
                "Requirements copied. Only the label, names and operation kinds are included. Check labels before sharing.",
              ),
            () => setNotice("Could not copy requirements. Try again."),
          )
        }
      />
      {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
    </View>
  );
}
