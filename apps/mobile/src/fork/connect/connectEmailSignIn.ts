/** The email-code path works without another application's native OAuth allowlist. */
export type ConnectSecondFactor = "totp" | "email_code" | "phone_code" | "backup_code";
export interface ConnectEmailSignIn {
  readonly status: string | null;
  readonly supportedSecondFactors?: ReadonlyArray<{ readonly strategy: string }>;
  readonly emailCode: {
    readonly sendCode: (params?: { emailAddress?: string }) => Promise<{ error: unknown }>;
    readonly verifyCode: (params: { code: string }) => Promise<{ error: unknown }>;
  };
  readonly mfa?: {
    readonly sendEmailCode: () => Promise<{ error: unknown }>;
    readonly sendPhoneCode: () => Promise<{ error: unknown }>;
    readonly verifyEmailCode: (params: { code: string }) => Promise<{ error: unknown }>;
    readonly verifyPhoneCode: (params: { code: string }) => Promise<{ error: unknown }>;
    readonly verifyTOTP: (params: { code: string }) => Promise<{ error: unknown }>;
    readonly verifyBackupCode: (params: { code: string }) => Promise<{ error: unknown }>;
  };
  readonly finalize: () => Promise<{ error: unknown }>;
}

export const CONNECT_FACTOR_LABELS = {
  totp: "Authenticator app",
  email_code: "Email code",
  phone_code: "Text message",
  backup_code: "Backup code",
} as const;
const SECOND_FACTORS: readonly ConnectSecondFactor[] = [
  "totp",
  "email_code",
  "phone_code",
  "backup_code",
];

export function connectSecondFactors(signIn: ConnectEmailSignIn): ConnectSecondFactor[] {
  return SECOND_FACTORS.filter((strategy) =>
    signIn.supportedSecondFactors?.some((factor) => factor.strategy === strategy),
  );
}

export function normalizeConnectEmail(value: string): string {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address for your Connect account.");
  }
  return email;
}

export async function sendConnectEmailCode(signIn: ConnectEmailSignIn, email: string) {
  const result = await signIn.emailCode.sendCode({ emailAddress: normalizeConnectEmail(email) });
  if (result.error) throw result.error;
}

function needsSecondFactor(signIn: ConnectEmailSignIn) {
  return signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust";
}

async function finishConnectSignIn(
  signIn: ConnectEmailSignIn,
): Promise<"complete" | "second-factor"> {
  if (needsSecondFactor(signIn) && connectSecondFactors(signIn).length) return "second-factor";
  if (signIn.status !== "complete") {
    throw new Error(
      "This account requires a sign-in method unavailable here. Connect this phone with a pairing link, or manage the account's sign-in methods in the browser.",
    );
  }
  const active = await signIn.finalize();
  if (active.error) throw active.error;
  return "complete";
}

/** Activation feeds the existing CloudAuthBridge, including account cleanup and discovery. */
export async function verifyConnectEmailCode(signIn: ConnectEmailSignIn, value: string) {
  if (needsSecondFactor(signIn)) return finishConnectSignIn(signIn);
  const code = value.trim();
  if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit code from your email.");
  if (signIn.status !== "complete") {
    const result = await signIn.emailCode.verifyCode({ code });
    if (result.error) throw result.error;
  }
  return finishConnectSignIn(signIn);
}

export async function prepareConnectSecondFactor(
  signIn: ConnectEmailSignIn,
  strategy: ConnectSecondFactor,
) {
  if (
    !needsSecondFactor(signIn) ||
    !connectSecondFactors(signIn).includes(strategy) ||
    !signIn.mfa
  ) {
    throw new Error(
      "This verification method is no longer available. Restart sign-in and try again.",
    );
  }
  const result =
    strategy === "email_code"
      ? await signIn.mfa.sendEmailCode()
      : strategy === "phone_code"
        ? await signIn.mfa.sendPhoneCode()
        : null;
  if (result?.error) throw result.error;
}

export async function verifyConnectSecondFactor(
  signIn: ConnectEmailSignIn,
  strategy: ConnectSecondFactor,
  value: string,
) {
  const code = value.trim();
  if (!code || (strategy !== "backup_code" && !/^\d{6}$/.test(code))) {
    throw new Error(
      strategy === "backup_code"
        ? "Enter an unused backup code."
        : "Enter a six-digit verification code.",
    );
  }
  if (signIn.status !== "complete") {
    if (!signIn.mfa || !connectSecondFactors(signIn).includes(strategy)) {
      throw new Error(
        "This verification method is no longer available. Restart sign-in and try again.",
      );
    }
    const mfa = signIn.mfa;
    const methods = {
      email_code: () => mfa.verifyEmailCode({ code }),
      phone_code: () => mfa.verifyPhoneCode({ code }),
      totp: () => mfa.verifyTOTP({ code }),
      backup_code: () => mfa.verifyBackupCode({ code }),
    };
    const result = await methods[strategy]();
    if (result.error) throw result.error;
  }
  return finishConnectSignIn(signIn);
}

export function connectEmailSignInError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray(error.errors)
  ) {
    const detail: unknown = error.errors[0];
    if (detail && typeof detail === "object" && "code" in detail) {
      if (detail.code === "form_identifier_not_found") {
        return "No Connect account uses this email yet. Create your account in the browser, then return here to sign in.";
      }
      if (detail.code === "form_code_incorrect")
        return "That code is incorrect. Check the code and try again.";
      if (detail.code === "verification_expired")
        return "That code expired. Send a new code and try again.";
      if (detail.code === "too_many_requests")
        return "Too many attempts. Wait a moment, then try again.";
    }
  }
  if (error instanceof Error && !error.message.startsWith("Clerk:")) return error.message;
  return "Could not sign in. Check your connection and try again.";
}

/** Hosted account pages use HTTPS and never depend on a native OAuth callback. */
export function connectAccountPageUrl(portal: string | null, page: "sign-up" | "user"): string {
  if (!portal) throw new Error("The Connect account portal is not configured for this app.");
  const url = new URL(portal);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("The Connect account portal must be an HTTPS origin.");
  }
  return new URL(`/${page}`, url).toString();
}
