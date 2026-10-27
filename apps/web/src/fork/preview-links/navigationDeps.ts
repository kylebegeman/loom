import type { PreviewNavigationDeps } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";
import {
  reachesEnvironmentLoopback,
  resolveBrowserNavigationTarget,
} from "~/browser/browserTargetResolver";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { readPreparedConnection } from "~/state/session";
import { readEnvironmentLabel, readPreviewLinkEnvironments } from "./capability";
import { previewLinks, runCommand } from "./state";

function reachesLoopback(environmentId: EnvironmentId): boolean {
  const connection = readPreparedConnection(environmentId);
  // Not connected yet: nothing can be shared, so leave the URL for the open to report.
  if (!connection) return true;
  if (reachesEnvironmentLoopback(connection.target)) return true;
  try {
    const host = new URL(connection.httpBaseUrl).hostname.replace(/^\[|\]$/g, "");
    return isLocalLoopbackHost(host);
  } catch {
    return true;
  }
}

function privateNetworkUrl(environmentId: EnvironmentId, url: URL): string | null {
  try {
    return resolveBrowserNavigationTarget(environmentId, {
      kind: "environment-port",
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      protocol: url.protocol === "https:" ? "https" : "http",
      path: `${url.pathname}${url.search}${url.hash}`,
    }).resolvedUrl;
  } catch {
    return null;
  }
}

export const appPreviewNavigationDeps: PreviewNavigationDeps = {
  previewLinkEnvironments: readPreviewLinkEnvironments,
  reachesLoopback,
  privateNetworkUrl,
  // As before links existed: a typed address stays as typed, and discovered ports arrive mapped.
  keepsTypedLoopbackOnPrivateNetwork: true,
  environmentLabel: readEnvironmentLabel,
  settingsPath: "Settings > Sharing & access > Preview links",
  share: (environmentId, input) => runCommand(previewLinks.share, { environmentId, input }),
  open: (environmentId, input) => runCommand(previewLinks.open, { environmentId, input }),
  reportFailure: (description) => {
    toastManager.add(
      stackedThreadToast({ type: "error", title: "Unable to open preview", description }),
    );
  },
};
