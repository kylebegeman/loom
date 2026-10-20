// @effect-diagnostics nodeBuiltinImport:off -- Local import validation parses RSA material without contacting GitHub.
import * as NodeCrypto from "node:crypto";
import {
  VaultMigrationError,
  type VaultTypedMigrationCredential,
  type VaultTypedMigrationDetails,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SshCrypto from "./SshCrypto.ts";
import { StoredKey } from "./VaultSsh.ts";
import { Stored as GitHubStored } from "./VaultGitHub.ts";
const encodeSsh = Schema.encodeEffect(Schema.fromJsonString(StoredKey));
const encodeGitHub = Schema.encodeEffect(Schema.fromJsonString(GitHubStored));
const invalid = () => new VaultMigrationError({ reason: "invalid-credential" });
export const encodeTypedMigrationCredential = Effect.fn("VaultMigration.encodeTypedCredential")(
  function* (
    input: VaultTypedMigrationCredential,
    operationId: string,
  ): Effect.fn.Return<
    {
      kind: "ssh-key" | "service-connection";
      value: Redacted.Redacted<string>;
      details: VaultTypedMigrationDetails;
    },
    VaultMigrationError,
    SshCrypto.SshCrypto
  > {
    if (input.type === "ssh") {
      const crypto = yield* SshCrypto.SshCrypto;
      const key = yield* crypto.importKey(input.privateKey).pipe(Effect.mapError(invalid));
      if (input.target.hostKey)
        yield* crypto.fingerprint(input.target.hostKey).pipe(Effect.mapError(invalid));
      const fingerprint = yield* crypto.fingerprint(key.publicKey).pipe(Effect.mapError(invalid));
      const value = yield* encodeSsh({
        ...key,
        protocol: 1,
        target: input.target,
        generationOperationId: operationId,
        trustOperationId: null,
      }).pipe(Effect.mapError(invalid));
      return {
        kind: "ssh-key",
        value: Redacted.make(value),
        details: { type: "ssh", target: input.target, publicKey: key.publicKey, fingerprint },
      };
    }
    yield* Effect.try({
      try: () => {
        if (input.credential.type === "token") {
          if (!/^[A-Za-z0-9_]{10,255}$/.test(Redacted.value(input.credential.token)))
            throw new Error("Invalid token");
        } else {
          const key = NodeCrypto.createPrivateKey(Redacted.value(input.credential.privateKey));
          if (
            key.asymmetricKeyType !== "rsa" ||
            (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
          )
            throw new Error("Use an unencrypted RSA key of at least 2048 bits");
        }
      },
      catch: invalid,
    });
    const repositories = [...new Set(input.repositories.map((r) => r.toLowerCase()))].sort();
    const value = yield* encodeGitHub({
      schemaVersion: 1,
      provider: "github.com",
      credential: input.credential,
      account: input.account.toLowerCase(),
      repositories,
    }).pipe(Effect.mapError(invalid));
    return {
      kind: "service-connection",
      value: Redacted.make(value),
      details: {
        type: "github",
        account: input.account.toLowerCase(),
        repositories,
        mechanism: input.credential.type,
        appId: input.credential.type === "app" ? input.credential.appId : null,
        installationId: input.credential.type === "app" ? input.credential.installationId : null,
      },
    };
  },
);
