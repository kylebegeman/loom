// @effect-diagnostics nodeBuiltinImport:off - SigV4 requires keyed HMAC, which Effect Crypto does not expose. This helper is pure.
import * as NodeCrypto from "node:crypto";

export interface B2SigningConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly keyId: string;
  readonly applicationKey: string;
}
const hexHash = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
const hmac = (key: string | Uint8Array, text: string) =>
  NodeCrypto.createHmac("sha256", key).update(text).digest();
const escape = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Signature V4 uses path-style object keys; credentials remain server-side. */
export function signB2ObjectUrl(
  config: B2SigningConfig,
  input: {
    readonly method: "GET" | "PUT";
    readonly objectKey: string;
    readonly now: string;
    readonly expiresInSeconds: number;
  },
) {
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !Number.isInteger(input.expiresInSeconds) ||
    input.expiresInSeconds < 1 ||
    input.expiresInSeconds > 900 ||
    !config.region ||
    !config.bucket ||
    !config.keyId ||
    !config.applicationKey ||
    input.objectKey.split("/").some((part) => part === "." || part === ".." || part.length === 0)
  )
    throw new Error("Invalid object storage signing configuration");
  const timestamp = input.now.replace(/[:-]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const path = `${endpoint.pathname.replace(/\/$/, "")}/${escape(config.bucket)}/${input.objectKey.split("/").map(escape).join("/")}`;
  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.keyId}/${scope}`],
    ["X-Amz-Date", timestamp],
    ["X-Amz-Expires", String(input.expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ]
    .map(([key, value]) => `${escape(key!)}=${escape(value!)}`)
    .sort()
    .join("&");
  const canonical = [
    input.method,
    path,
    query,
    `host:${endpoint.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.applicationKey}`, date), config.region), "s3"),
    "aws4_request",
  );
  const signature = hmac(
    signingKey,
    ["AWS4-HMAC-SHA256", timestamp, scope, hexHash(canonical)].join("\n"),
  ).toString("hex");
  return `${endpoint.origin}${path}?${query}&X-Amz-Signature=${signature}`;
}
