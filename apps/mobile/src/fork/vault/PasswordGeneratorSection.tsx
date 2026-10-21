import { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, Switch, View } from "react-native";
import {
  VAULT_PASSWORD_CHARACTER_SETS,
  VAULT_PASSWORD_DEFAULTS,
  VAULT_PASSWORD_MIN_LENGTH,
  VAULT_PASSWORD_MAX_LENGTH,
  type VaultPasswordOptions,
} from "@t3tools/client-runtime/fork";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { copyLocalVaultPassword, generateLocalVaultPassword } from "./password-platform";

export function VaultPasswordGeneratorSection() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsSection title="Vault password tools">
        <View className="gap-3 p-4">
          <Text>
            Generate passwords on this device, including while disconnected. Nothing is saved
            automatically.
          </Text>
          <Button label="Generate password" onPress={() => setOpen(true)} />
        </View>
      </SettingsSection>
      {open && <PasswordGenerator onClose={() => setOpen(false)} />}
    </>
  );
}

function PasswordGenerator({ onClose }: { readonly onClose: () => void }) {
  const [options, setOptions] = useState<VaultPasswordOptions>({ ...VAULT_PASSWORD_DEFAULTS });
  const [length, setLength] = useState(String(VAULT_PASSWORD_DEFAULTS.length));
  const [password, setPassword] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clear = useCallback(() => {
    setPassword(null);
    setVisible(false);
    setCopied(false);
    setError(null);
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") clear();
    });
    return () => subscription.remove();
  }, [clear]);
  const update = (patch: Partial<VaultPasswordOptions>) => {
    clear();
    setOptions((previous) => ({ ...previous, ...patch }));
  };
  const generate = () => {
    clear();
    try {
      setPassword(generateLocalVaultPassword({ ...options, length: Number(length) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password generation failed. Try again.");
    }
  };
  const copy = async () => {
    if (password === null || copying) return;
    setCopying(true);
    setError(null);
    try {
      if (!(await copyLocalVaultPassword(password))) throw new Error("Copy failed.");
      setCopied(true);
    } catch {
      setError("The password could not be copied. Reveal it to copy manually, or try again.");
    } finally {
      setCopying(false);
    }
  };
  return (
    <Sheet title="Generate a password" onClose={onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerClassName="gap-4 px-5 pb-8"
      >
        <Text>
          Generated on this device. Closing this sheet or leaving the app clears the view.
        </Text>
        <View className="gap-2">
          <Text>
            Length ({VAULT_PASSWORD_MIN_LENGTH} to {VAULT_PASSWORD_MAX_LENGTH})
          </Text>
          <TextInput
            accessibilityLabel="Password length"
            keyboardType="number-pad"
            value={length}
            editable={!copying}
            onChangeText={(next) => {
              clear();
              setLength(next);
            }}
          />
        </View>
        {VAULT_PASSWORD_CHARACTER_SETS.map(({ id, label }) => (
          <View key={id} className="flex-row items-center justify-between gap-3">
            <Text>{label}</Text>
            <Switch
              accessibilityLabel={label}
              value={options[id]}
              disabled={copying}
              onValueChange={(checked) => update({ [id]: checked })}
            />
          </View>
        ))}
        <View className="flex-row items-center justify-between gap-3">
          <Text>Exclude look-alikes</Text>
          <Switch
            accessibilityLabel="Exclude look-alikes"
            value={options.excludeLookAlikes}
            disabled={copying}
            onValueChange={(checked) => update({ excludeLookAlikes: checked })}
          />
        </View>
        <Button
          label={password === null ? "Generate password" : "Regenerate"}
          disabled={copying}
          onPress={generate}
        />
        {password !== null && (
          <View className="gap-3">
            <Text>Generated password</Text>
            <TextInput
              accessibilityLabel="Generated password"
              value={password}
              secureTextEntry={!visible}
              editable={false}
              autoComplete="off"
              autoCorrect={false}
            />
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={visible ? "Hide" : "Reveal"}
                disabled={copying}
                onPress={() => setVisible((previous) => !previous)}
              />
              <Button
                label={copied ? "Copied" : "Copy password"}
                disabled={copying}
                onPress={() => void copy()}
              />
              <Button label="Clear password" disabled={copying} tone="text" onPress={clear} />
            </View>
          </View>
        )}
        <Text textRole="footnote">
          Copy uses your system clipboard. Clearing this view does not clear the clipboard.
        </Text>
        {error && <Text accessibilityRole="alert">{error}</Text>}
        {password !== null && copied && (
          <Text accessibilityLiveRegion="polite">Password copied.</Text>
        )}
        <Button label="Close" onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}
