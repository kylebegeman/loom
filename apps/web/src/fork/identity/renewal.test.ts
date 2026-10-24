import { EnvironmentId, type DesktopBridge } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { desktopIdentityRenewal } from "./renewal";

const environmentId = EnvironmentId.make("environment-identity");
const identity = { issuer: "https://id.example", subject: "user-1" };
const request = {
  httpBaseUrl: "https://studio.example",
  environmentId,
  identity,
  currentToken: null,
};

function bridge(methods: Pick<DesktopBridge, "renewLoomIdentity" | "forgetLoomIdentity">) {
  return methods as DesktopBridge;
}

describe("desktopIdentityRenewal", () => {
  it.effect("returns the renewed session only when it belongs to the requested computer", () =>
    Effect.gen(function* () {
      const sent: Array<unknown> = [];
      const renewal = desktopIdentityRenewal(
        bridge({
          renewLoomIdentity: async (input) => {
            sent.push(input);
            return {
              _tag: "Renewed",
              session: {
                httpBaseUrl: input.httpBaseUrl,
                accessToken: "renewed",
                environmentId: input.environmentId,
                identity:
                  sent.length === 1 ? input.identity : { ...input.identity, subject: "other" },
                expiresAt: 1_000,
              },
            };
          },
        }),
      )!;

      expect(yield* renewal.renew(request)).toEqual({
        _tag: "Renewed",
        token: "renewed",
        expiresAt: 1_000,
      });
      expect(sent).toEqual([{ httpBaseUrl: request.httpBaseUrl, environmentId, identity }]);
      expect((yield* renewal.renew(request))._tag).toBe("SignInRequired");
    }),
  );

  it.effect("treats a failed bridge call as retryable and ignores a failed forget", () =>
    Effect.gen(function* () {
      const renewal = desktopIdentityRenewal(
        bridge({
          renewLoomIdentity: () => Promise.reject(new Error("offline")),
          forgetLoomIdentity: () => Promise.reject(new Error("keychain locked")),
        }),
      )!;

      expect(yield* renewal.renew(request).pipe(Effect.flip)).toMatchObject({
        _tag: "ConnectionTransientError",
      });
      yield* renewal.forget({ httpBaseUrl: request.httpBaseUrl, environmentId, identity });
    }),
  );

  it("is unavailable without the desktop renewal bridge", () => {
    expect(desktopIdentityRenewal(bridge({}))).toBeNull();
  });
});
