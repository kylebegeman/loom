import { connectionRoutes, type ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
import { savedIdentitySignIn } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_JOIN_PASSKEY_FEATURE,
  type AccountJoinApproval,
  type LoomDesktopApprovalRequest,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import {
  readPrimaryEnvironmentTarget,
  resolvePrimaryEnvironmentHttpUrl,
} from "~/environments/primary/target";
import { isElectron } from "~/env";
import { cancelLoomBrowserSignIn, confirmLoomApprovalBrowser } from "~/rpc/loomIdentity";

/** Null where the Library approves without a passkey; `target` is null where this device cannot ask. */
export type JoinPasskey = { readonly target: LoomDesktopApprovalRequest | null } | null;

const NO_PASSKEY_TEXT =
  "This device cannot reach your Library's sign-in to confirm your passkey. Approve from Loom on your iPhone or another device.";

/**
 * Where this device confirms the owner's passkey for its Library: the saved Loom Identity route,
 * else the Library this app runs on, else any saved address of it.
 */
export function joinPasskey(input: {
  readonly authorityId: EnvironmentId;
  readonly features: ReadonlyArray<string> | undefined;
  readonly entry: ConnectionCatalogEntry | undefined;
  readonly isPrimary: boolean;
}): JoinPasskey {
  if (!input.features?.includes(ACCOUNT_JOIN_PASSKEY_FEATURE)) return null;
  const saved =
    input.entry === undefined
      ? null
      : savedIdentitySignIn(input.entry, isElectron ? "native" : "browser");
  if (saved !== null)
    return {
      target: {
        httpBaseUrl: saved.httpBaseUrl,
        expectedEnvironmentId: input.authorityId,
        expectedIdentity: saved.expectedIdentity,
      },
    };
  const httpBaseUrl =
    input.isPrimary && readPrimaryEnvironmentTarget() !== null
      ? new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin
      : (input.entry === undefined ? [] : connectionRoutes(input.entry))
          .map((route) => Option.getOrNull(route.profile))
          .find((profile) => profile?._tag === "BearerConnectionProfile")?.httpBaseUrl;
  return {
    target:
      httpBaseUrl === undefined ? null : { httpBaseUrl, expectedEnvironmentId: input.authorityId },
  };
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
