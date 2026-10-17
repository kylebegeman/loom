import { useNavigation } from "@react-navigation/native";
import type { LibraryTimelineLink } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useLibraryAuthority } from "./libraryState";

/**
 * What the timeline and history search need from the Library and the computers around it: the
 * Library's capabilities, names for computers, and whether each one can open a live thread now.
 */
export function useLibraryActivity() {
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const hostLabel = (id: EnvironmentId) =>
    environments.find((env) => env.environmentId === id)?.label ??
    authority.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  const hostConnected = (id: EnvironmentId) => {
    const host = environments.find((env) => env.environmentId === id);
    return host?.entry.enabled === true && host.connection.phase === "connected";
  };
  return {
    authority,
    capabilities: config?.environment.capabilities,
    hostLabel,
    hostConnected,
  } as const;
}

/** Follows a timeline entry: the pull request, the live thread, or its saved history. */
export function useOpenLibraryTimelineLink(projectId: string) {
  const navigation = useNavigation();
  return useCallback(
    (link: LibraryTimelineLink) => {
      switch (link.kind) {
        case "pull-request":
          void tryOpenExternalUrl(link.url, "pull-request");
          return;
        case "thread":
          navigation.navigate("Thread", {
            environmentId: link.environmentId,
            threadId: link.threadId,
          });
          return;
        case "conversation":
          navigation.navigate("LibraryHistory", { projectId, archiveId: link.conversationId });
          return;
      }
    },
    [navigation, projectId],
  );
}
