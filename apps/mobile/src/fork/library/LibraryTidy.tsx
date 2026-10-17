import { useAtomValue } from "@effect/atom-react";
import { useNavigation, usePreventRemove, type StaticScreenProps } from "@react-navigation/native";
import {
  isRestingEntry,
  libraryActiveCopies,
  libraryCopyRemovalPermission,
  libraryTidyReasonLabel,
  libraryTidySuggestions,
  projectEntries,
  runLibraryTidy,
  supportsLoomFeature,
  type LibraryTidyCopyResult,
  type LibraryTidyResult,
  type ProjectEntry,
} from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  type LibraryCopyHealth,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useResolveClassNames } from "uniwind";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { RowPressable } from "../../components/ui/RowPressable";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import {
  library,
  refreshLibraryProject,
  refreshLibraryWork,
  useLibraryAuthority,
} from "./libraryState";

/** Matches web's projects page, so both clients call the same projects resting. */
const THREAD_INDEX_LIMIT = 100;

/**
 * Every Library project with its copies and latest activity. Null until all three have loaded:
 * before the conversation index arrives every project would look resting.
 */
function useLibraryProjectEntries() {
  const authority = useLibraryAuthority();
  const environmentId = authority.environmentId;
  const catalog = useEnvironmentQuery(
    environmentId ? library.projects({ environmentId, input: { includeArchived: true } }) : null,
  );
  const copies = useEnvironmentQuery(
    environmentId ? library.copies({ environmentId, input: {} }) : null,
  );
  const index = useEnvironmentQuery(
    environmentId
      ? library.threadIndex({ environmentId, input: { limit: THREAD_INDEX_LIMIT } })
      : null,
  );
  const entries =
    catalog.data && copies.data && index.data
      ? projectEntries(catalog.data, libraryActiveCopies(copies.data), index.data)
      : null;
  return {
    entries,
    error: catalog.error ?? copies.error ?? index.error,
    refresh: () => {
      catalog.refresh();
      copies.refresh();
      index.refresh();
    },
  };
}

/** Live projects quiet for two weeks, each offering Tidy. Shows nothing until activity is known. */
export function LibraryRestingProjects() {
  const navigation = useNavigation();
  const { entries } = useLibraryProjectEntries();
  const [now] = useState(Date.now);
  const resting = (entries ?? []).filter(
    (entry) => !entry.project.archived && isRestingEntry(entry, now),
  );
  if (!resting.length) return null;
  return (
    <SettingsSection
      title="Resting"
      footer="Quiet for two weeks. Tidy up removes the copies that hold nothing unsaved and can archive the project."
    >
      {resting.map((entry, index) => (
        <RestingProjectRow
          key={entry.project.id}
          entry={entry}
          separated={index > 0}
          onPress={() => navigation.navigate("LibraryTidy", { projectId: entry.project.id })}
        />
      ))}
    </SettingsSection>
  );
}

function RestingProjectRow(props: {
  entry: ProjectEntry;
  separated: boolean;
  onPress: () => void;
}) {
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  const label = `Tidy up ${props.entry.project.title}`;
  const detail = `Last active ${relativeTime(props.entry.activeAt)} ago`;
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      onPress={props.onPress}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      className={cn("bg-grouped-card", props.separated && "border-t border-border-subtle")}
    >
      <View className="min-h-14 justify-center gap-1 px-4 py-3">
        <Text className="text-base text-foreground">{label}</Text>
        <Text className="text-sm text-foreground-muted">{detail}</Text>
      </View>
    </RowPressable>
  );
}

export function LibraryTidyRouteScreen({
  route,
}: StaticScreenProps<{ readonly projectId: string }>) {
  const { entries, error, refresh } = useLibraryProjectEntries();
  const entry = entries?.find((candidate) => candidate.project.id === route.params.projectId);
  if (entry) return <LibraryTidyContent key={entry.project.id} entry={entry} />;
  return (
    <LibraryPage title="Tidy up" back>
      <LibraryNotice
        error={error}
        detail={
          error ? null : entries ? "This project is no longer in your Library." : "Loading project…"
        }
        onRetry={error ? refresh : undefined}
      />
    </LibraryPage>
  );
}

/**
 * Which computers let this client release a managed copy, and which let it unregister a borrowed
 * one. Removal runs on the copy's computer, so the Library's grants do not cover it.
 */
function useRemovalPermissions(copies: readonly LibraryWorkingCopy[]) {
  const key = JSON.stringify([...new Set(copies.map((copy) => copy.environmentId))].sort());
  const atom = useMemo(
    () => libraryCopyRemovalPermission(library, JSON.parse(key) as EnvironmentId[]),
    [key],
  );
  return useAtomValue(atom);
}

const commandValue = <A,>(result: AtomCommandResult<A, unknown>): A => {
  if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
  return result.value;
};

/**
 * Winds down a resting project in one confirmation: removes the copies that hold nothing unsaved
 * and archives the project if chosen. Every copy is checked again right before it is removed.
 */
function LibraryTidyContent(props: { entry: ProjectEntry }) {
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  // Held as opened, like web's dialog, so the lists stay put while the Library refreshes.
  const [entry] = useState(props.entry);
  const [now] = useState(Date.now);
  const readHealth = useAtomCommand(library.readCopyHealth, { reportFailure: false });
  const readStatus = useAtomCommand(library.readCopyStatus, { reportFailure: false });
  const release = useAtomCommand(library.releaseCopy, { reportFailure: false });
  const unregister = useAtomCommand(library.unregisterCopy, { reportFailure: false });
  const register = useAtomCommand(library.registerCopy, { reportFailure: false });
  const archive = useAtomCommand(library.archiveProject, { reportFailure: false });
  const canRegister = useAtomValue(library.registerCopy.permissionAtom(authority.environmentId));
  const canArchive = useAtomValue(library.archiveProject.permissionAtom(authority.environmentId));
  const host = (id: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === id);
  const connected = (id: EnvironmentId) => {
    const environment = host(id);
    return environment?.entry.enabled === true && environment.connection.phase === "connected";
  };
  const hostLabel = (id: EnvironmentId) =>
    host(id)?.label ??
    authority.computers.find((computer) => computer.environmentId === id)?.label ??
    "Saved computer";
  const [health, setHealth] = useState<readonly LibraryCopyHealth[] | null>(null);
  const [archiveChosen, setArchiveChosen] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<readonly LibraryTidyCopyResult[]>([]);
  const [result, setResult] = useState<LibraryTidyResult | null>(null);
  usePreventRemove(running, () => undefined);
  // Retrying a step after a lost reply reuses its request, so it is never applied twice.
  const requestIds = useRef(new Map<string, string>());
  const requestId = (key: string) => {
    const existing = requestIds.current.get(key);
    if (existing) return existing;
    const created = uuidv4();
    requestIds.current.set(key, created);
    return created;
  };

  const copies = libraryActiveCopies(entry.copies);
  const canRemove = useRemovalPermissions(copies);
  // Read once on open, only from copies whose computer offers health checks.
  const [checkable] = useState(() =>
    copies.filter(
      (copy) =>
        copy.state === "ready" &&
        connected(copy.environmentId) &&
        supportsLoomFeature(
          host(copy.environmentId)?.serverConfig?.environment.capabilities,
          LIBRARY_COPY_HEALTH_FEATURE,
        ),
    ),
  );
  useEffect(() => {
    let cancelled = false;
    // An unreadable copy simply has no health, which keeps it out of the safe list.
    void Promise.all(
      checkable.map((copy) =>
        readHealth({ environmentId: copy.environmentId, input: { workingCopyId: copy.id } }).then(
          (read) => (AsyncResult.isSuccess(read) ? [read.value] : []),
        ),
      ),
    ).then((reads) => {
      if (!cancelled) setHealth(reads.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [checkable, readHealth]);

  const suggestions = libraryTidySuggestions({
    entry,
    health: health ?? [],
    connected,
    canRemove,
    now,
  });
  const willArchive = suggestions.suggestArchive && archiveChosen;
  const nothingToDo = !suggestions.safe.length && !willArchive;
  const blocked =
    !authority.environmentId ||
    !authority.connected ||
    (suggestions.safe.length > 0 && !canRegister) ||
    (willArchive && !canArchive);

  const confirm = async () => {
    const authorityId = authority.environmentId;
    if (!authorityId || running) return;
    setRunning(true);
    const outcome = await runLibraryTidy({
      copies: suggestions.safe,
      archive: willArchive,
      connected,
      canRemove,
      readStatus: async (copy) =>
        commandValue(
          await readStatus({
            environmentId: copy.environmentId,
            input: { workingCopyId: copy.id },
          }),
        ),
      remove: async (status, reviewToken) => {
        const remove = status.copy.ownership === "borrowed" ? unregister : release;
        return commandValue(
          await remove({
            environmentId: status.copy.environmentId,
            input: {
              requestId: requestId(`remove:${status.copy.id}`),
              workingCopyId: status.copy.id,
              reviewToken,
            },
          }),
        );
      },
      register: async (copy) => {
        commandValue(
          await register({
            environmentId: authorityId,
            input: { requestId: requestId(`register:${copy.id}`), copy },
          }),
        );
      },
      archiveProject: async () => {
        commandValue(
          await archive({
            environmentId: authorityId,
            input: {
              requestId: requestId("archive"),
              projectId: entry.project.id,
              expectedRevision: entry.project.revision,
              archived: true,
            },
          }),
        );
      },
      progress: setProgress,
    });
    setResult(outcome);
    setRunning(false);
    refreshLibraryProject(authorityId, entry.project.id);
    refreshLibraryWork(authorityId, entry.project.id);
    appAtomRegistry.refresh(library.copies({ environmentId: authorityId, input: {} }));
    appAtomRegistry.refresh(
      library.threadIndex({ environmentId: authorityId, input: { limit: THREAD_INDEX_LIMIT } }),
    );
  };

  const settled = new Map(
    (result?.copies ?? progress).map((outcome) => [outcome.copy.id, outcome]),
  );
  const remaining = result?.copies.filter((outcome) => outcome.outcome !== "released") ?? [];
  return (
    <LibraryPage title={`Tidy up ${entry.project.title}`} back>
      <Text className="text-sm text-foreground-muted">
        {result
          ? remaining.length || result.archive?.ok === false
            ? "Some of this needs another look. Everything listed below was left as it was."
            : "Done. The project and its saved conversations stay in your Library."
          : "This project has been quiet for two weeks. Remove the copies that hold nothing unsaved, and archive the project if you are done with it for now."}
      </Text>
      {suggestions.suggestArchive || result?.archive ? (
        <SettingsSection footer="It leaves the project pickers and the current list. Its conversations stay readable, and you can restore it any time from Archived.">
          <SettingsSwitchRow
            label="Archive the project"
            value={result ? result.archive !== null : archiveChosen}
            disabled={running || result !== null}
            onValueChange={setArchiveChosen}
          />
        </SettingsSection>
      ) : null}
      {result?.archive?.ok === false ? <LibraryNotice error={result.archive.message} /> : null}
      {health === null && checkable.length ? (
        <LibraryNotice detail="Checking each copy for uncommitted and unpushed work…" />
      ) : (
        <>
          <CopyGroup
            title={`Safe to remove (${suggestions.safe.length})`}
            footer={
              suggestions.safe.length
                ? "Nothing uncommitted or unpushed. Each copy is checked again just before it is removed."
                : copies.length
                  ? "No copy is safe to remove right now."
                  : "No copies on your computers."
            }
            rows={suggestions.safe.map((copy) => {
              const outcome = settled.get(copy.id);
              return {
                copy,
                detail: rowDetail(copy, outcome, running),
                tone:
                  outcome?.outcome === "failed"
                    ? "danger"
                    : outcome && outcome.outcome !== "released"
                      ? "warning"
                      : "muted",
              };
            })}
            hostLabel={hostLabel}
          />
          {suggestions.attention.length ? (
            <CopyGroup
              title={`Needs attention (${suggestions.attention.length})`}
              footer="Tidy leaves these alone. Open the project to commit, push or remove them yourself."
              rows={suggestions.attention.map(({ copy, reasons }) => ({
                copy,
                detail: reasons.map(libraryTidyReasonLabel).join(" · "),
                tone: "warning",
              }))}
              hostLabel={hostLabel}
            />
          ) : null}
        </>
      )}
      {blocked && !result ? (
        <Text className="text-xs text-foreground-muted">
          {authority.connected
            ? "You do not have permission to change this project."
            : "Connect to your Library to tidy this project."}
        </Text>
      ) : null}
      {result ? (
        <Button label="Done" tone="primary" onPress={() => navigation.goBack()} />
      ) : (
        <Button
          label={running ? "Tidying…" : "Tidy up"}
          tone="primary"
          disabled={running || health === null || nothingToDo || blocked}
          onPress={() => {
            void confirm();
          }}
        />
      )}
    </LibraryPage>
  );
}

function rowDetail(
  copy: LibraryWorkingCopy,
  outcome: LibraryTidyCopyResult | undefined,
  running: boolean,
): string {
  const borrowed = copy.ownership === "borrowed";
  if (!outcome)
    return running
      ? "Waiting…"
      : borrowed
        ? "Stops using this folder. Its files stay."
        : "Removes the files on this computer.";
  switch (outcome.outcome) {
    case "released":
      return borrowed ? "No longer used" : "Removed";
    case "kept":
      return `Kept: ${outcome.reasons.map(libraryTidyReasonLabel).join(" · ")}`;
    case "blocked":
      return `Kept: ${outcome.blockers.join(" ") || "It can't be removed right now."}`;
    case "failed":
      return `Not removed: ${outcome.message}`;
  }
}

const DETAIL_TONE = {
  muted: "text-foreground-muted",
  warning: "text-warning-foreground",
  danger: "text-danger-foreground",
} as const;

function CopyGroup(props: {
  title: string;
  footer: string;
  rows: readonly {
    readonly copy: LibraryWorkingCopy;
    readonly detail: string;
    readonly tone: keyof typeof DETAIL_TONE;
  }[];
  hostLabel: (id: EnvironmentId) => string;
}) {
  if (!props.rows.length)
    return (
      <SettingsSection title={props.title}>
        <Text className="p-4 text-sm text-foreground-muted">{props.footer}</Text>
      </SettingsSection>
    );
  return (
    <SettingsSection title={props.title} footer={props.footer}>
      {props.rows.map(({ copy, detail, tone }, index) => (
        <View
          key={copy.id}
          accessible
          accessibilityLabel={`${props.hostLabel(copy.environmentId)}, ${copy.rootPath}. ${detail}`}
          className={cn("gap-1 px-4 py-3", index > 0 && "border-t border-border-subtle")}
        >
          <Text className="text-sm text-foreground" numberOfLines={1}>
            {props.hostLabel(copy.environmentId)}
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            {copy.rootPath}
          </Text>
          <Text className={cn("text-xs", DETAIL_TONE[tone])}>{detail}</Text>
        </View>
      ))}
    </SettingsSection>
  );
}
