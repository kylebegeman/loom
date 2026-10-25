import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/reactivity";
import * as SecureStore from "expo-secure-store";

import { LibraryPushRecord } from "./libraryPushPlan";

/** Kept out of mobile preferences, whose every key would cost three upstream seams. */
export const LIBRARY_PUSH_STORAGE_KEY = "loom.push.library.v1";

/**
 * Readable after the first unlock, so a foreground after a locked night still knows the opt-in.
 * Kept on this device only: a restored backup on another phone has its own push token.
 */
const keychain: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const RecordJson = Schema.fromJsonString(LibraryPushRecord);
const decodeRecord = Schema.decodeUnknownOption(RecordJson);
const encodeRecord = Schema.encodeSync(RecordJson);

export type LibraryPushStored =
  | { readonly loaded: false }
  | { readonly loaded: true; readonly record: LibraryPushRecord | null };

export const libraryPushRecordAtom = Atom.make<LibraryPushStored>({ loaded: false }).pipe(
  Atom.keepAlive,
  Atom.withLabel("loom:library-push:record"),
);

let tail: Promise<unknown> = Promise.resolve();
const exclusive = <A>(run: () => Promise<A>): Promise<A> => {
  const next = tail.then(run, run);
  tail = next.catch(() => undefined);
  return next;
};

/**
 * A failed read throws and leaves the record unloaded, so a locked keychain never looks like
 * "never opted in". An unreadable document reads as none; the next write replaces it.
 */
async function read(registry: AtomRegistry.AtomRegistry): Promise<LibraryPushRecord | null> {
  const stored = registry.get(libraryPushRecordAtom);
  if (stored.loaded) return stored.record;
  const raw = await SecureStore.getItemAsync(LIBRARY_PUSH_STORAGE_KEY, keychain);
  const record = raw === null ? null : Option.getOrNull(decodeRecord(raw));
  registry.set(libraryPushRecordAtom, { loaded: true, record });
  return record;
}

export const loadLibraryPushRecord = (registry: AtomRegistry.AtomRegistry) =>
  exclusive(() => read(registry));

/**
 * Changes run one at a time against the latest record. The keychain is written first, so the
 * atom never shows a record the phone would forget on restart.
 */
export const updateLibraryPushRecord = (
  registry: AtomRegistry.AtomRegistry,
  change: (record: LibraryPushRecord | null) => LibraryPushRecord | null,
) =>
  exclusive(async () => {
    const record = await read(registry);
    const next = change(record);
    if (next === record) return record;
    if (next === null) await SecureStore.deleteItemAsync(LIBRARY_PUSH_STORAGE_KEY, keychain);
    else await SecureStore.setItemAsync(LIBRARY_PUSH_STORAGE_KEY, encodeRecord(next), keychain);
    registry.set(libraryPushRecordAtom, { loaded: true, record: next });
    return next;
  });
