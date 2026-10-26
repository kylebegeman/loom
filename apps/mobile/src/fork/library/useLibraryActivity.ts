import { useNavigation } from "@react-navigation/native";
import type { LibraryTimelineLink } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";
import { useSelectWorkspaceDetail } from "../../features/workspace/useSelectWorkspaceDetail";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig } from "../../state/entities";
import { libraryFeatureState } from "./libraryLogic";
import { useLibraryAuthority } from "./libraryState";

/**
 * What the timeline and history search need from the Library and the computers around it: the
 * Library's capabilities, names for computers, and whether each one can open a live thread now.
 */
export function useLibraryActivity() {
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const capabilities = config?.environment.capabilities;
  const isConnected = (host: (typeof environments)[number] | undefined) =>
    host?.entry.enabled === true && host.connection.phase === "connected";
  const hostLabel = (id: EnvironmentId) =>
    environments.find((env) => env.environmentId === id)?.label ??
    authority.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  const hostConnected = (id: EnvironmentId) =>
    isConnected(environments.find((env) => env.environmentId === id));
  return {
    authority,
    capabilities,
    featureState: (feature: string) => libraryFeatureState(authority, capabilities, feature),
    hostLabel,
    hostConnected,
    // Changes exactly when `hostLabel` or `hostConnected` would answer differently, so lists
    // that keep row data stable still redraw rows that read them.
    hostsKey: [
      ...environments.map((env) => `${env.environmentId}=${env.label}:${isConnected(env) ? 1 : 0}`),
      ...authority.computers.map((entry) => `${entry.environmentId}=${entry.label}`),
    ].join("|"),
  } as const;
}

/** Follows a timeline entry: the pull request, the live thread, or its saved history. */
export function useOpenLibraryTimelineLink(projectId: string) {
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  return useCallback(
    (link: LibraryTimelineLink) => {
      switch (link.kind) {
        case "pull-request":
          void tryOpenExternalUrl(link.url, "pull-request");
          return;
        case "thread":
          selectDetail({
            name: "Thread",
            params: { environmentId: link.environmentId, threadId: link.threadId },
          });
          return;
        case "conversation":
          navigation.navigate("LibraryHistory", { projectId, archiveId: link.conversationId });
          return;
      }
    },
    [navigation, projectId, selectDetail],
  );
}
