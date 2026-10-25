import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;

type RenewalMetadata = Pick<LoomIdentityMetadata, "maxSessionAgeSeconds" | "sessionExchangeEnabled">;

/**
 * A computer lets a native client renew only when it caps sign-in age, since the cap is what ends
 * the refresh grant, and only through its session exchange. A cap under an hour renews nothing:
 * one sign-in already lasts that long.
 */
export function identityRenewalLimitSeconds(metadata: RenewalMetadata): number | null {
  const limit = metadata.maxSessionAgeSeconds;
  return metadata.sessionExchangeEnabled === true && limit !== undefined && limit > HOUR_SECONDS
    ? limit
    : null;
}

/** "7 days", "1 day" or "36 hours". */
function limitText(seconds: number): string {
  const days = Math.floor(seconds / DAY_SECONDS);
  if (days >= 2 || seconds % DAY_SECONDS === 0) return days === 1 ? "1 day" : `${days} days`;
  return `${Math.floor(seconds / HOUR_SECONDS)} hours`;
}

/**
 * One plain sentence on how long an Identity sign-in keeps this device connected. `renews` is
 * whether this client can renew at all: desktop with its renewal bridge and the phone can, a
 * browser never sees Identity tokens and cannot.
 */
export function identityRenewalText(input: {
  readonly metadata: RenewalMetadata;
  readonly renews: boolean;
}): string {
  const limit = identityRenewalLimitSeconds(input.metadata);
  if (limit === null) return "This computer does not renew sign-ins, so Loom asks you to sign in again every hour.";
  return input.renews
    ? `Loom renews this sign-in on its own for up to ${limitText(limit)}, then asks you to sign in again.`
    : `A browser asks you to sign in again every hour. The Loom app renews on its own for up to ${limitText(limit)}.`;
}
