import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import {
  COMMAND_INTENTS,
  type CommandIntent,
  type ProjectProfile,
  type IntentCommand,
} from "@t3tools/contracts/fork";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Switch } from "~/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import {
  LoomSettingsContent,
  LoomSettingsPanel,
  LoomSettingsField,
  LoomSettingsActions,
  LoomSettingsNotice,
} from "~/fork/settings/parts";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { useProjects, useServerConfigs } from "~/state/entities";
import { FEATURE, profiles, profileError, runProfileCommand } from "./state";
import { buildProfilePatch, mixedValue, type ProfileDraft } from "./profileDraft";
import { PROFILE_SECTION_ROWS } from "./profileRows";
import { PROFILE_BINDING_SOURCES } from "./bindingSources";
interface Target {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  label: string;
}
const profileScopeAtoms = Atom.family((key: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(key) as Target[];
    return targets.map((target) => ({
      ...target,
      result: get(
        profiles.profile({
          environmentId: target.environmentId,
          input: { projectId: target.projectId },
        }),
      ),
      allowed: get(profiles.update.permissionAtom(target.environmentId)),
    }));
  }),
);
function AgentSharing({
  environmentId,
  label,
  supported,
}: {
  environmentId: EnvironmentId;
  label: string;
  supported: boolean;
}) {
  const query = useEnvironmentQuery(
    supported ? profiles.settings({ environmentId, input: {} }) : null,
  );
  const allowed = useAtomValue(profiles.updateSettings.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (agentTool: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await runProfileCommand(profiles.updateSettings, { environmentId, input: { agentTool } });
      query.refresh();
    } catch (cause) {
      setError(profileError(cause));
    }
    setBusy(false);
  };
  return (
    <LoomSettingsPanel
      title={`Agent access · ${label}`}
      description="Agents can read your notes, commands and env variable status (never values) with one tool."
    >
      <LoomSettingsField label="Share profile with agents">
        <Switch
          checked={query.data?.agentTool ?? true}
          disabled={!supported || !allowed || busy || query.data === null}
          onCheckedChange={(value) => void save(value)}
          aria-label={`Share profile with agents on ${label}`}
        />
      </LoomSettingsField>
      {!supported ? (
        <LoomSettingsNotice>
          This environment does not run Loom's project profiles.
        </LoomSettingsNotice>
      ) : query.error || error ? (
        <LoomSettingsNotice role="alert">{error ?? query.error}</LoomSettingsNotice>
      ) : null}
    </LoomSettingsPanel>
  );
}
function IntentEditor({
  intent,
  value,
  mixed,
  scripts,
  disabled,
  onChange,
}: {
  intent: CommandIntent;
  value: IntentCommand | undefined;
  mixed: boolean;
  scripts: readonly { id: string; name: string }[];
  disabled: boolean;
  onChange: (value: IntentCommand | null) => void;
}) {
  const selected =
    value?._tag === "action"
      ? `action:${value.scriptId}`
      : value?._tag === "command"
        ? "command"
        : mixed
          ? "mixed"
          : "none";
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <span className="pt-2 text-sm capitalize">{intent}</span>
      <div className="min-w-0 space-y-2">
        <Select
          value={selected}
          disabled={disabled}
          onValueChange={(next) => {
            if (!next || next === "mixed") return;
            onChange(
              next === "none"
                ? null
                : next === "command"
                  ? { _tag: "command", command: "" }
                  : { _tag: "action", scriptId: next.slice(7) },
            );
          }}
        >
          <SelectTrigger size="sm" aria-label={`${intent} command mapping`}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {mixed ? <SelectItem value="mixed">Mixed</SelectItem> : null}
            <SelectItem value="none">Not mapped</SelectItem>
            <SelectItem value="command">Literal command</SelectItem>
            {scripts.map((script) => (
              <SelectItem key={script.id} value={`action:${script.id}`}>
                {script.name}
              </SelectItem>
            ))}
            {value?._tag === "action" && !scripts.some((script) => script.id === value.scriptId) ? (
              <SelectItem value={`action:${value.scriptId}`}>
                Unavailable action ({value.scriptId})
              </SelectItem>
            ) : null}
          </SelectPopup>
        </Select>
        {value?._tag === "command" ? (
          <Input
            size="sm"
            aria-label={`${intent} literal command`}
            value={value.command}
            maxLength={2000}
            disabled={disabled}
            onChange={(event) => onChange({ _tag: "command", command: event.target.value })}
          />
        ) : null}
      </div>
    </div>
  );
}
export function ProfileSettingsSection() {
  const scope = useSettingsScope();
  const configs = useServerConfigs();
  const targets = scope.targets.flatMap((target) =>
    target.projectId !== null
      ? [{ environmentId: target.environmentId, projectId: target.projectId, label: target.label }]
      : [],
  );
  const supportedTargets = targets.filter((target) =>
    loomFeaturesOf(configs.get(target.environmentId)?.environment.capabilities).includes(FEATURE),
  );
  const key = JSON.stringify(supportedTargets);
  const records = useAtomValue(profileScopeAtoms(key));
  const loaded = records.flatMap((record) => {
    const profile = Option.getOrNull(AsyncResult.value(record.result));
    return profile ? [{ ...record, profile }] : [];
  });
  const errors = records.filter((record) => record.result._tag === "Failure");
  const missing = targets.length - supportedTargets.length;
  const offline =
    scope.scope.kind === "project" || scope.scope.kind === "checkout"
      ? scope.scope.members.filter(
          (member) =>
            !scope.connectedEnvironments.some(
              (environment) => environment.environmentId === member.environmentId,
            ),
        ).length
      : 0;
  return (
    <LoomSettingsContent>
      <div className="space-y-5">
        {scope.environments.map((environment) => (
          <AgentSharing
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label}
            supported={loomFeaturesOf(
              configs.get(environment.environmentId)?.environment.capabilities,
            ).includes(FEATURE)}
          />
        ))}
        {offline > 0 ? (
          <LoomSettingsNotice>
            {offline} selected checkouts are offline and will not receive changes.
          </LoomSettingsNotice>
        ) : null}
        {!targets.length ? (
          <LoomSettingsNotice>Choose a project to edit its Loom profile.</LoomSettingsNotice>
        ) : (
          <>
            {missing ? (
              <LoomSettingsNotice>
                {missing} selected checkouts do not support project profiles.
              </LoomSettingsNotice>
            ) : null}
            {errors.length ? (
              <LoomSettingsNotice role="alert">
                Could not load profiles on {errors.map((record) => record.label).join(", ")}.{" "}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    records.forEach((record) =>
                      appAtomRegistry.refresh(
                        profiles.profile({
                          environmentId: record.environmentId,
                          input: { projectId: record.projectId },
                        }),
                      ),
                    )
                  }
                >
                  Try again
                </Button>
              </LoomSettingsNotice>
            ) : null}
            {loaded.length !== records.length && !errors.length ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading project profiles...
              </p>
            ) : null}
            {loaded.length === records.length && loaded.length > 0 ? (
              <ProfileEditor key={key} records={loaded} />
            ) : null}
          </>
        )}
        {PROFILE_SECTION_ROWS.length ? (
          <LoomSettingsPanel title="More">
            {PROFILE_SECTION_ROWS.map((row) => (
              <row.Component key={row.id} />
            ))}
          </LoomSettingsPanel>
        ) : null}
      </div>
    </LoomSettingsContent>
  );
}
export function ProfileEditor({
  records: sourceRecords,
}: {
  records: readonly (Target & { profile: ProjectProfile; allowed: boolean })[];
}) {
  const allProjects = useProjects();
  const configs = useServerConfigs();
  const [saved, setSaved] = useState<
    ReadonlyMap<string, { source: ProjectProfile; profile: ProjectProfile }>
  >(new Map());
  const keyFor = (record: Target) => JSON.stringify([record.environmentId, record.projectId]);
  const records = sourceRecords.map((record) => {
    const local = saved.get(keyFor(record));
    return local?.source === record.profile ? { ...record, profile: local.profile } : record;
  });
  const [draft, setDraft] = useState<ProfileDraft>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const allowed = records.every((record) => record.allowed);
  const notes = mixedValue(records.map((record) => record.profile.agentNotes));
  const schemaPath = mixedValue(records.map((record) => record.profile.env.schemaPath));
  const varlock = mixedValue(records.map((record) => record.profile.env.varlock));
  const daily = mixedValue(records.map((record) => record.profile.budgets.dailyTokens));
  const thread = mixedValue(records.map((record) => record.profile.budgets.threadTokens));
  const first = records[0]!;
  const project = allProjects.find(
    (project) => project.environmentId === first.environmentId && project.id === first.projectId,
  );
  const config = configs.get(first.environmentId);
  const scripts = project && config ? resolveProjectScripts(config.settings, project) : [];
  const edit = (patch: Partial<ProfileDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  };
  const dirty = Object.keys(draft).length > 0;
  const invalid =
    Object.values(draft.commands ?? {}).some(
      (command) => command?._tag === "command" && !command.command.trim(),
    ) ||
    (draft.schemaPath !== undefined && !draft.schemaPath.trim()) ||
    [draft.dailyTokens, draft.threadTokens].some(
      (value) =>
        value !== undefined && value !== null && (!Number.isSafeInteger(value) || value <= 0),
    );
  const save = async (reset = false) => {
    if (!allowed || busy || (!reset && invalid)) return;
    setBusy(true);
    setMessage(null);
    const results = await Promise.all(
      records.map(async (record) => {
        try {
          const savedProfile = reset
            ? await runProfileCommand(profiles.reset, {
                environmentId: record.environmentId,
                input: { projectId: record.projectId },
              })
            : await runProfileCommand(profiles.update, {
                environmentId: record.environmentId,
                input: {
                  projectId: record.projectId,
                  patch: buildProfilePatch(record.profile, draft),
                },
              });
          appAtomRegistry.refresh(
            profiles.profile({
              environmentId: record.environmentId,
              input: { projectId: record.projectId },
            }),
          );
          return {
            label: record.label,
            ok: true,
            error: "",
            key: keyFor(record),
            profile: savedProfile,
          };
        } catch (error) {
          return {
            label: record.label,
            ok: false,
            error: profileError(error),
            key: keyFor(record),
            profile: null,
          };
        }
      }),
    );
    setSaved((current) => {
      const next = new Map(current);
      for (const [index, result] of results.entries()) {
        if (result.profile)
          next.set(result.key, { source: sourceRecords[index]!.profile, profile: result.profile });
      }
      return next;
    });
    const failed = results.filter((result) => !result.ok);
    setMessage(
      failed.length
        ? `Saved on ${results.length - failed.length} of ${results.length} checkouts. ${failed.map((result) => `${result.label}: ${result.error}`).join(" ")}`
        : reset
          ? "Project profile reset."
          : "Project profile saved.",
    );
    if (!failed.length) setDraft({});
    setBusy(false);
  };
  const commandFor = (intent: CommandIntent) =>
    mixedValue(records.map((record) => record.profile.commands[intent]));
  return (
    <LoomSettingsPanel
      title="Private project profile"
      description={`Changes apply to ${records.length} selected checkout${records.length === 1 ? "" : "s"}. Notes stay in each environment's database.`}
    >
      <LoomSettingsField
        label="Agent notes"
        description="Private Markdown, up to 8,000 characters. Insert with % in the composer or let agents read it with the profile tool."
      >
        <Textarea
          aria-label="Agent notes"
          maxLength={8000}
          disabled={!allowed || busy}
          value={draft.agentNotes ?? notes.value ?? ""}
          placeholder={notes.mixed ? "Mixed" : "What should an agent know about this project?"}
          onChange={(event) => edit({ agentNotes: event.target.value })}
        />
      </LoomSettingsField>
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Commands</h3>
        {COMMAND_INTENTS.map((intent) => {
          const value = commandFor(intent);
          const edited = draft.commands && Object.hasOwn(draft.commands, intent);
          return (
            <IntentEditor
              key={intent}
              intent={intent}
              value={edited ? (draft.commands?.[intent] ?? undefined) : value.value}
              mixed={!edited && value.mixed}
              scripts={scripts}
              disabled={!allowed || busy}
              onChange={(command) => edit({ commands: { ...draft.commands, [intent]: command } })}
            />
          );
        })}
        <p className="text-xs text-muted-foreground">
          Action mappings follow the selected action's current command. Across computers, action IDs
          must exist in each checkout.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          { key: "dailyTokens" as const, label: "Tokens per day for this project", saved: daily },
          { key: "threadTokens" as const, label: "Tokens per thread", saved: thread },
        ].map((field) => (
          <LoomSettingsField
            key={field.key}
            label={field.label}
            description="Advisory. Leave blank for no budget."
          >
            <Input
              size="sm"
              type="number"
              min={1}
              step={1}
              aria-label={field.label}
              disabled={!allowed || busy}
              value={
                draft[field.key] === undefined
                  ? (field.saved.value ?? "")
                  : (draft[field.key] ?? "")
              }
              placeholder={field.saved.mixed ? "Mixed" : "No budget"}
              onChange={(event) =>
                edit({ [field.key]: event.target.value === "" ? null : Number(event.target.value) })
              }
            />
          </LoomSettingsField>
        ))}
      </div>
      <LoomSettingsField label="Env schema path">
        <Input
          size="sm"
          aria-label="Env schema path"
          maxLength={512}
          disabled={!allowed || busy}
          value={draft.schemaPath ?? schemaPath.value ?? ""}
          placeholder={schemaPath.mixed ? "Mixed" : ".env.schema"}
          onChange={(event) => edit({ schemaPath: event.target.value })}
        />
      </LoomSettingsField>
      <LoomSettingsField label="Use varlock for commands">
        <Select
          disabled={!allowed || busy}
          value={draft.varlock ?? varlock.value ?? "mixed"}
          onValueChange={(value) => {
            if (value === "auto" || value === "never") edit({ varlock: value });
          }}
        >
          <SelectTrigger size="sm" aria-label="Use varlock for commands">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {varlock.mixed ? <SelectItem value="mixed">Mixed</SelectItem> : null}
            <SelectItem value="auto">Automatic</SelectItem>
            <SelectItem value="never">Never</SelectItem>
          </SelectPopup>
        </Select>
      </LoomSettingsField>
      {records.length === 1
        ? PROFILE_BINDING_SOURCES.map((source) => (
            <source.Component
              key={source.kind}
              profile={{ ...first.profile, bindings: draft.bindings ?? first.profile.bindings }}
              onChange={(bindings) => edit({ bindings })}
            />
          ))
        : null}
      <p className="text-xs text-muted-foreground">
        Models, permissions, worktrees and project actions are in{" "}
        <Link
          to="/settings/projects"
          search={(previous) => ({ ...previous, section: undefined })}
          className="underline"
        >
          Project settings
        </Link>
        .
      </p>
      {!allowed ? (
        <LoomSettingsNotice>
          Orchestration operate access is required on every selected environment.
        </LoomSettingsNotice>
      ) : null}
      {invalid ? (
        <LoomSettingsNotice role="alert">
          Enter a command, a schema path, and positive whole token budgets where provided.
        </LoomSettingsNotice>
      ) : null}
      {message ? <LoomSettingsNotice role="status">{message}</LoomSettingsNotice> : null}
      <LoomSettingsActions>
        <Button disabled={!allowed || busy || !dirty || invalid} onClick={() => void save()}>
          {busy ? "Saving..." : "Save profile"}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !dirty}
          onClick={() => {
            setDraft({});
            setMessage(null);
          }}
        >
          Discard changes
        </Button>
        <Button variant="ghost" disabled={!allowed || busy} onClick={() => void save(true)}>
          Reset profile
        </Button>
      </LoomSettingsActions>
    </LoomSettingsPanel>
  );
}
