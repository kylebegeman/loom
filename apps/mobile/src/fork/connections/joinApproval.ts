import type { JoinPasskey } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { AccountJoinApproval } from "@t3tools/contracts/fork";
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

import { confirmApprovalWithNativeIdentity } from "../library/nativeIdentitySignIn";
import { joinApprovalStore } from "./joinApprovalStore";

const NO_PASSKEY_TEXT =
  "This phone has no saved address for your Library's sign-in, so it cannot confirm your passkey. Approve from Loom on a computer.";

/** How approving reads on the surfaces that offer it. */
export const JOIN_APPROVAL_TEXT = `Approving asks for your passkey the first time, then ${
  Platform.OS === "ios" ? "Face ID or your passcode" : "your fingerprint or screen lock"
}.`;

const CANCELLED: ReadonlyArray<string> = ["user_cancel", "system_cancel", "app_cancel"];

/**
 * The proof that approves one computer, or null when the user cancels. The first approval asks for
 * the passkey; after that, Face ID or the passcode releases the token the Library issued with it.
 */
export async function approveJoin(input: {
  readonly passkey: NonNullable<JoinPasskey>;
  readonly authorityId: EnvironmentId;
  readonly label: string;
}): Promise<AccountJoinApproval | null> {
  const target = input.passkey.target;
  if (target === null) throw new Error(NO_PASSKEY_TEXT);
  const account = target.expectedIdentity?.subject ?? null;
  // Without a passcode nothing on the phone can guard a saved token, so each approval asks again.
  const guarded =
    (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  const token = guarded
    ? await joinApprovalStore.get(input.authorityId, account).catch(() => null)
    : null;
  if (token !== null) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Approve ${input.label}`,
    });
    if (result.success) return { _tag: "device", token };
    if (CANCELLED.includes(result.error)) return null;
    throw new Error("Your phone did not confirm it is you, so the computer was not approved.");
  }
  const proof = await confirmApprovalWithNativeIdentity({ target, device: guarded });
  if (proof === null) return null;
  if (proof.device)
    await joinApprovalStore.put(input.authorityId, account, proof.device).catch(() => {
      // This approval still goes through; the next one asks for the passkey again.
    });
  return { _tag: "passkey", code: proof.code, verifier: proof.verifier };
}

/** A refused token is spent or replaced, so the next approval asks for the passkey again. */
export function approvalRefused(authorityId: EnvironmentId, approval: AccountJoinApproval) {
  if (approval._tag === "device") void joinApprovalStore.remove(authorityId).catch(() => undefined);
}
