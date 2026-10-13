import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  connectAccountPageUrl,
  connectSecondFactors,
  prepareConnectSecondFactor,
  verifyConnectEmailCode,
  verifyConnectSecondFactor,
  type ConnectSecondFactor,
} from "./connectEmailSignIn";

function fixture(status = "needs_second_factor") {
  const signIn = {
    status,
    supportedSecondFactors: [
      { strategy: "totp" },
      { strategy: "email_code" },
      { strategy: "phone_code" },
      { strategy: "backup_code" },
    ],
    emailCode: {
      sendCode: vi.fn(async () => ({ error: null as unknown })),
      verifyCode: vi.fn(async (_params: { code: string }) => {
        signIn.status = "needs_second_factor";
        return { error: null as unknown };
      }),
    },
    mfa: {
      sendEmailCode: vi.fn(async () => ({ error: null as unknown })),
      sendPhoneCode: vi.fn(async () => ({ error: null as unknown })),
      verifyEmailCode: vi.fn(async (_params: { code: string }) => complete()),
      verifyPhoneCode: vi.fn(async (_params: { code: string }) => complete()),
      verifyTOTP: vi.fn(async (_params: { code: string }) => complete()),
      verifyBackupCode: vi.fn(async (_params: { code: string }) => complete()),
    },
    finalize: vi.fn(async () => ({ error: null as unknown })),
  };
  function complete() {
    signIn.status = "complete";
    return { error: null as unknown };
  }
  return signIn;
}

const verificationMethods = [
  ["email_code", "verifyEmailCode", "123456"],
  ["phone_code", "verifyPhoneCode", "123456"],
  ["totp", "verifyTOTP", "123456"],
  ["backup_code", "verifyBackupCode", "backup-code-a1b2"],
] as const satisfies ReadonlyArray<readonly [ConnectSecondFactor, string, string]>;

describe("Connect second-factor completion", () => {
  it("offers only enrolled supported verification methods without duplicates", () => {
    const signIn = fixture();
    signIn.supportedSecondFactors = [
      { strategy: "backup_code" },
      { strategy: "passkey" },
      { strategy: "email_code" },
      { strategy: "email_code" },
    ];
    expect(connectSecondFactors(signIn)).toEqual(["email_code", "backup_code"]);
    expect(connectSecondFactors({ ...signIn, supportedSecondFactors: undefined })).toEqual([]);
  });

  it("transitions a verified first factor to MFA without activating an incomplete session", async () => {
    const signIn = fixture("needs_first_factor");
    await expect(verifyConnectEmailCode(signIn, "123456")).resolves.toBe("second-factor");
    expect(signIn.emailCode.verifyCode).toHaveBeenCalledOnce();
    expect(signIn.finalize).not.toHaveBeenCalled();
    await expect(verifyConnectEmailCode(signIn, "123456")).resolves.toBe("second-factor");
    expect(signIn.emailCode.verifyCode).toHaveBeenCalledOnce();
  });

  it("prepares client-trust email verification without consuming the first code again", async () => {
    const signIn = fixture("needs_client_trust");
    signIn.supportedSecondFactors = [{ strategy: "email_code" }];
    await expect(verifyConnectEmailCode(signIn, "")).resolves.toBe("second-factor");
    await prepareConnectSecondFactor(signIn, "email_code");
    expect(signIn.mfa.sendEmailCode).toHaveBeenCalledOnce();
    expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
    expect(signIn.emailCode.verifyCode).not.toHaveBeenCalled();
    expect(signIn.finalize).not.toHaveBeenCalled();
  });

  it("sends an enrolled phone code and keeps local authenticators and backups offline", async () => {
    const signIn = fixture();
    await prepareConnectSecondFactor(signIn, "phone_code");
    await prepareConnectSecondFactor(signIn, "totp");
    await prepareConnectSecondFactor(signIn, "backup_code");
    expect(signIn.mfa.sendPhoneCode).toHaveBeenCalledOnce();
    expect(signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
    expect(signIn.finalize).not.toHaveBeenCalled();
  });

  it.each(verificationMethods)(
    "activates the account only after %s verification completes",
    async (strategy, method, code) => {
      const signIn = fixture();
      await expect(verifyConnectSecondFactor(signIn, strategy, ` ${code} `)).resolves.toBe(
        "complete",
      );
      expect(signIn.mfa[method]).toHaveBeenCalledWith({ code });
      expect(signIn.emailCode.verifyCode).not.toHaveBeenCalled();
      expect(signIn.finalize).toHaveBeenCalledOnce();
    },
  );

  it.each(verificationMethods)(
    "preserves a rejected %s code for retry without activating the account",
    async (strategy, method, code) => {
      const signIn = fixture();
      const rejected = { errors: [{ code: "form_code_incorrect" }] };
      signIn.mfa[method].mockResolvedValueOnce({ error: rejected });
      await expect(verifyConnectSecondFactor(signIn, strategy, code)).rejects.toBe(rejected);
      expect(signIn.finalize).not.toHaveBeenCalled();
      await expect(verifyConnectSecondFactor(signIn, strategy, code)).resolves.toBe("complete");
      expect(signIn.mfa[method]).toHaveBeenCalledTimes(2);
      expect(signIn.finalize).toHaveBeenCalledOnce();
    },
  );

  it("retries session activation without consuming a verified backup code again", async () => {
    const signIn = fixture();
    const failure = new Error("Network unavailable");
    signIn.finalize.mockResolvedValueOnce({ error: failure });
    await expect(verifyConnectSecondFactor(signIn, "backup_code", "backup-code")).rejects.toBe(
      failure,
    );
    expect(signIn.status).toBe("complete");
    await expect(verifyConnectSecondFactor(signIn, "backup_code", "backup-code")).resolves.toBe(
      "complete",
    );
    expect(signIn.mfa.verifyBackupCode).toHaveBeenCalledOnce();
    expect(signIn.finalize).toHaveBeenCalledTimes(2);
  });

  it("keeps successful but unfinished verification out of the active account", async () => {
    const signIn = fixture();
    signIn.mfa.verifyTOTP.mockImplementationOnce(async () => ({ error: null }));
    await expect(verifyConnectSecondFactor(signIn, "totp", "123456")).resolves.toBe(
      "second-factor",
    );
    expect(signIn.finalize).not.toHaveBeenCalled();
  });

  it("returns actionable recovery for unsupported account factors", async () => {
    const signIn = fixture();
    signIn.supportedSecondFactors = [{ strategy: "passkey" }];
    expect(connectSecondFactors(signIn)).toEqual([]);
    await expect(verifyConnectEmailCode(signIn, "123456")).rejects.toThrow("pairing link");
    await expect(prepareConnectSecondFactor(signIn, "email_code")).rejects.toThrow(
      "no longer available",
    );
    await expect(verifyConnectSecondFactor(signIn, "email_code", "123456")).rejects.toThrow(
      "no longer available",
    );
    expect(signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
    expect(signIn.mfa.verifyEmailCode).not.toHaveBeenCalled();
    expect(signIn.finalize).not.toHaveBeenCalled();
  });

  it("rejects preparation with stale state or without the installed MFA API", async () => {
    const signIn = fixture("complete");
    await expect(prepareConnectSecondFactor(signIn, "totp")).rejects.toThrow("no longer available");
    signIn.status = "needs_second_factor";
    const withoutMfa = { ...signIn, mfa: undefined };
    await expect(prepareConnectSecondFactor(withoutMfa, "email_code")).rejects.toThrow(
      "no longer available",
    );
    await expect(verifyConnectSecondFactor(withoutMfa, "totp", "123456")).rejects.toThrow(
      "no longer available",
    );
    expect(signIn.finalize).not.toHaveBeenCalled();
  });

  it("surfaces delivery failures without pretending another code was sent", async () => {
    const signIn = fixture();
    const failure = new Error("Delivery unavailable");
    signIn.mfa.sendEmailCode.mockResolvedValueOnce({ error: failure });
    await expect(prepareConnectSecondFactor(signIn, "email_code")).rejects.toBe(failure);
    expect(signIn.finalize).not.toHaveBeenCalled();
  });

  it.each([
    ["totp", ""],
    ["totp", "12345"],
    ["phone_code", "abcdef"],
    ["email_code", "1234567"],
    ["backup_code", "  "],
  ] as const)("validates %s code %j before contacting the service", async (strategy, code) => {
    const signIn = fixture();
    await expect(verifyConnectSecondFactor(signIn, strategy, code)).rejects.toThrow("Enter");
    expect(signIn.mfa.verifyTOTP).not.toHaveBeenCalled();
    expect(signIn.mfa.verifyPhoneCode).not.toHaveBeenCalled();
    expect(signIn.mfa.verifyEmailCode).not.toHaveBeenCalled();
    expect(signIn.mfa.verifyBackupCode).not.toHaveBeenCalled();
    expect(signIn.finalize).not.toHaveBeenCalled();
  });
});

describe("Connect native hosted account pages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens signup and profile pages from explicit configuration without browser globals", () => {
    vi.stubGlobal("window", undefined);
    expect(connectAccountPageUrl("https://accounts.example.test", "sign-up")).toBe(
      "https://accounts.example.test/sign-up",
    );
    expect(connectAccountPageUrl("https://accounts.example.test/", "user")).toBe(
      "https://accounts.example.test/user",
    );
  });

  it.each([
    null,
    "http://accounts.example.test",
    "https://name:password@accounts.example.test",
    "https://accounts.example.test/path",
    "https://accounts.example.test/?token=secret",
    "https://accounts.example.test/#profile",
    "not-a-url",
  ])("rejects an unavailable or unsafe account portal %j", (portal) => {
    expect(() => connectAccountPageUrl(portal, "sign-up")).toThrow();
  });
});
