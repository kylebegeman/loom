import { useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_BADGE_CATEGORIES,
  DEFAULT_BOT_BADGE_PREFERENCES,
  type BotBadgePreferences,
} from "@t3tools/contracts/fork";
import { applyBotChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { BotNotice } from "./BotControls";
import { bots, useBotsCapabilities, useBotsChanges } from "./state";

function ComputerBadgeSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const host = useBotsCapabilities(environmentId);
  const live = host.badgePreferencesSupported && host.connected;
  const query = useEnvironmentQuery(
    live ? bots.badgePreferenceChanges({ environmentId, input: {} }) : null,
  );
  const collection = useEnvironmentQuery(live ? bots.list({ environmentId, input: {} }) : null);
  const changes = useBotsChanges(environmentId, live);
  const canSave = useAtomValue(bots.setBadgePreferences.permissionAtom(environmentId));
  const command = useAtomCommand(bots.setBadgePreferences, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preferences = query.data;
  const definitions = applyBotChanges(collection.data?.bots ?? [], changes);
  const rows = [
    ...definitions.map((bot) => ({ id: bot.id, name: bot.name })),
    ...(preferences?.mutedBotIds ?? [])
      .filter((botId) => !definitions.some((bot) => bot.id === botId))
      .map((botId) => ({ id: botId, name: botId })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const save = async (next: BotBadgePreferences) => {
    setBusy(true);
    setError(null);
    const result = await command({ environmentId, input: { preferences: next } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    setBusy(false);
  };
  const disabled = !canSave || !host.connected || busy;
  return (
    <SettingsSection
      title={`Bot notification dots · ${host.label}`}
      footer="Muted items stay in Needs you and run history. Preferences apply across devices connected to this computer."
    >
      {!host.connected ? (
        <Text className="p-4 text-sm text-foreground-muted">
          Connect to this computer to read its bot notification preferences.
        </Text>
      ) : !host.badgePreferencesSupported ? (
        <Text className="p-4 text-sm text-foreground-muted">
          Update Loom on this computer to customize bot notification dots.
        </Text>
      ) : !preferences ? (
        <Text className="p-4 text-sm text-foreground-muted">
          {query.error
            ? "Bot notification preferences are unavailable."
            : "Loading bot notification preferences…"}
        </Text>
      ) : (
        <>
          <SettingsSwitchRow
            label="Show bot notification dots"
            value={preferences.enabled}
            disabled={disabled}
            onValueChange={(enabled) => void save({ ...preferences, enabled })}
          />
          {BOT_BADGE_CATEGORIES.map(({ key, label }) => (
            <SettingsSwitchRow
              key={key}
              label={label}
              value={preferences[key]}
              disabled={disabled}
              onValueChange={(checked) => void save({ ...preferences, [key]: checked })}
            />
          ))}
          <Text className="px-4 py-2 text-sm font-t3-medium text-foreground-muted">
            Mute individual bots
          </Text>
          {rows.length ? (
            rows.map((bot) => (
              <SettingsSwitchRow
                key={bot.id}
                label={`Mute ${bot.name}`}
                value={preferences.mutedBotIds.includes(bot.id)}
                disabled={
                  disabled ||
                  (!preferences.mutedBotIds.includes(bot.id) &&
                    preferences.mutedBotIds.length >= 200)
                }
                onValueChange={(muted) =>
                  void save({
                    ...preferences,
                    mutedBotIds: muted
                      ? [...preferences.mutedBotIds, bot.id]
                      : preferences.mutedBotIds.filter((value) => value !== bot.id),
                  })
                }
              />
            ))
          ) : (
            <Text className="px-4 py-2 text-sm text-foreground-muted">
              {collection.error
                ? "The bot list is unavailable."
                : collection.isPending
                  ? "Loading bots…"
                  : "No bots to mute yet."}
            </Text>
          )}
          <View className="p-3">
            <Button
              label="Reset defaults"
              tone="text"
              disabled={disabled}
              onPress={() => void save(DEFAULT_BOT_BADGE_PREFERENCES)}
            />
          </View>
          {!canSave ? (
            <Text className="px-4 py-2 text-xs text-foreground-muted">
              This connection cannot change notification preferences.
            </Text>
          ) : null}
        </>
      )}
      {error || query.error || collection.error ? (
        <View className="p-4">
          <BotNotice
            error={error ?? query.error ?? collection.error}
            onRetry={() => {
              query.refresh();
              collection.refresh();
            }}
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}

export function BotBadgeSettings() {
  const environments = useWorkspaceEnvironments();
  if (environments.length === 0)
    return (
      <SettingsSection title="Bot notification dots">
        <Text className="p-4 text-sm text-foreground-muted">
          Connect a computer to customize its bot notification dots.
        </Text>
      </SettingsSection>
    );
  return (
    <>
      {environments.map((environment) => (
        <ComputerBadgeSettings
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ))}
    </>
  );
}
