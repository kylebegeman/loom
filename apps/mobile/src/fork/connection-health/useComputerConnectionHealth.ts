import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import {
  CONNECTION_STALL_DETAIL,
  computerDirectoryHealth,
  computerDisplayLabel,
  connectionStallTitle,
  supportsLoomFeature,
  tailnetOnlyConnectionHint,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { DIRECTORY_FEATURE } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";

import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { useConnectionStall } from "./useConnectionStall";

import { directoryComputers } from "../directory-computers/state";

/** Opens the Identity sign-in for a computer that refused this phone's expired sign-in. */
export function useComputerSignIn(
  environmentId: EnvironmentId | null,
  connection: Pick<EnvironmentConnectionPresentation, "phase" | "blockedReason"> | null,
): (() => void) | null {
  const navigation = useNavigation();
  const saved = useSavedRemoteConnection(environmentId);
  if (
    environmentId === null ||
    saved?.identity === undefined ||
    connection?.phase !== "error" ||
    connection.blockedReason !== "authentication"
  ) {
    return null;
  }
  const address = saved.identityHttpBaseUrl;
  return () =>
    navigation.navigate("IdentitySignIn", { environmentId, ...(address ? { address } : {}) });
}

/**
 * What the Library's directory last heard from a computer this phone cannot reach. It reads the
 * listing live, since a kept one cannot say the computer is running now, and only while `enabled`
 * and the Library is connected. The same read offers the computer the routes the Library lists.
 */
function useDirectoryHealthText(
  environmentId: EnvironmentId | null,
  label: string,
  enabled: boolean,
): string | null {
  const preferences = useAtomValue(mobilePreferencesAtom);
  // The same preference `useLibraryAuthority` reads, without its Library queries.
  const chosen = AsyncResult.isSuccess(preferences)
    ? preferences.value["loom.library.authorityEnvironmentId"]
    : null;
  const libraryId = chosen ? EnvironmentId.make(chosen) : null;
  const config = useEnvironmentServerConfig(libraryId);
  const { presentation: library } = useEnvironmentPresentation(libraryId);
  const readable =
    enabled &&
    environmentId !== null &&
    libraryId !== environmentId &&
    library?.connection.phase === "connected" &&
    config !== null &&
    supportsLoomFeature(config.environment.capabilities, DIRECTORY_FEATURE);
  const live = useAtomValue(directoryComputers.listing(readable ? libraryId : null));
  if (!readable || environmentId === null || !AsyncResult.isSuccess(live) || live.waiting) {
    return null;
  }
  const health = computerDirectoryHealth({
    listing: live.value.listing,
    environmentId,
    label,
    now: Date.parse(live.value.fetchedAt),
  });
  return health === null ? null : [health.text, health.attention].filter(Boolean).join(" ");
}

export interface ComputerConnectionHealth {
  readonly label: string;
  /** "Can't reach Dorothy since 3:04 PM", once a reconnect has failed past the stall window. */
  readonly stallTitle: string | null;
  readonly signIn: (() => void) | null;
  /** What the Library's directory last heard from the computer, read while it is stalled. */
  readonly directoryHealth: string | null;
}

export function useComputerConnectionHealth(
  environmentId: EnvironmentId,
): ComputerConnectionHealth {
  const { presentation } = useEnvironmentPresentation(environmentId);
  const connection = presentation?.connection ?? null;
  const label = presentation === null ? "This computer" : computerDisplayLabel(presentation);
  const stall = useConnectionStall(connection);
  const signIn = useComputerSignIn(environmentId, connection);
  const directoryHealth =
    [
      useDirectoryHealthText(environmentId, label, stall !== null),
      presentation ? tailnetOnlyConnectionHint(presentation.entry, presentation.connection) : null,
    ]
      .filter(Boolean)
      .join(" ") || null;
  return {
    label,
    stallTitle: stall === null ? null : connectionStallTitle(label, stall.since, stall.at),
    signIn,
    directoryHealth,
  };
}

export interface ConnectionNoticeOverride {
  readonly title: string;
  readonly detail: string;
  /** Takes the place of Retry now, since only signing in fixes an expired sign-in. */
  readonly signIn: (() => void) | null;
}

/**
 * The full-screen connection notice for an expired sign-in this phone can renew, or for a
 * reconnect that has failed past the stall window, which stops promising progress. Null keeps
 * the plain notice.
 */
export function useConnectionNoticeOverride(input: {
  readonly environmentId?: EnvironmentId | undefined;
  readonly environmentLabel: string;
  readonly resourceName: string;
  readonly connection: EnvironmentConnectionPresentation;
}): ConnectionNoticeOverride | null {
  const { environmentLabel: label, resourceName } = input;
  const { presentation } = useEnvironmentPresentation(input.environmentId ?? null);
  const stall = useConnectionStall(input.connection);
  const signIn = useComputerSignIn(input.environmentId ?? null, input.connection);
  const directoryHealth = useDirectoryHealthText(
    input.environmentId ?? null,
    label,
    stall !== null,
  );
  if (signIn !== null) {
    return {
      title: `Sign in to ${label} again`,
      detail: `Your sign-in expired. The ${resourceName} will load once you sign in.`,
      signIn,
    };
  }
  if (stall === null) return null;
  return {
    title: connectionStallTitle(label, stall.since, stall.at),
    detail: [
      CONNECTION_STALL_DETAIL,
      directoryHealth,
      presentation ? tailnetOnlyConnectionHint(presentation.entry, input.connection) : null,
      `The ${resourceName} will load once ${label} connects.`,
    ]
      .filter(Boolean)
      .join(" "),
    signIn: null,
  };
}
