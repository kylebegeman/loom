import { useAtomValue } from "@effect/atom-react";
import {
  effectiveLibraryCopyHealth,
  libraryRepositoryCanPull,
  libraryRepositoryHealthSummary,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  LIBRARY_COPY_HEALTH_PUBLISHED_FEATURE,
  type LibraryProject,
  type LibraryRepositoryHealth,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { library, useRefreshOnRefocus } from "./libraryState";

const ago = (iso: string) => `${relativeTime(iso)} ago`;

const repositoryTitle = (project: LibraryProject, resourceId: string) =>
  project.resources.find((resource) => resource.id === resourceId)?.title ?? resourceId;

/**
 * Branch and change counts for a ready copy. Live from its computer when that computer is
 * connected and advertises copy health, otherwise the last report the Library kept. Computers and
 * Libraries without either feature show nothing.
 */
export function LibraryCopyHealth(props: {
  project: LibraryProject;
  copy: LibraryWorkingCopy;
  connected: boolean;
  computerLabel: string;
  authorityEnvironmentId: EnvironmentId;
  /** When the Library last heard from the copy's computer. */
  lastSeenAt: string | undefined;
}) {
  const copyConfig = useEnvironmentServerConfig(props.copy.environmentId);
  const authorityConfig = useEnvironmentServerConfig(props.authorityEnvironmentId);
  const live = supportsLoomFeature(
    copyConfig?.environment.capabilities,
    LIBRARY_COPY_HEALTH_FEATURE,
  );
  const published = supportsLoomFeature(
    authorityConfig?.environment.capabilities,
    LIBRARY_COPY_HEALTH_PUBLISHED_FEATURE,
  );
  if (props.copy.state !== "ready") return null;
  if (props.connected && live)
    return (
      <LiveCopyHealth
        project={props.project}
        copy={props.copy}
        published={published}
        lastSeenAt={props.lastSeenAt}
      />
    );
  return published ? (
    <PublishedCopyHealth
      project={props.project}
      copy={props.copy}
      lastSeenAt={props.lastSeenAt}
      offlineLabel={props.connected ? null : props.computerLabel}
    />
  ) : null;
}

export function LibraryReadFailure(props: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <View className="gap-1">
      <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
        {props.message}
      </Text>
      <Button
        label={props.retrying ? "Checking…" : "Try again"}
        tone="text"
        disabled={props.retrying}
        onPress={props.onRetry}
      />
    </View>
  );
}

function RepositoryHealthList(props: {
  project: LibraryProject;
  repositories: readonly LibraryRepositoryHealth[];
  renderAction?: (repository: LibraryRepositoryHealth) => ReactNode;
  footer: ReactNode;
}) {
  return (
    <View className="gap-2">
      <View accessibilityLabel="Repositories" className="gap-2 rounded-xl bg-subtle p-3">
        {props.repositories.map((repository) => (
          <View key={repository.resourceId} className="gap-1">
            <Text className="text-sm font-t3-medium text-foreground">
              {repositoryTitle(props.project, repository.resourceId)}
            </Text>
            <Text
              className={cn(
                "text-xs",
                repository.error ? "text-warning-foreground" : "text-foreground-muted",
              )}
            >
              {libraryRepositoryHealthSummary(repository)}
            </Text>
            {props.renderAction?.(repository)}
          </View>
        ))}
      </View>
      {props.footer}
    </View>
  );
}

/** Renders nothing when the copy's computer never reported, which is never the same as clean. */
function PublishedCopyHealth(props: {
  project: LibraryProject;
  copy: LibraryWorkingCopy;
  lastSeenAt: string | undefined;
  /** The computer's name when it is not connected here. */
  offlineLabel: string | null;
  /** Why the live read that would replace this report is missing. */
  failure?: ReactNode;
}) {
  const effective = effectiveLibraryCopyHealth({
    copy: props.copy,
    live: null,
    lastSeenAt: props.lastSeenAt,
  });
  if (effective === null) return null;
  return (
    <RepositoryHealthList
      project={props.project}
      repositories={effective.health.repositories}
      footer={
        <View className="gap-1">
          <Text className="text-xs text-foreground-muted">
            Last reported {ago(effective.asOf)}
            {props.offlineLabel === null ? null : ` · ${props.offlineLabel} offline`}
          </Text>
          {props.failure}
        </View>
      }
    />
  );
}

/** Until the live read arrives, or when it fails, the last published health stands in. */
function LiveCopyHealth(props: {
  project: LibraryProject;
  copy: LibraryWorkingCopy;
  published: boolean;
  lastSeenAt: string | undefined;
}) {
  const { copy } = props;
  const health = useEnvironmentQuery(
    library.copyHealth({ environmentId: copy.environmentId, input: { workingCopyId: copy.id } }),
  );
  useRefreshOnRefocus(health.refresh);
  const pull = useAtomCommand(vcsEnvironment.pull, { reportFailure: false });
  const canPull = useAtomValue(vcsEnvironment.pull.permissionAtom(copy.environmentId));
  const refreshRemote = useAtomCommand(library.refreshCopyHealth, { reportFailure: false });
  // The server checks the same read scope it uses for vcs.refreshStatus.
  const canRefreshRemote = useEnvironmentScope(copy.environmentId, AuthOrchestrationReadScope);
  const [pulling, setPulling] = useState<string | null>(null),
    [checkingRemote, setCheckingRemote] = useState(false),
    [actionError, setActionError] = useState<string | null>(null);
  const busy = pulling !== null || checkingRemote;
  async function pullRepository(resourceId: string, cwd: string) {
    setPulling(resourceId);
    setActionError(null);
    const result = await pull({ environmentId: copy.environmentId, input: { cwd } });
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setActionError(cause instanceof Error ? cause.message : "Could not pull the latest changes.");
    }
    setPulling(null);
    health.refresh();
  }
  async function checkRemote() {
    setCheckingRemote(true);
    setActionError(null);
    const result = await refreshRemote({
      environmentId: copy.environmentId,
      input: { workingCopyId: copy.id, refreshRemote: true },
    });
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setActionError(cause instanceof Error ? cause.message : "Could not check the remote.");
    } else if (result.value.repositories.some((repository) => repository.fetchFailed)) {
      setActionError("Could not reach the remote. Counts are from the last fetch.");
    }
    setCheckingRemote(false);
    // The fetch updated the remote refs, so a plain read now shows the new counts.
    health.refresh();
  }
  const data = health.data;
  const failure = health.error ? (
    <LibraryReadFailure
      message="Could not check this copy."
      retrying={health.isPending}
      onRetry={health.refresh}
    />
  ) : null;
  if (
    data === null &&
    props.published &&
    effectiveLibraryCopyHealth({ copy, live: null, lastSeenAt: props.lastSeenAt }) !== null
  )
    return (
      <PublishedCopyHealth
        project={props.project}
        copy={copy}
        lastSeenAt={props.lastSeenAt}
        offlineLabel={null}
        failure={failure}
      />
    );
  if (data === null)
    return (
      failure ??
      (health.isPending ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          Checking repositories…
        </Text>
      ) : null)
    );
  return (
    <RepositoryHealthList
      project={props.project}
      repositories={data.repositories}
      renderAction={(repository) => {
        const cwd = copy.repositories.find(
          (entry) => entry.resourceId === repository.resourceId,
        )?.path;
        return cwd !== undefined && canPull && libraryRepositoryCanPull(repository) ? (
          <Button
            label={pulling === repository.resourceId ? "Pulling…" : "Pull"}
            tone="text"
            disabled={busy}
            onPress={() => void pullRepository(repository.resourceId, cwd)}
          />
        ) : null;
      }}
      footer={
        <View className="gap-1">
          <Text className="text-xs text-foreground-muted">Checked {ago(data.checkedAt)}</Text>
          {failure}
          {canRefreshRemote ? (
            <Button
              label={checkingRemote ? "Checking…" : "Check remote"}
              tone="text"
              disabled={busy}
              onPress={() => void checkRemote()}
            />
          ) : null}
          {actionError ? (
            <Text accessibilityLiveRegion="polite" className="text-xs text-warning-foreground">
              {actionError}
            </Text>
          ) : null}
        </View>
      }
    />
  );
}
