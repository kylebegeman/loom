import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models"; // fork: project-lifecycle
import { useNavigate } from "@tanstack/react-router"; // fork: project-lifecycle
// fork: project-lifecycle
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type StorageCleanupReportEntry,
} from "@t3tools/contracts";
import { useThreadActions } from "../../hooks/useThreadActions"; // fork: project-lifecycle
import { useThreadShells } from "../../state/entities"; // fork: project-lifecycle
import { useEnvironmentScope } from "../../state/session"; // fork: project-lifecycle
import { ProjectCheckoutSettings } from "../../fork/project-checkout/ProjectCheckoutSettings"; // fork: project-checkout-management
import { ScopedPathField } from "../../fork/settings/PathField"; // fork: path-picker
import type {
  StorageCleanupReport,
  StorageCleanupSettings,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork"; // fork: mini-native-retention
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatBytes } from "../../lib/formatBytes";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { DatabaseStorageNotice } from "./DatabaseStorageNotice";
import { AdvancedSettings } from "./AdvancedSettings";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { SettingsGroup } from "./SettingsGroup";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";

export function WorktreesDirectoryRow() {
  const { connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreesDirectory"]);
  if (
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.worktreesDirectory !== true,
    )
  )
    return null;

  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      description={
        // fork: brand
        "Folder where new worktrees are created, on any drive. Existing worktrees stay where they are. Unset uses the Loom home folder."
      }
      serverScoped
      settingKeys={["worktreesDirectory"]}
      control={
        // fork: path-picker
        <ScopedPathField
          kind="folder"
          label="Worktree location"
          defaultLabel="Loom home folder"
          newFolder
          value={settings.worktreesDirectory}
          mixed={mixed}
          onChange={(next) => updateSettings({ worktreesDirectory: next })}
          className="w-full @min-[32rem]/settings-row:w-80"
        />
      }
    />
  );
}

function RetentionControl({
  label,
  value,
  onChange,
  minimum = 1,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  minimum?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={minimum}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(minimum, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={`Decrease ${label}`} />
            <NumberFieldInput
              aria-label={`${label} in days`}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              days
            </span>
            <NumberFieldIncrement aria-label={`Increase ${label}`} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">Off</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 8 : null)}
      />
    </div>
  );
}

const KEEP_WHEN_LABELS = {
  "any-local-files": "Any local files",
  "uncommitted-changes": "Uncommitted changes",
  "tracked-changes": "Edited tracked files",
} as const;

function lastRunSummary(
  entries: readonly { readonly label: string; readonly counts: string }[],
  machineCount: number,
) {
  const first = entries[0];
  if (!first) return "";
  if (machineCount <= 1) return first.counts;
  if (entries.length === machineCount && entries.every((entry) => entry.counts === first.counts)) {
    return `${first.counts} on every machine`;
  }
  return entries.map((entry) => `${entry.label}: ${entry.counts}`).join(" · ");
}

function CleanupResults({
  report,
  environmentLabel,
  // fork: project-lifecycle
  environmentId,
}: {
  report: StorageCleanupReport;
  environmentLabel: string;
  // fork: project-lifecycle
  environmentId: EnvironmentId;
}) {
  return (
    <>
      {report.entries.map((entry, index) => {
        const name =
          entry.kind === "worktree"
            ? ((entry.threadId === null
                ? entry.path
                : entry.path?.split(/[\\/]/).findLast(Boolean)) ?? "Worktrees")
            : entry.kind === "project" // fork: project-checkout-management
              ? (entry.path?.split(/[\\/]/).findLast(Boolean) ?? "Worktrees")
              : entry.kind === "scratch" // fork: mini-native-retention
                ? (entry.path?.split(/[\\/]/).findLast(Boolean) ?? "Scratch")
                : entry.kind === "logs"
                  ? "Rotated logs"
                  : "Browser artifacts";
        return (
          <SettingsRow
            key={`${entry.path ?? entry.kind}:${entry.threadId ?? index}`}
            title={<span className="wrap-anywhere select-text">{name}</span>}
            description={
              <span className="block space-y-2 wrap-anywhere select-text">
                <span className={`block ${entry.outcome === "failed" ? "text-destructive" : ""}`}>
                  {entry.reason}
                </span>
                <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-l border-border/60 pl-3">
                  <span>Machine</span>
                  <span className="text-foreground/80">{environmentLabel}</span>
                  {entry.projectPath && (
                    <>
                      <span>Project</span>
                      <code className="text-foreground/80">{entry.projectPath}</code>
                    </>
                  )}
                  {entry.path && (
                    <>
                      <span>Folder</span>
                      <code className="text-foreground/80">{entry.path}</code>
                    </>
                  )}
                  {entry.threadTitle && (
                    <>
                      <span>Thread</span>
                      <span>{entry.threadTitle}</span>
                    </>
                  )}
                </span>
              </span>
            }
            control={
              // fork: project-lifecycle
              <div className="flex flex-wrap items-center justify-end gap-2">
                <CleanupRowActions environmentId={environmentId} entry={entry} />
                {(entry.outcome === "removed" ||
                  (entry.outcome === "kept" && entry.bytes !== null)) && (
                  <span className="text-xs text-muted-foreground">
                    {[
                      // fork: mini-native-retention
                      entry.kind !== "worktree" && entry.kind !== "scratch" && entry.files !== null
                        ? `${entry.files.toLocaleString()} ${entry.files === 1 ? "file" : "files"}`
                        : null,
                      entry.bytes !== null ? formatBytes(entry.bytes) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </div>
            }
          />
        );
      })}
      {report.omittedCount > 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {environmentLabel}: {report.omittedCount.toLocaleString()} more results.
        </p>
      )}
      {report.entries.length === 0 && report.omittedCount === 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {environmentLabel}: Nothing needed cleanup.
        </p>
      )}
    </>
  );
}

// fork: project-lifecycle
function CleanupRowActions({
  environmentId,
  entry,
}: {
  environmentId: EnvironmentId;
  entry: StorageCleanupReportEntry;
}) {
  const navigate = useNavigate();
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const allowed = useAtomValue(serverEnvironment.runStorageCleanup.permissionAtom(environmentId));
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const actions = useThreadActions();
  const threads = useThreadShells();
  const thread = threads.find(
    (thread) => thread.environmentId === environmentId && thread.id === entry.threadId,
  );
  const [pending, setPending] = useState(false);
  if (entry.kind !== "worktree" || entry.outcome !== "kept") return null;
  const remove = async () => {
    if (!entry.path || pending) return;
    setPending(true);
    try {
      const result = await run({ environmentId, input: { removeOrphanPath: entry.path } });
      if (result._tag === "Success") {
        const row = result.value.entries.find((row) => row.path === entry.path);
        toastManager.add({
          type: row?.outcome === "removed" ? "success" : "error",
          title: row?.reason ?? "Worktree removal did not complete",
        });
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      {entry.threadId ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: entry.threadId! },
            })
          }
        >
          Open conversation
        </Button>
      ) : null}
      {thread &&
      threadRuntimeCanArchive(thread.runtime) &&
      thread.settledOverride !== "settled" &&
      thread.archivedAt === null ? (
        <Button
          size="xs"
          variant="outline"
          disabled={!canOperate || pending}
          onClick={() => {
            setPending(true);
            void actions
              .settleThread({ environmentId, threadId: thread.id })
              .finally(() => setPending(false));
          }}
        >
          Settle
        </Button>
      ) : null}
      {entry.canRemove && entry.threadId === null ? (
        <Button
          size="xs"
          variant="destructive-outline"
          disabled={!allowed || pending}
          onClick={() => void remove()}
        >
          {pending ? "Removing..." : "Remove"}
        </Button>
      ) : null}
    </>
  );
}

const storageCleanupReportsAtom = environmentAtomList(
  "web-storage-cleanup-reports",
  (environmentId) => serverEnvironment.storageCleanupReport({ environmentId, input: {} }),
);
const storageCleanupPermissionsAtom = environmentAtomList(
  "web-storage-cleanup-permissions",
  serverEnvironment.runStorageCleanup.permissionAtom,
);

function CleanupSection() {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const { connectedEnvironments } = useSettingsScope();
  const [pending, setPending] = useState(false);
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
  );
  const supportedIds = supported.map(({ environmentId }) => environmentId);
  const reports = useAtomValue(storageCleanupReportsAtom(environmentIdsKey(supportedIds)));
  const permissions = useAtomValue(storageCleanupPermissionsAtom(environmentIdsKey(supportedIds)));
  const state = supportedIds.map((environmentId, index) => {
    const query = reports[index]!;
    return {
      environmentId,
      allowed: permissions[index]!,
      report: query._tag === "Success" ? query.value : null,
      loading: query.waiting,
      failed: query._tag === "Failure",
    };
  });
  const hasRules = supported.some((environment) => {
    const settings = environment.serverConfig?.settings;
    if (!settings) return false;
    const enabled = (rules: WorktreeCleanupRules) =>
      rules.worktreeAfterDays !== null ||
      rules.worktreeSettledAfterDays !== null ||
      rules.worktreeOnMerge ||
      rules.worktreeOnDelete ||
      rules.worktreeOnSettle || // fork: project-lifecycle
      rules.worktreeOnLand || // fork: project-lifecycle
      rules.worktreeUnchanged;
    return (
      // fork: project-checkout-management
      settings.storageCleanup.projectAfterDays !== null ||
      settings.storageCleanup.projectOnSettle || // fork: project-checkout-management
      settings.storageCleanup.scratchAfterDays !== null || // fork: mini-native-retention
      settings.storageCleanup.browserArtifactsAfterDays !== null ||
      settings.storageCleanup.logsAfterDays !== null ||
      enabled(resolveWorktreeCleanup(settings, null)) ||
      Object.values(settings.projectSettingsOverrides).some(
        (override) =>
          override.worktreeCleanup?.mode === "custom" && enabled(override.worktreeCleanup.rules),
      )
    );
  });
  if (supported.length === 0) return null;
  const summaries = supported.map((environment) => {
    const query = state.find((entry) => entry.environmentId === environment.environmentId);
    const report = query?.report ?? null;
    return {
      environment,
      report,
      label: settingsScopeEnvironmentLabel(environment, connectedEnvironments),
      counts: report
        ? `${report.counts.removed} removed, ${report.counts.kept} kept${report.counts.failed > 0 ? `, ${report.counts.failed} failed` : ""}`
        : "",
      description: report
        ? `Last run ${formatRelativeTimeLabel(report.finishedAt, nowMs)}. ${formatBytes(report.bytesFreed)} recovered.${report.counts.failed > 0 ? ` ${report.counts.failed} ${report.counts.failed === 1 ? "item" : "items"} couldn't be removed.` : ""}`
        : query?.failed
          ? "Could not load the last run."
          : query?.loading
            ? "Loading last run…"
            : "Cleanup hasn't run yet.",
    };
  });
  const deleteNow = async () => {
    if (pending) return;
    setPending(true);
    await Promise.all(
      supported
        .filter((environment) =>
          state.some((entry) => entry.environmentId === environment.environmentId && entry.allowed),
        )
        .map(async (environment) => {
          const result = await run({ environmentId: environment.environmentId, input: {} });
          if (result._tag === "Success") {
            const failures = result.value.entries.filter((entry) => entry.outcome === "failed");
            if (failures.length > 0)
              toastManager.add({
                type: "error",
                title: `Cleanup failed on ${environment.label}`,
                description: failures[0]!.reason,
              });
          } else if (!isAtomCommandInterrupted(result)) {
            toastManager.add({
              type: "error",
              title: `Could not run cleanup on ${environment.label}`,
              description: String(squashAtomCommandFailure(result)),
            });
          }
        }),
    ).finally(() => setPending(false));
  };
  return (
    <SettingsSection id="storage-cleanup" title="Cleanup" variant="plain">
      <SettingsGroup>
        <SettingsRow
          {...searchableSetting("storage-delete-now")}
          description={
            <span>
              {!hasRules
                ? "Turn on a cleanup rule to use this."
                : summaries.map(({ environment, label, description }) => (
                    <span key={environment.environmentId} className="block">
                      {supported.length > 1 ? `${label}: ` : ""}
                      {description}
                    </span>
                  ))}
            </span>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !hasRules || !state.some((entry) => entry.allowed)}
              onClick={() => void deleteNow()}
            >
              {pending ? "Deleting…" : "Delete now"}
            </Button>
          }
        />
      </SettingsGroup>
      {summaries.some(({ report }) => report !== null) && (
        <FoldedSettingsSection
          id="storage-cleanup-last-run"
          title="Last run"
          headerPlacement="inside"
          summary={lastRunSummary(
            summaries.filter(({ report }) => report !== null),
            connectedEnvironments.length,
          )}
        >
          {summaries.map(
            ({ environment, label, report }) =>
              report && (
                <CleanupResults
                  key={environment.environmentId}
                  report={report}
                  // fork: project-lifecycle
                  environmentId={environment.environmentId}
                  environmentLabel={label}
                />
              ),
          )}
        </FoldedSettingsSection>
      )}
    </SettingsSection>
  );
}

// fork: file-placement - Each computer's Projects folder, for new projects and Library files.
export function ProjectsDirectoryRow() {
  const { connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["projectsDirectory"]);
  if (connectedEnvironments.some((environment) => !environment.serverConfig?.folders)) return null;

  return (
    <SettingsRow
      {...searchableSetting("storage-projects-location")}
      description="Folder where Loom puts new projects and prepared Library files. Existing projects stay where they are. Unset uses the Loom home folder."
      serverScoped
      settingKeys={["projectsDirectory"]}
      control={
        <ScopedPathField
          kind="folder"
          label="Projects folder"
          defaultLabel="Loom home folder"
          newFolder
          value={settings.projectsDirectory}
          mixed={mixed}
          onChange={(next) => updateSettings({ projectsDirectory: next })}
          className="w-full @min-[32rem]/settings-row:w-80"
        />
      }
    />
  );
}

function supportsStorageCleanup(
  environments: ReadonlyArray<{
    readonly serverConfig: {
      readonly environment: { readonly capabilities: { readonly storageCleanup?: boolean } };
    } | null;
  }>,
) {
  return environments.every(
    (environment) => environment.serverConfig?.environment.capabilities.storageCleanup === true,
  );
}

/** Narrows a mixed selection to the machines that support cleanup. */
function StorageCleanupScopeNotice() {
  const { connectedEnvironments } = useSettingsScope();
  return (
    <SettingsScopeNotice
      inline
      target="environment"
      eligibleEnvironmentIds={connectedEnvironments
        .filter(
          (environment) =>
            environment.serverConfig?.environment.capabilities.storageCleanup === true,
        )
        .map((environment) => environment.environmentId)}
    >
      Update the selected environments to use storage cleanup, or choose a machine that supports it.
    </SettingsScopeNotice>
  );
}

export function WorktreeCleanupSection() {
  const { scope, environments, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (target) =>
        ({ ...target.settings.storageCleanup, ...resolveWorktreeCleanup(target.settings, null) })[
          key
        ] !== settings[key],
    )
      ? "Mixed across selected machines"
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);

  if (
    isProjectScope &&
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return (
      <SettingsSection id="storage-worktrees" title="Cleanup" variant="plain">
        <SettingsScopeNotice inline target="all">
          Update the selected machines to configure project worktree cleanup.
        </SettingsScopeNotice>
      </SettingsSection>
    );
  }
  if (!supportsStorageCleanup(connectedEnvironments)) {
    return (
      <SettingsSection id="storage-worktrees" title="Cleanup" variant="plain">
        <StorageCleanupScopeNotice />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection id="storage-worktrees" title="Cleanup">
      <>
        {isProjectScope && (
          <SettingsRow
            title="Automatic worktree cleanup"
            description={
              mode === "off"
                ? "Keep this project's worktrees until you delete them manually."
                : mode === "custom"
                  ? "Use these rules for this project."
                  : "Use each machine's worktree cleanup settings."
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <Select
                value={mixedModes ? null : mode}
                onValueChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else if (next === "custom")
                    updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              >
                <SelectTrigger size="sm" aria-label="Automatic worktree cleanup">
                  <SelectValue>
                    {mixedModes
                      ? "Mixed"
                      : mode === "inherit"
                        ? "Inherit"
                        : mode === "off"
                          ? "Off"
                          : "Custom"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">Inherit</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        )}
        {(!isProjectScope || (!mixedModes && mode === "custom")) && (
          <>
            {/* fork: project-lifecycle */}
            <SettingsRow
              title="Release settled worktrees once pushed"
              status={ruleStatus("worktreeOnSettle")}
              description="Release a worktree as soon as every thread using it settles and its branch is pushed. Unlike Delete settled worktrees, it never waits and keeps any worktree with local files. Continuing the conversation restores it and runs setup."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Release settled worktrees once pushed"
                  checked={settings.worktreeOnSettle}
                  onCheckedChange={(worktreeOnSettle) => updateWorktree({ worktreeOnSettle })}
                />
              }
            />
            {/* fork: project-lifecycle - older servers decode the setting but never run it. */}
            {connectedEnvironments.length > 0 &&
              connectedEnvironments.every((environment) =>
                loomFeaturesOf(environment.serverConfig?.environment.capabilities).includes(
                  "landed-worktree-cleanup",
                ),
              ) && (
                <SettingsRow
                  title="Delete landed worktrees and branches"
                  status={ruleStatus("worktreeOnLand")}
                  description="Remove a worktree and its local branch once its commits are on the default branch, with or without a pull request, and every thread using it is settled or archived. Worktrees with local changes are kept."
                  serverScoped={!isProjectScope}
                  control={
                    <Switch
                      aria-label="Delete landed worktrees and branches"
                      checked={settings.worktreeOnLand}
                      onCheckedChange={(worktreeOnLand) => updateWorktree({ worktreeOnLand })}
                    />
                  }
                />
              )}
            <SettingsRow
              title="Delete worktrees with deleted threads"
              status={ruleStatus("worktreeOnDelete")}
              description="Remove unused worktrees when active or archived threads are deleted. Worktrees with local changes are kept."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete worktrees with deleted threads"
                  checked={settings.worktreeOnDelete}
                  onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title="Delete merged worktrees"
              status={ruleStatus("worktreeOnMerge")}
              description="Remove worktrees whose pull request is merged and whose commits are included in the default branch."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete merged worktrees"
                  checked={settings.worktreeOnMerge}
                  onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
                />
              }
            />
            <SettingsRow
              title="Delete inactive worktrees"
              status={ruleStatus("worktreeAfterDays")}
              description="Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept."
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label="Delete inactive worktrees"
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            <AdvancedSettings
              // The keep-when search result lands on this section, not its row.
              targetIds={["storage-worktrees", searchableSetting("storage-worktree-keep-when").id]}
            >
              {connectedEnvironments.length > 0 &&
                connectedEnvironments.every(
                  (environment) =>
                    environment.serverConfig?.environment.capabilities.settledWorktreeCleanup ===
                    true,
                ) && (
                  <SettingsRow
                    title="Delete settled worktrees"
                    status={[
                      ruleStatus("worktreeSettledAfterDays"),
                      environments.length > connectedEnvironments.length
                        ? "Offline machines will not get this setting"
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(". ")}
                    description="Remove worktrees this many days after their thread settles. Set 0 days to remove them at the next cleanup. Branches and thread history are kept."
                    serverScoped={!isProjectScope}
                    control={
                      <RetentionControl
                        label="Delete settled worktrees"
                        value={settings.worktreeSettledAfterDays}
                        minimum={0}
                        onChange={(worktreeSettledAfterDays) =>
                          updateWorktree({ worktreeSettledAfterDays })
                        }
                      />
                    }
                  />
                )}
              <SettingsRow
                title="Delete unchanged worktrees"
                status={ruleStatus("worktreeUnchanged")}
                description="Remove worktrees with no commits beyond the default branch."
                serverScoped={!isProjectScope}
                control={
                  <Switch
                    aria-label="Delete unchanged worktrees"
                    checked={settings.worktreeUnchanged}
                    onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
                  />
                }
              />
              {connectedEnvironments.every(
                (environment) =>
                  environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
              ) && (
                <SettingsRow
                  {...searchableSetting("storage-worktree-keep-when")}
                  status={ruleStatus("worktreeKeepWhen")}
                  description={
                    settings.worktreeKeepWhen === "any-local-files"
                      ? "Includes ignored files, except node_modules."
                      : settings.worktreeKeepWhen === "tracked-changes"
                        ? "Deletes untracked and ignored files, including .env."
                        : "Keeps edits and untracked files. Deletes ignored files, including .env."
                  }
                  serverScoped={!isProjectScope}
                  control={
                    <Select
                      value={ruleStatus("worktreeKeepWhen") ? null : settings.worktreeKeepWhen}
                      onValueChange={(next) => {
                        if (
                          next === "any-local-files" ||
                          next === "uncommitted-changes" ||
                          next === "tracked-changes"
                        )
                          updateWorktree({ worktreeKeepWhen: next });
                      }}
                    >
                      <SelectTrigger size="sm" aria-label="Keep worktrees with local changes">
                        <SelectValue>
                          {ruleStatus("worktreeKeepWhen")
                            ? "Mixed"
                            : KEEP_WHEN_LABELS[settings.worktreeKeepWhen]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        <SelectItem value="any-local-files">Any local files</SelectItem>
                        <SelectItem value="uncommitted-changes">Uncommitted changes</SelectItem>
                        <SelectItem value="tracked-changes">Edited tracked files</SelectItem>
                      </SelectPopup>
                    </Select>
                  }
                />
              )}
            </AdvancedSettings>
          </>
        )}
      </>
    </SettingsSection>
  );
}

/** Retention for logs and captures, and the manual cleanup run, which covers worktrees too. */
export function StorageCleanupSections() {
  const { scope, connectedEnvironments, targets } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  if (scope.kind === "project" || scope.kind === "checkout")
    return <ProjectCheckoutSettings projects={scope.members} />; // fork: project-checkout-management
  const settings = scopedSettings.storageCleanup;
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some((target) => target.settings.storageCleanup[key] !== settings[key])
      ? "Mixed across selected machines"
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const databaseStorageNotice = (
    <DatabaseStorageNotice
      environments={connectedEnvironments.filter(
        (environment) =>
          environment.serverConfig?.environment.capabilities.databaseStorage === true,
      )}
    />
  );
  if (!supportsStorageCleanup(connectedEnvironments)) {
    return (
      <>
        {databaseStorageNotice}
        <SettingsSection id="storage-artifacts" title="Artifacts and logs" variant="plain">
          <StorageCleanupScopeNotice />
        </SettingsSection>
      </>
    );
  }

  return (
    <>
      {databaseStorageNotice}
      {/* fork: project-checkout-management */}
      {connectedEnvironments.every((environment) =>
        loomFeaturesOf(environment.serverConfig?.environment.capabilities).includes(
          "managed-project-checkouts",
        ),
      ) && (
        <SettingsSection id="storage-projects" title="Project checkouts">
          <SettingsRow
            title="Release settled project checkouts"
            status={ruleStatus("projectOnSettle")}
            description="Release published project folders managed by Loom after all conversations settle. Folders without reviewed ownership, per-project Keep choices, pinned conversations, active work, local files and linked worktrees are protected."
            control={
              <Switch
                aria-label="Release settled project checkouts"
                checked={settings.projectOnSettle}
                onCheckedChange={(projectOnSettle) => update({ projectOnSettle })}
              />
            }
          />
          <SettingsRow
            title="Release inactive project checkouts"
            status={ruleStatus("projectAfterDays")}
            description="Release safe published project folders managed by Loom after this many inactive days, unless a project has its own storage choice. Projects and conversations stay available; using a released project restores its saved revision and reruns setup."
            control={
              <RetentionControl
                label="Release inactive project checkouts"
                value={settings.projectAfterDays}
                onChange={(projectAfterDays) => update({ projectAfterDays })}
              />
            }
          />
          {/* fork: project-lifecycle - servers without folders ignore this setting. */}
          {connectedEnvironments.every((environment) => environment.serverConfig?.folders) && (
            <SettingsRow
              title="Release unused Library files"
              status={ruleStatus("unusedCopiesAfterDays")}
              description="Release Library files prepared on a computer that no conversation used, this many days after they were prepared or updated. Files used in a conversation are released once their conversations settle, whatever this is set to. Files you chose to keep, existing checkouts Loom reused and unpublished work stay."
              serverScoped
              control={
                <RetentionControl
                  label="Release unused Library files"
                  value={settings.unusedCopiesAfterDays}
                  onChange={(unusedCopiesAfterDays) => update({ unusedCopiesAfterDays })}
                />
              }
            />
          )}
        </SettingsSection>
      )}
      {/* fork: mini-native-retention */}
      {connectedEnvironments.every((environment) =>
        loomFeaturesOf(environment.serverConfig?.environment.capabilities).includes(
          "mini-native-retention",
        ),
      ) && (
        <SettingsSection id="storage-scratch" title="Scratch">
          <SettingsRow
            title="Release inactive Scratch folders"
            status={ruleStatus("scratchAfterDays")}
            description="Release clean Scratch repositories after this many inactive days. Pinned conversations and unsaved files are kept. Saved work and checkpoints are restored when you continue."
            serverScoped
            control={
              <RetentionControl
                label="Release inactive Scratch folders"
                value={settings.scratchAfterDays}
                onChange={(scratchAfterDays) => update({ scratchAfterDays })}
              />
            }
          />
        </SettingsSection>
      )}
      <SettingsSection id="storage-artifacts" title="Artifacts and logs">
        <SettingsRow
          title="Delete old browser artifacts"
          status={ruleStatus("browserArtifactsAfterDays")}
          description="Delete saved browser captures after this many days. Older capture links will no longer open."
          serverScoped
          control={
            <RetentionControl
              label="Delete old browser artifacts"
              value={settings.browserArtifactsAfterDays}
              onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
            />
          }
        />
        <SettingsRow
          title="Delete old rotated logs"
          status={ruleStatus("logsAfterDays")}
          description="Delete inactive rotated log files after this many days. Current logs are kept."
          serverScoped
          control={
            <RetentionControl
              label="Delete old rotated logs"
              value={settings.logsAfterDays}
              onChange={(logsAfterDays) => update({ logsAfterDays })}
            />
          }
        />
      </SettingsSection>
      <CleanupSection />
    </>
  );
}
