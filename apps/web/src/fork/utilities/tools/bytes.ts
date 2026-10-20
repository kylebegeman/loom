const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const encoder = new TextEncoder();
export const utf8Bytes = (text: string) => encoder.encode(text);

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Table-driven so megabyte inputs never hit the argument limit of `String.fromCharCode(...)`. */
export function bytesToBase64(
  bytes: Uint8Array,
  options: { readonly urlSafe?: boolean; readonly padding?: boolean } = {},
): string {
  const alphabet = options.urlSafe ? BASE64_URL : BASE64;
  const padding = options.padding ?? true;
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    out += alphabet[a >> 2];
    out += alphabet[((a & 0x03) << 4) | (b >> 4)];
    out += remaining > 1 ? alphabet[((b & 0x0f) << 2) | (c >> 6)] : padding ? "=" : "";
    out += remaining > 2 ? alphabet[c & 0x3f] : padding ? "=" : "";
  }
  return out;
}

/** Hex with optional whitespace between bytes, or null when it is not whole bytes of hex. */
export function hexToBytes(text: string): Uint8Array | null {
  const cleaned = text.replace(/\s+/g, "");
  if (cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(cleaned)) return null;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(cleaned.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

const DECODE = new Map<string, number>([
  ...[...BASE64].map((char, index) => [char, index] as const),
  ["-", 62],
  ["_", 63],
]);

/**
 * Either alphabet, whitespace ignored, padding optional. Null for anything that is not
 * base64; callers that need to say why validate first.
 */
export function base64ToBytes(text: string): Uint8Array | null {
  const cleaned = text.replace(/\s+/g, "");
  const body = cleaned.replace(/={1,2}$/, "");
  if (body.length % 4 === 1) return null;
  if (cleaned.length !== body.length && cleaned.length % 4 !== 0) return null;
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4));
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (const char of body) {
    const value = DECODE.get(char);
    if (value === undefined) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}
