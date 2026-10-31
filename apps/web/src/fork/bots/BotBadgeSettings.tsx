import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_BADGE_CATEGORIES,
  BOTS_BADGE_PREFERENCES_FEATURE,
  DEFAULT_BOT_BADGE_PREFERENCES,
  type BotBadgePreferences,
} from "@t3tools/contracts/fork";
import { applyBotChanges, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Switch } from "~/components/ui/switch";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useSettingsSearchTarget } from "~/components/settings/settingsLayout";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryErrorNotice, LibraryStateBadge } from "../project-library/LibraryControls";
import { bots, useBotsChanges } from "./state";

function ComputerBadgeSettings({
  environmentId,
  label,
  connected,
  supported,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly supported: boolean;
}) {
  const id = useId();
  const query = useEnvironmentQuery(
    supported && connected ? bots.badgePreferenceChanges({ environmentId, input: {} }) : null,
  );
  const collection = useEnvironmentQuery(
    supported && connected ? bots.list({ environmentId, input: {} }) : null,
  );
  const changes = useBotsChanges(environmentId, supported && connected);
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
  const disabled = !canSave || !connected || busy;
  return (
    <section
      aria-label={`Bot notification dots on ${label}`}
      className="space-y-5 border-t border-border/60 pt-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{label}</h3>
          {preferences ? (
            <LibraryStateBadge tone={preferences.enabled ? "active" : "neutral"}>
              {preferences.enabled ? "Dots enabled" : "Dots off"}
            </LibraryStateBadge>
          ) : null}
        </div>
        {preferences ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => void save(DEFAULT_BOT_BADGE_PREFERENCES)}
          >
            Reset defaults
          </Button>
        ) : null}
      </div>
      {!connected ? (
        <p className="text-sm text-muted-foreground">
          Connect to this computer to read its bot notification preferences.
        </p>
      ) : !supported ? (
        <p className="text-sm text-muted-foreground">
          Update Loom on this computer to customize bot notification dots.
        </p>
      ) : !preferences ? (
        <p className="text-sm text-muted-foreground">
          {query.error
            ? "Bot notification preferences are unavailable."
            : "Loading bot notification preferences…"}
        </p>
      ) : (
        <>
          <label
            htmlFor={`${id}-enabled`}
            className="flex items-center justify-between gap-4 rounded-lg bg-muted/25 p-3.5 text-sm font-medium"
          >
            <span className="grid gap-1">
              <span>Show bot notification dots</span>
              <span className="text-xs font-normal leading-relaxed text-muted-foreground">
                {preferences.enabled
                  ? "Use the updates selected below."
                  : "Your selections stay saved while dots are off."}
              </span>
            </span>
            <Switch
              id={`${id}-enabled`}
              aria-label="Show bot notification dots"
              checked={preferences.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => void save({ ...preferences, enabled })}
            />
          </label>
          <div className="grid items-start gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Updates that count</h4>
              <div className="divide-y divide-border/50">
                {BOT_BADGE_CATEGORIES.map(({ key, label: category }) => (
                  <label
                    key={key}
                    htmlFor={`${id}-${key}`}
                    className="flex items-center justify-between gap-4 py-2.5 text-sm"
                  >
                    <span>{category}</span>
                    <Checkbox
                      id={`${id}-${key}`}
                      checked={preferences[key]}
                      disabled={disabled}
                      onCheckedChange={(checked) => void save({ ...preferences, [key]: checked })}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Mute individual bots</h4>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Muted bots stay in Needs you and run history.
              </p>
              <div className="divide-y divide-border/50">
                {rows.length ? (
                  rows.map((bot) => (
                    <label
                      key={bot.id}
                      htmlFor={`${id}-bot-${bot.id}`}
                      className="flex items-center justify-between gap-4 py-2.5 text-sm"
                    >
                      <span className="min-w-0 wrap-anywhere">{bot.name}</span>
                      <Checkbox
                        id={`${id}-bot-${bot.id}`}
                        aria-label={`Mute ${bot.name}`}
                        checked={preferences.mutedBotIds.includes(bot.id)}
                        disabled={
                          disabled ||
                          (!preferences.mutedBotIds.includes(bot.id) &&
                            preferences.mutedBotIds.length >= 200)
                        }
                        onCheckedChange={(muted) =>
                          void save({
                            ...preferences,
                            mutedBotIds: muted
                              ? [...preferences.mutedBotIds, bot.id]
                              : preferences.mutedBotIds.filter((value) => value !== bot.id),
                          })
                        }
                      />
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {collection.error
                      ? "The bot list is unavailable."
                      : collection.isPending
                        ? "Loading bots…"
                        : "No bots to mute yet."}
                  </p>
                )}
              </div>
            </div>
          </div>
          {!canSave ? (
            <p className="text-xs text-muted-foreground">
              This connection cannot change notification preferences.
            </p>
          ) : null}
        </>
      )}
      {error || query.error || collection.error ? (
        <LibraryErrorNotice
          error={error ?? query.error ?? collection.error ?? ""}
          onRetry={() => {
            query.refresh();
            collection.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

export function BotBadgeSettings() {
  const { environments } = useSettingsScope();
  const target = useSettingsSearchTarget<HTMLDivElement>("bot-notification-dots");
  return (
    <div ref={target} id="bot-notification-dots" className="space-y-4 py-2">
      <h2 className="text-sm font-medium">Bot notification dots</h2>
      <p className="text-sm text-muted-foreground">
        Choose which updates light up the Bots badge. Preferences belong to each computer and apply
        across your connected devices.
      </p>
      {environments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Connect a computer to customize its bot notification dots.
        </p>
      ) : null}
      {environments.map((environment) => (
        <ComputerBadgeSettings
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
          connected={environment.connection.phase === "connected"}
          supported={supportsLoomFeature(
            environment.serverConfig?.environment.capabilities,
            BOTS_BADGE_PREFERENCES_FEATURE,
          )}
        />
      ))}
    </div>
  );
}
