/** `getRandomValues` refuses more than 65,536 bytes per call. */
const MAX_RANDOM_CHUNK = 65_536;

/**
 * The app's random source. `getRandomValues` is the one random API that also works on
 * plain-`http` origins, where `crypto.randomUUID` and `crypto.subtle` are missing.
 */
export function cryptoRandom(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let offset = 0; offset < bytes; offset += MAX_RANDOM_CHUNK)
    globalThis.crypto.getRandomValues(
      out.subarray(offset, Math.min(bytes, offset + MAX_RANDOM_CHUNK)),
    );
  return out;
}

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
