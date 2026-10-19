import {
  isUnreachableLoopback,
  navigablePreviewUrlWith,
  parsePreviewNavigationUrl,
  type PreviewNavigationDeps,
} from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { Alert } from "react-native";

import { tryOpenExternalUrl, type ExternalUrlTarget } from "../../lib/openExternalUrl";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { environmentSession } from "../../state/session";
import { readPreviewComputers } from "./entryUrl";
import { connectionReachesLoopback, privateNetworkPortUrl } from "./previewLinksLogic";
import { previewLinks } from "./state";

const httpBaseUrl = (environmentId: EnvironmentId) =>
  Option.match(appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)), {
    onNone: () => null,
    onSome: (connection) => connection.httpBaseUrl,
  });

async function run<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}

const mobilePreviewNavigationDeps: PreviewNavigationDeps = {
  previewLinkEnvironments: () => readPreviewComputers().map(({ environmentId }) => environmentId),
  reachesLoopback: (environmentId) => connectionReachesLoopback(httpBaseUrl(environmentId)),
  privateNetworkUrl: (environmentId, url) => privateNetworkPortUrl(httpBaseUrl(environmentId), url),
  // The phone's own localhost is never the computer's.
  keepsTypedLoopbackOnPrivateNetwork: false,
  environmentLabel: (environmentId) =>
    appAtomRegistry.get(environmentPresentations.presentationAtom(environmentId))?.entry.target
      .label ?? "this computer",
  // Setup lives in the desktop and web apps; the phone only shows each computer's status.
  settingsPath: "Settings > Loom > Previews in the desktop or web app",
  share: (environmentId, input) => run(previewLinks.share, { environmentId, input }),
  open: (environmentId, input) => run(previewLinks.open, { environmentId, input }),
  reportFailure: (message) => Alert.alert("Unable to open preview", message),
};

/**
 * For a link in a thread. A port on the thread's computer that this phone cannot reach opens
 * through a preview link; anything else opens as it always did. False when nothing opened.
 */
export async function openThreadUrlExternally(
  environmentId: string | undefined,
  url: string,
  target: ExternalUrlTarget,
): Promise<boolean> {
  const parsed = parsePreviewNavigationUrl(url);
  if (
    environmentId === undefined ||
    parsed === null ||
    !isUnreachableLoopback(mobilePreviewNavigationDeps, EnvironmentId.make(environmentId), parsed)
  ) {
    return tryOpenExternalUrl(url, target);
  }
  const resolved = await navigablePreviewUrlWith(mobilePreviewNavigationDeps, {
    url,
    environmentId: EnvironmentId.make(environmentId),
    runtime: undefined,
  });
  return resolved !== null && tryOpenExternalUrl(resolved, target);
}
