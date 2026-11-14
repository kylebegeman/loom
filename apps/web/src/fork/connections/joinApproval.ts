import { type ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
import { joinPasskey as libraryJoinPasskey, type JoinPasskey } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { AccountJoinApproval } from "@t3tools/contracts/fork";
import {
  readPrimaryEnvironmentTarget,
  resolvePrimaryEnvironmentHttpUrl,
} from "~/environments/primary/target";
import { isElectron } from "~/env";
import { cancelLoomBrowserSignIn, confirmLoomApprovalBrowser } from "~/rpc/loomIdentity";

export type { JoinPasskey };

const NO_PASSKEY_TEXT =
  "This device cannot reach your Library's sign-in to confirm your passkey. Approve from Loom on your iPhone or another device.";

/** The Library this app runs on confirms the passkey itself when no saved route signed in. */
export function joinPasskey(input: {
  readonly authorityId: EnvironmentId;
  readonly features: ReadonlyArray<string> | undefined;
  readonly entry: ConnectionCatalogEntry | undefined;
  readonly isPrimary: boolean;
}): JoinPasskey {
  return libraryJoinPasskey({
    authorityId: input.authorityId,
    features: input.features,
    entry: input.entry,
    surface: isElectron ? "native" : "browser",
    httpBaseUrl:
      input.isPrimary && readPrimaryEnvironmentTarget() !== null
        ? new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin
        : undefined,
  });
}

/**
 * Starts the passkey check that approves one computer. Call it from the tap itself: a browser
 * opens the passkey window only while handling the tap.
 */
export function startJoinApproval(passkey: NonNullable<JoinPasskey>): Promise<AccountJoinApproval> {
  const target = passkey.target;
  if (target === null) return Promise.reject(new Error(NO_PASSKEY_TEXT));
  const proof = (result: { readonly code: string; readonly verifier: string }) =>
    ({ _tag: "passkey", code: result.code, verifier: result.verifier }) as const;
  if (window.desktopBridge?.confirmLoomApproval)
    return window.desktopBridge.confirmLoomApproval(target).then(proof);
  if (isElectron) return Promise.reject(new Error("Update Loom to approve computers here."));
  const popup = window.open("about:blank", "_blank", "popup,width=520,height=720");
  if (!popup) return Promise.reject(new Error("Allow the passkey window, then approve again."));
  return confirmLoomApprovalBrowser(target, popup).then(proof);
}

export function cancelJoinApproval(passkey: NonNullable<JoinPasskey>) {
  const target = passkey.target;
  if (target === null) return;
  if (window.desktopBridge?.cancelLoomSignIn)
    void window.desktopBridge.cancelLoomSignIn({ httpBaseUrl: target.httpBaseUrl });
  else cancelLoomBrowserSignIn(target.httpBaseUrl);
}
