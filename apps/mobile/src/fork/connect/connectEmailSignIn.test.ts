import { describe, expect, it, vi } from "vite-plus/test";

import {
  connectEmailSignInError,
  normalizeConnectEmail,
  sendConnectEmailCode,
  verifyConnectEmailCode,
  type ConnectEmailSignIn,
} from "./connectEmailSignIn";

function fixture(status = "needs_first_factor") {
  const signIn = {
    status,
    emailCode: {
      sendCode: vi.fn<() => Promise<{ error: unknown }>>(async () => ({ error: null })),
      verifyCode: vi.fn(async () => {
        signIn.status = "complete";
        return { error: null };
      }),
    },
    finalize: vi.fn<() => Promise<{ error: unknown }>>(async () => ({ error: null })),
  };
  return signIn;
}

describe("Connect email-code sign-in", () => {
  it("sends an email code through the configured account service without a native redirect", async () => {
    const signIn = fixture();
    await sendConnectEmailCode(signIn, "  kyle@example.test  ");
    expect(signIn.emailCode.sendCode).toHaveBeenCalledWith({ emailAddress: "kyle@example.test" });
  });

  it("validates input before contacting the service", async () => {
    const signIn = fixture();
    expect(() => normalizeConnectEmail("not an email")).toThrow("valid email");
    await expect(sendConnectEmailCode(signIn, "kyle@local")).rejects.toThrow("valid email");
    await expect(verifyConnectEmailCode(signIn, "12")).rejects.toThrow("six-digit");
    expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
    expect(signIn.emailCode.verifyCode).not.toHaveBeenCalled();
  });

  it("only activates a completely verified session", async () => {
    const signIn = fixture();
    await verifyConnectEmailCode(signIn, " 123456 ");
    expect(signIn.emailCode.verifyCode).toHaveBeenCalledWith({ code: "123456" });
    expect(signIn.finalize).toHaveBeenCalledOnce();
    signIn.emailCode.verifyCode.mockImplementation(async () => {
      signIn.status = "needs_second_factor";
      return { error: null };
    });
    signIn.status = "needs_first_factor";
    await expect(verifyConnectEmailCode(signIn, "123456")).rejects.toThrow("unavailable here");
    expect(signIn.finalize).toHaveBeenCalledOnce();
  });

  it("retries activation without consuming an already verified code twice", async () => {
    const error = new Error("Connection interrupted");
    const signIn = fixture("complete");
    signIn.finalize.mockResolvedValueOnce({ error });
    await expect(verifyConnectEmailCode(signIn, "123456")).rejects.toThrow(error);
    await verifyConnectEmailCode(signIn, "123456");
    expect(signIn.emailCode.verifyCode).not.toHaveBeenCalled();
    expect(signIn.finalize).toHaveBeenCalledTimes(2);
  });

  it("keeps a rejected or failed code out of the active account", async () => {
    const error = { errors: [{ code: "form_code_incorrect" }] };
    const signIn: ConnectEmailSignIn = {
      ...fixture(),
      emailCode: {
        sendCode: async () => ({ error }),
        verifyCode: async () => ({ error }),
      },
    };
    await expect(sendConnectEmailCode(signIn, "kyle@example.test")).rejects.toBe(error);
    await expect(verifyConnectEmailCode(signIn, "123456")).rejects.toBe(error);
    expect(signIn.finalize).not.toHaveBeenCalled();
    expect(connectEmailSignInError(error)).toContain("incorrect");
  });

  it("gives actionable account, expiry, retry and unknown-error recovery", () => {
    expect(connectEmailSignInError({ errors: [{ code: "form_identifier_not_found" }] })).toContain(
      "Create your account",
    );
    expect(connectEmailSignInError({ errors: [{ code: "verification_expired" }] })).toContain(
      "Send a new code",
    );
    expect(connectEmailSignInError({ errors: [{ code: "too_many_requests" }] })).toContain(
      "Wait a moment",
    );
    expect(connectEmailSignInError({ errors: [{}] })).toContain("Check your connection");
  });
});
