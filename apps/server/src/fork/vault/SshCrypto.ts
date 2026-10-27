// @effect-diagnostics nodeBuiltinImport:off -- Node's crypto adapter owns SSH wire encoding and Ed25519 signatures.
import * as NodeCrypto from "node:crypto";
import { VaultSshError, type VaultSshTarget } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export const sshUint32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
export const sshString = (value: string | Buffer) => {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  return Buffer.concat([sshUint32(bytes.length), bytes]);
};
export class SshReader {
  private offset = 0;
  private readonly buffer: Buffer;
  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }
  byte() {
    if (this.offset >= this.buffer.length) throw new Error("Invalid SSH frame");
    return this.buffer[this.offset++]!;
  }
  uint32() {
    if (this.offset + 4 > this.buffer.length) throw new Error("Invalid SSH frame");
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }
  string() {
    const length = this.uint32();
    if (length > 16384 || this.offset + length > this.buffer.length)
      throw new Error("Invalid SSH frame");
    const result = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  padding() {
    const remaining = this.buffer.length - this.offset;
    if (this.buffer.length % 8 !== 0 || remaining > 8) throw new Error("Invalid SSH padding");
    for (let i = 1; i <= remaining; i++)
      if (this.byte() !== i) throw new Error("Invalid SSH padding");
  }
  end() {
    if (this.offset !== this.buffer.length) throw new Error("Trailing SSH data");
  }
}
const blob = (line: string) => {
  const bytes = Buffer.from(line.slice("ssh-ed25519 ".length), "base64");
  const reader = new SshReader(bytes);
  if (reader.string().toString() !== "ssh-ed25519" || reader.string().length !== 32)
    throw new Error("Invalid Ed25519 key");
  reader.end();
  if (`ssh-ed25519 ${bytes.toString("base64")}` !== line) throw new Error("Noncanonical SSH key");
  return bytes;
};
const publicLine = (key: NodeCrypto.KeyObject) => {
  const jwk = NodeCrypto.createPublicKey(key).export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || !jwk.x) throw new Error("Unsupported key");
  return `ssh-ed25519 ${Buffer.concat([sshString("ssh-ed25519"), sshString(Buffer.from(jwk.x, "base64url"))]).toString("base64")}`;
};
const importKey = (value: string) => {
  const text = value.trim();
  if (!text.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")) {
    if (!/^-----BEGIN PRIVATE KEY-----[\s\S]*-----END PRIVATE KEY-----$/.test(text))
      throw new Error("Unsupported private key");
    return NodeCrypto.createPrivateKey(text);
  }
  const body = text
    .replace(/^-----BEGIN OPENSSH PRIVATE KEY-----\s*/, "")
    .replace(/\s*-----END OPENSSH PRIVATE KEY-----$/, "")
    .replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error("Invalid OpenSSH key");
  const buffer = Buffer.from(body, "base64");
  if (
    buffer.toString("base64") !== body ||
    buffer.subarray(0, 15).toString() !== "openssh-key-v1\0"
  )
    throw new Error("Invalid OpenSSH envelope");
  const outer = new SshReader(buffer.subarray(15));
  if (
    outer.string().toString() !== "none" ||
    outer.string().toString() !== "none" ||
    outer.string().length !== 0 ||
    outer.uint32() !== 1
  )
    throw new Error("Encrypted or multiple SSH keys are unsupported");
  const publicBlob = outer.string(),
    inner = new SshReader(outer.string());
  outer.end();
  if (inner.uint32() !== inner.uint32() || inner.string().toString() !== "ssh-ed25519")
    throw new Error("Invalid Ed25519 key");
  const publicBytes = inner.string(),
    secret = inner.string();
  inner.string();
  inner.padding();
  if (publicBytes.length !== 32 || secret.length !== 64 || !secret.subarray(32).equals(publicBytes))
    throw new Error("Invalid Ed25519 private key");
  // Derive the public key independently of the two public copies in the OpenSSH envelope.
  const key = NodeCrypto.createPrivateKey({
    format: "der",
    type: "pkcs8",
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      secret.subarray(0, 32),
    ]),
  });
  if (
    !blob(publicLine(key)).equals(publicBlob) ||
    !Buffer.from(NodeCrypto.createPublicKey(key).export({ format: "jwk" }).x!, "base64url").equals(
      publicBytes,
    )
  )
    throw new Error("Mismatched SSH public key");
  return key;
};
const invalid = () => new VaultSshError({ reason: "invalid-key" });
export type SshBinding = { readonly sessionId: Buffer };
export class SshCrypto extends Context.Service<
  SshCrypto,
  {
    readonly importKey: (
      privateKey: Redacted.Redacted<string>,
    ) => Effect.Effect<{ privateKey: Redacted.Redacted<string>; publicKey: string }, VaultSshError>;
    readonly create: Effect.Effect<
      { privateKey: Redacted.Redacted<string>; publicKey: string },
      VaultSshError
    >;
    readonly publicKey: (
      privateKey: Redacted.Redacted<string>,
    ) => Effect.Effect<string, VaultSshError>;
    readonly fingerprint: (publicKey: string) => Effect.Effect<string, VaultSshError>;
    readonly respond: (input: {
      frame: Buffer;
      binding: SshBinding | null;
      target: VaultSshTarget;
      privateKey: Redacted.Redacted<string>;
      publicKey: string;
    }) => Effect.Effect<
      { response: Buffer; binding: SshBinding | null; signed: boolean },
      VaultSshError
    >;
  }
>()("t3/fork/vault/SshCrypto") {}
export const layer = Layer.succeed(SshCrypto, {
  importKey: Effect.fn("SshCrypto.importKey")(function (value) {
    return Effect.try({
      try: () => {
        const key = importKey(Redacted.value(value));
        return {
          publicKey: publicLine(key),
          privateKey: Redacted.make(key.export({ type: "pkcs8", format: "pem" }).toString()),
        };
      },
      catch: invalid,
    });
  }),
  create: Effect.try({
    try: () => {
      const pair = NodeCrypto.generateKeyPairSync("ed25519");
      return {
        privateKey: Redacted.make(
          pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        ),
        publicKey: publicLine(pair.privateKey),
      };
    },
    catch: invalid,
  }),
  publicKey: Effect.fn("SshCrypto.publicKey")(function (privateKey) {
    return Effect.try({
      try: () => publicLine(NodeCrypto.createPrivateKey(Redacted.value(privateKey))),
      catch: invalid,
    });
  }),
  fingerprint: Effect.fn("SshCrypto.fingerprint")(function (publicKey) {
    return Effect.try({
      try: () =>
        `SHA256:${NodeCrypto.createHash("sha256").update(blob(publicKey)).digest("base64").replace(/=+$/, "")}`,
      catch: invalid,
    });
  }),
  respond: Effect.fn("SshCrypto.respond")(function (input) {
    return Effect.try({
      try: () => {
        if (!input.target.hostKey) throw new Error("Untrusted host");
        const reader = new SshReader(input.frame),
          type = reader.byte();
        let binding = input.binding;
        if (type === 11) {
          reader.end();
          return {
            response: Buffer.concat([
              Buffer.from([12]),
              sshUint32(1),
              sshString(blob(input.publicKey)),
              sshString("Loom Vault"),
            ]),
            binding,
            signed: false,
          };
        }
        if (type === 27) {
          if (reader.string().toString() !== "session-bind@openssh.com" || binding)
            throw new Error("Unsupported binding");
          const host = reader.string(),
            sessionId = reader.string(),
            signature = new SshReader(reader.string()),
            forwarding = reader.byte();
          reader.end();
          if (
            !host.equals(blob(input.target.hostKey)) ||
            ![32, 48, 64].includes(sessionId.length) ||
            forwarding !== 0 ||
            signature.string().toString() !== "ssh-ed25519"
          )
            throw new Error("Invalid host binding");
          const bytes = signature.string();
          signature.end();
          const hostReader = new SshReader(host);
          hostReader.string();
          const hostObject = NodeCrypto.createPublicKey({
            key: Buffer.concat([
              Buffer.from("302a300506032b6570032100", "hex"),
              hostReader.string(),
            ]),
            type: "spki",
            format: "der",
          });
          if (!NodeCrypto.verify(null, sessionId, hostObject, bytes))
            throw new Error("Invalid host signature");
          binding = { sessionId };
          return { response: Buffer.from([6]), binding, signed: false };
        }
        if (type !== 13 || !binding || !reader.string().equals(blob(input.publicKey)))
          throw new Error("Unsupported signing request");
        const data = reader.string(),
          flags = reader.uint32();
        reader.end();
        const auth = new SshReader(data);
        const sessionId = auth.string(),
          messageType = auth.byte(),
          username = auth.string().toString(),
          service = auth.string().toString(),
          method = auth.string().toString(),
          present = auth.byte(),
          algorithm = auth.string().toString(),
          publicKey = auth.string();
        if (
          !sessionId.equals(binding.sessionId) ||
          messageType !== 50 ||
          username !== input.target.username ||
          service !== "ssh-connection" ||
          method !== "publickey-hostbound-v00@openssh.com" ||
          present !== 1 ||
          algorithm !== "ssh-ed25519" ||
          !publicKey.equals(blob(input.publicKey)) ||
          !auth.string().equals(blob(input.target.hostKey)) ||
          flags !== 0
        )
          throw new Error("Invalid authentication request");
        auth.end();
        const signature = NodeCrypto.sign(
          null,
          data,
          NodeCrypto.createPrivateKey(Redacted.value(input.privateKey)),
        );
        return {
          response: Buffer.concat([
            Buffer.from([14]),
            sshString(Buffer.concat([sshString("ssh-ed25519"), sshString(signature)])),
          ]),
          binding,
          signed: true,
        };
      },
      catch: invalid,
    });
  }),
});
