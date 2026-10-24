import { EnvironmentId } from "@t3tools/contracts";
import { type IdentityGrant, identityGrantKey } from "@t3tools/shared/fork/identity-grant";
import { describe, expect, it } from "vite-plus/test";

import {
  decodeIdentityGrants,
  IDENTITY_GRANTS_STORAGE_KEY,
  type IdentityGrantSecureStorage,
  makeIdentityGrantStore,
} from "./grantStore";

const grant = (environmentId: string, overrides: Partial<IdentityGrant> = {}): IdentityGrant => ({
  version: 1,
  issuer: "https://id.example.test",
  subject: "subject-1",
  environmentId: EnvironmentId.make(environmentId),
  httpBaseUrl: `https://${environmentId}.example.test`,
  clientId: "native-client",
  tokenEndpoint: "https://id.example.test/api/oidc/token",
  refreshToken: `refresh-${environmentId}`,
  idToken: `id-${environmentId}`,
  grantedAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

/** Yields between every call, so unserialized read, modify and write cycles would interleave. */
function memoryStorage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set(IDENTITY_GRANTS_STORAGE_KEY, initial);
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const storage: IdentityGrantSecureStorage = {
    getItem: async (key) => {
      await tick();
      return items.get(key) ?? null;
    },
    setItem: async (key, value) => {
      await tick();
      items.set(key, value);
    },
    removeItem: async (key) => {
      await tick();
      items.delete(key);
    },
  };
  return { items, storage };
}

describe("identity grant storage", () => {
  it("keeps valid grants and drops unreadable entries and documents", () => {
    const valid = grant("computer-a");
    const decoded = decodeIdentityGrants(
      JSON.stringify({
        version: 1,
        grants: [valid, { ...valid, refreshToken: 7 }, "junk", { version: 2 }],
      }),
    );
    expect([...decoded.values()]).toEqual([valid]);
    expect(decoded.get(identityGrantKey(valid))).toEqual(valid);
    for (const raw of [null, "not json", JSON.stringify({ version: 2, grants: [valid] })])
      expect(decodeIdentityGrants(raw).size).toBe(0);
  });

  it("rewrites the document with only valid grants on the next change", async () => {
    const kept = grant("computer-a");
    const { items, storage } = memoryStorage(
      JSON.stringify({ version: 1, grants: [kept, { broken: true }] }),
    );
    const store = makeIdentityGrantStore(storage);
    await store.put(grant("computer-b"));
    const stored = JSON.parse(items.get(IDENTITY_GRANTS_STORAGE_KEY)!);
    expect(stored.grants.map((entry: IdentityGrant) => entry.environmentId)).toEqual([
      "computer-a",
      "computer-b",
    ]);
  });

  it("keeps both rotations when two computers renew at once", async () => {
    const { storage } = memoryStorage();
    const store = makeIdentityGrantStore(storage);
    const a = grant("computer-a");
    const b = grant("computer-b");
    await Promise.all([store.put(a), store.put(b)]);
    await Promise.all([
      store.replaceIfSameSignIn({ ...a, refreshToken: "refresh-a-2" }),
      store.replaceIfSameSignIn({ ...b, refreshToken: "refresh-b-2" }),
    ]);
    expect((await store.get(identityGrantKey(a)))?.refreshToken).toBe("refresh-a-2");
    expect((await store.get(identityGrantKey(b)))?.refreshToken).toBe("refresh-b-2");
  });

  it("never brings back a removed grant or replaces a newer sign-in", async () => {
    const { items, storage } = memoryStorage();
    const store = makeIdentityGrantStore(storage);
    const older = grant("computer-a");
    const key = identityGrantKey(older);

    await store.put(older);
    await store.remove(key);
    await store.replaceIfSameSignIn({ ...older, refreshToken: "rotated" });
    expect(await store.get(key)).toBeNull();
    expect(items.has(IDENTITY_GRANTS_STORAGE_KEY)).toBe(false);

    const newer = { ...older, refreshToken: "newer", grantedAt: 2_000 };
    await store.put(newer);
    await store.replaceIfSameSignIn({ ...older, refreshToken: "rotated" });
    await store.removeIfSameSignIn(older);
    expect(await store.get(key)).toEqual(newer);

    await store.removeIfSameSignIn(newer);
    expect(await store.get(key)).toBeNull();
  });

  it("fails a change instead of overwriting grants it could not read", async () => {
    const { items, storage } = memoryStorage();
    const store = makeIdentityGrantStore(storage);
    await store.put(grant("computer-a"));
    const before = items.get(IDENTITY_GRANTS_STORAGE_KEY);
    const locked = makeIdentityGrantStore({
      ...storage,
      getItem: async () => {
        throw new Error("keychain locked");
      },
    });
    await expect(locked.put(grant("computer-b"))).rejects.toThrow("keychain locked");
    expect(items.get(IDENTITY_GRANTS_STORAGE_KEY)).toBe(before);
  });
});
