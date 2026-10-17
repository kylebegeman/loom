import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import { readLoomIdentity, loomBrowserLoginUrl, loomIdentityUrl } from "./loomIdentity";
const metadata: LoomIdentityMetadata = {
  enabled: true,
  browserLoginEnabled: true,
  issuer: "https://identity.example.com",
  clientId: "loom",
  authorizationEndpoint: "https://identity.example.com/authorize",
  tokenEndpoint: "https://identity.example.com/token",
  scopes: ["openid"],
  audience: "loom",
  environmentId: EnvironmentId.make("central"),
};
afterEach(() => vi.unstubAllGlobals());
describe("Loom browser sign-in boundary", () => {
  it("requires the host's verified browser login capability", () => {
    expect(loomBrowserLoginUrl("https://library.example.com/library", metadata)).toBe(
      "https://library.example.com/api/loom/identity/login",
    );
    expect(
      loomBrowserLoginUrl("https://library.example.com", {
        ...metadata,
        browserLoginEnabled: false,
      }),
    ).toBeNull();
    expect(
      loomBrowserLoginUrl("https://library.example.com", { ...metadata, enabled: false }),
    ).toBeNull();
    expect(
      loomBrowserLoginUrl("https://library.example.com", { ...metadata, clientId: null }),
    ).toBeNull();
  });
  it("targets only the selected host origin and rejects URL credentials", () => {
    expect(
      loomIdentityUrl(
        "https://library.example.com/a?returnTo=https://other.example",
        "/api/loom/identity",
      ),
    ).toBe("https://library.example.com/api/loom/identity");
    expect(
      loomIdentityUrl("https://user:secret@library.example.com", "/api/loom/identity"),
    ).toBeNull();
    expect(loomIdentityUrl("file:///private", "/api/loom/identity")).toBeNull();
  });
  it("preserves pairing when the identity endpoint is unsupported", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    expect(await readLoomIdentity("https://old.example.com")).toBeNull();
  });
  it("decodes public metadata before advertising sign-in", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(metadata), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await readLoomIdentity("https://library.example.com")).toEqual(metadata);
    expect(fetch).toHaveBeenCalledWith("https://library.example.com/api/loom/identity", {
      credentials: "omit",
    });
    fetch.mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    await expect(readLoomIdentity("https://library.example.com")).rejects.toThrow();
  });
});

it("returns browser sign-in to the requested page only on the selected host", () => {
  const login = loomBrowserLoginUrl(
    "https://library.example.com",
    metadata,
    "https://library.example.com/sites?range=30#checks",
  );
  expect(new URL(login!).searchParams.get("returnTo")).toBe("/sites?range=30#checks");
  const remote = loomBrowserLoginUrl(
    "https://library.example.com",
    metadata,
    "https://local.example.com/sites",
  );
  expect(new URL(remote!).searchParams.has("returnTo")).toBe(false);
});
