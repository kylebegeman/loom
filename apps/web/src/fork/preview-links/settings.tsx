import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { previewLibraryStatus, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  PREVIEW_LINK_LIFETIMES,
  PREVIEW_PAGES_FEATURE,
  type PreviewLinkLifetime,
  type PreviewLinksSnapshot,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { SecretInput } from "~/components/settings/SecretInput";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import {
  LoomSettingsActions,
  LoomSettingsContent,
  LoomSettingsField,
  LoomSettingsDetails,
  LoomSettingsPanel,
  LoomSettingsNotice,
} from "~/fork/settings/parts";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { ensureLocalApi } from "~/localApi";
import { useServerConfigs } from "~/state/entities";
import {
  LIFETIME_LABELS,
  draftFromSettings,
  gatewayStatus,
  settingsFromDraft,
  setupStatus,
  tunnelStatus,
  type SettingsDraft,
} from "./links";
import { EnvironmentPreviewPages } from "./pages";
import { failureOf, useAction } from "./parts";
import { FEATURE, openPreviewLinksSheet, previewLinks, runCommand } from "./state";

const LIFETIME_ITEMS = PREVIEW_LINK_LIFETIMES.map((value) => ({
  value,
  label: LIFETIME_LABELS[value],
}));

/** The server rejects shorter tokens; a Cloudflare connector token is far longer. */
const MIN_TOKEN_LENGTH = 20;

const NO_SETTINGS_ACCESS = "This connection cannot change preview settings.";
const NO_PREVIEW_ACCESS = "This connection cannot manage preview links.";

function EnvironmentPreviewLinks({
  environmentId,
  label,
  snapshot,
}: {
  environmentId: EnvironmentId;
  label: string;
  snapshot: PreviewLinksSnapshot;
}) {
  const { setup, links } = snapshot;
  const canSave = useAtomValue(previewLinks.configure.permissionAtom(environmentId));
  const canOperate = useAtomValue(previewLinks.revokeAll.permissionAtom(environmentId));
  const action = useAction();
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const shown = draft ?? draftFromSettings(setup.settings);
  const edit = (patch: Partial<SettingsDraft>) => {
    setSaved(false);
    setDraft({ ...shown, ...patch });
  };
  const parsed = settingsFromDraft(shown);
  const trimmedToken = token.trim();
  const tokenProblem =
    trimmedToken.length > 0 && trimmedToken.length < MIN_TOKEN_LENGTH
      ? "That connector token looks too short."
      : null;
  const problem = "problem" in parsed ? parsed.problem : tokenProblem;
  const dirty =
    JSON.stringify("settings" in parsed ? draftFromSettings(parsed.settings) : shown) !==
      JSON.stringify(draftFromSettings(setup.settings)) || trimmedToken.length > 0;
  const disabled = !canSave || action.busy;
  const status = setupStatus(setup);
  const library = previewLibraryStatus(setup);
  const openCount = links.filter((link) => link.state === "open").length;
  // Ending a container link removes its container, so only the other links can come back.
  const restoreNote = links.some(
    (link) => link.state === "open" && link.backing?.kind === "container",
  )
    ? "Port and folder links can be restored for 7 days; containers are removed."
    : openCount === 1
      ? "You can restore it for 7 days."
      : "You can restore them for 7 days.";

  const save = () =>
    void action.act("Unable to save preview settings", async () => {
      if (!("settings" in parsed) || tokenProblem) return;
      const next = parsed.settings;
      const moves =
        next.suffix !== setup.settings.suffix || next.machine !== setup.settings.machine;
      if (
        moves &&
        openCount > 0 &&
        !(await ensureLocalApi().dialogs.confirm(
          `A new domain or computer name changes every link address, so ${openCount === 1 ? "the open link ends" : `all ${openCount} open links end`}. Save anyway?`,
        ))
      ) {
        return;
      }
      await runCommand(previewLinks.configure, {
        environmentId,
        input:
          trimmedToken.length > 0
            ? { settings: next, tunnelToken: trimmedToken }
            : { settings: next },
      });
      setDraft(null);
      setToken("");
      setSaved(true);
    });

  const removeToken = () =>
    void action.act("Unable to remove the connector token", async () => {
      if (
        !(await ensureLocalApi().dialogs.confirm(
          `Remove the connector token from ${label}? Preview links stop working until you add one again.`,
        ))
      ) {
        return;
      }
      await runCommand(previewLinks.configure, {
        environmentId,
        input: { settings: setup.settings, tunnelToken: null },
      });
    });

  const signOutBrowsers = () =>
    void action.act("Unable to sign out preview browsers", async () => {
      if (
        !(await ensureLocalApi().dialogs.confirm(
          `Sign out every browser that opened a preview link on ${label}, and every browser reading pages published to your Library? They can get back in by opening a link from Loom or signing in to your Library again.`,
        ))
      ) {
        return;
      }
      await runCommand(previewLinks.signOutBrowsers, { environmentId, input: {} });
    });

  const endAll = () =>
    void action.act("Unable to end preview links", async () => {
      if (
        !(await ensureLocalApi().dialogs.confirm(
          openCount === 1
            ? `End the open preview link on ${label}? ${restoreNote}`
            : `End all ${openCount} open preview links on ${label}? ${restoreNote}`,
        ))
      ) {
        return;
      }
      await runCommand(previewLinks.revokeAll, { environmentId, input: {} });
    });

  return (
    <LoomSettingsContent className="flex flex-col gap-5">
      <LoomSettingsPanel
        title="Share development previews"
        description="Configure link addresses and defaults for this computer."
      >
        <SettingsRow
          className="px-0 sm:px-0"
          title="Share ports as links"
          description="Open this computer's dev servers from any device through your own domain. Each link opens only in a browser that entered from Loom or signed in to your Library."
          control={
            <Switch
              aria-label="Share ports as links"
              checked={shown.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => edit({ enabled })}
            />
          }
        />
        <SettingsRow className="px-0 sm:px-0" title="Link address">
          <div className="grid min-w-0 gap-4 pt-3 pb-2 sm:grid-cols-2">
            <LoomSettingsField
              label="Link domain"
              description="A domain whose wildcard record points at this computer's Cloudflare tunnel."
            >
              <Input
                aria-label="Link domain"
                size="sm"
                placeholder="example.com"
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                value={shown.suffix}
                onChange={(event) => edit({ suffix: event.target.value })}
              />
            </LoomSettingsField>
            <LoomSettingsField
              label="Computer name"
              description="Part of every link address, so each computer gets its own links."
            >
              <Input
                aria-label="Computer name"
                size="sm"
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                value={shown.machine}
                onChange={(event) => edit({ machine: event.target.value })}
              />
            </LoomSettingsField>
          </div>
        </SettingsRow>
        <SettingsRow
          className="px-0 sm:px-0"
          title="Default lifetime"
          description="How long a new link stays open. You can extend or end it later."
          control={
            <Select
              value={shown.defaultLifetime}
              disabled={disabled}
              items={LIFETIME_ITEMS}
              onValueChange={(value) => {
                if (value) edit({ defaultLifetime: value as PreviewLinkLifetime });
              }}
            >
              <SelectTrigger size="sm" aria-label="Default lifetime">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {LIFETIME_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </LoomSettingsPanel>
      <LoomSettingsDetails title="Cloudflare connection and gateway">
        <SettingsRow
          className="px-0 sm:px-0"
          title="Gateway port"
          description="The loopback port the tunnel forwards to. The tunnel's public hostname must use the same port."
          control={
            <Input
              aria-label="Gateway port"
              size="sm"
              className="w-full sm:w-24"
              type="number"
              min={1024}
              max={65535}
              inputMode="numeric"
              disabled={disabled}
              value={shown.gatewayPort}
              onChange={(event) => edit({ gatewayPort: event.target.value })}
            />
          }
        />
        <SettingsRow
          className="px-0 sm:px-0"
          title="Connector token"
          description="The token from your Cloudflare tunnel. It stays on this computer and is never shown again."
        >
          <div className="flex min-w-0 flex-wrap items-center gap-3 pt-3 pb-2">
            <div className="min-w-0 flex-1 basis-48">
              <SecretInput
                aria-label="Connector token"
                size="sm"
                configured={setup.tokenStored}
                disabled={disabled}
                value={token}
                onChange={(event) => {
                  setSaved(false);
                  setToken(event.target.value);
                }}
              />
            </div>
            {setup.tokenStored && (
              <Button size="sm" variant="outline" disabled={disabled} onClick={removeToken}>
                Remove
              </Button>
            )}
          </div>
        </SettingsRow>
      </LoomSettingsDetails>
      <div className="flex min-w-0 flex-col gap-3">
        <LoomSettingsNotice role={saved ? "status" : undefined}>
          {action.busy
            ? "Working..."
            : dirty
              ? "You have unsaved changes."
              : saved
                ? "Preview settings saved."
                : "Settings are up to date."}
        </LoomSettingsNotice>
        {dirty && problem && <LoomSettingsNotice role="alert">{problem}</LoomSettingsNotice>}
        <LoomSettingsActions>
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              disabled={action.busy}
              onClick={() => {
                setDraft(null);
                setToken("");
                setSaved(false);
              }}
            >
              Discard changes
            </Button>
          )}
          <Button
            size="sm"
            disabled={disabled || !dirty || problem !== null}
            title={canSave ? undefined : NO_SETTINGS_ACCESS}
            onClick={save}
          >
            Save settings
          </Button>
        </LoomSettingsActions>
      </div>
      <LoomSettingsPanel title="Connection status">
        <p className="text-sm font-medium">{status.label}</p>
        <dl className="grid min-w-0 gap-3 text-sm">
          <div className="grid min-w-0 gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
            <dt className="font-medium">Gateway</dt>
            <dd className="text-muted-foreground wrap-anywhere">{gatewayStatus(setup)}</dd>
          </div>
          <div className="grid min-w-0 gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
            <dt className="font-medium">Tunnel</dt>
            <dd className="text-muted-foreground wrap-anywhere">{tunnelStatus(setup)}</dd>
          </div>
          {library && (
            <div className="grid min-w-0 gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
              <dt className="font-medium">Library</dt>
              <dd
                className={
                  library.problem
                    ? "text-destructive-foreground wrap-anywhere"
                    : "text-muted-foreground wrap-anywhere"
                }
              >
                {library.label}: {library.detail}
              </dd>
            </div>
          )}
        </dl>
      </LoomSettingsPanel>
      <LoomSettingsPanel
        title="Manage access"
        description="Review open links or end access for preview browsers."
      >
        <SettingsRow
          className="px-0 sm:px-0"
          title="Open links"
          description={
            openCount === 0
              ? "No links are open on this computer."
              : `${openCount} ${openCount === 1 ? "link is" : "links are"} open on this computer.`
          }
        >
          <div className="pt-3 pb-2">
            <LoomSettingsActions>
              <Button size="sm" variant="outline" onClick={openPreviewLinksSheet}>
                Manage links
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canOperate || action.busy}
                title={canOperate ? undefined : NO_PREVIEW_ACCESS}
                onClick={signOutBrowsers}
              >
                Sign out preview browsers
              </Button>
              <Button
                size="sm"
                variant="destructive-outline"
                disabled={!canOperate || action.busy || openCount === 0}
                title={canOperate ? undefined : NO_PREVIEW_ACCESS}
                onClick={endAll}
              >
                End all links
              </Button>
            </LoomSettingsActions>
          </div>
        </SettingsRow>
      </LoomSettingsPanel>
    </LoomSettingsContent>
  );
}

function EnvironmentPreviewLinksLoader({
  environmentId,
  label,
}: {
  environmentId: EnvironmentId;
  label: string;
}) {
  const result = useAtomValue(previewLinks.snapshot({ environmentId, input: {} }));
  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const failure = failureOf(result);
  if (!snapshot) {
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        {failure ? (
          <>
            <LoomSettingsNotice role="alert">{failure}</LoomSettingsNotice>
            <LoomSettingsActions>
              <Button
                variant="outline"
                onClick={() =>
                  appAtomRegistry.refresh(previewLinks.snapshot({ environmentId, input: {} }))
                }
              >
                Try again
              </Button>
            </LoomSettingsActions>
          </>
        ) : (
          <LoomSettingsNotice role="status">Loading preview link settings...</LoomSettingsNotice>
        )}
      </LoomSettingsContent>
    );
  }
  return (
    <EnvironmentPreviewLinks environmentId={environmentId} label={label} snapshot={snapshot} />
  );
}

export function PreviewLinksSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>
          Select a connected environment to manage preview links.
        </LoomSettingsNotice>
      </LoomSettingsContent>
    );
  const config = configs.get(environment.environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, FEATURE))
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>
          This environment's server does not have preview links.
        </LoomSettingsNotice>
      </LoomSettingsContent>
    );
  return (
    <div key={environment.environmentId} className="flex min-w-0 flex-col">
      <EnvironmentPreviewLinksLoader
        environmentId={environment.environmentId}
        label={config?.environment.label ?? "this computer"}
      />
      {/* An older server answers no page requests, so its section would only ever fail. */}
      {supportsLoomFeature(config?.environment.capabilities, PREVIEW_PAGES_FEATURE) && (
        <EnvironmentPreviewPages environmentId={environment.environmentId} />
      )}
    </div>
  );
}
