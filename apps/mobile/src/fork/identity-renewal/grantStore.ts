import {
  IdentityGrant,
  identityGrantKey,
  type IdentityGrantStore,
} from "@t3tools/shared/fork/identity-grant";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Kept apart from the connection catalog, which discards its whole document when one part is unreadable. */
export const IDENTITY_GRANTS_STORAGE_KEY = "loom.identity.grants.v1";

export interface IdentityGrantSecureStorage {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
  readonly removeItem: (key: string) => Promise<void>;
}

export interface MobileIdentityGrantStore extends IdentityGrantStore {
  /**
   * Saves a rotated grant only while the stored grant still comes from the same sign-in, so a
   * renewal that finishes after a removal or a newer sign-in never brings an older grant back.
   */
  readonly replaceIfSameSignIn: (grant: IdentityGrant) => Promise<void>;
  /** Removes the stored grant only while it still comes from the same sign-in as `grant`. */
  readonly removeIfSameSignIn: (grant: IdentityGrant) => Promise<void>;
}

const StoredGrants = Schema.Struct({
  version: Schema.Literal(1),
  grants: Schema.Array(Schema.Unknown),
});
const decodeStoredGrants = Schema.decodeUnknownOption(Schema.fromJsonString(StoredGrants));
const decodeGrant = Schema.decodeUnknownOption(IdentityGrant);
const encodeStoredGrants = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({ version: Schema.Literal(1), grants: Schema.Array(IdentityGrant) }),
  ),
);

/** Unreadable documents and entries are dropped; the next write leaves only valid grants. */
export function decodeIdentityGrants(raw: string | null): Map<string, IdentityGrant> {
  const grants = new Map<string, IdentityGrant>();
  if (raw === null) return grants;
  const stored = decodeStoredGrants(raw);
  if (Option.isNone(stored)) return grants;
  for (const entry of stored.value.grants) {
    const grant = decodeGrant(entry);
    if (Option.isSome(grant)) grants.set(identityGrantKey(grant.value), grant.value);
  }
  return grants;
}

const sameSignIn = (stored: IdentityGrant | undefined, grant: IdentityGrant) =>
  stored !== undefined && stored.grantedAt === grant.grantedAt;

/**
 * Every change is a read, modify and write of one document. Changes run one at a time, so two
 * computers renewing together cannot drop each other's rotated refresh token, which Pocket ID
 * would treat as reuse a minute later and answer by revoking the grant.
 */
export function makeIdentityGrantStore(
  storage: IdentityGrantSecureStorage,
): MobileIdentityGrantStore {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <A>(run: () => Promise<A>): Promise<A> => {
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  };
  // A failed read throws instead of looking empty, so a locked keychain never erases other grants.
  const read = async () => decodeIdentityGrants(await storage.getItem(IDENTITY_GRANTS_STORAGE_KEY));
  const change = (
    key: string,
    next: (stored: IdentityGrant | undefined) => IdentityGrant | undefined,
  ): Promise<void> =>
    exclusive(async () => {
      const grants = await read();
      const stored = grants.get(key);
      const replacement = next(stored);
      if (replacement === stored) return;
      if (replacement === undefined) grants.delete(key);
      else grants.set(key, replacement);
      if (grants.size === 0) await storage.removeItem(IDENTITY_GRANTS_STORAGE_KEY);
      else
        await storage.setItem(
          IDENTITY_GRANTS_STORAGE_KEY,
          encodeStoredGrants({ version: 1, grants: [...grants.values()] }),
        );
    });

  return {
    get: (key) => exclusive(async () => (await read()).get(key) ?? null),
    put: (grant) => change(identityGrantKey(grant), () => grant),
    remove: (key) => change(key, () => undefined),
    replaceIfSameSignIn: (grant) =>
      change(identityGrantKey(grant), (stored) => (sameSignIn(stored, grant) ? grant : stored)),
    removeIfSameSignIn: (grant) =>
      change(identityGrantKey(grant), (stored) => (sameSignIn(stored, grant) ? undefined : stored)),
  };
}
