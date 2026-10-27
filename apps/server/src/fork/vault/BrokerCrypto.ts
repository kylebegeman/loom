// @effect-diagnostics nodeBuiltinImport:off -- Node's Ed25519 implementation is the broker signing adapter.
import * as NodeCrypto from "node:crypto";
import { VaultBrokerError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export class BrokerCrypto extends Context.Service<
  BrokerCrypto,
  {
    readonly create: Effect.Effect<
      { privateKey: Redacted.Redacted<string>; publicKey: string; fingerprint: string },
      VaultBrokerError
    >;
    readonly fingerprint: (publicKey: string) => Effect.Effect<string, VaultBrokerError>;
    readonly publicKey: (
      privateKey: Redacted.Redacted<string>,
    ) => Effect.Effect<string, VaultBrokerError>;
    readonly sign: (
      privateKey: Redacted.Redacted<string>,
      message: string,
    ) => Effect.Effect<string, VaultBrokerError>;
    readonly verify: (
      publicKey: string,
      message: string,
      signature: string,
    ) => Effect.Effect<boolean, VaultBrokerError>;
  }
>()("t3/fork/vault/BrokerCrypto") {}
const publicObject = (publicKey: string) => {
  const bytes = Buffer.from(publicKey, "base64");
  const key = NodeCrypto.createPublicKey({ key: bytes, type: "spki", format: "der" });
  if (
    key.asymmetricKeyType !== "ed25519" ||
    key.export({ type: "spki", format: "der" }).toString("base64") !== publicKey
  )
    throw new Error("Invalid broker key");
  return key;
};
const invalid = () => new VaultBrokerError({ reason: "invalid-proof" });
export const layer = Layer.succeed(
  BrokerCrypto,
  BrokerCrypto.of({
    create: Effect.try({
      try: () => {
        const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ed25519");
        const bytes = publicKey.export({ type: "spki", format: "der" });
        return {
          privateKey: Redacted.make(privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
          publicKey: bytes.toString("base64"),
          fingerprint: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
        };
      },
      catch: invalid,
    }),
    fingerprint: Effect.fn("BrokerCrypto.fingerprint")(function (key) {
      return Effect.try({
        try: () =>
          NodeCrypto.createHash("sha256")
            .update(publicObject(key).export({ type: "spki", format: "der" }))
            .digest("hex"),
        catch: invalid,
      });
    }),
    publicKey: Effect.fn("BrokerCrypto.publicKey")(function (key) {
      return Effect.try({
        try: () =>
          NodeCrypto.createPublicKey(Redacted.value(key))
            .export({ type: "spki", format: "der" })
            .toString("base64"),
        catch: invalid,
      });
    }),
    sign: Effect.fn("BrokerCrypto.sign")(function (key, message) {
      return Effect.try({
        try: () =>
          NodeCrypto.sign(
            null,
            Buffer.from(message),
            NodeCrypto.createPrivateKey(Redacted.value(key)),
          ).toString("base64"),
        catch: invalid,
      });
    }),
    verify: Effect.fn("BrokerCrypto.verify")(function (key, message, signature) {
      return Effect.try({
        try: () =>
          NodeCrypto.verify(
            null,
            Buffer.from(message),
            publicObject(key),
            Buffer.from(signature, "base64"),
          ),
        catch: invalid,
      });
    }),
  }),
);
