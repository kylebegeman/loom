import { describe, expect, it } from "@effect/vitest";
import {
  generatePreviewTicketKeyPair,
  isPreviewNonce,
  previewTicketAudience,
  previewTicketKeyId,
  previewTicketPrivateKey,
  previewTicketPublicKey,
  randomPreviewNonce,
  readRequestCookie,
  signPreviewTicket,
  verifyPreviewTicket,
} from "./ticket.ts";

const pair = generatePreviewTicketKeyPair();
const privateKey = previewTicketPrivateKey(pair.privateKey)!;
const publicKey = previewTicketPublicKey(pair.publicKey)!;
const keyId = previewTicketKeyId(pair.publicKey);
const issuer = "https://loom.begam.in";
const audience = previewTicketAudience("5173-abc123-dorothy.bagels.top");
const nonce = randomPreviewNonce();
const now = 1_800_000_000_000;

const sign = (overrides: Partial<Parameters<typeof signPreviewTicket>[0]> = {}) =>
  signPreviewTicket({
    privateKey,
    keyId,
    issuer,
    audience,
    subject: "pocket-id:kyle",
    nonce,
    nowMs: now,
    ...overrides,
  });

const expected = { publicKey, keyId, issuer, audience, nonce, nowMs: now };

describe("preview tickets", () => {
  it("round-trips a fresh ticket for one host and nonce", () => {
    expect(verifyPreviewTicket(sign(), expected)).toMatchObject({
      subject: "pocket-id:kyle",
      expiresAtMs: now + 60_000,
    });
  });

  it("refuses another host, nonce, issuer or key", () => {
    const token = sign();
    expect(verifyPreviewTicket(token, { ...expected, audience: "https://other" })).toBeNull();
    expect(verifyPreviewTicket(token, { ...expected, nonce: randomPreviewNonce() })).toBeNull();
    expect(verifyPreviewTicket(token, { ...expected, issuer: "https://evil" })).toBeNull();
    const other = generatePreviewTicketKeyPair();
    expect(
      verifyPreviewTicket(token, {
        ...expected,
        publicKey: previewTicketPublicKey(other.publicKey)!,
      }),
    ).toBeNull();
    expect(verifyPreviewTicket(token, { ...expected, keyId: "rotated" })).toBeNull();
  });

  it("refuses expired, future and tampered tickets", () => {
    expect(verifyPreviewTicket(sign(), { ...expected, nowMs: now + 120_000 })).toBeNull();
    expect(verifyPreviewTicket(sign({ nowMs: now + 120_000 }), expected)).toBeNull();
    const [header, payload, signature] = sign().split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), sub: "x" }),
    ).toString("base64url");
    expect(verifyPreviewTicket(`${header}.${forged}.${signature}`, expected)).toBeNull();
    expect(verifyPreviewTicket("not.a.ticket", expected)).toBeNull();
  });

  it("only accepts well-formed keys and nonces", () => {
    expect(previewTicketPublicKey("short")).toBeNull();
    expect(previewTicketPrivateKey("bm9wZQ")).toBeNull();
    expect(isPreviewNonce(nonce)).toBe(true);
    expect(isPreviewNonce("abc")).toBe(false);
  });

  it("reads one cookie and refuses duplicates", () => {
    expect(readRequestCookie(["a=1; __Host-x=2"], "__Host-x")).toBe("2");
    expect(readRequestCookie("__Host-x=2; __Host-x=3", "__Host-x")).toBeNull();
    expect(readRequestCookie(undefined, "__Host-x")).toBeNull();
  });
});
