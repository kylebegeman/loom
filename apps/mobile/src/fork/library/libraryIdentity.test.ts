import { AuthAccessTokenType, AuthTokenExchangeGrantType, EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  exchangeLibraryIdentityToken,
  libraryIdentityAddress,
  libraryIdentityResourceParameters,
  loadLibraryIdentity,
} from "./libraryIdentity";
const environmentId = EnvironmentId.make("selected-library");
const metadata: LoomIdentityMetadata = {
  enabled: true,
  browserLoginEnabled: true,
  issuer: "https://identity.example",
  clientId: "web-client",
  nativeClientId: "native-client",
  authorizationEndpoint: "https://identity.example/authorize",
  tokenEndpoint: "https://identity.example/token",
  scopes: ["openid", "profile"],
  audience: "loom",
  environmentId,
};
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
describe("native library identity", () => {
  it("requests Pocket ID custom API access with the RFC 8707 resource parameter", () => {
    expect(
      libraryIdentityResourceParameters({ ...metadata, resource: "https://loom.begam.in" }),
    ).toEqual({ resource: "https://loom.begam.in" });
    expect(libraryIdentityResourceParameters(metadata)).toEqual({});
  });
  it("uses the explicitly entered address and verifies the saved destination", async () => {
    const request = vi.fn<typeof fetch>(async () => response(metadata));
    expect(libraryIdentityAddress("https://library.example:9443/")).toEqual({
      httpBaseUrl: "https://library.example:9443",
      wsBaseUrl: "wss://library.example:9443/ws",
    });
    await expect(
      loadLibraryIdentity("https://library.example:9443", environmentId, request),
    ).resolves.toMatchObject({ nativeClientId: "native-client", environmentId });
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://library.example:9443/api/loom/identity",
    );
    await expect(
      loadLibraryIdentity(
        "https://library.example:9443",
        EnvironmentId.make("different-library"),
        request,
      ),
    ).rejects.toThrow("another library server");
  });
  it("requires native PKCE configuration and rejects embedded credentials", async () => {
    expect(() => libraryIdentityAddress("https://user:password@library.example")).toThrow(
      "without a path or credentials",
    );
    const request = vi.fn<typeof fetch>(async () =>
      response({ ...metadata, nativeClientId: undefined }),
    );
    await expect(
      loadLibraryIdentity("https://library.example", environmentId, request),
    ).rejects.toThrow("Native library sign-in is not configured");
  });
  it("exchanges the identity access token for a bearer on the exact library address", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response({
        access_token: "test-host-session",
        issued_token_type: AuthAccessTokenType,
        token_type: "Bearer",
        expires_in: 300,
        scope: "orchestration:read",
      }),
    );
    expect(
      await exchangeLibraryIdentityToken(
        "https://library.example",
        "test-identity-access",
        request,
      ),
    ).toMatchObject({ access_token: "test-host-session", token_type: "Bearer" });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe("https://library.example/oauth/token");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).not.toHaveProperty("DPoP");
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: AuthTokenExchangeGrantType,
      subject_token_type: AuthAccessTokenType,
      requested_token_type: AuthAccessTokenType,
      subject_token: "test-identity-access",
    });
  });
  it("does not accept a DPoP or expired result as a saved bearer", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response({
        access_token: "test-session",
        issued_token_type: AuthAccessTokenType,
        token_type: "DPoP",
        expires_in: 300,
        scope: "orchestration:read",
      }),
    );
    await expect(
      exchangeLibraryIdentityToken("https://library.example", "test-identity", request),
    ).rejects.toThrow("unsupported or expired");
    request.mockResolvedValueOnce(
      response({
        access_token: "test-session",
        issued_token_type: AuthAccessTokenType,
        token_type: "Bearer",
        expires_in: 0,
        scope: "orchestration:read",
      }),
    );
    await expect(
      exchangeLibraryIdentityToken("https://library.example", "test-identity", request),
    ).rejects.toThrow("unsupported or expired");
  });
});
