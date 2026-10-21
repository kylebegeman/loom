import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import { generateVaultPassword, type VaultPasswordOptions } from "@t3tools/client-runtime/fork";

export function generateLocalVaultPassword(options: VaultPasswordOptions): string {
  // getRandomBytes may fall back to Math.random in Expo development/debugger sessions.
  return generateVaultPassword(options, (count) => Crypto.getRandomValues(new Uint8Array(count)))
    .value;
}

export function copyLocalVaultPassword(value: string): Promise<boolean> {
  return Clipboard.setStringAsync(value, { android: { isSensitive: true } });
}
