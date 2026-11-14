import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "loom.join-approvals.v1";

/** Usable only while the phone is unlocked, and never restored to another device. */
const keychain: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const StoredApproval = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.Number,
  /** The Loom Identity subject this phone's Library connection used when the token was issued. */
  account: Schema.NullOr(Schema.String),
});
const StoredApprovals = Schema.fromJsonString(Schema.Record(Schema.String, StoredApproval));
const decodeApprovals = Schema.decodeUnknownOption(StoredApprovals);
const encodeApprovals = Schema.encodeSync(StoredApprovals);
type StoredApprovals = typeof StoredApprovals.Type;

/** Left before expiry so a token never lapses between Face ID and the Library checking it. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * The token that approves for this Library, or null once it is about to expire or the phone's
 * Library connection signed in with another account than the one it was issued for.
 */
export function usableJoinApproval(
  approvals: StoredApprovals,
  environmentId: EnvironmentId,
  account: string | null,
  now: number,
): string | null {
  const stored = approvals[environmentId];
  if (stored === undefined || stored.account !== account) return null;
  return stored.expiresAt - EXPIRY_MARGIN_MS > now ? stored.token : null;
}

let tail: Promise<unknown> = Promise.resolve();
const exclusive = <A>(run: () => Promise<A>): Promise<A> => {
  const next = tail.then(run, run);
  tail = next.catch(() => undefined);
  return next;
};

async function read(): Promise<StoredApprovals> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY, keychain);
  return raw === null ? {} : Option.getOrElse(decodeApprovals(raw), () => ({}));
}

async function write(approvals: StoredApprovals) {
  if (Object.keys(approvals).length === 0) await SecureStore.deleteItemAsync(STORAGE_KEY, keychain);
  else await SecureStore.setItemAsync(STORAGE_KEY, encodeApprovals(approvals), keychain);
}

export const joinApprovalStore = {
  get: (environmentId: EnvironmentId, account: string | null) =>
    exclusive(async () => usableJoinApproval(await read(), environmentId, account, Date.now())),
  put: (
    environmentId: EnvironmentId,
    account: string | null,
    device: { readonly token: string; readonly expiresAt: number },
  ) => exclusive(async () => write({ ...(await read()), [environmentId]: { ...device, account } })),
  remove: (environmentId: EnvironmentId) =>
    exclusive(async () => {
      const { [environmentId]: _removed, ...rest } = await read();
      await write(rest);
    }),
};
